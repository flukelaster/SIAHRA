import type { EarthquakeRecentResponse } from "@siahra/shared-types";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";

const MAX_LIMIT = 500;

/**
 * GET /api/v1/earthquakes/recent?limit=&minMag=
 * `limit` is clamped to 1..500 (an unparseable value falls back to 100) and
 * `minMag` is applied inside the query, so "newest 100 with M>=5" means what
 * it says rather than "M>=5 among the newest 100".
 */
export async function handleEarthquakesRecent(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(rawLimit) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit))) : 100;
  const rawMinMag = url.searchParams.get("minMag");
  const minMag = rawMinMag !== null && Number.isFinite(Number(rawMinMag)) ? Number(rawMinMag) : null;

  const stub = env.EARTHQUAKE_FEED.getByName("global");
  const events = await stub.getRecent(limit, minMag);
  const body: EarthquakeRecentResponse = { asOf: new Date().toISOString(), events };
  return json(body, { cacheControl: "public, max-age=10, s-maxage=20" });
}

export async function handleEarthquakesLive(request: Request, env: AppEnv): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected websocket upgrade", { status: 426 });
  }
  const stub = env.EARTHQUAKE_FEED.getByName("global");
  return stub.fetch(request);
}
