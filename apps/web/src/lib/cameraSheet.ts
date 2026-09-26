/**
 * เรขาคณิตและท่าทางของแผงกล้องด้านขวา (`components/map/CameraSheet.tsx`) + การแยก
 * "คลิก" ออกจาก "ลาก" บนแผนที่ (`Map3DCanvas`) — pure module ไม่มี React/DOM ให้เทสตรง ๆ
 */
import type { CctvCamera, ItiCCamera } from "@siahra/shared-types";
import type { Lang, TFunction } from "../i18n";
import { GUTTER, TOOLS_W, type ShellSafeArea, type Tier } from "./shellLayout";

/**
 * กล้องที่แผงด้านขวากำลังแสดง — มาจากการคลิกหมุดกล้อง (`distanceKm` null) หรือปุ่ม
 * "กล้องใกล้เคียง" ใน popup ของสถานีระดับน้ำ (ระยะจากสถานี)
 */
export type CameraSelection =
  | { kind: "cctv"; camera: CctvCamera; distanceKm: number | null }
  | { kind: "itic"; camera: ItiCCamera; distanceKm: number | null };

/** ชื่อกล้อง DWR ตามภาษา (ต้นทางให้มา ไม่ได้แปลเอง) — ใช้ทั้งใน `CctvBody` และหัวแผงกล้อง */
export function cctvCameraName(camera: CctvCamera, lang: Lang, t: TFunction): string {
  const name = lang === "th" ? (camera.nameTh ?? camera.nameEn) : (camera.nameEn ?? camera.nameTh);
  return name ?? t("popup.cctv.fallbackName", { code: camera.stationCode });
}

/** ชื่อกล้อง iTIC — ต้นทางมีชื่อเดียว (ไม่แยกภาษา) */
export function iticCameraName(camera: ItiCCamera, t: TFunction): string {
  return camera.name ?? t("popup.itic.fallbackName", { id: camera.id });
}

/** คีย์ของการเลือก — เปลี่ยน = remount เนื้อหา (ตัวเล่น/ตัวขอภาพของกล้องเดิมหยุดก่อน) */
export function cameraSelectionKey(sel: CameraSelection): string {
  return `${sel.kind}:${sel.camera.id}`;
}

/* ------------------------------------------------------------------ */
/* คลิก vs ลาก                                                          */
/* ------------------------------------------------------------------ */

/** เมาส์ขยับเกินนี้ = ลาก (หมุน/เลื่อนแผนที่) ไม่ใช่คลิก */
export const CLICK_MAX_MOUSE_PX = 5;
/** นิ้วสั่นกว่าเมาส์ — การเลื่อนด้วยนิ้วย่อมเกินเกณฑ์นี้อยู่แล้วโดยนิยาม */
export const CLICK_MAX_TOUCH_PX = 10;
/** กดค้างนานกว่านี้ = ไม่ใช่คลิก */
export const CLICK_MAX_MS = 600;

/**
 * การปล่อยปุ่ม/นิ้วครั้งนี้เป็น "คลิกเพื่อดูข้อมูล" หรือไม่ — **ไม่ขึ้นกับเครื่องมือ**
 * (ลูกศร/มือ): เครื่องมือเปลี่ยนแค่ว่าการ *ลาก* หมุนหรือเลื่อนแผนที่ ส่วนการคลิกที่แทบ
 * ไม่ขยับไม่ได้หมุนหรือเลื่อนอะไรเลยในทั้งสองโหมด จึงเลือกหมุดได้เหมือนกัน
 * การลากที่ไปจบบนหมุดขยับเกินเกณฑ์อยู่แล้ว จึงไม่เปิดหมุดนั้น
 */
export function isClickRelease(movedPx: number, heldMs: number, touch: boolean): boolean {
  return movedPx <= (touch ? CLICK_MAX_TOUCH_PX : CLICK_MAX_MOUSE_PX) && heldMs <= CLICK_MAX_MS;
}

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

export const CAMERA_SHEET_W = 400;
/** แคบกว่านี้ภาพ 16:9 เล็กเกินจะดู — ยอมทับ drawer ด้านซ้ายบางส่วนบน tablet แทน */
export const CAMERA_SHEET_MIN_W = 320;

export interface CameraSheetBox {
  top: number;
  right: number;
  bottom: number;
  left: number | null;
  width: number | null;
}

/**
 * กล่องของแผงกล้อง (CSS px เทียบกับ viewport ของแผนที่)
 *
 *   phone  : เต็มจอ (0,0,0,0) — ทับ TopBar และแผ่นเลื่อน แผงมีหัวข้อ + ปุ่มปิดของตัวเอง
 *   ≥tablet: top = safeArea.top (ใต้ TopBar), bottom = GUTTER + dock + 8 (แนวเดียวกับก้อน
 *            rail+drawer ใน AppShell), right = GUTTER + TOOLS_W + GUTTER — อยู่ **ซ้าย**
 *            ของคอลัมน์เข็มทิศ/ซูม ปุ่มเหล่านั้นจึงยังกดได้ระหว่างดูกล้อง
 *            width = CAMERA_SHEET_W หดตามจอ แต่ไม่ต่ำกว่า CAMERA_SHEET_MIN_W
 */
export function cameraSheetBox(
  tier: Tier,
  safeArea: ShellSafeArea,
  viewportW: number,
): CameraSheetBox {
  if (tier === "phone") return { top: 0, right: 0, bottom: 0, left: 0, width: null };
  const right = GUTTER + TOOLS_W + GUTTER;
  // safeArea.bottom = GUTTER + dock (computeSafeArea) — +8 เหมือนก้อน rail/drawer ของ AppShell
  const bottom = safeArea.bottom + 8;
  const room = viewportW - right - safeArea.left;
  const width = Math.max(CAMERA_SHEET_MIN_W, Math.min(CAMERA_SHEET_W, room));
  return { top: safeArea.top, right, bottom, left: null, width: Math.min(width, viewportW - right - GUTTER) };
}
