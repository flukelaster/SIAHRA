import type { LocalAuthorityBaselineExposure, LocalAuthorityExposureArtefact } from "@siahra/shared-types";
import raw from "./localAuthorityExposure.json";

/**
 * ความเสี่ยงพื้นฐาน (ประชากร/อาคาร/ถนน/สิ่งอำนวยความสะดวก) ของ อปท. ที่มีขอบเขต
 * จริงจาก E11.2 เท่านั้น (E11.3) — สร้างใหม่ด้วย
 * `npm run build:local-authority-exposure -w apps/etl` (อ่าน
 * `apps/etl/src/buildLocalAuthorityExposure.ts`)
 *
 * cast ที่ขอบเดียวจุดนี้โดยตั้งใจ เหมือน `apps/api/src/data/localAuthorities.ts`
 */
const artefact = raw as unknown as LocalAuthorityExposureArtefact;

const BY_ID = new Map<string, LocalAuthorityBaselineExposure>(
  artefact.exposures.map((e) => [e.localAuthorityId, e]),
);

export const LOCAL_AUTHORITY_EXPOSURE_RECORD_COUNT = artefact.recordCount;

/** null เมื่อไม่มีขอบเขตจริงจาก E11.2 ให้คำนวณ zonal statistics — ไม่ใช่ error */
export function getExposureByLocalAuthorityId(id: string): LocalAuthorityBaselineExposure | null {
  return BY_ID.get(id) ?? null;
}
