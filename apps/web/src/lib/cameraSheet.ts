/**
 * สิ่งที่แผงกล้องด้านขวา (`components/map/CameraSheet.tsx`) ต้องใช้ + การแยก "คลิก" ออกจาก "ลาก" บนแผนที่
 * (`Map3DCanvas`) — pure module ไม่มี React/DOM ให้เทสตรง ๆ; เรขาคณิตและการปัดปิดของกรอบแผงด้านขวา
 * (ใช้ร่วมกับแผงรายงานจากประชาชน) ย้ายไปอยู่ที่ `lib/rightSheet.ts`
 */
import { cameraKey, type Camera, type CameraSourceId } from "@siahra/shared-types";
import type { Lang, TFunction } from "../i18n";
import type { CatalogueProbe } from "../hooks/useCameraCatalogues";
import type { SnapshotCache } from "./snapshotCache";

/**
 * กล้องที่แผงด้านขวากำลังแสดง — มาจากการคลิกหมุดกล้อง (`distanceKm` null) หรือปุ่ม
 * "กล้องใกล้เคียง" ใน popup ของสถานีระดับน้ำ (ระยะจากสถานี) — แหล่งอยู่ใน `camera.sourceId`
 */
export interface CameraSelection {
  camera: Camera;
  distanceKm: number | null;
}

/**
 * สิ่งที่แผงกล้อง/popup ต้องใช้กับกล้อง (E15.3) — null = ไม่มีแหล่งเปิดอยู่หรือชั้นปิด: ไม่มีแถว
 * "กล้องใกล้เคียง" และไม่มีทางที่ popup จะส่ง request ไปหาต้นทางกล้องใด
 */
export interface CameraContext {
  /** ทุกแหล่ง ทั้งประเทศ — สถานีริมเขตจังหวัดอาจใกล้กล้องของจังหวัดข้างเคียงที่สุด */
  cameras: readonly Camera[];
  /** แคชภาพนิ่ง DWR (กุญแจ `cameraKey`) — เจ้าของ object URL ทั้งหมด */
  cache: SnapshotCache;
  /** เวลา/vantage ของ probe ต่อแหล่ง — ป้าย "ไม่ตอบตอน build เมื่อ … จาก …" ในแผงกล้อง */
  probes: Partial<Record<CameraSourceId, CatalogueProbe>>;
}

/** ชื่อกล้องตามภาษา (ต้นทางให้มา ไม่ได้แปลเอง) — ไม่มีชื่อ = "กล้อง {id}" ใช้ทั้งในแผงกล้องและ popup */
export function cameraName(camera: Pick<Camera, "id" | "nameTh" | "nameEn">, lang: Lang, t: TFunction): string {
  const name = lang === "th" ? (camera.nameTh ?? camera.nameEn) : (camera.nameEn ?? camera.nameTh);
  return name ?? t("popup.camera.fallbackName", { id: camera.id });
}

/** คีย์ของการเลือก (= `cameraKey`) — เปลี่ยน = remount เนื้อหา (ตัวเล่น/ตัวขอภาพของกล้องเดิมหยุดก่อน) */
export function cameraSelectionKey(sel: CameraSelection): string {
  return cameraKey(sel.camera);
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
