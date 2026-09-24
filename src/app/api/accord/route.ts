import type { NextRequest } from "next/server";

import { fetchAccord } from "@/lib/accord.server";
import { isValidDdmmyyyy } from "@/lib/dates";

/**
 * Proxy to Accord's GetRawDataJSON endpoint.
 *
 *   GET /api/accord?dataset=company-master&date=31072026
 *   GET /api/accord?dataset=nse-stocks-live&date=31072026&seq=3
 *
 * Why a proxy instead of calling Accord from the browser?
 *  1. The token stays on the server (never shipped to users).
 *  2. Accord only accepts requests from whitelisted server IPs – a browser
 *     request would come from the visitor's IP and get 403.
 *  3. Avoids CORS issues.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const dataset = sp.get("dataset") ?? "";
  const date = sp.get("date") ?? "";
  const seq = Number(sp.get("seq") ?? "1");
  const sub = sp.get("sub") ?? "";

  if (!dataset) {
    return Response.json({ ok: false, message: "Missing ?dataset=" }, { status: 400 });
  }
  if (!isValidDdmmyyyy(date)) {
    return Response.json(
      { ok: false, message: "?date= must be ddmmyyyy, e.g. 31072026" },
      { status: 400 },
    );
  }
  if (!Number.isInteger(seq) || seq < 1 || seq > 999) {
    return Response.json({ ok: false, message: "?seq= must be 1–999" }, { status: 400 });
  }

  const result = await fetchAccord({ datasetId: dataset, date, seq, sub });
  // Always 200 to the browser so the UI can show Accord's status + explanation.
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
