import { parseQuery } from "../query.js";
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
  const q = parseQuery(new URL(request.url), {
    at: { type: "isoInstant" },
    province: { type: "province" },
  });
  if (!q.ok) return json({ error: q.error }, { status: 400 });
  const { at, province } = q.value;
  if (at === null) return json({ error: "at (ISO-8601) required" }, { status: 400 });
  try {
    const snap = await env.OBSERVATION_CACHE.getByName("thaiwater").archivedSnapshot(Date.parse(at), province);
    if (!snap) return json({ error: "No snapshot near that time" }, { status: 404, cacheControl: "public, max-age=60" });
    return json(snap, { cacheControl: "public, max-age=3600" });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: "archive snapshot failed", error: String(err) }));
    return json({ error: "Archive unavailable" }, { status: 503 });
  }
}
