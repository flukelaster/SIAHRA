import { parseQuery } from "../query.js";
import * as cachePolicy from "../cachePolicy.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";

/** GET /api/v1/stations/{id}/history?hours=72 — ThaiWater water-level time series. */
export async function handleStationHistory(id: string, request: Request, env: AppEnv): Promise<Response> {
  const stationId = Number(id);
  if (!Number.isInteger(stationId) || stationId <= 0) return json({ error: "Invalid station id" }, { status: 400 });
  const q = parseQuery(new URL(request.url), { hours: { type: "int", min: 1, max: 720, fallback: 72 } });
  if (!q.ok) return json({ error: q.error }, { status: 400 });
  const stub = env.OBSERVATION_CACHE.getByName("thaiwater");
  try {
    const data = await stub.getHistory(stationId, q.value.hours);
    return json(data, { cache: cachePolicy.history });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: "station history failed", error: String(err) }));
    return json({ error: "History unavailable" }, { status: 503 });
  }
}

/** GET /api/v1/dams[?province=NN] — reservoir storage (ThaiWater analyst/dam). */
export async function handleDams(request: Request, env: AppEnv): Promise<Response> {
  const q = parseQuery(new URL(request.url), { province: { type: "province" } });
  if (!q.ok) return json({ error: q.error }, { status: 400 });
  const stub = env.OBSERVATION_CACHE.getByName("thaiwater");
  try {
    const data = await stub.getDams(q.value.province);
    return json(data, { cache: cachePolicy.slowMoving });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: "dams failed", error: String(err) }));
    return json({ error: "Dam data unavailable" }, { status: 503 });
  }
}
