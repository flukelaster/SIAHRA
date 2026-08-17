import type { HealthResponse, SourceStatus } from "@siahra/shared-types";
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
      .catch((err: unknown) => [
        unknownStatus("thaiwater", "ThaiWater (สสน.)", String(err)),
      ]),
    env.EARTHQUAKE_FEED.getByName("global")
      .status()
      .catch((err: unknown) => [
        unknownStatus("earthquakes", "แผ่นดินไหว (USGS/EMSC/TMD)", String(err)),
      ]),
    env.FLOOD_EXTENT.getByName("gistda")
      .status()
      .then((s) => [s])
      .catch((err: unknown) => [
        unknownStatus("gistda-flood", "น้ำท่วมจากภาพดาวเทียม (GISTDA)", String(err)),
      ]),
    env.RADAR.getByName("tmd")
      .status()
      .then((s) => [s])
      .catch((err: unknown) => [unknownStatus("tmd-radar", "เรดาร์ฝน (กรมอุตุนิยมวิทยา)", String(err))]),
  ];
  const sources = (await Promise.all(collectors)).flat();
  const body: HealthResponse = {
    ok: sources.every((s) => s.health === "ok" || s.health === "stale"),
    serverTime: new Date().toISOString(),
    sources,
  };
  return json(body, { cacheControl: "public, max-age=15" });
}

function unknownStatus(id: string, labelTh: string, error: string): SourceStatus {
  return {
    id,
    labelTh,
    health: "unknown",
    fetchedAt: null,
    latestObservedAt: null,
    lastAttemptAt: null,
    lastError: error,
    detail: {},
    staleAfterSeconds: 0,
  };
}
