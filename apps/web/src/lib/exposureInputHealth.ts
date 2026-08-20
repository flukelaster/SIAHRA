import type { SourceStatus } from "@siahra/shared-types";

/**
 * Exposure consumes only ThaiWater rainfall and water-level observations.
 * The aggregate ThaiWater source health also includes the independent dam
 * feed, so it must not decide whether an exposure run's inputs are degraded.
 *
 * The status fields are deliberately fail-closed: an older backend response
 * with no per-feed metadata cannot establish that either input is fresh.
 */
export function exposureInputsAreDegraded(thaiwater: SourceStatus | null): boolean {
  if (thaiwater === null) return false;
  return [thaiwater.detail.rainfallHealth, thaiwater.detail.waterlevelHealth].some((health) => health !== "ok");
}
