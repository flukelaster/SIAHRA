/**
 * เรขาคณิตและท่าทางของกรอบแผงด้านขวา (`components/map/RightSheet.tsx`) — ใช้ร่วมกันโดยแผงกล้อง
 * (`CameraSheet`) และแผงรายงานจากประชาชน (`ReportSheet`) มีแผงด้านขวาได้ทีละหนึ่งเท่านั้น
 * (Map3DCanvas ล้างอีกฝั่งเมื่อเปิดฝั่งหนึ่ง) — pure module ไม่มี React/DOM ให้เทสตรง ๆ
 */
import { GUTTER, TOOLS_W, type ShellSafeArea, type Tier } from "./shellLayout";

/* ------------------------------------------------------------------ */
/* ปัดขวาเพื่อปิด                                                        */
/* ------------------------------------------------------------------ */

/** ปัดไปทางขวาเกินนี้ (px) = ปิด */
export const SWIPE_CLOSE_PX = 80;
/** หรือสะบัดเร็วกว่านี้ (px/ms) ไปทางขวา — ต้องขยับอย่างน้อย `SWIPE_FLING_MIN_PX` ด้วย */
export const SWIPE_CLOSE_PX_PER_MS = 0.5;
export const SWIPE_FLING_MIN_PX = 24;

/**
 * ปล่อยนิ้วแล้ว: ปิดแผงหรือเด้งกลับ
 *
 * @param dx     ระยะแนวนอนรวม (บวก = ไปทางขวา)
 * @param dy     ระยะแนวตั้งรวม — แนวตั้งเด่นกว่า = ผู้ใช้กำลังเลื่อนเนื้อหา ไม่ใช่ปัด
 * @param velocity px/ms แนวนอนช่วงท้าย (บวก = ไปทางขวา)
 */
export function swipeShouldClose(dx: number, dy: number, velocity: number): boolean {
  if (dx <= 0 || Math.abs(dy) > dx) return false;
  if (dx >= SWIPE_CLOSE_PX) return true;
  return velocity >= SWIPE_CLOSE_PX_PER_MS && dx >= SWIPE_FLING_MIN_PX;
}

/* ------------------------------------------------------------------ */
/* ตำแหน่งแผง                                                           */
/* ------------------------------------------------------------------ */

export const RIGHT_SHEET_W = 400;
/** แคบกว่านี้ภาพ 16:9 เล็กเกินจะดู — ยอมทับ drawer ด้านซ้ายบางส่วนบน tablet แทน */
export const RIGHT_SHEET_MIN_W = 320;

export interface RightSheetBox {
  top: number;
  right: number;
  bottom: number;
  left: number | null;
  width: number | null;
}

/**
 * กล่องของแผงด้านขวา — แผงกล้องและแผงรายงานจากประชาชน (CSS px เทียบกับ viewport ของแผนที่)
 *
 *   phone  : เต็มจอ (0,0,0,0) — ทับ TopBar และแผ่นเลื่อน แผงมีหัวข้อ + ปุ่มปิดของตัวเอง
 *   ≥tablet: top = safeArea.top (ใต้ TopBar), bottom = GUTTER + dock + 8 (แนวเดียวกับก้อน
 *            rail+drawer ใน AppShell), right = GUTTER + TOOLS_W + GUTTER — อยู่ **ซ้าย**
 *            ของคอลัมน์เข็มทิศ/ซูม ปุ่มเหล่านั้นจึงยังกดได้ระหว่างเปิดแผง
 *            width = RIGHT_SHEET_W หดตามจอ แต่ไม่ต่ำกว่า RIGHT_SHEET_MIN_W
 */
export function rightSheetBox(
  tier: Tier,
  safeArea: ShellSafeArea,
  viewportW: number,
): RightSheetBox {
  if (tier === "phone") return { top: 0, right: 0, bottom: 0, left: 0, width: null };
  const right = GUTTER + TOOLS_W + GUTTER;
  // safeArea.bottom = GUTTER + dock (computeSafeArea) — +8 เหมือนก้อน rail/drawer ของ AppShell
  const bottom = safeArea.bottom + 8;
  const room = viewportW - right - safeArea.left;
  const width = Math.max(RIGHT_SHEET_MIN_W, Math.min(RIGHT_SHEET_W, room));
  return { top: safeArea.top, right, bottom, left: null, width: Math.min(width, viewportW - right - GUTTER) };
}
