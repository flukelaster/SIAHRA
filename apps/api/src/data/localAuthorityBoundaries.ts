import type { LocalAuthorityBoundariesArtefact, LocalAuthorityBoundaryGeometry } from "@siahra/shared-types";
import raw from "./localAuthorityBoundaries.json";

/**
 * ขอบเขต อปท. จริงจาก E11.2 ที่ถูก bake เข้า bundle ของ Worker (E11.4) — สร้างใหม่ด้วย
 * `npm run build:local-authority-boundaries-bundle -w apps/etl` (อ่าน
 * `apps/etl/src/buildLocalAuthorityBoundariesBundle.ts`) ซึ่งแค่คัดลอกเรขาคณิตจริงจาก
 * `apps/web/public/aoi/{code}/local-authorities.geojson` มาทั้งดุ้น ไม่คำนวณใหม่
 *
 * cast ที่ขอบเดียวจุดนี้โดยตั้งใจ เหมือน `apps/api/src/data/localAuthorities.ts`
 */
const artefact = raw as unknown as LocalAuthorityBoundariesArtefact;

const BY_ID = new Map<string, LocalAuthorityBoundaryGeometry>(
  artefact.boundaries.map((b) => [b.id, b.geometry]),
);

export const LOCAL_AUTHORITY_BOUNDARIES_RECORD_COUNT = artefact.recordCount;

/** null เมื่อไม่มีขอบเขตจริงจาก E11.2 — ไม่ใช่ error */
export function getBoundaryGeometryById(id: string): LocalAuthorityBoundaryGeometry | null {
  return BY_ID.get(id) ?? null;
}
