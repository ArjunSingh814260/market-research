import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";

import { fetchAccord } from "@/lib/accord.server";
import { isValidDdmmyyyy } from "@/lib/dates";
import { findIndex, type IndexInfo } from "@/lib/indexNames";
import { fetchNseIndexList } from "@/lib/nseIndexList.server";
import { getField, normalizeRows, type Row } from "@/lib/rows";

/**
 * Which stocks belong to an index (e.g. NIFTY 50)?
 *
 *   GET /api/index-constituents?date=31072026                 → list of indices
 *   GET /api/index-constituents?date=31072026&index=NIFTY 50  → + its constituents
 *
 * Joins two master feeds from the Stock Prices tech doc:
 *   Indicesmaster   (INDEX_CODE, EXCHANGE, INDEX_NAME)   section=Master
 *   Comp_Indexpart  (FINCODE, SYMBOL, INDEX_CODE)        section=Master
 *
 * Master feeds are INCREMENTAL – on most days they only contain changes (or
 * return 204). Accord gives you a one-time full dump when you subscribe; save
 * those as data/Indicesmaster.json and data/Comp_Indexpart.json and this route
 * uses them as the base, applying the day's feed on top.
 *
 * Masters change at most once a day (10:30 PM), and Accord limits hits, so the
 * result is cached in memory per date.
 */

interface Constituent {
  fincode: unknown;
  symbol: string;
  scripcode: unknown;
  company?: string;
  industry?: string;
}
interface Masters {
  indices: IndexInfo[];
  parts: Row[];
  sources: string[];
  messages: string[];
}

const cache = new Map<string, { at: number; data: Masters }>();
const TTL_MS = 6 * 60 * 60 * 1000;

async function readDump(file: string): Promise<Row[]> {
  try {
    const text = await readFile(path.join(process.cwd(), "data", file), "utf8");
    return normalizeRows(JSON.parse(text));
  } catch {
    return [];
  }
}

/** Base dump + today's incremental feed, merged by primary key using the Flag rules. */
async function loadMaster(datasetId: string, dumpFile: string, pk: string[], date: string) {
  const merged = new Map<string, Row>();
  const key = (r: Row) => pk.map((k) => String(getField(r, k))).join("|");
  const dump = await readDump(dumpFile);
  for (const r of dump) merged.set(key(r), r);

  const res = await fetchAccord({ datasetId, date });
  for (const r of res.rows) {
    if (String(getField(r, "flag") ?? "").toUpperCase() === "D") merged.delete(key(r));
    else merged.set(key(r), r);
  }
  const sources = [
    dump.length ? `data/${dumpFile} (${dump.length} rows)` : "",
    res.count ? `${res.filename} feed ${res.source} (${res.count} rows)` : "",
  ].filter(Boolean);
  const message = !res.ok || res.count === 0 ? `${res.filename}: ${res.message ?? `HTTP ${res.status}`}` : "";
  return { rows: [...merged.values()], sources, message };
}

async function getMasters(date: string): Promise<Masters> {
  const hit = cache.get(date);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const [im, cp] = await Promise.all([
    loadMaster("indices-master", "Indicesmaster.json", ["INDEX_CODE"], date),
    loadMaster("comp-indexpart", "Comp_Indexpart.json", ["FINCODE", "INDEX_CODE"], date),
  ]);

  const indices = im.rows
    .map((r) => ({
      code: Number(getField(r, "INDEX_CODE")),
      exchange: String(getField(r, "EXCHANGE") ?? "").trim(),
      name: String(getField(r, "INDEX_NAME") ?? "").trim(),
      longName: String(getField(r, "INDEX_LNAME") ?? "").trim(),
    }))
    .sort((a, b) => a.exchange.localeCompare(b.exchange) || a.name.localeCompare(b.name));

  const data: Masters = {
    indices,
    parts: cp.rows,
    sources: [...im.sources, ...cp.sources],
    messages: [im.message, cp.message].filter(Boolean),
  };
  // Only cache when we actually got something, so a transient 403/timeout isn't sticky.
  if (indices.length && cp.rows.length) cache.set(date, { at: Date.now(), data });
  return data;
}

/**
 * ?source=auto   (default) Accord's Comp_Indexpart, replaced by NSE's official
 *                list when that has more stocks (Accord's daily feed is partial)
 * ?source=accord only Accord
 * ?source=nse    only NSE's list (niftyindices.com CSV)
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const date = sp.get("date") ?? "";
  const indexParam = sp.get("index")?.trim() ?? "";
  const source = (sp.get("source") ?? "auto").toLowerCase();
  if (!isValidDdmmyyyy(date)) {
    return Response.json({ ok: false, message: "?date= must be ddmmyyyy" }, { status: 400 });
  }

  const m = await getMasters(date);
  let index: IndexInfo | undefined;
  let constituents: Constituent[] = [];
  let constituentsFrom = "";
  const sources = [...m.sources];
  const messages = [...m.messages];

  if (indexParam) {
    index = findIndex(m.indices, indexParam);

    const accordRows = index
      ? m.parts.filter((r) => Number(getField(r, "INDEX_CODE")) === index!.code)
      : [];
    const fromAccord: Constituent[] = accordRows
      .map((r) => ({
        fincode: getField(r, "FINCODE"),
        symbol: String(getField(r, "SYMBOL") ?? "").trim().toUpperCase(),
        scripcode: getField(r, "SCRIPCODE"),
      }))
      .filter((c) => c.symbol);

    // Skip the NSE call in mock mode unless explicitly asked for.
    const wantNse =
      source === "nse" || (source === "auto" && process.env.ACCORD_MOCK !== "true");
    if (wantNse) {
      const nse = await fetchNseIndexList(indexParam, index?.name ?? "", index?.longName ?? "");
      if (nse.ok) {
        sources.push(`NSE list ${nse.url?.split("/").pop()} (${nse.constituents.length} stocks)`);
        if (source === "nse" || nse.constituents.length > fromAccord.length) {
          // Keep Accord's FINCODE / SCRIPCODE where Accord knows the symbol.
          const accordBySymbol = new Map(fromAccord.map((c) => [c.symbol, c]));
          constituents = nse.constituents.map((c) => ({
            fincode: accordBySymbol.get(c.symbol)?.fincode ?? null,
            scripcode: accordBySymbol.get(c.symbol)?.scripcode ?? null,
            symbol: c.symbol,
            company: c.company,
            industry: c.industry,
          }));
          constituentsFrom = "nse";
        }
      } else if (nse.message) {
        messages.push(nse.message);
      }
    }

    if (!constituentsFrom && source !== "nse") {
      constituents = fromAccord;
      constituentsFrom = "accord";
    }
    constituents.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  return Response.json(
    {
      ok: m.indices.length > 0,
      date,
      indices: m.indices,
      index: index ?? null,
      constituents,
      constituentsFrom,
      sources,
      message:
        messages.join(" · ") ||
        (indexParam && !index ? `Index "${indexParam}" not found in Indicesmaster.` : undefined),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
