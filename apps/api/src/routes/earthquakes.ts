import { parseQuery } from "../query.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";

const MAX_LIMIT = 500;

/**
 * GET /api/v1/earthquakes/recent?limit=&minMag=
 * `limit` is clamped to 1..500 (a non-numeric value is a 400, not a silent
 * fallback) and `minMag` is applied inside the query, so "newest 100 with
 * M>=5" means what it says rather than "M>=5 among the newest 100".
 */
export async function handleEarthquakesRecent(request: Request, env: AppEnv): Promise<Response> {
  const q = parseQuery(new URL(request.url), {
    limit: { type: "int", min: 1, max: MAX_LIMIT, fallback: 100 },
    minMag: { type: "float" },
  });
  if (!q.ok) return json({ error: q.error }, { status: 400 });

  const stub = env.EARTHQUAKE_FEED.getByName("global");
  const body = await stub.getRecentResponse(q.value.limit, q.value.minMag);
  return json(body, { cacheControl: "public, max-age=10, s-maxage=20" });
}

export async function handleEarthquakesLive(request: Request, env: AppEnv): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected websocket upgrade", { status: 426 });
  }
  const stub = env.EARTHQUAKE_FEED.getByName("global");
  return stub.fetch(request);
}
