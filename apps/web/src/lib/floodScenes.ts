import type { FloodSceneIndex, FloodSceneIndexEntry } from "@siahra/shared-types";

/**
 * ส่วนที่ "คิด" ของ `hooks/useFloodScenes.ts` / `hooks/useFloodScene.ts` (E14.F4)
 * — ไม่มี React ไม่มี fetch จึงเทสได้ตรง ๆ ใน `environment: "node"`
 */

/**
 * หน้าต่างย้อนหลังที่ยอมให้ฉากหนึ่ง "แทน" เวลาที่เลือกได้: 14 วัน
 *
 * Sentinel-1 บินซ้ำจุดเดิมทุก 6–12 วัน (สองดาวเทียมสลับวงโคจร; ตั้งแต่ S1B หยุด
 * ทำงานปลายปี 2021 หลายพื้นที่เหลือ 12 วันจนกว่า S1C จะครบ) — ถ้าไม่มีภาพเลยใน
 * 14 วันก่อนเวลาที่เลือก แปลว่า "ไม่มีภาพ" ไม่ใช่ "ภาพเก่าที่ยังใช้ได้" และแผนที่
 * ต้องบอกอย่างนั้น ไม่ใช่วาดฉากอายุสองเดือนราวกับเป็นสภาพ ณ วันนั้น
 */
export const FLOOD_SCENE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type FloodSceneReason = "no-scene-in-window";

export interface FloodScenePick {
  /** ฉากที่จะวาด — ใหม่สุดที่ `observedAt ≤ at` และไม่เก่ากว่าหน้าต่าง */
  scene: FloodSceneIndexEntry | null;
  /** ฉากใหม่สุดก่อน `at` โดยไม่สนหน้าต่าง — ให้ legend บอกว่า "ภาพล่าสุดก่อนหน้านั้นคือเมื่อไหร่" */
  latestBefore: FloodSceneIndexEntry | null;
  reason: FloodSceneReason | null;
}

const EMPTY: FloodScenePick = { scene: null, latestBefore: null, reason: null };

/**
 * เลือกฉากสำหรับเวลา `atMs` — ดัชนีเรียงใหม่สุดก่อนตามสัญญา แต่ไม่พึ่งลำดับนั้น
 * (หา max ของ observedAt ที่ ≤ at เอง) เผื่อดัชนีที่เขียนด้วยมือ
 */
export function pickFloodScene(index: FloodSceneIndex | null, atMs: number): FloodScenePick {
  if (!index || index.scenes.length === 0) return EMPTY;
  let latestBefore: FloodSceneIndexEntry | null = null;
  let latestMs = -Infinity;
  for (const s of index.scenes) {
    const t = Date.parse(s.observedAt);
    if (!Number.isFinite(t) || t > atMs) continue;
    if (t > latestMs) {
      latestMs = t;
      latestBefore = s;
    }
  }
  if (!latestBefore) return { scene: null, latestBefore: null, reason: "no-scene-in-window" };
  if (atMs - latestMs > FLOOD_SCENE_MAX_AGE_MS) {
    return { scene: null, latestBefore, reason: "no-scene-in-window" };
  }
  return { scene: latestBefore, latestBefore, reason: null };
}

/**
 * ดัชนีนี้เป็นของจังหวัดที่กำลังดูอยู่จริงไหม — ไม่งั้น `null`
 *
 * `useFloodScenes` รีเซ็ตดัชนีใน effect ซึ่งวิ่ง *หลัง* เรนเดอร์ ตอนสลับจังหวัด
 * 57 → 50 จึงมีหนึ่งเฟรมที่ `provinceCode = "50"` แต่ดัชนียังเป็นของ 57 ถ้าเลือก
 * ฉากจากดัชนีนั้นต่อ hook จะยิง `/aoi/50/flood/<sceneId ของ 57>/field.bin`
 * (404 ที่ prod) — ที่นี่คือประตูเดียวที่กันเรื่องนั้น: ดัชนีของจังหวัดอื่นเท่ากับ
 * ไม่มีดัชนี
 */
export function indexForProvince(index: FloodSceneIndex | null, provinceCode: string | null): FloodSceneIndex | null {
  if (!index || !provinceCode || index.provinceCode !== provinceCode) return null;
  return index;
}

export interface FloodFieldRequest {
  /** `{code}/{sceneId}` — คีย์ของแคชฟิลด์ที่ถอดแล้ว (ฉากหนึ่งไม่มีวันเปลี่ยนไบต์) */
  cacheKey: string;
  url: string;
}

/** คำขอ `field.bin` ของฉากที่เลือก — `null` = ไม่มีอะไรให้ยิง (ไม่มีจังหวัด/ไม่มีฉาก) */
export function floodFieldRequest(
  provinceCode: string | null,
  scene: FloodSceneIndexEntry | null,
): FloodFieldRequest | null {
  if (!provinceCode || !scene) return null;
  return {
    cacheKey: `${provinceCode}/${scene.sceneId}`,
    url: `/aoi/${provinceCode}/flood/${scene.sceneId}/field.bin`,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * ตรวจรูปร่างของ `index.json` ขั้นต่ำก่อนเชื่อ — จังหวัด/กริด/descriptor สองชั้น/
 * รายการฉาก ถ้าไม่ครบถือว่าเป็นไฟล์ที่อ่านไม่ได้ (error) ไม่ใช่ดัชนีว่าง
 */
export function isFloodSceneIndex(v: unknown): v is FloodSceneIndex {
  if (!isRecord(v)) return false;
  if (typeof v.provinceCode !== "string") return false;
  if (!isRecord(v.grid) || !isNum(v.grid.width) || !isNum(v.grid.height)) return false;
  if (!isRecord(v.layers) || !isRecord(v.layers.extent) || !isRecord(v.layers.depth)) return false;
  if (typeof v.layers.extent.epistemicClass !== "string" || typeof v.layers.depth.epistemicClass !== "string") {
    return false;
  }
  if (!Array.isArray(v.scenes)) return false;
  return v.scenes.every(
    (s) => isRecord(s) && typeof s.sceneId === "string" && typeof s.observedAt === "string",
  );
}
