import { provinceDistanceKm, type ProvinceRingSet } from "./pointInProvince.js";
import { PROVINCE_RINGS } from "./provinceRings.js";

/** จุดหนึ่งของพายุที่ใช้คิดระยะ — `radiusKm` คือวงกลม 70 % ของ JMA (null = ไม่มีวง) */
export interface StormPoint {
  lat: number;
  lon: number;
  radiusKm: number | null;
}

/**
 * ระยะ (กม. ปัดเป็นจำนวนเต็ม) จากขอบเขตของทุกจังหวัดถึงจุดที่ใกล้ที่สุดของพายุ —
 * ถ้าจุดนั้นมีวงกลม 70 % ของ JMA ระยะคือถึง **ขอบวง** (`max(0, d − r)`)
 *
 * เรขาคณิตล้วน ไม่ใช่ความน่าจะเป็น: StormTrackDO เรียก **ครั้งเดียวต่อพายุต่อรอบ refresh**
 * ไม่ใช่ต่อคำขอ วงขอบเขต 77 จังหวัด (`PROVINCE_RINGS`) ถูก parse ครั้งเดียวที่ระดับ
 * โมดูลใน `provinceRings.ts`
 *
 * ใช้ `provinceDistanceKm` ตัวเดียวกับ `nearest` ของแผ่นดินไหว (คิดครบทุกจังหวัด
 * ไม่มีขั้นคัดกรองก่อน — เหตุผลอยู่ที่ `nearestProvinces`) การฉายแบบ equirectangular
 * ของมันคลาดมากขึ้นเมื่อพายุอยู่ไกลหลายพันกิโลเมตร แต่ระยะระดับนั้นไม่มีผลกับคำถามที่
 * ตัวเลขนี้ตอบ ("พายุเข้ามาใกล้จังหวัดนี้แค่ไหน")
 */
export function nearestKmByProvince(
  points: readonly StormPoint[],
  provinces: readonly ProvinceRingSet[] = PROVINCE_RINGS,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (points.length === 0) return out;
  for (const p of provinces) {
    let best = Infinity;
    for (const pt of points) {
      const { distanceKm } = provinceDistanceKm(pt.lon, pt.lat, p);
      const d = pt.radiusKm !== null ? Math.max(0, distanceKm - pt.radiusKm) : distanceKm;
      if (d < best) best = d;
    }
    if (Number.isFinite(best)) out[p.code] = Math.round(best);
  }
  return out;
}
