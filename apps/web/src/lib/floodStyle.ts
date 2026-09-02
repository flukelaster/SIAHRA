/**
 * ภาษาภาพของ "น้ำ" บนแผนที่ — แหล่งเดียวของค่าสีและสูตรไล่ระดับที่ shader
 * (`scene/terrainMaterial.ts`, `scene/FloodSurface.ts`) และ legend
 * (`components/layout/MapLegend.tsx`) อ่านร่วมกัน ห้าม hard-code ซ้ำอีกฝั่ง
 * ไม่งั้นสัญลักษณ์กับสิ่งที่วาดจริงจะเพี้ยนจากกันเงียบ ๆ (กฎเดียวกับ
 * `illustrativeStyle.ts` / `exposureStyle.ts` / `forecastStyle.ts`)
 *
 * สองแหล่ง "ตรวจวัดจริง" ที่ต้องดูไม่เหมือนกัน (E14.F4):
 *
 *   - **Copernicus GFM** (Sentinel-1, มีเวลาบันทึกภาพต่อฉาก) — พื้นทึบไล่ระดับ
 *     ตามความลึกภาพประกอบ (FwDET) ฟ้าอ่อน → น้ำเงินเข้ม + ขอบจางบาง ๆ + การไหล
 *     ช้า ๆ ส่วนเซลล์ที่ "ไม่ได้ประมาณความลึก" เป็นสีตื้น + ลายจุดในปริภูมิจอภาพ
 *     (คาบเดียวกับลายเส้นของชั้นภาพประกอบ) เพื่อไม่ให้อ่านเป็น 0 ม.
 *   - **GISTDA** (แปลภาพจากหน่วยงานไทย ไม่มีเวลาบันทึกภาพ) — พื้นโปร่งบางเฉด
 *     เทาอมฟ้า + **เส้นขอบ** คมราว 1.5 px ซึ่งเป็นสัญญาณหลัก
 *
 *   ทั้งคู่ *ไม่ใช่* ลายเส้นทแยง — ลายเส้นทแยง/ตาราง/แนวตั้งสงวนไว้ให้ชั้น
 *   "ภาพประกอบ" (พื้นที่ลุ่มต่ำ การเผชิญน้ำ แถบฝน) ตาม `illustrativeStyle.ts`
 *   ความลึก FwDET เป็นภาพประกอบก็จริง แต่ถูกวาดเป็น *ระดับสี* บนพื้นที่น้ำที่
 *   ดาวเทียมเห็นจริง ไม่ใช่พื้นที่ที่เราคำนวณขึ้นเอง — ป้าย "ภาพประกอบ" ใน legend
 *   และเอกสาร `docs/methodology/flood-depth.md` เป็นคนบอกชนิดของมัน
 *
 * ไฟล์นี้ **ห้าม import three** — เทสฝั่งเว็บรันใน `environment: "node"`
 */
import type { Lang } from "../i18n";
import { formatNumber } from "./number";

/** สีแบบ linear RGB 0–1 (ค่าเดียวกับที่ส่งเข้า GLSL) */
export const FLOOD_RGB = {
  /** น้ำตื้น (0 ม.) — ฟ้าอ่อน */
  shallow: [0.55, 0.82, 0.95] as const,
  /** น้ำลึก (≥ ราว 3 ม.) — น้ำเงินเข้ม */
  deep: [0.02, 0.1, 0.4] as const,
  /** สีเดียวแบบไม่ไล่ระดับ เมื่อชั้นความลึกถูกปิด = "พื้นที่ที่ดาวเทียมเห็นน้ำ" ล้วน ๆ */
  extent: [0.18, 0.5, 0.85] as const,
  /** ขอบจางรอบพื้นที่ท่วม (GFM) */
  rim: [0.88, 0.96, 1.0] as const,
};

/**
 * สีของน้ำท่วม GISTDA — ย้ายมาจาก `floodDeep`/`floodLight` ที่เคย hard-code ใน
 * terrainMaterial.ts เฉดเทาอมฟ้า (B > G เล็กน้อย) ต่างจากฟ้าอิ่ม/น้ำเงินของ GFM
 */
export const GISTDA_RGB = {
  deep: [0.1, 0.34, 0.5] as const,
  light: [0.3, 0.58, 0.72] as const,
  /** เส้นขอบ — สัญญาณหลักของชั้นนี้ตั้งแต่ F4 */
  rim: [0.85, 0.93, 0.98] as const,
};

/** ความลึกอ้างอิงของสูตรไล่ระดับ: ที่ 3 ม. สีถึง 90% ของทางไปสีน้ำลึก */
export const FLOOD_DEPTH_REF_M = 3;
export const FLOOD_DEPTH_REF_MIX = 0.9;

/**
 * ค่า k ของ `1 − exp(−k·depth)` (รูปแบบ Beer–Lambert: แสงถูกดูดกลืนตามความลึก)
 * เลือกให้ 3 ม. ≈ 0.9 — คำนวณจากสองค่าข้างบน ไม่ได้พิมพ์เลขตายตัว
 */
export const FLOOD_DEPTH_K = -Math.log(1 - FLOOD_DEPTH_REF_MIX) / FLOOD_DEPTH_REF_M;

/** สัดส่วนการผสม shallow → deep ที่ความลึก `depthM` (0 → 0, 3 ม. ≈ 0.9, ลู่เข้า 1) */
export function depthToMix(depthM: number): number {
  if (!(depthM > 0)) return 0;
  return 1 - Math.exp(-FLOOD_DEPTH_K * depthM);
}

/** จุดบน ramp ของ legend (เมตร) — จุดสุดท้ายอ่านว่า "≥ 3" */
export const FLOOD_DEPTH_LEGEND_STOPS_M: readonly number[] = [0, 0.5, 1, 2, 3];

/**
 * สัดส่วนรัศมีของจุดในลาย "ไม่ได้ประมาณความลึก" เทียบกับคาบลาย (`uHatchPx` /
 * `ILLUSTRATIVE_HATCH_PERIOD_PX`) — ใช้ค่าเดียวกันทั้งใน shader และ SVG ของ legend
 */
export const FLOOD_STIPPLE_DOT_FRAC = 0.28;

const to255 = (v: number) => Math.round(v * 255);

function css(c: readonly [number, number, number]): string {
  return `rgb(${to255(c[0])}, ${to255(c[1])}, ${to255(c[2])})`;
}

/** สี GFM เป็น CSS `rgb()` ให้ legend ใช้ค่าชุดเดียวกับ shader */
export function floodCss(which: keyof typeof FLOOD_RGB): string {
  return css(FLOOD_RGB[which]);
}

/** สี GISTDA เป็น CSS `rgb()` */
export function gistdaCss(which: keyof typeof GISTDA_RGB): string {
  return css(GISTDA_RGB[which]);
}

/** สีที่ความลึกหนึ่ง ๆ ตามสูตรเดียวกับ shader (`mix(shallow, deep, depthToMix)`) */
export function floodDepthCss(depthM: number): string {
  const m = depthToMix(depthM);
  const s = FLOOD_RGB.shallow;
  const d = FLOOD_RGB.deep;
  return css([s[0] + (d[0] - s[0]) * m, s[1] + (d[1] - s[1]) * m, s[2] + (d[2] - s[2]) * m]);
}

export interface FloodDepthLegendStop {
  depthM: number;
  /** 0–1 ตามสูตร `depthToMix` */
  mix: number;
  css: string;
  /** true = จุดสุดท้าย อ่านว่า "≥ N" ไม่ใช่ "N" */
  open: boolean;
}

/** ramp ของ legend คำนวณจาก `depthToMix` ตัวเดียวกับ shader — ไม่มีสีที่เลือกแยกไว้ */
export function floodDepthLegendRamp(): FloodDepthLegendStop[] {
  const last = FLOOD_DEPTH_LEGEND_STOPS_M.length - 1;
  return FLOOD_DEPTH_LEGEND_STOPS_M.map((depthM, i) => ({
    depthM,
    mix: depthToMix(depthM),
    css: floodDepthCss(depthM),
    open: i === last,
  }));
}

/** จุดบน ramp แสดงทศนิยมได้หนึ่งตำแหน่ง — ไม่งั้น 0.5 ม. ถูกปัดเป็น "1" ซ้ำกับจุด 1 ม. */
const FLOOD_DEPTH_LABEL_DIGITS = 1;

/** ป้ายใต้จุดบน ramp: "0", "0.5", "1", "2", "≥3" (คั่นหลักตามภาษาผ่าน `formatNumber`) */
export function floodDepthStopLabel(lang: Lang, stop: FloodDepthLegendStop): string {
  const n = formatNumber(lang, stop.depthM, FLOOD_DEPTH_LABEL_DIGITS);
  return stop.open ? `≥${n}` : n;
}

/**
 * ความลึกสูงสุดของฉากเป็นเมตร ทศนิยมหนึ่งตำแหน่ง (725 ซม. → "7.3", 850 → "8.5")
 * — ปัดที่ระดับเดซิเมตรก่อน แล้วค่อยจัดรูปแบบด้วยจำนวนหลักเท่ากับป้ายบน ramp
 */
export function floodDepthMaxLabel(lang: Lang, maxDepthCm: number): string {
  return formatNumber(lang, Math.round(maxDepthCm / 10) / 10, FLOOD_DEPTH_LABEL_DIGITS);
}
