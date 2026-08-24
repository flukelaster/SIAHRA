/**
 * ภาษาภาพของ "แถบฝนพยากรณ์รายวัน (TMD)" บนแผนที่ 3 มิติ (E12.4b) — แหล่งเดียวของ
 * ค่าสีที่ทั้ง shader (`scene/terrainMaterial.ts`) และ legend
 * (`components/layout/MapLegend.tsx`) อ่านร่วมกัน ห้าม hard-code ซ้ำอีกฝั่ง
 *
 * ต่างจากทั้งสองชั้นภาพประกอบที่มีอยู่แล้วโดยตั้งใจ ทั้งสีและลาย เพราะทั้งสามชั้น
 * ต้องแยกกันได้แม้ในภาพขาวดำ (greyscale) ไม่ใช่แค่ต่างเฉด:
 *   - **สี**: ฟ้าอมเขียว (teal/seafoam) — ไม่ใช่ม่วง→บานเย็นของชั้นการเผชิญน้ำ
 *     (E10.4, `exposureStyle.ts`), ไม่ใช่ฟ้า/น้ำเงินของน้ำท่วมที่ตรวจวัดจริง
 *     (GISTDA) และไม่ใช่ส้ม/แดงของฮาโลค่าตรวจวัดจริง จุดสีทั้งสามของ ramp นี้ถือ
 *     ช่อง G (เขียว) ไว้สูงกว่า B เสมอ (ตรงข้ามกับ GISTDA ที่ B > G) และมี luma
 *     ตามสูตร Rec.601 (0.299R + 0.587G + 0.114B — สูตรเดียวกับที่ปุ่ม greyscale
 *     ใน CSS/GLSL ใช้แปลงภาพเป็นขาวดำ) อยู่ที่ ~0.58–0.80 ซึ่งอยู่นอกแถบ ~0.50–0.54
 *     ที่ ramp ม่วง→บานเย็นของ `EXPOSURE_RGB` ใช้อยู่ (คำนวณแล้วเทียบกันจริง ไม่ใช่
 *     แค่ "ดูต่างสี" — สองชั้นนี้เป็นลายเส้นซ้อน terrain เหมือนกันทั้งคู่)
 *   - **ลาย**: เส้นแนวตั้งล้วน (`gl_FragCoord.x` อย่างเดียวใน terrainMaterial.ts)
 *     ต่างจากทแยง 45° ของพื้นที่ลุ่มต่ำ (x+y) และทแยงกลับด้าน/ลายตารางของชั้น
 *     การเผชิญน้ำ (x−y) — สามชั้นจึงแยกกันได้ทั้งด้วยสีและด้วยเนื้อลาย
 *
 * เกณฑ์ 90/35/10 มม./24 ชม. มาจาก `TMD_RAIN_24H_BANDS`/`bandRain24h` ใน
 * `@siahra/shared-types` (อ้างอิงเดียวกับที่ `apps/api/src/exposure/compute.ts`
 * ใช้กับปัจจัย `rain24hMm` ของสถานี) — ไฟล์นี้ไม่ประกาศตัวเลขเกณฑ์ซ้ำอีกชุด
 *
 * ไฟล์นี้ **ห้าม import three** — เทสฝั่งเว็บรันใน `environment: "node"`
 */
import { bandRain24h, type ExposureLevel, type ForecastStep } from "@siahra/shared-types";
import { bangkokDateKey } from "./time";

/** ระดับที่ "ระบายลงบนภูมิประเทศ" ได้ — ตัดแถบต่ำสุด (`"low"`) ออกเสมอ เหมือนกับ
 *  `EXPOSURE_DRAPED_LEVELS` ของชั้นการเผชิญน้ำ: ชั้นนี้ทั้งชั้นเป็น "สัญญาณเตือน"
 *  แถบต่ำสุดจึงไม่มีอะไรให้เน้น ไม่ใช่การซ่อนข้อมูล (แถบต่ำสุดยังถูกพูดถึงใน legend
 *  แยกเป็นข้อความของตัวเอง ดู `ForecastBandStatus["kind"] === "low"` ด้านล่าง) */
export type ForecastBandLevel = Exclude<ExposureLevel, "low">;

/** สีแบบ linear RGB 0–1 (ค่าเดียวกับที่ส่งเข้า GLSL) */
export const FORECAST_RGB: Record<ForecastBandLevel, readonly [number, number, number]> = {
  elevated: [0.55, 0.92, 0.8],
  high: [0.15, 0.85, 0.7],
  severe: [0.0, 0.85, 0.72],
};

const to255 = (v: number) => Math.round(v * 255);

/** แปลงเป็น CSS `rgb()` ให้ legend ใช้ค่าชุดเดียวกับ shader */
export function forecastCss(level: ForecastBandLevel): string {
  const c = FORECAST_RGB[level];
  return `rgb(${to255(c[0])}, ${to255(c[1])}, ${to255(c[2])})`;
}

/**
 * ผลของการหา "แถบฝนพยากรณ์วันนี้" หนึ่งครั้ง — สามสถานะที่ต้องไม่ถูกพับเป็นข้อความ
 * เดียวกัน (AGENTS.md: "ไม่มีอะไรใหม่" กับ "แหล่งข้อมูลบอกว่าสงบ" เป็นข้อความคนละ
 * ประโยคเสมอ):
 *   - `"no-value"` — เราไม่รู้ ไม่ว่าจะเพราะ TMD ไม่ได้ส่งขั้นของวันนี้มาเลย หรือ
 *     ส่งมาแต่ `rainMm` เป็น `null` — ทั้งสองกรณีคือ "ไม่มีค่าให้อ่าน" เหมือนกัน
 *   - `"low"` — TMD **ส่งค่ามาจริง** และค่านั้นต่ำกว่าเกณฑ์ที่ต้องเน้น (`elevated`)
 *     เป็นข้อเท็จจริงที่แบบจำลองยืนยัน ไม่ใช่ความเงียบ
 *   - `"band"` — ค่าที่ส่งมาถึงหรือเกินเกณฑ์ใดเกณฑ์หนึ่ง พร้อม `step` ต้นทาง
 *     (ให้ผู้เรียกอ่าน `rainMm`/`validAt` ดิบได้โดยไม่ต้องหาซ้ำ)
 */
export type ForecastBandStatus =
  | { kind: "no-value" }
  | { kind: "low" }
  | { kind: "band"; level: ForecastBandLevel; step: ForecastStep };

/**
 * หาขั้นรายวันของ `daily` ที่ตรงกับวันปฏิทินกรุงเทพฯ เดียวกับ `targetIso` — เทียบ
 * ด้วย `bangkokDateKey` เท่านั้น (ห้ามตัดสตริง ISO ตรง ๆ ดูเหตุผลที่ `lib/time.ts`)
 */
export function matchDailyStep(
  daily: readonly ForecastStep[],
  targetIso: string,
): ForecastStep | null {
  const targetKey = bangkokDateKey(targetIso);
  if (targetKey === null) return null;
  return daily.find((s) => bangkokDateKey(s.validAt) === targetKey) ?? null;
}

/**
 * รวมสามขั้นเป็นครั้งเดียว: จับคู่วันปฏิทินกรุงเทพฯ → อ่าน `rainMm` → จัดแถบด้วย
 * `bandRain24h` — จุดคำนวณเดียวที่ `App.tsx` เรียก (คำนวณครั้งเดียว ไม่ใช่ทั้งใน
 * `Map3DCanvas` และ `MapLegend` แยกกัน ไม่งั้นสองจุดอาจตัดสินไม่ตรงกันได้)
 *
 * `daily === null` (ยังไม่เคยดึง batch สำเร็จเลย) ถือเป็น `"no-value"` เหมือนกับ
 * "มี batch แต่ไม่มีขั้นของวันนี้" — ทั้งสองคือ "ไม่มีค่าให้อ่าน" จากมุมของชั้นนี้
 */
export function computeForecastBandStatus(
  daily: readonly ForecastStep[] | null,
  atIso: string,
): ForecastBandStatus {
  const step = daily ? matchDailyStep(daily, atIso) : null;
  if (step === null || step.rainMm === null) return { kind: "no-value" };
  const level = bandRain24h(step.rainMm);
  if (level === null) return { kind: "no-value" };
  if (level === "low") return { kind: "low" };
  return { kind: "band", level, step };
}
