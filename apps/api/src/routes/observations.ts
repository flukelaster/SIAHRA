import { parseQuery } from "../query.js";
import * as cachePolicy from "../cachePolicy.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import { errorText, logError } from "../log.js";

/**
 * GET /api/v1/observations[?province=NN][&at=<iso>]
 *
 * Direct sensor readings from the ThaiWater/HII telemetry network. Served
 * from a Durable Object cache because the upstream payloads are 2-4 MB.
 */
export async function handleObservations(request: Request, env: AppEnv): Promise<Response> {
  const q = parseQuery(new URL(request.url), {
    province: { type: "province" },
    at: { type: "isoInstant" },
  });
  if (!q.ok) return json({ error: q.error }, { status: 400 });

  const stub = env.OBSERVATION_CACHE.getByName("thaiwater");

  try {
    const data = await stub.getObservations(q.value.province, q.value.at);
    return json(data, { cache: cachePolicy.observations });
  } catch (err) {
    logError("observations request failed", { error: errorText(err) });
    return json({ error: "Observation data unavailable" }, { status: 503 });
  }
}
