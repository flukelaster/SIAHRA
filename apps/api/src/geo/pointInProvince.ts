import type { NearestProvince } from "@siahra/shared-types";

/**
 * ชุดวงขอบเขตของจังหวัดหนึ่ง ตามรูปแบบของ `apps/api/src/data/provinceRings.json`
 * ที่ `apps/etl/src/provinceBoundaries.ts` เขียนออกมา (ดู `ProvinceRingSet` ฝั่งนั้น)
 */
export interface ProvinceRingSet {
  code: string;
  nameTh: string;
  nameEn: string;
  /**
   * [minLon, minLat, maxLon, maxLat] — **ไม่ได้ใช้คัดกรองจังหวัดออกก่อนคิดระยะ**
   * (ดูหมายเหตุที่ `nearestProvinces`) เก็บไว้เป็นเมทาดาทาของวงเท่านั้น
   */
  bbox: [number, number, number, number];
  /** ทุกวงปิดของจังหวัด (วงนอก วงใน และเกาะ) เรียงแบนเป็น [lon,lat,lon,lat,...] */
  rings: number[][];
}

/** π·R/180 ที่ R = 6371 กม. — ความยาวหนึ่งองศาละติจูดโดยเฉลี่ย */
const KM_PER_DEG_LAT = 111.19492664455873;

/**
 * จุดอยู่ใน "ชุดวง" หรือไม่ — นับจำนวนครั้งที่รังสีแนวนอนตัดขอบ (even–odd rule)
 * บนวงทุกวงรวมกัน กติกานี้จัดการ **รูเกาะ** (วงในของ MultiPolygon) ให้ถูกต้อง
 * ในตัวมันเอง: จุดในรูจะตัดขอบเป็นจำนวนคู่ จึงถือว่าอยู่นอกจังหวัด
 */
export function pointInRings(lon: number, lat: number, rings: number[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length / 2;
    if (n < 3) continue;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i * 2];
      const yi = ring[i * 2 + 1];
      const xj = ring[j * 2];
      const yj = ring[j * 2 + 1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** ระยะจากจุดถึงส่วนของเส้นตรง บนระนาบท้องถิ่นที่หน่วยเป็นกิโลเมตรแล้ว */
function pointToSegmentKm(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return Math.hypot(ex, ey);
}

/**
 * ระยะที่สั้นที่สุดจากจุดถึง **ขอบ** ของชุดวง (กม.) — ไม่สนว่าอยู่ในหรือนอก
 *
 * ฉายพิกัดลงระนาบ equirectangular ที่ตรึงสเกลด้วย cos(ละติจูดของจุดที่ถาม):
 * ในระยะไม่กี่ร้อยกิโลเมตรของประเทศไทย ความคลาดเคลื่อนอยู่ระดับต่ำกว่า 1%
 * ซึ่งเล็กกว่าความหยาบของวงที่ย่อมาแล้ว (~330 ม.) — และเป็นสเกลเดียวกันสำหรับ
 * ทุกจังหวัดในการเรียกครั้งหนึ่ง การจัดอันดับจึงเทียบกันได้ตรง ๆ
 */
export function distanceToRingsKm(lon: number, lat: number, rings: number[][]): number {
  const kx = KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const ky = KM_PER_DEG_LAT;
  const px = lon * kx;
  const py = lat * ky;
  let best = Infinity;
  for (const ring of rings) {
    const n = ring.length / 2;
    if (n < 2) continue;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const d = pointToSegmentKm(
        px,
        py,
        ring[j * 2] * kx,
        ring[j * 2 + 1] * ky,
        ring[i * 2] * kx,
        ring[i * 2 + 1] * ky,
      );
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * ระยะจากจุดถึง **รูปหลายเหลี่ยม** ของจังหวัด — 0 เมื่อจุดอยู่ในเขต
 * (ไม่ใช่ระยะถึงจุดศูนย์กลางจังหวัด ดูหมายเหตุที่ `nearestProvinces`)
 */
export function provinceDistanceKm(
  lon: number,
  lat: number,
  province: ProvinceRingSet,
): { distanceKm: number; inside: boolean } {
  if (pointInRings(lon, lat, province.rings)) return { distanceKm: 0, inside: true };
  return { distanceKm: distanceToRingsKm(lon, lat, province.rings), inside: false };
}

/** ปัดเป็นทศนิยมหนึ่งตำแหน่ง (100 ม.) — ละเอียดกว่าที่วงที่ย่อแล้วรับประกันได้อยู่แล้ว */
function round1(km: number): number {
  return Math.round(km * 10) / 10;
}

/**
 * จังหวัดที่ใกล้ที่สุด `limit` อันดับ เรียงตามระยะถึงขอบเขตจังหวัด
 *
 * **คิดครบทุกจังหวัดที่ส่งเข้ามา ไม่มีขั้นคัดกรองก่อน** — การคัดด้วยระยะถึง
 * จุดศูนย์กลาง (centroid) ไม่ใช่ขอบล่างที่ปลอดภัย: จังหวัดที่ยาวเรียวมีศูนย์กลาง
 * ห่างจากจุดที่ถามได้เป็นร้อยกิโลเมตรทั้งที่ขอบเขตของมันพาดผ่านใกล้ ๆ จังหวัดนั้น
 * จึงถูกตัดทิ้งก่อนถึงขั้นคิดรูปหลายเหลี่ยม และคำตอบที่ถูกต้องก็หายไปทั้งอันดับ
 * (เทสใน `test/pointInProvince.test.ts` ยึดพฤติกรรมนี้ไว้)
 *
 * ต้นทุนคือการทดสอบจุด-ต่อ-ส่วนของเส้นระดับหลักหมื่นครั้งต่อหนึ่งเหตุการณ์ใหม่
 * — หลักไมโครวินาที และคิดครั้งเดียวตอน ingest แล้วเก็บลงระเบียน
 */
export function nearestProvinces(
  lon: number,
  lat: number,
  provinces: readonly ProvinceRingSet[],
  limit = 3,
): NearestProvince[] {
  const scored: NearestProvince[] = provinces.map((p) => {
    const { distanceKm, inside } = provinceDistanceKm(lon, lat, p);
    return {
      provinceCode: p.code,
      nameTh: p.nameTh,
      nameEn: p.nameEn,
      distanceKm: inside ? 0 : round1(distanceKm),
      inside,
    };
  });
  // ระยะเท่ากันให้เรียงตามรหัสจังหวัด ผลลัพธ์จะได้ไม่ขึ้นกับลำดับใน artefact
  scored.sort((a, b) =>
    a.distanceKm === b.distanceKm
      ? a.provinceCode.localeCompare(b.provinceCode)
      : a.distanceKm - b.distanceKm,
  );
  return scored.slice(0, limit);
}
