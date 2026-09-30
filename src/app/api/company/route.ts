import type { NextRequest } from "next/server";

import { isValidDdmmyyyy } from "@/lib/dates";
import { companyFundamentals, listCompanies } from "@/lib/fundamentals.server";

/**
 * Company fundamentals, built from the Company Fundamentals tech doc feeds.
 *
 *   GET /api/company?date=31072026                  → companies in Company_master
 *   GET /api/company?date=31072026&fincode=100325   → one company, every statement
 *                                                     laid out with Accord's display formats
 *
 * Each Accord file is fetched at most once per date and kept in data/cache/
 * (see fetchAccordCached) because Accord limits hits per file per day.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const date = sp.get("date") ?? "";
  const fincode = sp.get("fincode");

  if (!isValidDdmmyyyy(date)) {
    return Response.json({ ok: false, message: "?date= must be ddmmyyyy" }, { status: 400 });
  }

  if (!fincode) {
    const { companies, sources } = await listCompanies(date);
    return Response.json(
      { ok: companies.length > 0, date, companies, sources },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!/^\d+$/.test(fincode)) {
    return Response.json({ ok: false, message: "?fincode= must be a number" }, { status: 400 });
  }
  const data = await companyFundamentals(date, Number(fincode));
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
