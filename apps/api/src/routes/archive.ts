import { json } from "../router.js";
import type { AppEnv } from "../types.js";

/** GET /api/v1/archive/days — which Bangkok days have long-term archive files. */
export async function handleArchiveDays(_req: Request, env: AppEnv): Promise<Response> {
  try {
    const days = await env.OBSERVATION_CACHE.getByName("thaiwater").archiveDays(60);
    return json({ days }, { cacheControl: "public, max-age=300" });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: "archive days failed", error: String(err) }));
    return json({ error: "Archive unavailable" }, { status: 503 });
  }
}

/** GET /api/v1/archive/snapshot?at=<iso>[&province=NN] — nearest hourly nationwide snapshot. */
export async function handleArchiveSnapshot(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  const at = url.searchParams.get("at");
  const province = url.searchParams.get("province");
  if (!at || !Number.isFinite(Date.parse(at))) return json({ error: "at (ISO-8601) required" }, { status: 400 });
  if (province !== null && !/^[0-9]{2}$/.test(province)) return json({ error: "Invalid province code" }, { status: 400 });
  try {
    const snap = await env.OBSERVATION_CACHE.getByName("thaiwater").archivedSnapshot(Date.parse(at), province);
    if (!snap) return json({ error: "No snapshot near that time" }, { status: 404, cacheControl: "public, max-age=60" });
    return json(snap, { cacheControl: "public, max-age=3600" });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: "archive snapshot failed", error: String(err) }));
    return json({ error: "Archive unavailable" }, { status: 503 });
  }
}
