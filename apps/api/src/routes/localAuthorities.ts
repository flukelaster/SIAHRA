import {
  isLocalAuthorityType,
  isProvinceCode,
  LOCAL_AUTHORITY_TYPES,
  type LocalAuthoritiesResponse,
  type LocalAuthorityDetailResponse,
  type LocalAuthorityExposureResponse,
  type LocalAuthorityImpactResponse,
} from "@siahra/shared-types";
import * as cachePolicy from "../cachePolicy.js";
import { getBoundaryGeometryById } from "../data/localAuthorityBoundaries.js";
import {
  getLocalAuthorityById,
  LOCAL_AUTHORITIES_DESCRIPTOR,
  queryLocalAuthorities,
} from "../data/localAuthorities.js";
import { getExposureByLocalAuthorityId } from "../data/localAuthorityExposure.js";
import { computeLocalAuthorityImpact } from "../geo/floodIntersection.js";
import { errorText, logError } from "../log.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";

/**
 * ทะเบียน อปท. ทั้งประเทศ (E11.1) — เป็น static-reference ที่ bake เข้า bundle
 * ตอน build ไม่ใช่ค่าที่ต้องขอ Durable Object จึงไม่มีทาง "ล่ม" แบบแหล่งสด
 * และไม่ต้องปรากฏใน /api/v1/health (ดู SOURCES.dla ใน packages/shared-types)
 */

/** GET /api/v1/local-authorities[?province=NN][&type=...][&q=...] */
export function handleLocalAuthoritiesList(request: Request): Response {
  const url = new URL(request.url);
  const province = url.searchParams.get("province");
  if (province !== null && !isProvinceCode(province)) {
    return json({ error: `Invalid province — expected a real two-digit code, got "${province}"` }, { status: 400 });
  }
  const type = url.searchParams.get("type");
  if (type !== null && !isLocalAuthorityType(type)) {
    return json(
      { error: `Invalid type — expected one of ${LOCAL_AUTHORITY_TYPES.join(", ")}, got "${type}"` },
      { status: 400 },
    );
  }
  const q = url.searchParams.get("q");

  const localAuthorities = queryLocalAuthorities({
    provinceCode: province ?? undefined,
    type: type ?? undefined,
    query: q ?? undefined,
  });

  const body: LocalAuthoritiesResponse = {
    layer: LOCAL_AUTHORITIES_DESCRIPTOR,
    total: localAuthorities.length,
    localAuthorities,
  };
  return json(body, { cache: cachePolicy.slowMoving });
}

/** GET /api/v1/local-authorities/:id — id เป็นได้ทั้ง `TH-LAO-<code>` หรือ `<code>` เปล่า ๆ */
export function handleLocalAuthorityDetail(id: string): Response {
  const localAuthority = getLocalAuthorityById(id);
  if (!localAuthority) return json({ error: `No such local authority: ${id}` }, { status: 404 });
  const body: LocalAuthorityDetailResponse = {
    layer: LOCAL_AUTHORITIES_DESCRIPTOR,
    localAuthority,
  };
  return json(body, { cache: cachePolicy.slowMoving });
}

/**
 * GET /api/v1/local-authorities/:id/exposure — E11.3 baseline exposure
 * (population/buildings/roads/facilities). 404 both when `id` is not a real
 * registry record, and when it is real but has no E11.2 boundary polygon to
 * compute zonal statistics against — never a fabricated zero/estimated record.
 */
export function handleLocalAuthorityExposure(id: string): Response {
  const localAuthority = getLocalAuthorityById(id);
  if (!localAuthority) return json({ error: `No such local authority: ${id}` }, { status: 404 });

  const exposure = getExposureByLocalAuthorityId(localAuthority.id);
  if (!exposure) {
    return json(
      { error: `No baseline exposure for ${localAuthority.id} — no E11.2 boundary polygon to compute it against` },
      { status: 404 },
    );
  }

  const body: LocalAuthorityExposureResponse = { exposure };
  return json(body, { cache: cachePolicy.slowMoving });
}

/**
 * GET /api/v1/local-authorities/:id/impact — E11.4 real polygon intersection
 * between the current GISTDA flood-extent scene and the authority's real
 * E11.2 boundary. 404 when `id` is not a real registry record, or when it is
 * real but has no E11.2 boundary polygon or no E11.3 baseline exposure to
 * compute against — same "real prerequisite missing → 404, not a fabricated
 * record" discipline as `/exposure`. Depends on live flood data (not the
 * static registry/exposure artefacts above), so it uses the flood-extent
 * cache policy, not `slowMoving`.
 */
export async function handleLocalAuthorityImpact(id: string, env: AppEnv): Promise<Response> {
  const localAuthority = getLocalAuthorityById(id);
  if (!localAuthority) return json({ error: `No such local authority: ${id}` }, { status: 404 });

  const boundary = getBoundaryGeometryById(localAuthority.id);
  const baseline = getExposureByLocalAuthorityId(localAuthority.id);
  if (!boundary || !baseline) {
    return json(
      {
        error: `No flood-impact data for ${localAuthority.id} — no E11.2 boundary polygon or E11.3 baseline exposure to compute it against`,
      },
      { status: 404 },
    );
  }

  const stub = env.FLOOD_EXTENT.getByName("gistda");
  try {
    const flood = await stub.getProvince(localAuthority.provinceCode);
    const impact = computeLocalAuthorityImpact({
      authorityId: localAuthority.id,
      authorityGeometry: boundary,
      floodFeatures: flood.features,
      retrievedAt: flood.retrievedAt,
      baseline,
      computedAt: new Date().toISOString(),
    });
    const body: LocalAuthorityImpactResponse = { impact };
    return json(body, { cache: cachePolicy.floodExtent(flood.retrievedAt) });
  } catch (err) {
    logError("local authority impact request failed", { error: errorText(err), id: localAuthority.id });
    return json({ error: "Flood impact unavailable" }, { status: 503 });
  }
}
