"use client";

import { useEffect, useState } from "react";

export type StepStatus = "pending" | "active" | "done" | "error" | "skipped";

export interface Step {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "active") return <Spinner className="h-5 w-5 text-indigo-500" />;
  if (status === "done")
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-xs text-white">
        ✓
      </span>
    );
  if (status === "error")
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white">
        ✕
      </span>
    );
  return (
    <span className="flex h-5 w-5 items-center justify-center">
      <span className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-600" />
    </span>
  );
}

/** Seconds since `since`, ticking while mounted. */
function useElapsed(since: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [since]);
  return since === null ? 0 : Math.max(0, (now - since) / 1000);
}

/**
 * A checklist that shows what the page is doing right now:
 * spinner on the running step, ✓ on finished ones, and a live detail line.
 */
export function LoadingSteps({
  steps,
  running,
  startedAt,
  title = "Loading data",
}: {
  steps: Step[];
  running: boolean;
  startedAt: number | null;
  title?: string;
}) {
  const elapsed = useElapsed(running ? startedAt : null);
  const finished = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const pct = steps.length ? Math.round((finished / steps.length) * 100) : 0;
  if (!steps.length) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/30"
    >
      <div className="flex items-center justify-between gap-4">
        <p className="flex items-center gap-2 font-medium">
          {running && <Spinner className="h-4 w-4 text-indigo-500" />}
          {running ? title : "Done"}
        </p>
        <span className="text-xs tabular-nums text-zinc-500">
          {finished}/{steps.length} steps{running && ` · ${elapsed.toFixed(1)}s`}
        </span>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-900/60">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all duration-500"
          style={{ width: `${Math.max(pct, running ? 5 : 0)}%` }}
        />
      </div>

      <ol className="mt-4 space-y-3">
        {steps.map((s) => (
          <li key={s.key} className="flex gap-3">
            <StepIcon status={s.status} />
            <div className="min-w-0">
              <p
                className={`text-sm ${s.status === "pending" ? "text-zinc-400" : "font-medium"} ${s.status === "error" ? "text-red-600" : ""}`}
              >
                {s.label}
              </p>
              {s.detail && (
                <p className="break-words text-xs text-zinc-500 dark:text-zinc-400">{s.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Grey placeholder rows shown while the table is loading. */
export function TableSkeleton({ rows = 8, cols = 8 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="flex gap-4 bg-zinc-100 px-3 py-3 dark:bg-zinc-900">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-3 flex-1 animate-pulse rounded bg-zinc-300 dark:bg-zinc-700" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
          {Array.from({ length: cols }).map((_, i) => (
            <div
              key={i}
              className="h-3 flex-1 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"
              style={{ animationDelay: `${(r * cols + i) * 20}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
