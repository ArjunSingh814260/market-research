"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Spinner } from "@/components/LoadingSteps";
import { StatementTable, formatValue } from "@/components/StatementTable";
import { ddmmyyyyToIso, isoToDdmmyyyy } from "@/lib/dates";
import type {
  CompanyFundamentals,
  CompanyListItem,
  ResultPeriod,
  ShpMeasure,
  SourceInfo,
} from "@/lib/fundamentals";

const SAMPLE_DATE = process.env.NEXT_PUBLIC_DEFAULT_DATE ?? "31072026";

const TABS = [
  ["overview", "Overview"],
  ["bs", "Balance Sheet"],
  ["pl", "Profit & Loss"],
  ["cf", "Cash Flow"],
  ["fr", "Ratios"],
  ["results", "Results"],
  ["shp", "Shareholding"],
] as const;
type Tab = (typeof TABS)[number][0];

const STATEMENT_FILES: Record<"bs" | "pl" | "cf" | "fr", [string, string]> = {
  bs: ["Finance_bs", "Finance_cons_bs"],
  pl: ["Finance_pl", "Finance_cons_pl"],
  cf: ["Finance_cf", "Finance_cons_cf"],
  fr: ["Finance_fr", "Finance_cons_fr"],
};

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string, boolean?][];
}) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-300 p-0.5 text-sm dark:border-zinc-700">
      {options.map(([v, label, disabled]) => (
        <button
          key={v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1 font-medium transition ${
            value === v
              ? "bg-indigo-600 text-white"
              : "text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="font-mono text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

function CompanyPicker({
  companies,
  selected,
  onSelect,
}: {
  companies: CompanyListItem[];
  selected: number | null;
  onSelect: (fincode: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const current = companies.find((c) => c.fincode === selected);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return companies
      .filter(
        (c) =>
          !q ||
          c.symbol.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          String(c.fincode) === q,
      )
      .slice(0, 60);
  }, [companies, query]);

  function choose(c: CompanyListItem) {
    onSelect(c.fincode);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        value={open ? query : current ? `${current.symbol} – ${current.name}` : query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches[0]) choose(matches[0]);
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={`Search ${companies.length} companies by symbol or name…`}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
      />
      {open && (
        <ul className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {matches.length === 0 && <li className="px-3 py-2 text-zinc-500">No match</li>}
          {matches.map((c) => (
            <li key={c.fincode}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(c)}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-indigo-50 dark:hover:bg-indigo-950/40 ${
                  c.hasFinancials ? "" : "opacity-50"
                }`}
              >
                <span className="w-28 shrink-0 font-mono text-xs font-semibold">{c.symbol}</span>
                <span className="truncate">{c.name}</span>
                <span className="ml-auto shrink-0 text-xs text-zinc-400">
                  {c.hasFinancials ? c.industry : `${c.status} · no financials`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Sources({ sources }: { sources: SourceInfo[] }) {
  return (
    <details className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <summary className="cursor-pointer font-medium">
        Accord files used ({sources.filter((s) => s.count > 0).length}/{sources.length} with data)
      </summary>
      <table className="mt-3 w-full text-xs">
        <tbody>
          {sources.map((s) => (
            <tr key={s.dataset} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1 font-mono">{s.filename}</td>
              <td className={`py-1 ${s.status === 200 ? "text-emerald-600" : "text-amber-600"}`}>
                HTTP {s.status}
              </td>
              <td className="py-1 text-right tabular-nums">{s.count.toLocaleString()} rows</td>
              <td className="py-1 pl-3 text-zinc-500">{s.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-zinc-500">
        Each file is fetched from Accord once per date and saved in <code>data/cache/</code>.
        Delete that folder to fetch again.
      </p>
    </details>
  );
}

export function CompanyView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const date = params.get("date") ?? SAMPLE_DATE;
  const fincodeParam = params.get("fincode");
  const fincode = fincodeParam ? Number(fincodeParam) : null;

  // Each response remembers which request it answers, so "loading" is simply
  // "the stored response is for a different date / company".
  const [list, setList] = useState<{
    date: string;
    companies: CompanyListItem[];
    error: string | null;
  } | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; data: CompanyFundamentals | null } | null>(
    null,
  );
  const companies = list?.date === date ? list.companies : null;
  const listError = list?.date === date ? list.error : null;
  const dataKey = fincode ? `${date}/${fincode}` : null;
  const data = loaded?.data ?? null;
  const loading = dataKey !== null && loaded?.key !== dataKey;
  const [tab, setTab] = useState<Tab>("overview");
  const [view, setView] = useState<"standalone" | "consolidated">("standalone");
  const [period, setPeriod] = useState<ResultPeriod>("quarterly");
  const [measure, setMeasure] = useState<ShpMeasure>("percent");
  const [hideEmpty, setHideEmpty] = useState(true);

  function navigate(next: { date?: string; fincode?: number | null }) {
    const sp = new URLSearchParams(params);
    if (next.date) sp.set("date", next.date);
    if (next.fincode !== undefined) {
      if (next.fincode === null) sp.delete("fincode");
      else sp.set("fincode", String(next.fincode));
    }
    router.replace(`${pathname}?${sp}`);
  }

  // Company list for the date
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/company?date=${date}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((body) => {
        const src = (body.sources as SourceInfo[] | undefined)?.find((s) => s.message);
        setList({
          date,
          companies: body.companies ?? [],
          error: body.ok ? null : (src?.message ?? body.message ?? "Company_master returned no rows."),
        });
      })
      .catch((e) => {
        if (e.name !== "AbortError") setList({ date, companies: [], error: String(e.message ?? e) });
      });
    return () => ctrl.abort();
  }, [date]);

  // Default to the first company with financials (Reliance if present)
  useEffect(() => {
    if (fincode || !companies?.length) return;
    const first =
      companies.find((c) => c.symbol === "RELIANCE" && c.hasFinancials) ??
      companies.find((c) => c.hasFinancials) ??
      companies[0];
    navigate({ fincode: first.fincode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, fincode]);

  // Fundamentals for the selected company
  useEffect(() => {
    if (!dataKey) return;
    const ctrl = new AbortController();
    fetch(`/api/company?date=${date}&fincode=${fincode}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((body: CompanyFundamentals) => {
        setLoaded({ key: dataKey, data: body });
        // Fall back to consolidated when the company only files consolidated numbers
        const hasStd = Object.keys(body.statements?.standalone ?? {}).length > 0;
        const hasCons = Object.keys(body.statements?.consolidated ?? {}).length > 0;
        setView((v) => (v === "standalone" && !hasStd && hasCons ? "consolidated" : v));
      })
      .catch((e) => {
        if (e.name !== "AbortError") setLoaded({ key: dataKey, data: null });
      });
    return () => ctrl.abort();
  }, [date, fincode, dataKey]);

  const c = data?.company;
  const equity = data?.equity[view] ?? data?.equity.standalone ?? null;
  const hasCons = data ? Object.keys(data.statements.consolidated).length > 0 : false;
  const hasStd = data ? Object.keys(data.statements.standalone).length > 0 : false;
  const results = data?.results[view] ?? {};
  const csvBase = `${c?.symbol || fincode}_${view}`;

  const n = (v: unknown, d = 2) => (typeof v === "number" ? formatValue(v, d) : "—");

  const viewToggle = (
    <Segmented
      value={view}
      onChange={setView}
      options={[
        ["standalone", "Standalone", !hasStd],
        ["consolidated", "Consolidated", !hasCons],
      ]}
    />
  );
  const emptyToggle = (
    <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
      <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
      Hide empty rows
    </label>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Company Fundamentals</h1>
        <p className="text-sm text-zinc-500">
          Balance sheet, P&amp;L, cash flow, ratios, quarterly results and shareholding from
          Accord&apos;s Company Fundamentals feeds, laid out with Accord&apos;s industry display
          formats. All amounts in ₹ crore.
        </p>
      </div>

      <div className="grid gap-4 rounded-xl border border-zinc-200 p-4 sm:grid-cols-[3fr_1fr] dark:border-zinc-800">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Company</span>
          {companies ? (
            <CompanyPicker
              companies={companies}
              selected={fincode}
              onSelect={(f) => navigate({ fincode: f })}
            />
          ) : (
            <p className="flex items-center gap-2 py-2 text-zinc-500">
              <Spinner /> Loading Company_master…
            </p>
          )}
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Feed date</span>
          <input
            type="date"
            value={ddmmyyyyToIso(date)}
            onChange={(e) => e.target.value && navigate({ date: isoToDdmmyyyy(e.target.value), fincode: null })}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        {listError && (
          <p className="text-sm text-red-600 sm:col-span-2">{listError}</p>
        )}
      </div>

      {loading && !data && (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner /> Loading fundamentals… the first load of a date fetches every file from Accord
          and can take a minute.
        </p>
      )}

      {data && !data.ok && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          {data.message}
        </p>
      )}

      {c && (
        <div className={`space-y-6 transition-opacity ${loading ? "opacity-50" : ""}`}>
          {/* Header */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{c.name}</h2>
                <p className="text-sm text-zinc-500">
                  <span className="font-mono">
                    NSE {c.symbol || "—"}
                    {c.series && ` (${c.series})`} · BSE {c.bseCode || "—"} · FINCODE {c.fincode}
                  </span>{" "}
                  · {c.industry}
                  {c.sector && ` · ${c.sector}`}
                </p>
              </div>
              {viewToggle}
            </div>
            {equity && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                <Metric
                  label="Price (₹)"
                  value={n(equity.price)}
                  hint={`${equity.exchange ?? ""} ${equity.priceDate ?? ""}`}
                />
                <Metric label="Market cap (₹ Cr)" value={n(equity.mcap, 0)} />
                <Metric label="P/E (TTM)" value={n(equity.pe)} hint={`EPS ${n(equity.ttmEps)}`} />
                <Metric label="Price / Book" value={n(equity.priceToBook)} />
                <Metric label="Book value (₹)" value={n(equity.bookValue)} />
                <Metric label="Dividend yield %" value={n(equity.dividendYield)} />
                <Metric label="EV / EBITDA" value={n(equity.evEbitda)} />
                <Metric label="Face value (₹)" value={n(equity.faceValue)} />
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                  tab === key
                    ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                    : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                {(
                  [
                    ["Status", c.status],
                    ["ISIN", c.isin],
                    ["CIN", c.cin],
                    ["Business house", c.house],
                    ["Incorporated", c.incorporated],
                    ["Chairman", c.chairman],
                    ["Managing director", c.md],
                    ["Company secretary", c.secretary],
                    ["Listed on", c.listings.join(", ")],
                    ["Registrar", c.registrar],
                    ["Registered office", [c.address, c.city].filter(Boolean).join(", ")],
                    ["Phone", c.phone],
                    ["Email", c.email],
                    ["Website", c.website],
                    ["Display formats", `Finance ${c.financeFormat || "—"} · Results ${c.resultFormat || "—"}`],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-zinc-500">{k}</dt>
                    <dd className="break-words">
                      {k === "Website" && v ? (
                        <a
                          href={/^https?:/.test(v) ? v : `https://${v}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          {v}
                        </a>
                      ) : (
                        v || "—"
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="space-y-2">
                <h3 className="font-medium">
                  Board of directors{data.board.year && ` · FY ${data.board.year}`}
                </h3>
                {data.board.directors.length ? (
                  <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-100 text-left dark:bg-zinc-900">
                        <tr>
                          <th className="px-3 py-2 font-medium">Name</th>
                          <th className="px-3 py-2 font-medium">Designation</th>
                          <th className="px-3 py-2 text-right font-medium">Remuneration (₹ Cr)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.board.directors.map((d, i) => (
                          <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="px-3 py-1.5">{d.name}</td>
                            <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-400">{d.designation}</td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums">{n(d.remuneration)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">No board data in this date&apos;s feed.</p>
                )}
              </div>
              <div className="lg:col-span-2">
                <Sources sources={data.sources} />
              </div>
            </div>
          )}

          {(tab === "bs" || tab === "pl" || tab === "cf" || tab === "fr") && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-4">
                {emptyToggle}
                <span className="text-xs text-zinc-500">
                  File <code className="font-mono">{STATEMENT_FILES[tab][view === "standalone" ? 0 : 1]}</code>
                </span>
              </div>
              {data.statements[view][tab] ? (
                <StatementTable
                  statement={data.statements[view][tab]!}
                  hideEmpty={hideEmpty}
                  csvName={`${csvBase}_${tab}`}
                />
              ) : (
                <p className="text-sm text-zinc-500">
                  No {view} data for this company in this date&apos;s feed.
                </p>
              )}
            </div>
          )}

          {tab === "results" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-4">
                <Segmented
                  value={period}
                  onChange={setPeriod}
                  options={[
                    ["quarterly", "Quarterly", !results.quarterly],
                    ["halfyearly", "Half-yearly", !results.halfyearly],
                    ["annual", "Annual", !results.annual],
                  ]}
                />
                {emptyToggle}
                <span className="text-xs text-zinc-500">
                  File{" "}
                  <code className="font-mono">
                    {view === "standalone" ? "Resultsf_IND_Ex1" : "Resultsf_IND_Cons_Ex1"}
                  </code>{" "}
                  · revised (QR/HR/AR) figures replace originals
                </span>
              </div>
              {results[period] ? (
                <StatementTable
                  statement={results[period]!}
                  hideEmpty={hideEmpty}
                  csvName={`${csvBase}_results_${period}`}
                />
              ) : (
                <p className="text-sm text-zinc-500">No {period} {view} results in this date&apos;s feed.</p>
              )}
            </div>
          )}

          {tab === "shp" && (
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-4">
                  <Segmented
                    value={measure}
                    onChange={setMeasure}
                    options={[
                      ["percent", "% holding"],
                      ["shares", "No. of shares"],
                      ["holders", "No. of holders"],
                    ]}
                  />
                  <span className="text-xs text-zinc-500">
                    File <code className="font-mono">Shpsummary</code> · layout from Shp_Displayformat
                  </span>
                </div>
                {data.shareholding.pattern[measure] ? (
                  <StatementTable
                    statement={data.shareholding.pattern[measure]!}
                    hideEmpty={false}
                    decimals={measure === "percent" ? 2 : 0}
                    csvName={`${csvBase}_shareholding_${measure}`}
                  />
                ) : (
                  <p className="text-sm text-zinc-500">No shareholding data in this date&apos;s feed.</p>
                )}
              </div>

              {data.shareholding.holders.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-medium">
                    Shareholders by name · {data.shareholding.holdersAsOf}
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      File <code className="font-mono">Shp_details</code> +{" "}
                      <code className="font-mono">Shp_catmaster_2</code>
                    </span>
                  </h3>
                  <div className="max-h-[60vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-zinc-100 text-left dark:bg-zinc-900">
                        <tr>
                          <th className="px-3 py-2 font-medium">Name</th>
                          <th className="px-3 py-2 font-medium">Category</th>
                          <th className="px-3 py-2 text-right font-medium">Shares</th>
                          <th className="px-3 py-2 text-right font-medium">%</th>
                          <th className="px-3 py-2 text-right font-medium">Pledged %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.shareholding.holders.map((h, i) => (
                          <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="px-3 py-1.5">{h.name}</td>
                            <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-400">{h.category}</td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums">{n(h.shares, 0)}</td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums">{n(h.percentage)}</td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums">{n(h.pledgedPct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
