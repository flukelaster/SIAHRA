import { createRouter, type Route } from "./router.js";
import { runScheduledTick } from "./scheduledTick.js";
import { handleEarthquakesLive, handleEarthquakesRecent } from "./routes/earthquakes.js";
import { handleExposureRun, handleProvinceExposureLatest } from "./routes/exposure.js";
import { handleFloodExtentSummary, handleProvinceFloodExtent } from "./routes/flood.js";
import { handleHealth } from "./routes/health.js";
import { handleLocalAuthorityDetail, handleLocalAuthoritiesList } from "./routes/localAuthorities.js";
import { handleObservations } from "./routes/observations.js";
import { handleRadarFrame, handleRadarFrames } from "./routes/radar.js";
import { handleDams, handleStationHistory } from "./routes/stations.js";
import { handleArchiveDays, handleArchiveSnapshot } from "./routes/archive.js";
import type { AppEnv } from "./types.js";

export { EarthquakeFeedDO } from "./durable-objects/earthquake-feed.js";
export { FloodExtentDO } from "./durable-objects/flood-extent.js";
export { ForecastPointerDO } from "./durable-objects/forecast-pointer.js";
export { ObservationCacheDO } from "./durable-objects/observation-cache.js";
export { RadarDO } from "./durable-objects/radar.js";

/**
 * Every route declares its own limit — no endpoint inherits the router's
 * DEFAULT_LIMIT any more, so raising or lowering a budget is a visible edit
 * here rather than an invisible side effect somewhere else. The numbers and
 * the reasoning behind them are in docs/api.md.
 */
export const routes: Route[] = [
  { method: "GET", pattern: /^\/api\/v1\/health$/, handler: handleHealth, limit: { perMinute: 300 } },
  { method: "GET", pattern: /^\/api\/v1\/earthquakes\/recent$/, handler: handleEarthquakesRecent, limit: { perMinute: 300 } },
  { method: "GET", pattern: /^\/api\/v1\/earthquakes\/live$/, handler: handleEarthquakesLive, limit: { perMinute: 10, burst: 5 } },
  { method: "GET", pattern: /^\/api\/v1\/observations$/, handler: handleObservations, limit: { perMinute: 120 } },
  { method: "GET", pattern: /^\/api\/v1\/flood-extent\/summary$/, handler: handleFloodExtentSummary, limit: { perMinute: 300 } },
  { method: "GET", pattern: /^\/api\/v1\/dams$/, handler: handleDams, limit: { perMinute: 300 } },
  {
    method: "GET",
    pattern: /^\/api\/v1\/local-authorities$/,
    handler: (req) => handleLocalAuthoritiesList(req),
    limit: { perMinute: 300 },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/local-authorities\/([A-Za-z0-9-]+)$/,
    handler: (_req, _env, [id]) => handleLocalAuthorityDetail(id),
    limit: { perMinute: 300 },
  },
  { method: "GET", pattern: /^\/api\/v1\/archive\/days$/, handler: handleArchiveDays, limit: { perMinute: 300 } },
  { method: "GET", pattern: /^\/api\/v1\/archive\/snapshot$/, handler: handleArchiveSnapshot, limit: { perMinute: 60 } },
  { method: "GET", pattern: /^\/api\/v1\/radar\/frames$/, handler: handleRadarFrames, limit: { perMinute: 300 } },
  {
    method: "GET",
    pattern: /^\/api\/v1\/radar\/frame\/([0-9]+)\.png$/,
    handler: (_req, env, [ts]) => handleRadarFrame(ts, env),
    limit: { perMinute: 600 },
    limitScope: "radar-frame",
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/stations\/([0-9]+)\/history$/,
    handler: (req, env, [id]) => handleStationHistory(id, req, env),
    limit: { perMinute: 60, burst: 20 },
    limitScope: "history",
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/provinces\/([0-9]{2})\/flood-extent$/,
    handler: (_req, env, [province]) => handleProvinceFloodExtent(province, env),
    limit: { perMinute: 300 },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/provinces\/([0-9]{2})\/exposure\/latest$/,
    handler: (_req, env, [province]) => handleProvinceExposureLatest(province, env),
    limit: { perMinute: 300 },
  },
  {
    // รูปของ runId ถูกบังคับตั้งแต่ในตารางเส้นทาง (`YYYYMMDDTHHMMSSZ-<16 hex>`)
    // ขยะจึงกลายเป็น 404 ของ router และไม่มี input ของผู้ใช้เดินไปถึงคีย์ R2
    method: "GET",
    pattern: /^\/api\/v1\/exposure\/runs\/([0-9]{8}T[0-9]{6}Z-[0-9a-f]{16})$/,
    handler: (_req, env, [runId]) => handleExposureRun(runId, env),
    // 120/นาที สูงกว่า `/archive/snapshot` (60/นาที) ทั้งที่ทั้งคู่อ่าน R2 หนึ่งก้อน
    // ต่อคำขอ เพราะก้อนนี้เล็กกว่ามาก: run ทั้งประเทศเก็บเป็น gzip ~103 KB (ดิบ 1.29 MB)
    // และเป็น artefact แช่แข็งที่ CDN แคชได้หนึ่งปี คำขอที่ถึง origin จริงจึงมีน้อย
    limit: { perMinute: 120 },
    limitScope: "exposure-run",
  },
];

const route = createRouter(routes);

export default {
  fetch: (request: Request, env: AppEnv, ctx: ExecutionContext) => route(request, env, ctx),

  /**
   * One tick refreshes four independent sources. They run concurrently and in
   * isolation (see src/scheduledTick.ts): a source that throws or hangs is
   * logged and the other three still refresh — a dead GISTDA scene must never
   * be the reason ThaiWater levels went stale.
   */
  async scheduled(_controller: ScheduledController, env: AppEnv): Promise<void> {
    await runScheduledTick([
      {
        id: "earthquakes",
        run: async () => ({ ...(await env.EARTHQUAKE_FEED.getByName("global").pollAndBroadcast()) }),
      },
      // Keep the observation cache warm too, so the first browser request after
      // a quiet period never pays the 2-4 MB upstream fetch inline.
      { id: "thaiwater", run: () => env.OBSERVATION_CACHE.getByName("thaiwater").ensureFresh() },
      { id: "gistda-flood", run: () => env.FLOOD_EXTENT.getByName("gistda").ensureFresh() },
      { id: "tmd-radar", run: () => env.RADAR.getByName("tmd").ensureFresh() },
    ]);
  },
} satisfies ExportedHandler<AppEnv>;
