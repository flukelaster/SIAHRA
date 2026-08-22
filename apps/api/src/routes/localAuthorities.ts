import {
  isLocalAuthorityType,
  isProvinceCode,
  LOCAL_AUTHORITY_TYPES,
  type LocalAuthoritiesResponse,
  type LocalAuthorityDetailResponse,
} from "@siahra/shared-types";
import * as cachePolicy from "../cachePolicy.js";
import {
  getLocalAuthorityById,
  LOCAL_AUTHORITIES_DESCRIPTOR,
  queryLocalAuthorities,
} from "../data/localAuthorities.js";
import { json } from "../router.js";

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
