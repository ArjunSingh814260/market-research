import "server-only";

import { getDataset, isIntraday, type Dataset } from "./datasets";
import { intradayFilename } from "./dates";
import { mockRows } from "./mock";
import { normalizeRows, type Row } from "./rows";

const BASE_URL =
  process.env.ACCORD_BASE_URL ??
  "https://contentapi.accordwebservices.com/RawData/GetRawDataJSON";

export interface FetchResult {
  ok: boolean;
  /** HTTP status from Accord (or ours on validation errors) */
  status: number;
  source: "live" | "mock";
  dataset: Pick<Dataset, "id" | "label" | "section" | "primaryKey">;
  filename: string;
  date: string;
  /** Request URL with the token masked – handy for debugging */
  url: string;
  count: number;
  rows: Row[];
  message?: string;
  fetchedAt: string;
}

/** What each documented status code means (API_RequestResponse.pdf). */
function explain(status: number): string | undefined {
  switch (status) {
    case 200:
      return undefined;
    case 204:
      return "204 No Content – Accord has no new/updated records for this file on this date (or this intraday sequence hasn't been published yet).";
    case 403:
      return "403 Forbidden – the request came from an IP address Accord hasn't whitelisted. Run this app on the server whose public IP you gave Accord.";
    case 404:
      return "404 Not Found – the URL is wrong (check filename / section spelling).";
    case 401:
      return "401 Unauthorized – the token is invalid or expired.";
    default:
      return `Accord returned HTTP ${status}.`;
  }
}

export function buildAccordUrl(filename: string, date: string, section: string, sub = "") {
  const token = process.env.ACCORD_TOKEN ?? "";
  const params = new URLSearchParams({ filename, date, section, sub, token });
  return `${BASE_URL}?${params.toString()}`;
}

export async function fetchAccord(opts: {
  datasetId: string;
  date: string; // ddmmyyyy
  seq?: number; // intraday sequence number (1, 2, 3…)
  sub?: string;
}): Promise<FetchResult> {
  const dataset = getDataset(opts.datasetId);
  const fetchedAt = new Date().toISOString();

  if (!dataset) {
    return {
      ok: false,
      status: 400,
      source: "live",
      dataset: { id: opts.datasetId, label: "Unknown", section: "", primaryKey: [] },
      filename: "",
      date: opts.date,
      url: "",
      count: 0,
      rows: [],
      message: `Unknown dataset "${opts.datasetId}"`,
      fetchedAt,
    };
  }

  const seq = Math.max(1, opts.seq ?? 1);
  const filename = isIntraday(dataset) ? intradayFilename(opts.date, seq) : dataset.filename!;
  const url = buildAccordUrl(filename, opts.date, dataset.section, opts.sub ?? "");
  const maskedUrl = url.replace(/token=[^&]*/, "token=••••••");
  const base = {
    dataset: {
      id: dataset.id,
      label: dataset.label,
      section: dataset.section,
      primaryKey: dataset.primaryKey,
    },
    filename,
    date: opts.date,
    url: maskedUrl,
    fetchedAt,
  };

  // ── Mock mode ────────────────────────────────────────────────
  if (process.env.ACCORD_MOCK === "true") {
    const rows = mockRows(dataset, opts.date, seq);
    return {
      ...base,
      ok: true,
      status: rows.length ? 200 : 204,
      source: "mock",
      count: rows.length,
      rows,
      message: rows.length ? "Mock data (ACCORD_MOCK=true)" : explain(204),
    };
  }

  if (!process.env.ACCORD_TOKEN) {
    return {
      ...base,
      ok: false,
      status: 500,
      source: "live",
      count: 0,
      rows: [],
      message: "ACCORD_TOKEN is not set. Add it to .env.local.",
    };
  }

  // ── Live request ─────────────────────────────────────────────
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(Number(process.env.ACCORD_TIMEOUT_MS ?? 60_000)),
      headers: { Accept: "application/json" },
    });

    if (res.status === 204) {
      return { ...base, ok: true, status: 204, source: "live", count: 0, rows: [], message: explain(204) };
    }

    const text = await res.text();
    if (!res.ok) {
      return {
        ...base,
        ok: false,
        status: res.status,
        source: "live",
        count: 0,
        rows: [],
        message: explain(res.status) + (text ? ` Response: ${text.slice(0, 300)}` : ""),
      };
    }

    let payload: unknown = text;
    try {
      payload = JSON.parse(text);
    } catch {
      // leave as text; normalizeRows returns [] for non-JSON
    }
    const rows = normalizeRows(payload);
    return {
      ...base,
      ok: true,
      status: res.status,
      source: "live",
      count: rows.length,
      rows,
      message: rows.length ? undefined : "Request succeeded but returned no rows.",
    };
  } catch (err) {
    const e = err as Error;
    const timeout = e.name === "TimeoutError" || e.name === "AbortError";
    return {
      ...base,
      ok: false,
      status: timeout ? 504 : 502,
      source: "live",
      count: 0,
      rows: [],
      message: timeout
        ? "Timed out waiting for Accord. Large files (e.g. Company_master) can be slow – try again or raise ACCORD_TIMEOUT_MS."
        : `Could not reach Accord: ${e.message}. If you're on a restricted network or non-whitelisted IP, try ACCORD_MOCK=true to preview the UI.`,
    };
  }
}
