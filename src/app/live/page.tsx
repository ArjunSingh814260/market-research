"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DataTable } from "@/components/DataTable";
import { StatusBanner } from "@/components/StatusBanner";
import { getAccord, type AccordResponse } from "@/lib/client";
import { ddmmyyyyToIso, intradayFilename, isoToDdmmyyyy } from "@/lib/dates";
import { applyFlags, getField, toNumber, type Row } from "@/lib/rows";

const SAMPLE_DATE = process.env.NEXT_PUBLIC_DEFAULT_DATE ?? "31072026";
const PK = ["SYMBOL", "SERIES"];
const fmt = (n: number | null, d = 2) =>
  n === null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });

interface LogLine {
  t: string;
  text: string;
  tone: "ok" | "wait" | "err";
}

/**
 * NSE intraday prices, following the procedure in the tech doc:
 *   "Based on provided frequency/interval increase sequence number to fetch
 *    latest file and update database. Once current numbered file is updated,
 *    fetch next sequence numbered file in next interval. If file is not
 *    received retry same sequence number."
 */
export default function LivePage() {
  const [dateIso, setDateIso] = useState(ddmmyyyyToIso(SAMPLE_DATE));
  const date = isoToDdmmyyyy(dateIso);
  const [nextSeq, setNextSeq] = useState(1);
  const [intervalSec, setIntervalSec] = useState(60);
  const [polling, setPolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<AccordResponse | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  // `store` is the working "table" (like your DB table); `prices` is its snapshot for rendering.
  const store = useRef(new Map<string, Row>());
  const [prices, setPrices] = useState<Row[]>([]);
  const [names, setNames] = useState(
    new Map<string, { name: string; fincode: unknown; industry: unknown }>(),
  );
  const seqRef = useRef(1);
  const stopRef = useRef(false);

  const addLog = (text: string, tone: LogLine["tone"]) =>
    setLog((l) => [{ t: new Date().toLocaleTimeString(), text, tone }, ...l].slice(0, 100));

  const reset = useCallback(() => {
    store.current.clear();
    seqRef.current = 1;
    setNextSeq(1);
    setLast(null);
    setLog([]);
    setPrices([]);
  }, []);

  /** Fetch the current sequence file once. Returns true if a file was applied. */
  const fetchNext = useCallback(async (): Promise<boolean> => {
    const seq = seqRef.current;
    const res = await getAccord("nse-stocks-live", date, seq);
    setLast(res);
    if (res.ok && res.count > 0) {
      const stats = applyFlags(store.current, res.rows, PK);
      addLog(
        `${intradayFilename(date, seq)}: ${res.count} rows (+${stats.inserted} new, ${stats.updated} updated, ${stats.deleted} deleted)`,
        "ok",
      );
      seqRef.current = seq + 1;
      setNextSeq(seq + 1);
      setPrices([...store.current.values()]);
      return true;
    }
    addLog(
      `${intradayFilename(date, seq)}: ${res.ok ? "not published yet – will retry same sequence" : res.message}`,
      res.ok ? "wait" : "err",
    );
    return false;
  }, [date]);

  // Poll loop
  useEffect(() => {
    if (!polling) return;
    stopRef.current = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopRef.current) return;
      setBusy(true);
      await fetchNext();
      setBusy(false);
      if (!stopRef.current) timer = setTimeout(tick, intervalSec * 1000);
    };
    tick();
    return () => {
      stopRef.current = true;
      clearTimeout(timer);
    };
  }, [polling, intervalSec, fetchNext]);

  /** For past dates: read seq 1, 2, 3… back-to-back until a file is missing. */
  async function catchUp() {
    setPolling(false);
    stopRef.current = false;
    setBusy(true);
    for (let i = 0; i < 100 && !stopRef.current; i++) {
      const got = await fetchNext();
      if (!got) break;
    }
    setBusy(false);
  }

  async function loadNames() {
    setBusy(true);
    const res = await getAccord("company-master", date);
    if (res.ok) {
      const map = new Map(names);
      for (const r of res.rows) {
        const key = `${getField(r, "SYMBOL")}|${getField(r, "SERIES")}`;
        map.set(key, {
          name: String(getField(r, "COMPNAME") ?? getField(r, "S_NAME") ?? ""),
          fincode: getField(r, "FINCODE"),
          industry: getField(r, "industry"),
        });
      }
      setNames(map);
      addLog(`Company master: ${res.count} companies loaded for name lookup`, "ok");
    } else {
      addLog(`Company master: ${res.message}`, "err");
    }
    setBusy(false);
  }

  // Rows for display, joined with company names (SYMBOL + SERIES → Company_master)
  const rows = useMemo(() => {
    return prices.map((r) => {
      const n = names.get(`${getField(r, "SYMBOL")}|${getField(r, "SERIES")}`);
      return {
        SYMBOL: getField(r, "SYMBOL"),
        SERIES: getField(r, "SERIES"),
        COMPANY: n?.name ?? "",
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
      } as Row;
    });
  }, [prices, names]);

  const movers = useMemo(() => {
    const withChg = rows.filter((r) => r.PER_CHANGE !== null);
    const byChg = [...withChg].sort((a, b) => (b.PER_CHANGE as number) - (a.PER_CHANGE as number));
    const byVol = [...rows].sort((a, b) => ((b.VOLUME as number) ?? 0) - ((a.VOLUME as number) ?? 0));
    const adv = withChg.filter((r) => (r.PER_CHANGE as number) > 0).length;
    const dec = withChg.filter((r) => (r.PER_CHANGE as number) < 0).length;
    return {
      gainers: byChg.slice(0, 5),
      losers: byChg.slice(-5).reverse(),
      active: byVol.slice(0, 5),
      adv,
      dec,
    };
  }, [rows]);

  const lastUpd = useMemo(() => {
    let max = "";
    for (const r of rows) if (String(r.UPD_TIME ?? "") > max) max = String(r.UPD_TIME);
    return max;
  }, [rows]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">NSE Live Prices (15-min delayed)</h1>
        <p className="text-sm text-zinc-500">
          Fetches intraday files <code>yyyymmdd01</code>, <code>02</code>, <code>03</code>… in
          sequence and merges them by <code>SYMBOL + SERIES</code> using the A/O/D flag rules.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Date</span>
          <input
            type="date"
            value={dateIso}
            onChange={(e) => {
              stopRef.current = true;
              setPolling(false);
              reset();
              setDateIso(e.target.value);
            }}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Poll every (sec)</span>
          <input
            type="number"
            min={15}
            value={intervalSec}
            onChange={(e) => setIntervalSec(Math.max(15, Number(e.target.value) || 60))}
            className="w-28 rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <div className="text-sm">
          <span className="block font-medium">Next file</span>
          <code className="inline-block py-2 font-mono">{intradayFilename(date, nextSeq)}</code>
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={() => fetchNext()}
            disabled={busy || polling}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Fetch next file
          </button>
          <button
            onClick={catchUp}
            disabled={busy || polling}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            title="Fetch 01, 02, 03… back-to-back until a file is missing"
          >
            Catch up (all files)
          </button>
          <button
            onClick={loadNames}
            disabled={busy}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            title="Join Company_master to show company names"
          >
            Load company names
          </button>
          <button
            onClick={() => setPolling((p) => !p)}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white ${polling ? "bg-red-600 hover:bg-red-500" : "bg-indigo-600 hover:bg-indigo-500"}`}
          >
            {polling ? "Stop polling" : "Start polling"}
          </button>
          <button
            onClick={() => {
              setPolling(false);
              stopRef.current = true;
              reset();
            }}
            className="rounded-md px-3 py-2 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Reset
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Market breadth</p>
            <p className="mt-2 text-2xl font-semibold">
              <span className="text-emerald-600">{movers.adv}</span>
              <span className="mx-1 text-zinc-400">/</span>
              <span className="text-red-600">{movers.dec}</span>
            </p>
            <p className="text-xs text-zinc-500">advances / declines · {rows.length} scrips</p>
            <p className="mt-2 text-xs text-zinc-500">Last update: {lastUpd.replace("T", " ") || "—"}</p>
          </div>
          {(
            [
              ["Top gainers", movers.gainers, "PER_CHANGE"],
              ["Top losers", movers.losers, "PER_CHANGE"],
              ["Most active (volume)", movers.active, "VOLUME"],
            ] as const
          ).map(([title, list, field]) => (
            <div key={title} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="text-xs uppercase tracking-wide text-zinc-500">{title}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {list.map((r) => {
                  const v = r[field] as number | null;
                  return (
                    <li key={String(r.SYMBOL)} className="flex justify-between gap-2">
                      <span className="truncate font-medium">{String(r.SYMBOL)}</span>
                      <span
                        className={`tabular-nums ${field === "PER_CHANGE" ? ((v ?? 0) >= 0 ? "text-emerald-600" : "text-red-600") : ""}`}
                      >
                        {field === "PER_CHANGE"
                          ? `${(v ?? 0) > 0 ? "+" : ""}${fmt(v)}%`
                          : fmt(v, 0)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {last && <StatusBanner res={last} />}

      <DataTable rows={rows} filename={`nse_live_${date}`} primaryKey={PK} />

      {log.length > 0 && (
        <details open className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <summary className="cursor-pointer font-medium">Fetch log</summary>
          <ul className="mt-2 max-h-60 space-y-0.5 overflow-auto font-mono text-xs">
            {log.map((l, i) => (
              <li
                key={i}
                className={
                  l.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : l.tone === "wait" ? "text-amber-700 dark:text-amber-400" : "text-red-600"
                }
              >
                [{l.t}] {l.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
