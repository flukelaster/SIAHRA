import { createRouter } from "./router.js";
import { handleEarthquakesLive, handleEarthquakesRecent } from "./routes/earthquakes.js";
import { handleFloodExtentSummary, handleProvinceFloodExtent } from "./routes/flood.js";
import { handleProvinceHazardsLatest } from "./routes/hazards.js";
import { handleHealth } from "./routes/health.js";
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

const route = createRouter([
  { pattern: /^\/api\/v1\/health$/, handler: handleHealth },
  { pattern: /^\/api\/v1\/earthquakes\/recent$/, handler: handleEarthquakesRecent },
  { pattern: /^\/api\/v1\/earthquakes\/live$/, handler: handleEarthquakesLive, limit: { perMinute: 10, burst: 5 } },
  { pattern: /^\/api\/v1\/observations$/, handler: handleObservations, limit: { perMinute: 120 } },
  { pattern: /^\/api\/v1\/flood-extent\/summary$/, handler: handleFloodExtentSummary },
  { pattern: /^\/api\/v1\/dams$/, handler: handleDams },
  { pattern: /^\/api\/v1\/archive\/days$/, handler: handleArchiveDays },
  { pattern: /^\/api\/v1\/archive\/snapshot$/, handler: handleArchiveSnapshot, limit: { perMinute: 60 } },
  { pattern: /^\/api\/v1\/radar\/frames$/, handler: handleRadarFrames },
  {
    pattern: /^\/api\/v1\/radar\/frame\/([0-9]+)\.png$/,
    handler: (_req, env, [ts]) => handleRadarFrame(ts, env),
    limit: { perMinute: 600 },
    limitScope: "radar-frame",
  },
  {
    pattern: /^\/api\/v1\/stations\/([0-9]+)\/history$/,
    handler: (req, env, [id]) => handleStationHistory(id, req, env),
    limit: { perMinute: 60, burst: 20 },
    limitScope: "history",
  },
  {
    pattern: /^\/api\/v1\/provinces\/([0-9]{2})\/flood-extent$/,
    handler: (_req, env, [province]) => handleProvinceFloodExtent(province, env),
  },
  {
    pattern: /^\/api\/v1\/provinces\/([0-9]{2})\/hazards\/latest$/,
    handler: (_req, env, [province]) => handleProvinceHazardsLatest(province, env),
  },
]);

export default {
  fetch: (request: Request, env: AppEnv, ctx: ExecutionContext) => route(request, env, ctx),

  async scheduled(_controller: ScheduledController, env: AppEnv): Promise<void> {
    const stub = env.EARTHQUAKE_FEED.getByName("global");
    const result = await stub.pollAndBroadcast();
    console.log(
      JSON.stringify({ level: "info", message: "earthquake poll complete", ...result }),
    );
    // Keep the observation cache warm too, so the first browser request after
    // a quiet period never pays the 2-4 MB upstream fetch inline.
    await env.OBSERVATION_CACHE.getByName("thaiwater").ensureFresh();
    await env.FLOOD_EXTENT.getByName("gistda").ensureFresh();
    await env.RADAR.getByName("tmd").ensureFresh();
  },
} satisfies ExportedHandler<AppEnv>;
