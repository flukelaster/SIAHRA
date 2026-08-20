import { parseQuery } from "../query.js";
import * as cachePolicy from "../cachePolicy.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import { errorText, logError } from "../log.js";

/** GET /api/v1/archive/days — which Bangkok days have long-term archive files. */
export async function handleArchiveDays(_req: Request, env: AppEnv): Promise<Response> {
  try {
    const days = await env.OBSERVATION_CACHE.getByName("thaiwater").archiveDays(60);
    return json({ days }, { cache: cachePolicy.slowMoving });
  } catch (err) {
    logError("archive days failed", { error: errorText(err) });
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
    if (!snap) return json({ error: "No snapshot near that time" }, { status: 404 });
    return json(snap, { cache: cachePolicy.archivedSnapshot });
  } catch (err) {
    logError("archive snapshot failed", { error: errorText(err) });
    return json({ error: "Archive unavailable" }, { status: 503 });
  }
}
