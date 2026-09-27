import type { NearestProvince } from "@siahra/shared-types";
import raw from "../data/provinceRings.json";
import { nearestProvinces, pointInRings, type ProvinceRingSet } from "./pointInProvince.js";

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

/**
 * จังหวัดที่ครอบจุดนี้ (point-in-polygon บนวงที่ย่อแล้ว) — `null` = นอกทุกจังหวัด
 * ใช้กับรายงานจากประชาชน: server เป็นคนกำหนดจังหวัดเอง ไม่เชื่อค่าที่ client ส่งมา
 *
 * วงถูกย่อไว้ (`PROVINCE_RINGS_TOLERANCE_DEG`) จุดที่ชิดขอบจังหวัดจึงอาจตกไปอีกจังหวัด หรือจุดริมชายฝั่ง
 * /ชายแดนอาจได้ `null` ทั้งที่อยู่ในไทยจริง — ยอมรับได้สำหรับหมุดรายงาน ไม่ใช่เรขาคณิตเชิงกฎหมาย
 * bbox ใช้กรองก่อนได้อย่างปลอดภัยที่นี่ (ต่างจากการคิดระยะ): จุดที่อยู่ในวงต้องอยู่ใน bbox ของวงเสมอ —
 * bbox มาจากเรขาคณิตก่อนปัดทศนิยม วงที่ปัดแล้วจึงอาจล้นออกไปไม่เกินครึ่งหลักสุดท้าย เผื่อไว้ `BBOX_PAD_DEG`
 */
const BBOX_PAD_DEG = 0.001;

export function provinceCodeAt(lon: number, lat: number): string | null {
  for (const p of PROVINCE_RINGS) {
    const [minLon, minLat, maxLon, maxLat] = p.bbox;
    if (lon < minLon - BBOX_PAD_DEG || lon > maxLon + BBOX_PAD_DEG) continue;
    if (lat < minLat - BBOX_PAD_DEG || lat > maxLat + BBOX_PAD_DEG) continue;
    if (pointInRings(lon, lat, p.rings)) return p.code;
  }
  return null;
}
