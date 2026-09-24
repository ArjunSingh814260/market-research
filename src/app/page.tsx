"use client";

import { useRef, useState } from "react";

import { DataTable } from "@/components/DataTable";
import { StatusBanner } from "@/components/StatusBanner";
import { getAccord, type AccordResponse } from "@/lib/client";
import { DATASETS, GROUPS, getDataset, isIntraday } from "@/lib/datasets";
import { ddmmyyyyToIso, intradayFilename, isoToDdmmyyyy } from "@/lib/dates";

const SAMPLE_DATE = process.env.NEXT_PUBLIC_DEFAULT_DATE ?? "31072026";

export default function ExplorerPage() {
  const [datasetId, setDatasetId] = useState("company-master");
  const [dateIso, setDateIso] = useState(ddmmyyyyToIso(SAMPLE_DATE));
  const [seq, setSeq] = useState(1);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<AccordResponse | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const dataset = getDataset(datasetId)!;
  const date = isoToDdmmyyyy(dateIso);
  const filename = isIntraday(dataset) ? intradayFilename(date, seq) : dataset.filename;

  async function load() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      setRes(await getAccord(datasetId, date, isIntraday(dataset) ? seq : undefined, ctrl.signal));
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setRes({
          ok: false,
          status: 0,
          source: "live",
          dataset: { id: datasetId, label: dataset.label, section: dataset.section, primaryKey: [] },
          filename: filename ?? "",
          date,
          url: "",
          count: 0,
          rows: [],
          message: (e as Error).message,
          fetchedAt: new Date().toISOString(),
        });
      }
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Data Explorer</h1>
        <p className="text-sm text-zinc-500">
          Pick any feed from the Accord technical documents, choose a date, and fetch it through
          this app&apos;s server (<code>/api/accord</code>).
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        className="grid gap-4 rounded-xl border border-zinc-200 p-4 sm:grid-cols-[2fr_1fr_auto_auto] dark:border-zinc-800"
      >
        <label className="space-y-1 text-sm">
          <span className="font-medium">Dataset</span>
          <select
            value={datasetId}
            onChange={(e) => {
              setDatasetId(e.target.value);
              setRes(null);
            }}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {DATASETS.filter((d) => d.group === g).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Date</span>
          <input
            type="date"
            value={dateIso}
            onChange={(e) => setDateIso(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        {isIntraday(dataset) ? (
          <label className="space-y-1 text-sm">
            <span className="font-medium">Sequence #</span>
            <input
              type="number"
              min={1}
              max={999}
              value={seq}
              onChange={(e) => setSeq(Math.max(1, Number(e.target.value) || 1))}
              className="w-24 rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        ) : (
          <div />
        )}

        <div className="flex items-end">
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {loading ? "Fetching…" : "Fetch"}
          </button>
        </div>

        <div className="text-xs text-zinc-500 sm:col-span-4">
          <p>{dataset.description}</p>
          <p className="mt-1">
            filename=<b className="font-mono">{filename}</b> · date=<b className="font-mono">{date}</b>{" "}
            · section=<b className="font-mono">{dataset.section}</b> · PK=
            <b className="font-mono">{dataset.primaryKey.join(" + ")}</b> · {dataset.frequency}
          </p>
        </div>
      </form>

      {loading && (
        <p className="animate-pulse text-sm text-zinc-500">
          Requesting {filename} from Accord… large master files can take a while.
        </p>
      )}

      {res && !loading && (
        <div className="space-y-4">
          <StatusBanner res={res} />
          <DataTable
            rows={res.rows}
            filename={`${res.filename}_${res.date}`}
            primaryKey={res.dataset.primaryKey}
          />
        </div>
      )}
    </div>
  );
}
