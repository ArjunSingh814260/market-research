"use client";

import type { Row } from "./rows";

/** Shape returned by /api/accord (mirrors FetchResult on the server). */
export interface AccordResponse {
  ok: boolean;
  status: number;
  source: "live" | "mock";
  dataset: { id: string; label: string; section: string; primaryKey: string[] };
  filename: string;
  date: string;
  url: string;
  count: number;
  rows: Row[];
  message?: string;
  fetchedAt: string;
}

/** Fetch a dataset through our own API route (never call Accord directly from the browser). */
export async function getAccord(
  dataset: string,
  date: string,
  seq?: number,
  signal?: AbortSignal,
): Promise<AccordResponse> {
  const params = new URLSearchParams({ dataset, date });
  if (seq) params.set("seq", String(seq));
  const res = await fetch(`/api/accord?${params}`, { signal, cache: "no-store" });
  const body = await res.json();
  if (!res.ok && !("rows" in body)) {
    return {
      ok: false,
      status: res.status,
      source: "live",
      dataset: { id: dataset, label: dataset, section: "", primaryKey: [] },
      filename: "",
      date,
      url: "",
      count: 0,
      rows: [],
      message: body.message ?? `HTTP ${res.status}`,
      fetchedAt: new Date().toISOString(),
    };
  }
  return body as AccordResponse;
}

export function downloadText(filename: string, text: string, type = "text/csv") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
