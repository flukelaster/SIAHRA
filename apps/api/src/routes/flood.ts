import * as cachePolicy from "../cachePolicy.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import { errorText, logError } from "../log.js";

/** GET /api/v1/provinces/{NN}/flood-extent — GISTDA satellite flood polygons for one province. */
export async function handleProvinceFloodExtent(province: string, env: AppEnv): Promise<Response> {
  const stub = env.FLOOD_EXTENT.getByName("gistda");
  try {
    const data = await stub.getProvince(province);
    return json(data, { cache: cachePolicy.floodExtent(data.retrievedAt) });
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
