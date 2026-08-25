import { parseQuery } from "../query.js";
import * as cachePolicy from "../cachePolicy.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import { errorText, logError } from "../log.js";

/**
 * GET /api/v1/provinces/{NN}/flood-extent[?at=<iso>] — GISTDA satellite flood
 * polygons for one province; `at` (E14.F1) answers from the scene that covered
 * that instant instead of the latest one, validated the same way as
 * /observations so a bad value is a 400, never a NaN in the Durable Object.
 */
export async function handleProvinceFloodExtent(province: string, request: Request, env: AppEnv): Promise<Response> {
  const q = parseQuery(new URL(request.url), { at: { type: "isoInstant" } });
  if (!q.ok) return json({ error: q.error }, { status: 400 });
  const atMs = q.value.at ? Date.parse(q.value.at) : null;
  const stub = env.FLOOD_EXTENT.getByName("gistda");
  try {
    const data = await stub.getProvince(province, atMs);
    return json(data, { cache: cachePolicy.floodExtent(data.retrievedAt, atMs !== null) });
  } catch (err) {
    logError("flood extent request failed", { error: errorText(err) });
    return json({ error: "Flood extent unavailable" }, { status: 503 });
  }
}

/** GET /api/v1/flood-extent/summary — per-province totals of the current scene. */
export async function handleFloodExtentSummary(_req: Request, env: AppEnv): Promise<Response> {
  const stub = env.FLOOD_EXTENT.getByName("gistda");
  try {
    const data = await stub.getSummary();
    return json(data, { cache: cachePolicy.floodExtent(data.retrievedAt) });
  } catch (err) {
    logError("flood summary request failed", { error: errorText(err) });
    return json({ error: "Flood extent unavailable" }, { status: 503 });
  }
}
