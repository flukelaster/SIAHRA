import { json } from "../router.js";
import type { AppEnv } from "../types.js";

/** GET /api/v1/radar/frames?hours=3 */
export async function handleRadarFrames(request: Request, env: AppEnv): Promise<Response> {
  const raw = Number(new URL(request.url).searchParams.get("hours") ?? "3");
  const hours = Number.isFinite(raw) ? Math.min(24, Math.max(1, raw)) : 3;
  try {
    const data = await env.RADAR.getByName("tmd").getFrames(hours);
    return json(data, { cacheControl: "public, max-age=60" });
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
      "Cache-Control": "public, max-age=86400, immutable",
      ETag: object.httpEtag,
    },
  });
}
