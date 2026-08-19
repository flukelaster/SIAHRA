import { SOURCES, type HealthResponse, type SourceId, type SourceStatus } from "@siahra/shared-types";
import { rejectedLastHour } from "../rateLimit.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";

/**
 * GET /api/v1/health — freshness of every upstream source, so the UI can put
 * "data is N minutes old / source down" next to the map instead of hiding
 * it. Each DO reports its own status; a DO that throws is reported as
 * "unknown" rather than failing the whole endpoint.
 */
export async function handleHealth(_request: Request, env: AppEnv): Promise<Response> {
  const collectors: Promise<SourceStatus[]>[] = [
    env.OBSERVATION_CACHE.getByName("thaiwater")
      .status()
      .then((s) => [s])
      .catch((err: unknown) => [unknownStatus("thaiwater", String(err))]),
    env.EARTHQUAKE_FEED.getByName("global")
      .status()
      .catch((err: unknown) => [unknownStatus("earthquakes", String(err))]),
    env.FLOOD_EXTENT.getByName("gistda")
      .status()
      .then((s) => [s])
      .catch((err: unknown) => [unknownStatus("gistda-flood", String(err))]),
    env.RADAR.getByName("tmd")
      .status()
      .then((s) => [s])
      .catch((err: unknown) => [unknownStatus("tmd-radar", String(err))]),
  ];
  const sources = (await Promise.all(collectors)).flat();
  const body: HealthResponse = {
    ok: sources.every((s) => s.health === "ok" || s.health === "stale"),
    serverTime: new Date().toISOString(),
    sources,
    api: { rateLimited429LastHour: rejectedLastHour() },
  };
  return json(body, { cacheControl: "public, max-age=15" });
}

/** id ถูกบังคับเป็น SourceId เพื่อไม่ให้ /health โผล่ชื่อแหล่งที่ layer ไหนอ้างไม่ได้ */
function unknownStatus(id: SourceId, error: string): SourceStatus {
  return {
    id,
    labelTh: SOURCES[id].nameTh,
    labelEn: SOURCES[id].nameEn,
    health: "unknown",
    fetchedAt: null,
    latestObservedAt: null,
    lastAttemptAt: null,
    lastError: error,
    detail: {},
    staleAfterSeconds: 0,
  };
}
