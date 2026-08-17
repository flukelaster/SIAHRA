import type { AppEnv } from "../types.js";

const PROVINCE_RE = /^[0-9]{2}$/;

/**
 * GET /api/v1/observations[?province=NN]
 *
 * Direct sensor readings from the ThaiWater/HII telemetry network. Served
 * from a Durable Object cache because the upstream payloads are 2-4 MB.
 */
export async function handleObservations(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  const province = url.searchParams.get("province");

  if (province !== null && !PROVINCE_RE.test(province)) {
    return Response.json(
      { error: "Invalid province code — expected two digits, e.g. 50" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const at = url.searchParams.get("at");
  if (at !== null && !Number.isFinite(Date.parse(at))) {
    return Response.json({ error: "Invalid at — expected ISO-8601" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const stub = env.OBSERVATION_CACHE.getByName("thaiwater");

  try {
    const data = await stub.getObservations(province, at);
    return Response.json(data, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=120" },
    });
  } catch (err) {
    console.error(
      JSON.stringify({ level: "error", message: "observations request failed", error: String(err) }),
    );
    return Response.json(
      { error: "Observation data unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
