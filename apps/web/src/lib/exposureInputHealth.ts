import type { SourceStatus } from "@siahra/shared-types";

/**
 * Whether the rainfall and water-level station feeds themselves are healthy —
 * independent of the dam feed, which is bundled into the aggregate ThaiWater
 * source health (`status()` on the backend folds `damsError` into `lastError`
 * on purpose, for `SourceStatusBar`). Used by two call sites that both need
 * exactly this narrower question, never the aggregate:
 *
 * - `App.tsx`'s `observationsStale` — dims the rain/water-level station
 *   markers on the map. A dam failure must not dim them (round 8 review):
 *   `DamCard` already surfaces dam failures on its own, so folding damsError
 *   in here would only mis-dim unrelated, perfectly fresh station data.
 * - Exposure consumes only ThaiWater rainfall and water-level observations,
 *   so the aggregate ThaiWater source health must not decide whether an
 *   exposure run's inputs are degraded either.
 *
 * The status fields are deliberately fail-closed: an older backend response
 * with no per-feed metadata cannot establish that either input is fresh.
 */
export function exposureInputsAreDegraded(thaiwater: SourceStatus | null): boolean {
  if (thaiwater === null) return false;
  return [thaiwater.detail.rainfallHealth, thaiwater.detail.waterlevelHealth].some((health) => health !== "ok");
}
