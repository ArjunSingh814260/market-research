/**
 * Shapes returned by /api/company. Safe for client and server.
 * The server builds these in fundamentals.server.ts.
 */

export interface StatementRow {
  label: string;
  /** Leading spaces in Accord's display-format description (sub-items are indented) */
  indent: number;
  bold: boolean;
  /** Section heading: a display-format row with no FieldName */
  header: boolean;
  values: (number | null)[];
}

export interface Statement {
  /** Display format used, e.g. MAN, BNK, FIN (from Company_master FFORMAT / RFORMAT) */
  format: string;
  /** e.g. "₹ Cr", "%", "x" – shown above the table */
  unitLabel: string;
  /** Column headings, newest first: "Mar 2026", "Jun 2026 (3m)" … */
  periods: string[];
  rows: StatementRow[];
}

export interface CompanyListItem {
  fincode: number;
  symbol: string;
  name: string;
  industry: string;
  status: string;
  hasFinancials: boolean;
}

export interface SourceInfo {
  dataset: string;
  filename: string;
  status: number;
  count: number;
  message?: string;
}

export interface Holder {
  name: string;
  category: string;
  percentage: number | null;
  shares: number | null;
  pledgedPct: number | null;
}

export interface Director {
  name: string;
  designation: string;
  /** Remuneration in ₹ Cr */
  remuneration: number | null;
}

export type ResultPeriod = "quarterly" | "halfyearly" | "annual";
export type ShpMeasure = "percent" | "shares" | "holders";

export interface CompanyFundamentals {
  ok: boolean;
  date: string;
  message?: string;
  company: {
    fincode: number;
    name: string;
    shortName: string;
    symbol: string;
    series: string;
    bseCode: string;
    isin: string;
    cin: string;
    industry: string;
    sector: string;
    house: string;
    chairman: string;
    md: string;
    secretary: string;
    incorporated: string;
    faceValue: number | null;
    status: string;
    financeFormat: string;
    resultFormat: string;
    listings: string[];
    address: string;
    city: string;
    phone: string;
    email: string;
    website: string;
    registrar: string;
  } | null;
  /** Latest price & valuation (company_equity) – amounts in ₹ Cr */
  equity: {
    standalone: Record<string, number | string | null> | null;
    consolidated: Record<string, number | string | null> | null;
  };
  statements: {
    standalone: Partial<Record<"bs" | "pl" | "cf" | "fr", Statement>>;
    consolidated: Partial<Record<"bs" | "pl" | "cf" | "fr", Statement>>;
  };
  results: {
    standalone: Partial<Record<ResultPeriod, Statement>>;
    consolidated: Partial<Record<ResultPeriod, Statement>>;
  };
  shareholding: {
    pattern: Partial<Record<ShpMeasure, Statement>>;
    holdersAsOf: string | null;
    holders: Holder[];
  };
  board: { year: string | null; directors: Director[] };
  sources: SourceInfo[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 202603 → "Mar 2026" (Accord's Year_end / Date_End are yyyymm integers). */
export function yyyymmLabel(v: unknown): string {
  const s = String(v ?? "");
  const m = Number(s.slice(4, 6));
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${s.slice(0, 4)}` : s;
}
