"use client";

import { downloadText } from "@/lib/client";
import type { Statement, StatementRow } from "@/lib/fundamentals";

const isEmpty = (r: StatementRow) => r.values.every((v) => v === null || v === 0);

/** Drop rows with no data, then headings that have nothing left under them. */
function withoutEmptyRows(rows: StatementRow[]): StatementRow[] {
  const kept = rows.filter((r) => r.header || !isEmpty(r));
  return kept.filter((r, i) => {
    if (!r.header) return true;
    const next = kept[i + 1];
    return next !== undefined && !next.header;
  });
}

export function formatValue(v: number | null, decimals = 2): string {
  if (v === null) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

function toCsv(s: Statement, rows: StatementRow[]): string {
  const esc = (x: string) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
  return [
    [s.unitLabel, ...s.periods].map(esc).join(","),
    ...rows.map((r) =>
      [esc(" ".repeat(r.indent) + r.label), ...r.values.map((v) => (v === null ? "" : String(v)))].join(","),
    ),
  ].join("\n");
}

export function StatementTable({
  statement,
  hideEmpty,
  decimals = 2,
  csvName,
}: {
  statement: Statement;
  hideEmpty: boolean;
  decimals?: number;
  csvName: string;
}) {
  const rows = hideEmpty ? withoutEmptyRows(statement.rows) : statement.rows;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
        <span>
          Figures in <b>{statement.unitLabel}</b> · display format{" "}
          <code className="font-mono">{statement.format}</code> · {rows.length} rows
        </span>
        <button
          onClick={() => downloadText(`${csvName}.csv`, toCsv(statement, rows))}
          className="rounded-md border border-zinc-300 px-2.5 py-1 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Download CSV
        </button>
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 min-w-64 border-b border-zinc-200 bg-zinc-100 px-3 py-2 text-left font-medium dark:border-zinc-800 dark:bg-zinc-900">
                Particulars
              </th>
              {statement.periods.map((p, i) => (
                <th
                  key={`${p}-${i}`}
                  className="sticky top-0 z-10 whitespace-nowrap border-b border-zinc-200 bg-zinc-100 px-3 py-2 text-right font-medium dark:border-zinc-800 dark:bg-zinc-900"
                >
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className={
                  r.header
                    ? "bg-zinc-50 dark:bg-zinc-900/60"
                    : "hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20"
                }
              >
                <td
                  className={`sticky left-0 border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800/70 ${
                    r.header ? "bg-zinc-50 dark:bg-zinc-900" : "bg-white dark:bg-zinc-950"
                  } ${r.bold ? "font-semibold" : ""} ${r.indent ? "text-zinc-600 dark:text-zinc-400" : ""}`}
                  style={{ paddingLeft: `${0.75 + Math.min(r.indent, 8) * 0.3}rem` }}
                >
                  {r.label}
                </td>
                {r.header
                  ? statement.periods.map((_, j) => (
                      <td key={j} className="border-b border-zinc-100 dark:border-zinc-800/70" />
                    ))
                  : r.values.map((v, j) => (
                      <td
                        key={j}
                        className={`whitespace-nowrap border-b border-zinc-100 px-3 py-1.5 text-right font-mono tabular-nums dark:border-zinc-800/70 ${
                          r.bold ? "font-semibold" : ""
                        } ${v !== null && v < 0 ? "text-red-600 dark:text-red-400" : ""} ${
                          v === null ? "text-zinc-300 dark:text-zinc-700" : ""
                        }`}
                      >
                        {formatValue(v, decimals)}
                      </td>
                    ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
