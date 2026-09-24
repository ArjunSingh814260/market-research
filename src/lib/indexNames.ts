/**
 * Accord's Indicesmaster uses short NSE codes in INDEX_NAME (e.g. "NIFTY" for
 * Nifty 50, "BANKNIFTY" for Nifty Bank) and the full name in INDEX_LNAME.
 * These helpers let people search with the familiar names.
 */

export interface IndexInfo {
  code: number;
  exchange: string;
  name: string; // INDEX_NAME (short code)
  longName: string; // INDEX_LNAME
}

export const normIndex = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Common names → Accord's INDEX_NAME. */
const ALIASES: Record<string, string> = {
  NIFTY50: "NIFTY",
  NIFTY: "NIFTY",
  NIFTYBANK: "BANKNIFTY",
  BANKNIFTY: "BANKNIFTY",
};

export function findIndex(indices: IndexInfo[], query: string): IndexInfo | undefined {
  const q = normIndex(query);
  if (!q) return undefined;
  if (/^\d+$/.test(query.trim())) return indices.find((i) => i.code === Number(query));

  const nseFirst = [...indices].sort(
    (a, b) => Number(b.exchange === "NSE") - Number(a.exchange === "NSE"),
  );
  const alias = ALIASES[q];
  return (
    nseFirst.find((i) => normIndex(i.name) === q) ??
    nseFirst.find((i) => normIndex(i.longName) === q) ??
    (alias ? nseFirst.find((i) => normIndex(i.name) === alias) : undefined)
  );
}

/** Label for dropdowns: "Nifty 50 (NIFTY)". */
export function indexLabel(i: IndexInfo): string {
  if (!i.longName || normIndex(i.longName) === normIndex(i.name)) return i.name;
  return `${i.longName} (${i.name})`;
}
