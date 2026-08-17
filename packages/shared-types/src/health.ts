/**
 * Operational status of every upstream source, surfaced next to the map (see
 * plan: "source freshness and model health next to the hazard map"). Nothing
 * here is hazard data — it only says how fresh/available the hazard data is.
 */
export type SourceHealth = "ok" | "stale" | "degraded" | "down" | "unknown";

export interface SourceStatus {
  id: string;
  /** Human label (Thai). */
  labelTh: string;
  health: SourceHealth;
  /** When our backend last successfully pulled from the source. */
  fetchedAt: string | null;
  /** Newest observation timestamp inside the data we hold. */
  latestObservedAt: string | null;
  /** Last attempt (successful or not). */
  lastAttemptAt: string | null;
  lastError: string | null;
  /** Source-specific detail, e.g. station counts, frames, ws clients. */
  detail: Record<string, number | string | null>;
  /** After this many seconds without a successful fetch the source is stale. */
  staleAfterSeconds: number;
}

export interface HealthResponse {
  ok: boolean;
  serverTime: string;
  sources: SourceStatus[];
}
