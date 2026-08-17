import type { AppEnv } from "../types.js";

const PROVINCE_RE = /^[0-9]{2}$/;

export async function handleProvinceHazardsLatest(province: string, env: AppEnv): Promise<Response> {
  if (!PROVINCE_RE.test(province)) {
    return Response.json({ error: "Invalid province code" }, { status: 400 });
  }

  const stub = env.FORECAST_POINTER.getByName(`province:${province}`);
  const pointer = await stub.getLatest();

  if (!pointer) {
    return Response.json(
      { error: "No forecast published for this province yet" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const object = await env.HAZARD_BUCKET.get(pointer.manifestKey);
  if (!object) {
    return Response.json({ error: "Forecast manifest not found" }, { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=5, s-maxage=15, stale-while-revalidate=30",
      ETag: object.httpEtag,
      "X-Model-Run": pointer.runId,
    },
  });
}
