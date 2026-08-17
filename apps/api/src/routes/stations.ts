import { json } from "../router.js";
import type { AppEnv } from "../types.js";

/** GET /api/v1/stations/{id}/history?hours=72 — ThaiWater water-level time series. */
export async function handleStationHistory(id: string, request: Request, env: AppEnv): Promise<Response> {
  const stationId = Number(id);
  if (!Number.isInteger(stationId) || stationId <= 0) return json({ error: "Invalid station id" }, { status: 400 });
  const rawHours = Number(new URL(request.url).searchParams.get("hours") ?? "72");
  const hours = Number.isFinite(rawHours) ? Math.min(168, Math.max(1, Math.round(rawHours))) : 72;
  const stub = env.OBSERVATION_CACHE.getByName("thaiwater");
  try {
    const data = await stub.getHistory(stationId, hours);
    return json(data, { cacheControl: "public, max-age=120" });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: "station history failed", error: String(err) }));
    return json({ error: "History unavailable" }, { status: 503 });
  }
}

/** GET /api/v1/dams[?province=NN] — reservoir storage (ThaiWater analyst/dam). */
export async function handleDams(request: Request, env: AppEnv): Promise<Response> {
  const province = new URL(request.url).searchParams.get("province");
  if (province !== null && !/^[0-9]{2}$/.test(province)) return json({ error: "Invalid province code" }, { status: 400 });
  const stub = env.OBSERVATION_CACHE.getByName("thaiwater");
  try {
    const data = await stub.getDams(province);
    return json(data, { cacheControl: "public, max-age=300" });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: "dams failed", error: String(err) }));
    return json({ error: "Dam data unavailable" }, { status: 503 });
  }
}
