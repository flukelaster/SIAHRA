import { parseQuery } from "../query.js";
import * as cachePolicy from "../cachePolicy.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";

/** GET /api/v1/radar/frames?hours=3 */
export async function handleRadarFrames(request: Request, env: AppEnv): Promise<Response> {
  const q = parseQuery(new URL(request.url), { hours: { type: "int", min: 1, max: 720, fallback: 3 } });
  if (!q.ok) return json({ error: q.error }, { status: 400 });
  try {
    const data = await env.RADAR.getByName("tmd").getFrames(q.value.hours);
    return json(data, { cache: cachePolicy.radarFrames });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: "radar frames failed", error: String(err) }));
    return json({ error: "Radar unavailable" }, { status: 503 });
  }
}

/** GET /api/v1/radar/frame/{tsMs}.png — proxied TMD composite, immutable. */
export async function handleRadarFrame(tsRaw: string, env: AppEnv): Promise<Response> {
  const tsMs = Number(tsRaw);
  if (!Number.isFinite(tsMs)) return json({ error: "Bad frame id" }, { status: 400 });
  const key = await env.RADAR.getByName("tmd").frameKey(tsMs);
  if (!key) return json({ error: "Frame not found" }, { status: 404 });
  const object = await env.HAZARD_BUCKET.get(key);
  if (!object) return json({ error: "Frame missing" }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": cachePolicy.radarFrame.value,
      ETag: object.httpEtag,
    },
  });
}
