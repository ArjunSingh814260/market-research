"use client";

import { useMemo, useState } from "react";

import { downloadText } from "@/lib/client";
import { columnsOf, rowsToCsv, toNumber, type Row } from "@/lib/rows";

const PAGE_SIZE = 50;

function Flag({ v }: { v: unknown }) {
  const f = String(v ?? "").toUpperCase();
  const cls =
    f === "D"
      ? "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-200"
      : f === "O"
        ? "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-200"
        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${cls}`}>{f || "–"}</span>;
}

function Cell({ col, v }: { col: string; v: unknown }) {
  if (col.toLowerCase() === "flag") return <Flag v={v} />;
  if (v === null || v === undefined || v === "") return <span className="opacity-30">—</span>;
  const lc = col.toLowerCase();
  // Codes / ids / yyyymm periods are identifiers, not quantities – show them raw.
  if (/code|token|fincode|^id$|_id$|year|date|srno|serial|no$/i.test(col)) return <>{String(v)}</>;
  if (typeof v === "number") {
    const signed = lc.includes("change");
    const cls = signed ? (v > 0 ? "text-emerald-600" : v < 0 ? "text-red-600" : "") : "";
    return (
      <span className={`tabular-nums ${cls}`}>
        {v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
      </span>
    );
  }
  return <>{String(v)}</>;
}

export function DataTable({
  rows,
  filename = "data",
  primaryKey = [],
}: {
  rows: Row[];
  filename?: string;
  primaryKey?: string[];
}) {
  const columns = useMemo(() => columnsOf(rows), [rows]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = q
      ? rows.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)))
      : rows;
    if (sort) {
      out = [...out].sort((a, b) => {
        const av = a[sort.col],
          bv = b[sort.col];
        const an = toNumber(av),
          bn = toNumber(bv);
        if (an !== null && bn !== null) return (an - bn) * sort.dir;
        return String(av ?? "").localeCompare(String(bv ?? "")) * sort.dir;
      });
    }
    return out;
  }, [rows, query, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const pkSet = new Set(primaryKey.map((k) => k.toLowerCase()));

  if (!rows.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          placeholder="Search all columns…"
          className="w-full max-w-xs rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <span className="text-sm text-zinc-500">
          {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} rows ·{" "}
          {columns.length} columns
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => downloadText(`${filename}.csv`, rowsToCsv(filtered, columns))}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Download CSV
          </button>
          <button
            onClick={() =>
              downloadText(`${filename}.json`, JSON.stringify(filtered, null, 2), "application/json")
            }
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            JSON
          </button>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-900">
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  onClick={() =>
                    setSort((s) =>
                      s?.col === c ? { col: c, dir: s.dir === 1 ? -1 : 1 } : { col: c, dir: 1 },
                    )
                  }
                  className="cursor-pointer whitespace-nowrap px-3 py-2 text-left font-medium select-none hover:bg-zinc-200 dark:hover:bg-zinc-800"
                >
                  {c}
                  {pkSet.has(c.toLowerCase()) && (
                    <span className="ml-1 rounded bg-amber-200 px-1 text-[10px] text-amber-900">
                      PK
                    </span>
                  )}
                  {sort?.col === c && <span className="ml-1">{sort.dir === 1 ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr
                key={i}
                className="border-t border-zinc-100 odd:bg-white even:bg-zinc-50/60 dark:border-zinc-800 dark:odd:bg-zinc-950 dark:even:bg-zinc-900/40"
              >
                {columns.map((c) => (
                  <td key={c} className="max-w-xs truncate whitespace-nowrap px-3 py-1.5">
                    <Cell col={c} v={r[c]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
            className="rounded border px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
          >
            ← Prev
          </button>
          <span>
            Page {current + 1} / {pages}
          </span>
          <button
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
            className="rounded border px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
