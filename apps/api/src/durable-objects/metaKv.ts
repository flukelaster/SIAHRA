/**
 * Key-value `meta` table helpers shared by every Durable Object that needs a
 * handful of small persisted scalars (`fetchedAt`, `lastError`, backoff
 * bookkeeping, …) alongside its real rows. Extracted out of `FloodExtentDO`
 * (E11.5) — that DO and `ObservationCacheDO` had near-identical
 * `readMeta`/`writeMeta` private methods, and the new `AlertEngineDO` would
 * have been a third copy; one shared module means the KV semantics (null =
 * delete the row, never "the empty string") are defined once.
 *
 * `ObservationCacheDO` keeps its own copy for now — this module's job is to
 * stop the count from growing, not to touch a DO outside this task's scope.
 */

export interface MetaRow extends Record<string, SqlStorageValue> {
  value: string;
}

/** Every DO using these helpers must run this once (inside `blockConcurrencyWhile`). */
export const META_TABLE_DDL = `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`;

export function readMeta(sql: SqlStorage, key: string): string | null {
  return sql.exec<MetaRow>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value ?? null;
}

/** `value === null` deletes the row — there is no such thing as a stored `null`. */
export function writeMeta(sql: SqlStorage, key: string, value: string | null): void {
  if (value === null) {
    sql.exec("DELETE FROM meta WHERE key = ?", key);
    return;
  }
  sql.exec(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}
