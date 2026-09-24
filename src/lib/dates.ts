/** Date helpers for the Accord API's formats. */

/** "2026-07-31" (from <input type=date>) → "31072026" (ddmmyyyy for the API) */
export function isoToDdmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}${m}${y}`;
}

/** "31072026" → "2026-07-31" */
export function ddmmyyyyToIso(s: string): string {
  return `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;
}

/**
 * Intraday filename = yyyymmdd + sequence, sequence starting at 01.
 * e.g. date 31072026, seq 1 → "2026073101"
 */
export function intradayFilename(ddmmyyyy: string, seq: number): string {
  const yyyymmdd = `${ddmmyyyy.slice(4, 8)}${ddmmyyyy.slice(2, 4)}${ddmmyyyy.slice(0, 2)}`;
  return `${yyyymmdd}${String(seq).padStart(2, "0")}`;
}

export function isValidDdmmyyyy(s: string): boolean {
  if (!/^\d{8}$/.test(s)) return false;
  const d = new Date(ddmmyyyyToIso(s));
  return !Number.isNaN(d.getTime());
}
