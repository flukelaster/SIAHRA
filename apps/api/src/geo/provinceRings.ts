import type { NearestProvince } from "@siahra/shared-types";
import raw from "../data/provinceRings.json";
import { nearestProvinces, type ProvinceRingSet } from "./pointInProvince.js";

/**
 * วงขอบเขต 77 จังหวัดที่ถูก bake เข้า bundle ของ Worker — Worker อ่านไฟล์ใน
 * `apps/web/public/aoi/*` ตอนรันไม่ได้ สร้างใหม่ด้วย
 * `npm run build:province-rings -w apps/etl`
 *
 * cast ที่ขอบเดียวจุดนี้โดยตั้งใจ: ถ้าปล่อยให้ TypeScript อนุมานชนิดตามค่าจริง
 * ของพิกัดสามแสนกว่าตัว การ typecheck จะช้าลงอย่างเห็นได้ชัดโดยไม่ได้อะไรกลับมา
 */
const artefact = raw as unknown as {
  generatedAt: string;
  toleranceDeg: number;
  provinces: ProvinceRingSet[];
};

export const PROVINCE_RINGS: readonly ProvinceRingSet[] = artefact.provinces;
export const PROVINCE_RINGS_TOLERANCE_DEG = artefact.toleranceDeg;

/** สามจังหวัดที่ใกล้จุดนี้ที่สุด คิดจากทั้ง 77 จังหวัด ไม่มีขั้นคัดกรองก่อน */
export function nearestProvincesForPoint(lon: number, lat: number, limit = 3): NearestProvince[] {
  return nearestProvinces(lon, lat, PROVINCE_RINGS, limit);
}
