import type { AccordResponse } from "@/lib/client";

export function StatusBanner({ res }: { res: AccordResponse }) {
  const tone = !res.ok
    ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
    : res.status === 204 || res.count === 0
      ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
      : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200";

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-semibold">HTTP {res.status}</span>
        <span>{res.count.toLocaleString()} rows</span>
        {res.filename && (
          <span>
            file <code className="font-mono">{res.filename}</code>
          </span>
        )}
        {res.source === "mock" && (
          <span className="rounded bg-violet-600 px-1.5 py-0.5 text-xs font-medium text-white">
            MOCK
          </span>
        )}
        <span className="opacity-70">{new Date(res.fetchedAt).toLocaleTimeString()}</span>
      </div>
      {res.message && <p className="mt-1">{res.message}</p>}
      {res.url && (
        <p className="mt-1 break-all font-mono text-xs opacity-70">{res.url}</p>
      )}
    </div>
  );
}
