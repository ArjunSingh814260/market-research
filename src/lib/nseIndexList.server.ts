import "server-only";

import { normIndex } from "./indexNames";

/**
 * Official index constituent lists published by NSE Indices (niftyindices.com)
 * as CSV files, e.g.
 *   https://www.niftyindices.com/IndexConstituent/ind_nifty50list.csv
 * Columns: Company Name, Industry, Symbol, Series, ISIN Code
 *
 * Used to fill in indices where Accord's Comp_Indexpart is incomplete
 * (the daily feed only carries changes; the full list comes in the one-time dump).
 */

const BASE = process.env.NSE_INDEX_CSV_BASE ?? "https://www.niftyindices.com/IndexConstituent/";

/** Accord INDEX_NAME / common name (normalised) → CSV file name. */
const FILES: Record<string, string> = {
  NIFTY: "ind_nifty50list.csv",
  NIFTY50: "ind_nifty50list.csv",
  BANKNIFTY: "ind_niftybanklist.csv",
  NIFTYBANK: "ind_niftybanklist.csv",
  NIFTYJUNIOR: "ind_niftynext50list.csv",
  NIFTYNEXT50: "ind_niftynext50list.csv",
  NIFTY100: "ind_nifty100list.csv",
  NIFTY200: "ind_nifty200list.csv",
  NIFTY500: "ind_nifty500list.csv",
  NIFTYMIDCAP: "ind_niftymidcap100list.csv",
  NIFTYMIDCAP100: "ind_niftymidcap100list.csv",
  NIFTYSMALL: "ind_niftysmallcap100list.csv",
  NIFTYSMALLCAP100: "ind_niftysmallcap100list.csv",
  NIFTYIT: "ind_niftyitlist.csv",
  NIFTYENERGY: "ind_niftyenergylist.csv",
  NIFTYINFRAST: "ind_niftyinfralist.csv",
  NIFTYINFRASTRUCTURE: "ind_niftyinfralist.csv",
  NOILGAS: "ind_niftyoilgaslist.csv",
  NIFTYOILGAS: "ind_niftyoilgaslist.csv",
  NFTY200MOM30: "ind_nifty200Momentum30_list.csv",
  NIFTY200MOMENTUM30: "ind_nifty200Momentum30_list.csv",
};

export interface NseConstituent {
  symbol: string;
  company: string;
  industry: string;
  series: string;
  isin: string;
}

export interface NseListResult {
  ok: boolean;
  url?: string;
  constituents: NseConstituent[];
  message?: string;
}

const cache = new Map<string, { at: number; data: NseListResult }>();
const TTL_MS = 12 * 60 * 60 * 1000; // lists change rarely (semi-annual rebalance)

export function nseCsvFor(...names: string[]): string | undefined {
  for (const n of names) {
    const f = FILES[normIndex(n)];
    if (f) return f;
  }
  return undefined;
}

/** Minimal CSV parser that handles quoted fields ("Company, Ltd."). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export async function fetchNseIndexList(...names: string[]): Promise<NseListResult> {
  const file = nseCsvFor(...names);
  if (!file) {
    return { ok: false, constituents: [], message: `No NSE list known for ${names.filter(Boolean).join(" / ")}` };
  }
  const url = BASE + file;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      // niftyindices.com rejects requests without a browser-like User-Agent.
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
        Accept: "text/csv,*/*",
      },
    });
    if (!res.ok) return { ok: false, url, constituents: [], message: `NSE list: HTTP ${res.status}` };

    const text = (await res.text()).replace(/^﻿/, "");
    const [header, ...body] = parseCsv(text);
    const col = (name: string) =>
      header?.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase()) ?? -1;
    const iSym = col("Symbol");
    if (iSym < 0) {
      return { ok: false, url, constituents: [], message: "NSE list: unexpected file format (no Symbol column)" };
    }
    const iName = col("Company Name"),
      iInd = col("Industry"),
      iSer = col("Series"),
      iIsin = col("ISIN Code");
    const constituents = body
      .map((r) => ({
        symbol: (r[iSym] ?? "").trim().toUpperCase(),
        company: (r[iName] ?? "").trim(),
        industry: (r[iInd] ?? "").trim(),
        series: (r[iSer] ?? "").trim(),
        isin: (r[iIsin] ?? "").trim(),
      }))
      .filter((c) => c.symbol);

    const data = { ok: constituents.length > 0, url, constituents };
    if (data.ok) cache.set(url, { at: Date.now(), data });
    return data;
  } catch (e) {
    return { ok: false, url, constituents: [], message: `NSE list: ${(e as Error).message}` };
  }
}
