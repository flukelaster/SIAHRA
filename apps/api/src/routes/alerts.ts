import { isProvinceCode } from "@siahra/shared-types";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import * as cachePolicy from "../cachePolicy.js";

/**
 * GET /api/v1/alerts/active[?province=NN][&localAuthorityId=ID]
 */
export async function handleActiveAlerts(req: Request, env: AppEnv): Promise<Response> {
  const url = new URL(req.url);
  const province = url.searchParams.get("province");
  const localAuthorityId = url.searchParams.get("localAuthorityId") || undefined;

  if (province !== null && !isProvinceCode(province)) {
    return json({ error: `Invalid province code "${province}"` }, { status: 400 });
  }

  const stub = env.ALERT_ENGINE.getByName("primary");
  const data = await stub.getActiveAlerts({
    provinceCode: province ?? undefined,
    localAuthorityId,
  });

  return json(data, {
    cache: cachePolicy.realtime,
  });
}

/**
 * GET /api/v1/alerts/rules[?stationId=ID][&basin=CODE]
 */
export async function handleAlertRules(req: Request, env: AppEnv): Promise<Response> {
  const url = new URL(req.url);
  const stationIdParam = url.searchParams.get("stationId");
  const basinCode = url.searchParams.get("basin") || undefined;

  let stationId: number | undefined;
  if (stationIdParam !== null) {
    stationId = Number(stationIdParam);
    if (!Number.isFinite(stationId)) {
      return json({ error: `Invalid stationId "${stationIdParam}"` }, { status: 400 });
    }
  }

  const stub = env.ALERT_ENGINE.getByName("primary");
  const data = await stub.getRules({
    stationId,
    basinCode,
  });

  return json(data, {
    cache: cachePolicy.slowMoving,
  });
}

/**
 * POST /api/v1/alerts/evaluate
 */
export async function handleEvaluateAlerts(req: Request, env: AppEnv): Promise<Response> {
  let readings: Array<{ stationId: number; telemetry: Record<string, number | null> }> = [];

  try {
    const body = (await req.json()) as {
      readings?: Array<{ stationId: number; telemetry: Record<string, number | null> }>;
    };
    if (Array.isArray(body?.readings)) {
      readings = body.readings;
    }
  } catch {
    // If empty body, proceed with empty readings
  }

  const stub = env.ALERT_ENGINE.getByName("primary");
  const result = await stub.evaluateTelemetry(readings);

  return json(result, {
    cache: cachePolicy.noStore,
  });
}
