/**
 * Helpers for working with rows returned by the Accord feed.
 * Safe for client and server.
 */

export type Row = Record<string, unknown>;

/**
 * The docs don't pin down the exact JSON envelope, so accept every shape we
 * are likely to get:
 *   [ {...}, {...} ]                       → plain array
 *   { "Table": [ ... ] } / { "data": [...] } → first array property
 *   "[{...}]"                               → JSON encoded twice
 *   { ...single row... }                    → one row
 */
export function normalizeRows(payload: unknown): Row[] {
  if (payload == null || payload === "") return [];

  if (typeof payload === "string") {
    try {
      return normalizeRows(JSON.parse(payload));
    } catch {
      return [];
    }
  }

  if (Array.isArray(payload)) {
    return payload.filter((r): r is Row => typeof r === "object" && r !== null);
  }

  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) return normalizeRows(value);
      if (typeof value === "string" && value.trim().startsWith("[")) {
        const rows = normalizeRows(value);
        if (rows.length) return rows;
      }
    }
    return [obj];
  }

  return [];
}

/** Case-insensitive property lookup – feeds mix FINCODE / Fincode / fincode. */
export function getField(row: Row, name: string): unknown {
  if (name in row) return row[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(row)) if (k.toLowerCase() === lower) return row[k];
  return undefined;
}

export function rowKey(row: Row, primaryKey: string[]): string {
  return primaryKey.map((k) => String(getField(row, k) ?? "")).join("|");
}

/**
 * Apply an incremental feed to an existing set of rows, exactly as Accord
 * describes in their email:
 *   Flag 'A' or 'O' → update if the primary key exists, otherwise insert
 *   Flag 'D'        → delete the row with that primary key
 * The same logic is what you'd run as SQL upserts/deletes in your database.
 */
export function applyFlags(
  existing: Map<string, Row>,
  incoming: Row[],
  primaryKey: string[],
): { inserted: number; updated: number; deleted: number } {
  let inserted = 0,
    updated = 0,
    deleted = 0;
  for (const row of incoming) {
    const key = rowKey(row, primaryKey);
    const flag = String(getField(row, "flag") ?? "A").trim().toUpperCase();
    if (flag === "D") {
      if (existing.delete(key)) deleted++;
    } else {
      if (existing.has(key)) updated++;
      else inserted++;
      existing.set(key, row);
    }
  }
  return { inserted, updated, deleted };
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function rowsToCsv(rows: Row[], columns: string[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join(
    "\n",
  );
}

/** Union of keys across rows, preserving first-seen order. */
export function columnsOf(rows: Row[]): string[] {
  const seen = new Set<string>();
  for (const r of rows.slice(0, 500)) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}
