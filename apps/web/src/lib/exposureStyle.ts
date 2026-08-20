/**
 * ภาษาภาพของชั้น "ระดับการเผชิญน้ำ (ภาพประกอบ)" (E10.4) — แหล่งเดียวของค่าสี
 * และของกฎที่แยก "วัดได้แล้วอยู่แถบต่ำสุด" ออกจาก "ไม่มีปัจจัยใดวัดได้เลย"
 *
 * ชั้นนี้ใช้ **ภาษาภาพชุดเดียวกับชั้นภาพประกอบอื่น** (`lib/illustrativeStyle.ts`):
 * ลายเส้นทแยง คาบเท่ากัน วางในปริภูมิจอภาพเหมือนกัน ต่างกันแค่สองอย่างที่ตั้งใจ
 * ให้แยกออกได้แม้ในภาพขาวดำ
 *   1. **ทแยงกลับด้าน** (shader ใช้ `x − y` แทน `x + y`) ซ้อนกับลายพื้นที่ลุ่มต่ำ
 *      แล้วอ่านเป็น "ลายตาราง" — ต่างจากลายทแยงเดี่ยวของพื้นที่ลุ่มต่ำ และต่างจาก
 *      พื้นทึบของน้ำท่วมที่ตรวจวัดจริง (GISTDA) ทั้งสามชั้นจึงแยกกันได้ด้วยเนื้อลาย
 *   2. **สีไล่ตามระดับ** ม่วง → บานเย็น ซึ่งไม่ใช่สีของน้ำ (ฟ้า/น้ำเงินของ GISTDA)
 *      และไม่ใช่สีของฮาโลค่าตรวจวัดจริง (ส้ม/แดง)
 *
 * ทั้ง shader (`scene/terrainMaterial.ts`) หมุดบนแผนที่ (`scene/ExposureMarkers.ts`)
 * และสัญลักษณ์ใน legend อ่านค่าจากไฟล์นี้ไฟล์เดียว ห้าม hard-code ซ้ำอีกฝั่ง
 *
 * ไฟล์นี้ **ห้าม import three** — เทสฝั่งเว็บรันใน `environment: "node"`
 */
import type { ExposureFactors, ExposureLevel, StationExposure } from "@siahra/shared-types";

/**
 * สิ่งที่เรนเดอร์จริง = ระดับสี่แถบ **บวกอีกหนึ่งสถานะที่สัญญาไม่มีคำเรียก**
 *
 * `ExposureLevel = "low"` กินความสองอย่างในคำเดียว (ดู `packages/shared-types`
 * และ `docs/methodology/flood-exposure.md` §ขั้นตอนการคำนวณ ข้อ 3):
 *   - สถานีที่ **วัดได้** แล้วค่าตกอยู่ในแถบต่ำสุด
 *   - สถานีที่ **ไม่มีปัจจัยใดวัดได้เลย** จึงไม่มีอะไรจะจัดแถบ แล้วได้ `"low"` ไปด้วย
 *
 * สถานีที่ไม่มีใครวัดไม่ใช่สถานีที่ปลอดภัย การระบายสีเดียวกับแถบต่ำสุดคือการทำให้
 * "ไม่มีข้อมูล" หายไปเงียบ ๆ ซึ่ง AGENTS.md ห้ามไว้ตรง ๆ — สองสถานะนี้จึงถูกแยก
 * ตอนเรนเดอร์ ไม่ใช่ด้วยการเพิ่มฟิลด์ลงในสัญญา (สัญญาถูกปิดไว้ตั้งแต่ E10.2)
 */
export type ExposureRenderClass = ExposureLevel | "no-data";

/**
 * ปัจจัยหนึ่งตัว "ใช้จัดแถบได้" หรือไม่ — กฎเดียวกับ `bandOfRising`/`bandOfFalling`
 * ใน `apps/api/src/exposure/compute.ts` ทุกตัวอักษร: `null` หรือค่าที่ไม่ใช่จำนวนจำกัด
 * → ไม่เกิดแถบ (ไม่ได้ถูกนับเป็นศูนย์)
 */
function usableNumber(value: number | null): boolean {
  return value !== null && Number.isFinite(value);
}

/**
 * มีปัจจัยอย่างน้อยหนึ่งตัวที่จัดแถบได้ไหม
 *
 * `situationLevel` เป็นรหัสแถบของ ThaiWater เอง ไม่ใช่ค่าวัดต่อเนื่อง จึงนับว่า
 * ใช้ได้เมื่อไม่ใช่ `null` (ฝั่ง api แม็ปผ่านตารางตรง ๆ ไม่ได้เทียบเกณฑ์ตัวเลข)
 */
export function hasUsableFactor(factors: ExposureFactors): boolean {
  return (
    usableNumber(factors.rain1hMm) ||
    usableNumber(factors.rain24hMm) ||
    usableNumber(factors.freeboardM) ||
    usableNumber(factors.freeboardTrendMPerH) ||
    factors.situationLevel !== null
  );
}

/**
 * สถานะที่ใช้เรนเดอร์จริงของสถานีหนึ่ง — อนุมานจาก `factors` ที่ run ส่งมาเท่านั้น
 * ไม่ได้เพิ่มฟิลด์ใดลงในสัญญา และไม่ได้ถามอะไรกลับไปที่ api
 */
export function exposureRenderClass(station: StationExposure): ExposureRenderClass {
  return hasUsableFactor(station.factors) ? station.level : "no-data";
}

/** นับสถานีแยกตามสถานะที่จะเรนเดอร์ — legend เอาไปบอกจำนวนตามความจริง */
export function countExposureClasses(
  stations: readonly StationExposure[],
): Record<ExposureRenderClass, number> {
  const out: Record<ExposureRenderClass, number> = {
    low: 0,
    elevated: 0,
    high: 0,
    severe: 0,
    "no-data": 0,
  };
  for (const s of stations) out[exposureRenderClass(s)] += 1;
  return out;
}

/** สีแบบ linear RGB 0–1 (ค่าเดียวกับที่ส่งเข้า GLSL) */
export const EXPOSURE_RGB: Record<ExposureRenderClass, readonly [number, number, number]> = {
  // แถบต่ำสุด "ที่วัดมาแล้ว" — ม่วงหม่น จงใจให้เงียบ ไม่ใช่สีเขียวที่อ่านว่า "ปลอดภัย"
  low: [0.52, 0.46, 0.7],
  elevated: [0.68, 0.4, 0.86],
  high: [0.85, 0.3, 0.78],
  severe: [1.0, 0.24, 0.6],
  /**
   * ไม่มีปัจจัยใดวัดได้ — เทาอมฟ้า ไร้สีโดยตั้งใจ เพราะไม่มีค่าอะไรให้ไล่ระดับ
   * และต้องไม่ถูกอ่านว่าเป็นแถบใดแถบหนึ่งของสเกลข้างบน
   */
  "no-data": [0.62, 0.66, 0.72],
};

/**
 * รหัสระดับที่เขียนลงแชนแนล G ของ texture (shader แปลงกลับเป็นสีด้วย ramp เดียวกัน)
 * — เว้นระยะเท่ากันเพื่อให้ `smoothstep` ระหว่างแถบใน GLSL ตรงกับที่นี่
 */
export const EXPOSURE_CODE: Record<ExposureLevel, number> = {
  low: 0.25,
  elevated: 0.5,
  high: 0.75,
  severe: 1,
};

/**
 * ระดับที่ "ระบายลงบนภูมิประเทศ" — เฉพาะแถบที่สูงกว่าต่ำสุด
 *
 * ชื่อของชั้นคือ "พื้นที่ลุ่มต่ำที่ *ขณะนี้* มีฝนหนัก/น้ำสูงในบริเวณใกล้เคียง" ถ้าแถบ
 * ต่ำสุดก็ระบายด้วย ทั้งจังหวัดจะติดสีตลอดเวลาและคำว่า "ขณะนี้" จะไม่มีความหมาย
 * สถานีแถบต่ำสุดยังถูกวาดเป็นหมุดเสมอ (ไม่ได้หายไป) — ดู `scene/ExposureMarkers.ts`
 */
export const EXPOSURE_DRAPED_LEVELS: readonly ExposureLevel[] = ["elevated", "high", "severe"];

/** ความแรงของฮาโลต่อแถบ (0–1) และรัศมีเป็นเมตร — ข้อตกลงการแสดงผล ไม่ใช่ขอบเขตที่คำนวณ */
export const EXPOSURE_HALO: Record<ExposureLevel, { strength: number; radiusM: number }> = {
  low: { strength: 0, radiusM: 0 },
  elevated: { strength: 0.55, radiusM: 5000 },
  high: { strength: 0.8, radiusM: 6000 },
  severe: { strength: 1, radiusM: 7000 },
};

const to255 = (v: number) => Math.round(v * 255);

/** แปลงเป็น CSS `rgb()` ให้ legend ใช้ค่าชุดเดียวกับ shader */
export function exposureCss(cls: ExposureRenderClass): string {
  const c = EXPOSURE_RGB[cls];
  return `rgb(${to255(c[0])}, ${to255(c[1])}, ${to255(c[2])})`;
}

/** เลขสีสำหรับ three.js (`new THREE.Color(hex)`) โดยไม่ต้อง import three ที่นี่ */
export function exposureHex(cls: ExposureRenderClass): number {
  const c = EXPOSURE_RGB[cls];
  return (to255(c[0]) << 16) | (to255(c[1]) << 8) | to255(c[2]);
}
