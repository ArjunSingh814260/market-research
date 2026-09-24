"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DataTable } from "@/components/DataTable";
import { LoadingSteps, Spinner, TableSkeleton, type Step } from "@/components/LoadingSteps";
import { getAccord } from "@/lib/client";
import { ddmmyyyyToIso, intradayFilename, isoToDdmmyyyy } from "@/lib/dates";
import { indexLabel, normIndex as norm, type IndexInfo } from "@/lib/indexNames";
import { applyFlags, getField, toNumber, type Row } from "@/lib/rows";

const SAMPLE_DATE = process.env.NEXT_PUBLIC_DEFAULT_DATE ?? "31072026";
const MAX_FILES = 100; // safety cap for catch-up loops

interface Constituent {
  fincode: unknown;
  symbol: string;
  scripcode: unknown;
  company?: string;
  industry?: string;
}
interface ConstituentsResponse {
  ok: boolean;
  indices: IndexInfo[];
  index: IndexInfo | null;
  constituents: Constituent[];
  sources: string[];
  constituentsFrom?: "nse" | "accord" | "";
  message?: string;
}

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });

interface FeedProgress {
  seq: number; // sequence number being fetched next
  files: number; // files read in this call
  rows: number; // distinct rows held so far
  fetching: boolean;
}

/** An intraday feed we read file-by-file (seq 01, 02 …) and merge by primary key. */
function useIntradayFeed(datasetId: string, pk: string[]) {
  const store = useRef(new Map<string, Row>());
  const seq = useRef(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [lastFile, setLastFile] = useState("");

  const reset = useCallback(() => {
    store.current.clear();
    seq.current = 1;
    setRows([]);
    setLastFile("");
  }, []);

  /** Read files from the current sequence until one isn't published yet. */
  const catchUp = useCallback(
    async (date: string, onProgress?: (p: FeedProgress) => void) => {
      let got = 0;
      for (let i = 0; i < MAX_FILES; i++) {
        onProgress?.({ seq: seq.current, files: got, rows: store.current.size, fetching: true });
        const res = await getAccord(datasetId, date, seq.current);
        if (!res.ok || res.count === 0) {
          if (!res.ok) throw new Error(res.message ?? `HTTP ${res.status}`);
          break; // 204 → not published yet; retry this same seq next time
        }
        applyFlags(store.current, res.rows, pk);
        setLastFile(res.filename);
        seq.current += 1;
        got++;
      }
      onProgress?.({ seq: seq.current, files: got, rows: store.current.size, fetching: false });
      if (got) setRows([...store.current.values()]);
      return got;
    },
    [datasetId, pk],
  );

  return { rows, lastFile, reset, catchUp };
}

const STOCK_PK = ["SYMBOL", "SERIES"];
const INDEX_PK = ["Symbol"];

export default function IndicesPage() {
  const [dateIso, setDateIso] = useState(ddmmyyyyToIso(SAMPLE_DATE));
  const date = isoToDdmmyyyy(dateIso);
  const [indexName, setIndexName] = useState("NIFTY 50");
  const [indices, setIndices] = useState<IndexInfo[]>([]);
  const [index, setIndex] = useState<IndexInfo | null>(null);
  const [constituents, setConstituents] = useState<Constituent[]>([]);
  const [manual, setManual] = useState("");
  const [info, setInfo] = useState<{ sources: string[]; from?: string; message?: string } | null>(
    null,
  );
  const [listSource, setListSource] = useState<"auto" | "accord" | "nse">("auto");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const setStep = (key: string, patch: Partial<Step>) =>
    setSteps((all) => all.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const [auto, setAuto] = useState(false);

  const stocks = useIntradayFeed("nse-stocks-live", STOCK_PK);
  const idxLive = useIntradayFeed("nse-indices-live", INDEX_PK);

  async function load() {
    setBusy(true);
    setError("");
    setStartedAt(Date.now());
    stocks.reset();
    idxLive.reset();
    const idxLabel = indexName;
    setSteps([
      { key: "list", label: `1. Get the list of stocks in ${idxLabel}`, status: "active", detail: "Reading Accord's index masters and NSE's official list…" },
      { key: "prices", label: "2. Download stock prices (Accord NseStocksLive)", status: "pending" },
      { key: "level", label: "3. Download the index level (Accord NSEIndicesLive)", status: "pending" },
    ]);

    // Step 1 – constituents
    let listOk = false;
    try {
      const q = new URLSearchParams({ date, index: indexName, source: listSource });
      const res: ConstituentsResponse = await (await fetch(`/api/index-constituents?${q}`)).json();
      setIndices(res.indices ?? []);
      setIndex(res.index);
      // Use Accord's own code (e.g. "NIFTY") so the dropdown shows the right selection.
      if (res.index) setIndexName(res.index.name);
      setConstituents(res.constituents ?? []);
      setInfo({ sources: res.sources ?? [], from: res.constituentsFrom, message: res.message });
      const n = res.constituents?.length ?? 0;
      listOk = true;
      setStep("list", {
        label: `1. Get the list of stocks in ${res.index ? indexLabel(res.index) : idxLabel}`,
        status: n ? "done" : "error",
        detail: n
          ? `${n} stocks from ${res.constituentsFrom === "nse" ? "NSE's official list" : "Accord Comp_Indexpart"}`
          : (res.message ?? "No stocks found for this index"),
      });
    } catch (e) {
      setStep("list", { status: "error", detail: (e as Error).message });
      setError((e as Error).message);
    }

    // Steps 2 & 3 – intraday files, in parallel
    if (listOk) {
      setStep("prices", { status: "active", detail: "Starting…" });
      setStep("level", { status: "active", detail: "Starting…" });
      const feedDetail = (p: FeedProgress, what: string) =>
        p.fetching
          ? `Downloading file ${intradayFilename(date, p.seq)}… (${p.files} file${p.files === 1 ? "" : "s"} done, ${p.rows.toLocaleString("en-IN")} ${what} so far)`
          : p.files
            ? `${p.files} file${p.files === 1 ? "" : "s"} read (up to ${intradayFilename(date, p.seq - 1)}) · ${p.rows.toLocaleString("en-IN")} ${what}`
            : "No files published for this date yet";
      await Promise.all([
        stocks
          .catchUp(date, (p) => setStep("prices", { detail: feedDetail(p, "stocks") }))
          .then((n) => setStep("prices", { status: n ? "done" : "error" }))
          .catch((e: Error) => {
            setStep("prices", { status: "error", detail: e.message });
            setError(e.message);
          }),
        idxLive
          .catchUp(date, (p) => setStep("level", { detail: feedDetail(p, "indices") }))
          .then((n) => setStep("level", { status: n ? "done" : "error" }))
          .catch((e: Error) => setStep("level", { status: "error", detail: e.message })),
      ]);
    } else {
      setStep("prices", { status: "skipped", detail: "Skipped" });
      setStep("level", { status: "skipped", detail: "Skipped" });
    }
    setBusy(false);
  }

  // Load the selected index (Nifty 50) as soon as the page opens.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    const t = setTimeout(() => loadRef.current(), 0);
    return () => clearTimeout(t);
  }, []);

  // Auto-refresh: pick up any newly published intraday files every minute.
  const stocksCatchUp = stocks.catchUp;
  const indicesCatchUp = idxLive.catchUp;
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => {
      Promise.all([stocksCatchUp(date), indicesCatchUp(date)]).catch((e: Error) =>
        setError(e.message),
      );
    }, 60_000);
    return () => clearInterval(t);
  }, [auto, date, stocksCatchUp, indicesCatchUp]);

  // Symbols in the index: from Comp_Indexpart, or pasted by hand as a fallback.
  const symbols = useMemo(() => {
    if (constituents.length) return constituents.map((c) => c.symbol.toUpperCase());
    return manual
      .split(/[\s,;]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }, [constituents, manual]);

  const table = useMemo(() => {
    const bySymbol = new Map<string, Row>();
    for (const r of stocks.rows) {
      const sym = String(getField(r, "SYMBOL") ?? "").toUpperCase();
      const series = String(getField(r, "SERIES") ?? "").toUpperCase();
      // Prefer the EQ series when a symbol trades in more than one.
      if (!bySymbol.has(sym) || series === "EQ") bySymbol.set(sym, r);
    }
    const meta = new Map(constituents.map((c) => [c.symbol.toUpperCase(), c]));
    const found: Row[] = [];
    const missing: string[] = [];
    for (const sym of symbols) {
      const r = bySymbol.get(sym);
      if (!r) {
        missing.push(sym);
        continue;
      }
      found.push({
        SYMBOL: sym,
        ...(meta.get(sym)?.company ? { COMPANY: meta.get(sym)!.company } : {}),
        ...(meta.get(sym)?.industry ? { INDUSTRY: meta.get(sym)!.industry } : {}),
        LTP: toNumber(getField(r, "LTP")),
        CHANGE: toNumber(getField(r, "CHANGE")),
        PER_CHANGE: toNumber(getField(r, "PER_CHANGE")),
        OPEN: toNumber(getField(r, "Open")),
        HIGH: toNumber(getField(r, "High")),
        LOW: toNumber(getField(r, "Low")),
        PREV_PRICE: toNumber(getField(r, "PREV_PRICE")),
        VOLUME: toNumber(getField(r, "VOLUME")),
        VALUE: toNumber(getField(r, "VALUE")),
        UPD_TIME: getField(r, "UPD_TIME"),
      });
    }
    found.sort((a, b) => ((b.PER_CHANGE as number) ?? 0) - ((a.PER_CHANGE as number) ?? 0));
    return { found, missing };
  }, [stocks.rows, symbols, constituents]);

  const level = useMemo(() => {
    // NSEIndicesLive.Symbol should equal INDEX_NAME; also accept the long name just in case.
    const targets = new Set(
      [index?.name ?? indexName, index?.longName ?? ""].map(norm).filter(Boolean),
    );
    const r = idxLive.rows.find((x) => targets.has(norm(String(getField(x, "Symbol") ?? ""))));
    if (!r) return null;
    return {
      close: toNumber(getField(r, "Close")),
      change: toNumber(getField(r, "Change")),
      pct: toNumber(getField(r, "Per_Change")),
      high: toNumber(getField(r, "High")),
      low: toNumber(getField(r, "Low")),
      time: String(getField(r, "Updtime") ?? ""),
    };
  }, [idxLive.rows, index, indexName]);

  const adv = table.found.filter((r) => (r.PER_CHANGE as number) > 0).length;
  const dec = table.found.filter((r) => (r.PER_CHANGE as number) < 0).length;
  // NSE indices only (fall back to all), with Nifty 50 at the top.
  const nseIndices = (indices.some((i) => i.exchange === "NSE")
    ? indices.filter((i) => i.exchange === "NSE")
    : indices
  ).toSorted((a, b) => Number(b.name === "NIFTY") - Number(a.name === "NIFTY"));
  const loaded = info !== null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Index Constituents</h1>
        <p className="text-sm text-zinc-500">
          Nifty 50 (or any index) stocks and prices, built by joining{" "}
          <code>Indicesmaster</code> → <code>Comp_Indexpart</code> → <code>NseStocksLive</code>, with
          the index level from <code>NSEIndicesLive</code>.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Index</span>
          {nseIndices.length ? (
            <select
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {nseIndices.map((i) => (
                <option key={i.code} value={i.name}>
                  {indexLabel(i)}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
              className="w-48 rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          )}
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Date</span>
          <input
            type="date"
            value={dateIso}
            onChange={(e) => setDateIso(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Stock list from</span>
          <select
            value={listSource}
            onChange={(e) => setListSource(e.target.value as "auto" | "accord" | "nse")}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="auto">Auto (NSE if Accord is incomplete)</option>
            <option value="nse">NSE official list</option>
            <option value="accord">Accord Comp_Indexpart</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-70"
        >
          {busy && <Spinner />}
          {busy ? "Loading…" : "Load"}
        </button>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Auto-refresh every minute
        </label>
      </form>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Step-by-step loader: visible while loading, and afterwards only if something failed */}
      {(busy || steps.some((st) => st.status === "error")) && (
        <LoadingSteps
          steps={steps}
          running={busy}
          startedAt={startedAt}
          title={`Loading ${index ? indexLabel(index) : indexName}…`}
        />
      )}

      {loaded && !busy && (
        <p className="text-xs text-zinc-500">
          {info.from && (
            <b className="mr-1 text-zinc-700 dark:text-zinc-300">
              {constituents.length} stocks from{" "}
              {info.from === "nse" ? "NSE's official list" : "Accord Comp_Indexpart"}.
            </b>
          )}
          Sources checked: {info.sources.join(" + ") || "none"}
          {info.message && <> · {info.message}</>}
          {stocks.lastFile && <> · prices up to file {stocks.lastFile}</>}
        </p>
      )}

      {loaded && !busy && !constituents.length && (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <p>
            No constituents were returned for <b>{indexName}</b>. Master feeds are incremental, so
            on most days <code>Comp_Indexpart</code> only contains changes. Save Accord&apos;s
            one-time dump as <code>data/Comp_Indexpart.json</code> and{" "}
            <code>data/Indicesmaster.json</code>, or paste the symbols below for now.
          </p>
          <textarea
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            rows={3}
            placeholder="RELIANCE, TCS, HDFCBANK, INFY, …"
            className="w-full rounded-md border border-amber-300 bg-white p-2 font-mono text-xs text-zinc-900 dark:border-amber-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
      )}

      {symbols.length > 0 && stocks.rows.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-xs uppercase tracking-wide text-zinc-500">{index ? indexLabel(index) : indexName}</p>
            {level ? (
              <>
                <p className="mt-2 text-3xl font-semibold tabular-nums">{fmt(level.close)}</p>
                <p className={`tabular-nums ${(level.change ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {(level.change ?? 0) > 0 ? "+" : ""}
                  {fmt(level.change)} ({(level.pct ?? 0) > 0 ? "+" : ""}
                  {fmt(level.pct)}%)
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  H {fmt(level.high)} · L {fmt(level.low)} · {level.time.replace("T", " ")}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">Index level not in NSEIndicesLive for this date.</p>
            )}
          </div>
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Breadth</p>
            <p className="mt-2 text-3xl font-semibold">
              <span className="text-emerald-600">{adv}</span>
              <span className="mx-1 text-zinc-400">/</span>
              <span className="text-red-600">{dec}</span>
            </p>
            <p className="text-xs text-zinc-500">
              advances / declines · {table.found.length} of {symbols.length} stocks priced
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Top / bottom</p>
            <ul className="mt-2 space-y-1 text-sm">
              {[...table.found.slice(0, 3), ...table.found.slice(-3)]
                .filter((r, i, a) => a.indexOf(r) === i)
                .map((r) => (
                  <li key={String(r.SYMBOL)} className="flex justify-between">
                    <span className="font-medium">{String(r.SYMBOL)}</span>
                    <span
                      className={`tabular-nums ${(r.PER_CHANGE as number) >= 0 ? "text-emerald-600" : "text-red-600"}`}
                    >
                      {(r.PER_CHANGE as number) > 0 ? "+" : ""}
                      {fmt(r.PER_CHANGE as number)}%
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}

      {table.missing.length > 0 && stocks.rows.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          In the index but no price in NseStocksLive: {table.missing.join(", ")}
        </p>
      )}

      {busy && table.found.length === 0 ? (
        <TableSkeleton rows={10} cols={9} />
      ) : (
        <DataTable
        rows={table.found}
        filename={`${norm(index?.name ?? indexName)}_${date}`}
        primaryKey={["SYMBOL"]}
      />
      )}
    </div>
  );
}
