/**
 * ค่าเริ่มต้นของชั้นข้อมูลทุกชั้น — แหล่งเดียวของความจริง (ย้ายออกมาจาก `App.tsx` ใน redesign PR 3
 * ค่าและคำอธิบายเดิมทุกตัว) เพื่อให้ `lib/layerGroups.ts` อ่านชุดของหัวข้อภาพรวมจากค่านี้โดยตรง
 * แทนที่จะคัดลอก — `App.tsx` ใช้เป็นสถานะเริ่มต้น และเป็น `defaultLayers` ของ permalink codec
 * (`?layers=` ถูกเขียนเฉพาะเมื่อต่างจากค่านี้ — ความหมายเดิมของ `lib/permalink.ts` ทุกประการ)
 *
 * เจ้าของตัดสินใจ 2026-09-27: ค่านี้คงเดิม (เปิด 18 จาก 20 ชั้น) — ลิงก์เก่าทุกลิงก์ต้องเปิดได้เหมือนเดิม
 *
 * ไฟล์นี้อยู่บนเส้นทางของ entry: เก็บเฉพาะค่าเริ่มต้น + สถานะตอนเปิดหน้า กฎของชุดหัวข้ออยู่ใน
 * `lib/layerGroups.ts` (lazy)
 */
import type { MapLayers } from "../components/layout/Map3DCanvas";

export const DEFAULT_LAYERS: MapLayers = {
  imagery: true,
  lowland: true,
  /**
   * E10.4 — ชั้นเดียวที่ **ปิดไว้เป็นค่าเริ่มต้น** ชั้นนี้เป็นสิ่งที่เราคำนวณเอง
   * ไม่ใช่สิ่งที่ใครวัดมา จึงต้องเป็นการกดเปิดของผู้ใช้เสมอ ไม่ใช่ของแถมที่ติดมา
   * (ผลข้างเคียงที่ตั้งใจ: `?layers=` จะปรากฏใน permalink เสมอ เพราะมีชั้นที่ปิดอยู่
   *  หนึ่งชั้น — ซึ่งเป็นความหมายเดิมของพารามิเตอร์นั้นทุกประการ)
   */
  exposure: false,
  hazard: true,
  stations: true,
  buildings: true,
  roads: true,
  water: true,
  floodExtent: true,
  // E14.F4 — ฉาก Sentinel-1 (Copernicus GFM) เป็นของที่ดาวเทียมเห็น เปิดได้เหมือน
  // GISTDA; ความลึก FwDET เปิดตามเพราะเป็น *การแสดงผล* ของฉากนั้น (ป้าย "ภาพประกอบ"
  // ใน legend บอกชนิด) และมีผลเฉพาะเมื่อ floodGfm เปิดอยู่
  floodGfm: true,
  floodDepth: true,
  dams: true,
  /**
   * E15/E15.3 — กล้อง CCTV ทุกแหล่ง (`ENABLED_CAMERA_SOURCES`) **ปิดเป็นค่าเริ่มต้น** (เจ้าของตัดสินใจ
   * 2026-09-26): หมุดและบัญชีกล้อง (`/cctv/{sourceId}.json`) ถูกโหลดก็ต่อเมื่อผู้ใช้เปิดชั้นนี้เอง
   * (`useCameraCatalogues` ได้ `enabled` = มีแหล่งเปิด + `layers.cctv`) — ปิดอยู่ = ไม่มี request ใดใต้
   * `/cctv/` เลย; ภาพ/สตรีมจากต้นทางยังขอก็ต่อเมื่อคลิกหมุดเท่านั้น
   * แฟล็ก `VITE_FEATURE_CCTV=0` (ทั้งชั้น) / `VITE_FEATURE_CCTV_DISABLE=<id,...>` (รายแหล่ง) ตอน build =
   * ถอดออกทั้งหมด แม้ permalink จะตั้ง `cctv` ไว้
   */
  cctv: false,
  radar: true,
  sunlight: true,
  trees: true,
  // ครอบคลุมไม่ครบทุกจังหวัด/อปท. (E11.2) แต่เป็นของจริงที่ OSM แม็ปไว้ ไม่ใช่ข้อมูล
  // เสื่อมคุณภาพที่ต้องซ่อนไว้ก่อน — เปิดเป็นค่าเริ่มต้นได้ ตราบใดที่ legend บอก
  // caveat ความไม่ครบทุกครั้งที่ชั้นนี้แสดงอยู่ (ดู MapLegend.tsx)
  localAuthorities: true,
  // E16 B-1 — "ล้นตลิ่งตอนนี้" ใน 3 มิติ: GISTDA ไม่ได้ข้อมูลตั้งแต่ 2026-09-10 และ Sentinel-1 ผ่าน
  // ทุก 6–12 วัน ระดับน้ำเทียบตลิ่งจึงเป็นสัญญาณที่สดที่สุดที่มี — แผ่นน้ำจำลอง (illustrative) เปิด
  // เป็นค่าเริ่มต้นได้ตราบใดที่ legend บอก caveat ทุกครั้งที่แสดง (แบบเดียวกับ localAuthorities)
  stationSheet: true,
  // E16 B-2 — แผ่นน้ำ 3 มิติบนขอบเขต GISTDA: ขอบเขตเป็นของที่ดาวเทียมเห็น ความลึกเป็นภาพประกอบ
  // (legend บอกชนิด + ข้อสมมติทุกครั้ง) มีผลเฉพาะเมื่อ floodExtent เปิดอยู่ — แบบเดียวกับ floodDepth
  gistdaDepth: true,
  northRoute: true,
};

/**
 * สถานะชั้นข้อมูล + "เดินตามหัวข้อไหม"
 *
 * `following` อยู่ในหน่วยความจำเท่านั้น — ไม่อยู่ใน permalink และไม่อยู่ใน localStorage: ลิงก์พก
 * เฉพาะ `?layers=` (ความหมายเดิม) และหน้าที่เปิดใหม่เริ่มจากกฎของ `initialLayerState` เสมอ
 */
export interface LayerPresetState {
  layers: MapLayers;
  following: boolean;
}

/**
 * สถานะตอนเปิดหน้า — **ไม่ใช้ชุดของหัวข้อตอนเริ่ม** (หัวข้อที่จำไว้ใน `siahra.shell` ไม่เปลี่ยนชั้น):
 *   - ไม่มี `?layers=` → `DEFAULT_LAYERS` และเดินตามหัวข้อ
 *   - มี `?layers=`    → ชั้นตามลิงก์ทุกตัว (คีย์ที่ไม่อยู่ในลิงก์ = ปิด — กฎเดิมของ App.tsx) และถือว่า
 *     ปรับเองแล้ว: ลิงก์ที่แชร์มาต้องไม่ถูกหัวข้อเปลี่ยนทับ
 */
export function initialLayerState(permalinkLayers: readonly string[] | null): LayerPresetState {
  if (!permalinkLayers) return { layers: DEFAULT_LAYERS, following: true };
  const on = new Set(permalinkLayers);
  // ลำดับคีย์ของ DEFAULT_LAYERS (เหมือนเดิม) — `serialisePermalink` เขียน `?layers=` ตามลำดับนี้
  const layers = Object.fromEntries(Object.keys(DEFAULT_LAYERS).map((k) => [k, on.has(k)])) as unknown as MapLayers;
  return { layers, following: false };
}
