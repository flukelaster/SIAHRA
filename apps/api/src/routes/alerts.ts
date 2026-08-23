import { isProvinceCode } from "@siahra/shared-types";
import * as cachePolicy from "../cachePolicy.js";
import { getLocalAuthorityById } from "../data/localAuthorities.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import { errorText, logError } from "../log.js";

/**
 * Threshold/alert engine routes (E11.5) — read-only, deliberately. There is
 * no `POST /api/v1/alerts/evaluate` anywhere in this file or this codebase:
 * the reverted implementation's only trigger was exactly that endpoint, and
 * its empty-body path silently cleared every active alert. Evaluation only
 * happens inside `AlertEngineDO`'s own `alarm()`/`ensureFresh()`, driven by
 * the cron (`src/index.ts`'s `scheduled()`), never from an inbound request.
 */

/** GET /api/v1/alerts/active[?province=NN][&localAuthorityId=ID] */
export async function handleActiveAlerts(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  const province = url.searchParams.get("province");
  if (province !== null && !isProvinceCode(province)) {
    return json({ error: `Invalid province — expected a real two-digit code, got "${province}"` }, { status: 400 });
  }
  const rawLocalAuthorityId = url.searchParams.get("localAuthorityId");
  let localAuthorityId: string | undefined;
  if (rawLocalAuthorityId !== null) {
    // รับได้ทั้ง id เต็ม (`TH-LAO-6110604`) และรหัส อปท. เปล่า ๆ (`6110604`)
    // เหมือน /local-authorities/:id — แต่ AlertEngineDO เก็บ/เทียบด้วย id เต็ม
    // เท่านั้น ต้อง normalise ก่อนส่งต่อ ไม่งั้นรหัสเปล่า ๆ ที่ผ่านการตรวจแล้วว่า
    // "มีอยู่จริง" จะกลับไม่ match อะไรเลยที่ชั้น DO (filter ที่ดูเหมือนใช้ได้แต่ว่าง)
    const authority = getLocalAuthorityById(rawLocalAuthorityId);
    if (!authority) return json({ error: `No such local authority: ${rawLocalAuthorityId}` }, { status: 404 });
    localAuthorityId = authority.id;
  }

  try {
    const stub = env.ALERT_ENGINE.getByName("primary");
    const body = await stub.getActiveAlerts({
      provinceCode: province ?? undefined,
      localAuthorityId,
    });
    return json(body, { cache: cachePolicy.observations });
  } catch (err) {
    logError("active alerts request failed", { error: errorText(err) });
    return json({ error: "Alert data unavailable" }, { status: 503 });
  }
}

/** GET /api/v1/alerts/rules[?stationId=ID] */
export async function handleAlertRules(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  const rawStationId = url.searchParams.get("stationId");
  let stationId: number | undefined;
  if (rawStationId !== null) {
    const n = Number(rawStationId);
    if (!Number.isInteger(n) || n < 0) {
      return json({ error: `Invalid stationId — expected a non-negative integer, got "${rawStationId}"` }, { status: 400 });
    }
    stationId = n;
  }

  try {
    const stub = env.ALERT_ENGINE.getByName("primary");
    const body = await stub.getRules({ stationId });
    return json(body, { cache: cachePolicy.slowMoving });
  } catch (err) {
    logError("alert rules request failed", { error: errorText(err) });
    return json({ error: "Alert rule data unavailable" }, { status: 503 });
  }
}
