import "server-only";

import { fetchAccordCached, type FetchResult } from "./accord.server";
import { getDataset } from "./datasets";
import displayFormats from "./displayFormats.json";
import {
  yyyymmLabel,
  type CompanyFundamentals,
  type CompanyListItem,
  type ResultPeriod,
  type ShpMeasure,
  type SourceInfo,
  type Statement,
  type StatementRow,
} from "./fundamentals";
import { applyFlags, getField, toNumber, type Row } from "./rows";

/**
 * Company fundamentals, laid out the way Accord's technical document says
 * (CompanyFundamentals_DataFeedAPI_Display_Techdoc.pdf):
 *
 *  - Each statement's rows, labels, order, indent and formulas come from the
 *    *_Displayformat.xlsx files (converted to displayFormats.json by
 *    scripts/build_display_formats.py).
 *  - Which format to use comes from Company_master:
 *      Balance sheet  FFORMAT BNK / FIN → same, anything else → MAN
 *      P&L, Cash flow FFORMAT (AIR, HTL, POW, SOW …) → same, else MAN
 *      Ratios         FFORMAT BNK → BNK, else MAN
 *      Results        RFORMAT BNK / FIN / MAN, else MAN
 *  - Type_Flag C rows (minority interest etc.) only appear in consolidated.
 *  - FieldName can be a formula ("Reserve-Share_premium-…", "Isnull(a,0)+b").
 *
 * All money is shown in ₹ crore. Annual statements carry their own Unit per
 * row (1, 1000, 1 lakh, 1 million, 1 crore); results are in ₹ million.
 */

interface FormatRow {
  order: number;
  label: string;
  field: string | null;
  indent: number;
  bold: boolean;
  useUnit: boolean;
  typeFlag: string | null;
}
type FormatFile = Record<string, FormatRow[]>;
const FORMATS = displayFormats as unknown as Record<
  "bs" | "pl" | "cf" | "fr" | "resultsStd" | "resultsCons" | "shp",
  FormatFile
>;

const CRORE = 10_000_000;

const FILES = [
  "company-master",
  "industry-master",
  "company-address",
  "company-listings",
  "stock-exchange-master",
  "registrar-data",
  "registrar-master",
  "board",
  "finance-bs",
  "finance-pl",
  "finance-cf",
  "finance-fr",
  "finance-cons-bs",
  "finance-cons-pl",
  "finance-cons-cf",
  "finance-cons-fr",
  "results-std",
  "results-cons",
  "company-equity",
  "company-equity-cons",
  "shp-summary",
  "shp-details",
  "shp-catmaster",
] as const;
type FileId = (typeof FILES)[number];

type Loaded = Record<FileId, Row[]> & { sources: SourceInfo[] };

/** Load (from cache or Accord) and apply A/O/D flags to every file the page needs. */
async function loadAll(date: string, only: readonly FileId[] = FILES): Promise<Loaded> {
  const results = await Promise.all(only.map((id) => fetchAccordCached(id, date)));
  const out = { sources: [] as SourceInfo[] } as Loaded;
  results.forEach((res: FetchResult, i) => {
    const id = only[i];
    const merged = new Map<string, Row>();
    applyFlags(merged, res.rows, getDataset(id)?.primaryKey ?? []);
    out[id] = [...merged.values()];
    out.sources.push({
      dataset: id,
      filename: res.filename,
      status: res.status,
      count: res.count,
      message: res.ok && res.count ? undefined : res.message,
    });
  });
  return out;
}

const num = (row: Row | undefined, f: string) => (row ? toNumber(getField(row, f)) : null);
const str = (row: Row | undefined, f: string) => {
  const v = row ? getField(row, f) : null;
  return v == null ? "" : String(v).trim();
};
const byFincode = (rows: Row[], fincode: number) =>
  rows.filter((r) => toNumber(getField(r, "FINCODE")) === fincode);

// ── Formula evaluation ─────────────────────────────────────────

/** Lower-cased key lookup for one row (feeds mix FINCODE / Fincode / fincode). */
function lowerRow(row: Row): Map<string, unknown> {
  return new Map(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));
}

/**
 * Evaluate a display-format FieldName against a row. Supports field names,
 * numbers, + - * / ( ) and SQL's Isnull(x, 0). Missing values count as 0
 * inside a formula, but if none of the referenced fields has a value the
 * result is null (so empty lines stay empty).
 */
function evaluate(expr: string, row: Map<string, unknown>): number | null {
  if (/^\w+$/.test(expr)) return toNumber(row.get(expr.toLowerCase()));

  const tokens = expr.match(/isnull\s*\(|[A-Za-z_]\w*|\d+(?:\.\d+)?|[-+*/(),]/gi) ?? [];
  let pos = 0;
  let sawValue = false;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function factor(): number {
    const t = next();
    if (t === undefined) return 0;
    if (t === "-") return -factor();
    if (t === "(") {
      const v = sum();
      next(); // ")"
      return v;
    }
    if (/^isnull/i.test(t)) {
      // Isnull(x, 0): missing values already count as 0, so just use x.
      const v = sum();
      next(); // ","
      sum();
      next(); // ")"
      return v;
    }
    if (/^\d/.test(t)) return Number(t);
    const v = toNumber(row.get(t.toLowerCase()));
    if (v === null) return 0;
    sawValue = true;
    return v;
  }
  function product(): number {
    let v = factor();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const r = factor();
      v = op === "*" ? v * r : r === 0 ? 0 : v / r;
    }
    return v;
  }
  function sum(): number {
    let v = product();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  const v = sum();
  return sawValue ? Math.round(v * 10000) / 10000 : null;
}

// ── Statement building ─────────────────────────────────────────

/** Identity columns that the display formats list but that belong in the header. */
const SKIP_FIELDS = new Set([
  "fincode",
  "year_end",
  "type",
  "unit",
  "result_type",
  "date_end",
  "noofmonths",
  "no_months",
]);

/** Results rows that are not money (per-share, %, ratios, counts). */
const NON_MONETARY =
  /\beps\b|%|face value|\bratio\b|\btier\b|basel|\bno of\b|number of|return on assets|\bnim\b|months/i;

function pickFormat(file: FormatFile, wanted: string, allowed?: string[]): string {
  const w = (wanted || "").trim().toUpperCase();
  if ((!allowed || allowed.includes(w)) && file[w]) return w;
  return "MAN";
}

function build(
  format: FormatFile,
  formatName: string,
  consolidated: boolean,
  periods: Row[],
  scale: (row: FormatRow, period: Row, v: number) => number,
  periodLabel: (r: Row) => string,
  unitLabel: string,
): Statement {
  const lowered = periods.map(lowerRow);
  const rows: StatementRow[] = [];
  for (const f of format[formatName] ?? []) {
    if (f.typeFlag === "C" && !consolidated) continue;
    if (f.field && SKIP_FIELDS.has(f.field.toLowerCase())) continue;
    if (!f.field && (!f.label || f.label.toUpperCase() === "TYPE")) continue;
    rows.push({
      label: f.label,
      indent: f.indent,
      bold: f.bold || !f.field,
      header: !f.field,
      values: f.field
        ? lowered.map((r, i) => {
            const v = evaluate(f.field!, r);
            return v === null ? null : Math.round(scale(f, periods[i], v) * 100) / 100;
          })
        : periods.map(() => null),
    });
  }
  return { format: formatName, unitLabel, periods: periods.map(periodLabel), rows };
}

function annual(
  kind: "bs" | "pl" | "cf" | "fr",
  rows: Row[],
  fformat: string,
  consolidated: boolean,
): Statement | undefined {
  if (!rows.length) return undefined;
  const sorted = [...rows].sort(
    (a, b) => (num(b, "Year_end") ?? 0) - (num(a, "Year_end") ?? 0),
  );
  const allowed = kind === "bs" ? ["BNK", "FIN"] : kind === "fr" ? ["BNK"] : undefined;
  const format = pickFormat(FORMATS[kind], fformat, allowed);
  return build(
    FORMATS[kind],
    format,
    consolidated,
    sorted,
    // UseUnit = T → money in the row's Unit; show as ₹ Cr
    (f, period, v) => {
      const unit = num(period, "Unit");
      return f.useUnit && unit ? (v * unit) / CRORE : v;
    },
    (r) => {
      const months = num(r, "No_months");
      const label = yyyymmLabel(getField(r, "Year_end"));
      return months && months !== 12 ? `${label} (${months}m)` : label;
    },
    kind === "fr" ? "ratios" : "₹ Cr",
  );
}

const RESULT_TYPES: Record<ResultPeriod, [string, string]> = {
  quarterly: ["Q", "QR"],
  halfyearly: ["H", "HR"],
  annual: ["A", "AR"],
};

function results(
  rows: Row[],
  rformat: string,
  consolidated: boolean,
): Partial<Record<ResultPeriod, Statement>> {
  const out: Partial<Record<ResultPeriod, Statement>> = {};
  const file = consolidated ? FORMATS.resultsCons : FORMATS.resultsStd;
  const format = pickFormat(file, rformat);
  for (const [period, [plain, revised]] of Object.entries(RESULT_TYPES) as [
    ResultPeriod,
    [string, string],
  ][]) {
    // "If both Q & QR records are available for the same Date_end, always use the revised record."
    const byDate = new Map<number, Row>();
    for (const r of rows) {
      const t = str(r, "Result_Type").toUpperCase();
      if (t !== plain && t !== revised) continue;
      const d = num(r, "Date_End") ?? 0;
      if (!byDate.has(d) || t === revised) byDate.set(d, r);
    }
    if (!byDate.size) continue;
    const sorted = [...byDate.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r);
    out[period] = build(
      file,
      format,
      consolidated,
      sorted,
      // Results are in ₹ million → ₹ Cr, except per-share / % / counts
      (f, _p, v) => (NON_MONETARY.test(f.label) ? v : v / 10),
      (r) => {
        const label = yyyymmLabel(getField(r, "Date_End"));
        const months = num(r, "NoOfMonths");
        const usual = period === "quarterly" ? 3 : period === "halfyearly" ? 6 : 12;
        return months && months !== usual ? `${label} (${months}m)` : label;
      },
      "₹ Cr",
    );
  }
  return out;
}

/**
 * Shp_Displayformat uses the nh… (number of holders) columns. The same
 * categories exist as tp… (% holding) and ns… (number of shares), so the
 * page can switch between them by swapping the prefix.
 */
function shareholding(rows: Row[]): Partial<Record<ShpMeasure, Statement>> {
  if (!rows.length) return {};
  const sorted = [...rows].sort((a, b) => (num(b, "DATE_END") ?? 0) - (num(a, "DATE_END") ?? 0));
  const out: Partial<Record<ShpMeasure, Statement>> = {};
  const prefixes: Record<ShpMeasure, [string, string]> = {
    percent: ["tp", "% of shares"],
    shares: ["ns", "No. of shares"],
    holders: ["nh", "No. of shareholders"],
  };
  for (const [measure, [prefix, unitLabel]] of Object.entries(prefixes) as [
    ShpMeasure,
    [string, string],
  ][]) {
    const swapped: FormatFile = {
      ALL: FORMATS.shp.ALL.map((f) => ({
        ...f,
        field: f.field?.replace(/\bnh(?=[A-Z])/g, prefix) ?? null,
      })),
    };
    out[measure] = build(
      swapped,
      "ALL",
      false,
      sorted,
      (_f, _p, v) => v,
      (r) => yyyymmLabel(getField(r, "DATE_END")),
      unitLabel,
    );
  }
  return out;
}

// ── Public API ─────────────────────────────────────────────────

export async function listCompanies(date: string) {
  const data = await loadAll(date, ["company-master", "finance-bs", "finance-cons-bs"]);
  const withFinancials = new Set(
    [...data["finance-bs"], ...data["finance-cons-bs"]].map((r) => num(r, "FINCODE")),
  );
  const companies: CompanyListItem[] = data["company-master"]
    .map((r) => ({
      fincode: num(r, "FINCODE") ?? 0,
      symbol: str(r, "SYMBOL") || str(r, "SCRIP_NAME"),
      name: str(r, "COMPNAME"),
      industry: str(r, "industry"),
      status: str(r, "Status"),
      hasFinancials: withFinancials.has(num(r, "FINCODE")),
    }))
    .sort(
      (a, b) =>
        Number(b.hasFinancials) - Number(a.hasFinancials) || a.name.localeCompare(b.name),
    );
  return { companies, sources: data.sources };
}

export async function companyFundamentals(
  date: string,
  fincode: number,
): Promise<CompanyFundamentals> {
  const d = await loadAll(date);
  const master = byFincode(d["company-master"], fincode)[0];
  const empty: CompanyFundamentals = {
    ok: false,
    date,
    company: null,
    equity: { standalone: null, consolidated: null },
    statements: { standalone: {}, consolidated: {} },
    results: { standalone: {}, consolidated: {} },
    shareholding: { pattern: {}, holdersAsOf: null, holders: [] },
    board: { year: null, directors: [] },
    sources: d.sources,
  };
  if (!master) {
    return { ...empty, message: `FINCODE ${fincode} is not in Company_master for ${date}.` };
  }

  const fformat = str(master, "FFORMAT");
  const rformat = str(master, "RFORMAT");

  // Masters joined to the company
  const industry = d["industry-master"].find(
    (r) => num(r, "Ind_code") === num(master, "IND_CODE"),
  );
  const address = byFincode(d["company-address"], fincode)[0];
  const exchanges = new Map(
    d["stock-exchange-master"].map((r) => [num(r, "STK_ID"), str(r, "STK_NAME")]),
  );
  const listings = byFincode(d["company-listings"], fincode)
    .map((r) => exchanges.get(num(r, "STK_ID")) ?? `Exchange ${str(r, "STK_ID")}`)
    .filter(Boolean);
  const regNo = num(byFincode(d["registrar-data"], fincode)[0], "RegistrarNo");
  const registrar = d["registrar-master"].find((r) => num(r, "RegistrarNo") === regNo);

  const equityOf = (rows: Row[]) => {
    const r = byFincode(rows, fincode)[0];
    if (!r) return null;
    const cr = (f: string) => {
      const v = num(r, f);
      return v === null ? null : Math.round((v / CRORE) * 100) / 100;
    };
    return {
      price: num(r, "PRICE"),
      priceDate: str(r, "PriceDate").slice(0, 10),
      exchange: str(r, "STK_Exchange"),
      mcap: cr("MCAP"),
      ev: cr("EV"),
      pe: num(r, "TTMPE"),
      ttmEps: num(r, "TTMEPS"),
      ttmYearEnd: yyyymmLabel(getField(r, "TTM_YEAREND")),
      priceToBook: num(r, "Price_BV"),
      bookValue: num(r, "BOOKNAVPERSHARE"),
      dividendYield: num(r, "YIELD"),
      evEbitda: num(r, "EV_EBITDA"),
      evSales: num(r, "EV_Sales"),
      mcapSales: num(r, "MCAP_Sales"),
      priceCeps: num(r, "Price_CEPS"),
      shares: num(r, "No_Shs_Subscribed"),
      faceValue: num(r, "FV"),
    };
  };

  const statementsFor = (consolidated: boolean) => {
    const prefix = consolidated ? "finance-cons-" : "finance-";
    const out: CompanyFundamentals["statements"]["standalone"] = {};
    for (const kind of ["bs", "pl", "cf", "fr"] as const) {
      const s = annual(
        kind,
        byFincode(d[`${prefix}${kind}` as FileId], fincode),
        fformat,
        consolidated,
      );
      if (s) out[kind] = s;
    }
    return out;
  };

  // Shareholders by name – latest quarter, largest first
  const categories = new Map(
    d["shp-catmaster"].map((r) => [
      num(r, "SHP_CATID"),
      [str(r, "SHP_CATNAME"), str(r, "SUB_CATEGORY")].filter(Boolean).join(" – "),
    ]),
  );
  const details = byFincode(d["shp-details"], fincode);
  const latestShp = Math.max(0, ...details.map((r) => num(r, "DATE_END") ?? 0));
  const holders = details
    .filter((r) => num(r, "DATE_END") === latestShp)
    .map((r) => ({
      name: str(r, "NAME"),
      category: categories.get(num(r, "SHP_CATID")) ?? "",
      percentage: num(r, "PERCENTAGE"),
      shares: num(r, "NO_OF_SHARES"),
      pledgedPct: num(r, "PledgeEncumberedPercentage"),
    }))
    .sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0));

  // Board – latest financial year
  const board = byFincode(d.board, fincode);
  const boardYear = Math.max(0, ...board.map((r) => num(r, "YRC") ?? 0));
  const seen = new Set<string>();
  const directors = board
    .filter((r) => num(r, "YRC") === boardYear)
    // A director can appear once per designation id (e.g. Chairman and MD)
    .filter((r) => {
      const k = `${str(r, "DIRNAME")}|${str(r, "Reported_DSG")}`;
      return !seen.has(k) && !!seen.add(k);
    })
    .sort((a, b) => (num(a, "SRNO") ?? 0) - (num(b, "SRNO") ?? 0))
    .map((r) => {
      const rem = num(r, "DIRREM");
      const unit = num(r, "REM_UNIT") ?? CRORE;
      return {
        name: str(r, "DIRNAME"),
        designation: str(r, "Reported_DSG"),
        remuneration: rem === null ? null : Math.round(((rem * unit) / CRORE) * 100) / 100,
      };
    });

  return {
    ok: true,
    date,
    company: {
      fincode,
      name: str(master, "COMPNAME"),
      shortName: str(master, "S_NAME"),
      symbol: str(master, "SYMBOL"),
      series: str(master, "SERIES"),
      bseCode: str(master, "SCRIPCODE"),
      isin: str(master, "ISIN"),
      cin: str(master, "CIN"),
      industry: str(master, "industry"),
      sector: str(industry, "Sector"),
      house: str(master, "house"),
      chairman: str(master, "CHAIRMAN"),
      md: str(master, "MDIR"),
      secretary: str(master, "COSEC"),
      incorporated: [str(master, "INC_MONTH"), str(master, "INC_YEAR")].filter(Boolean).join(" "),
      faceValue: num(master, "FV"),
      status: [str(master, "Status"), str(master, "Sublisting")].filter(Boolean).join(" · "),
      financeFormat: fformat,
      resultFormat: rformat,
      listings,
      address: ["ADD1", "ADD2", "ADD3"].map((f) => str(address, f)).filter(Boolean).join(", "),
      city: [str(address, "CITY_NAME"), str(address, "STATE_NAME"), str(address, "PINCODE")]
        .filter(Boolean)
        .join(", "),
      phone: str(address, "PHONE"),
      email: str(address, "E_MAIL"),
      website: str(address, "WEBSITE"),
      registrar: str(registrar, "RegistrarName"),
    },
    equity: {
      standalone: equityOf(d["company-equity"]),
      consolidated: equityOf(d["company-equity-cons"]),
    },
    statements: { standalone: statementsFor(false), consolidated: statementsFor(true) },
    results: {
      standalone: results(byFincode(d["results-std"], fincode), rformat, false),
      consolidated: results(byFincode(d["results-cons"], fincode), rformat, true),
    },
    shareholding: {
      pattern: shareholding(byFincode(d["shp-summary"], fincode)),
      holdersAsOf: latestShp ? yyyymmLabel(latestShp) : null,
      holders,
    },
    board: { year: boardYear ? yyyymmLabel(boardYear) : null, directors },
    sources: d.sources,
  };
}
