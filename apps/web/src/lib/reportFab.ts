/**
 * ปุ่มลอย "รายงานผลกระทบ" (FAB) ที่มุมขวาล่างของแผนที่ + แถบคำแนะนำของโหมดปักหมุด (`MapViewport`)
 * — pure module ไม่มี React/DOM ให้เทสตรง ๆ
 *
 * ปุ่มนี้แยกออกจากคอลัมน์เครื่องมือมุมมอง (เข็มทิศ/ลูกศร/มือ/ซูม) ตามข้อตัดสินใจของเจ้าของ 2026-09-28:
 * ไอคอนเปล่าในคอลัมน์ดูเหมือนเครื่องมือมุมมอง จึงเป็นปุ่มมีป้ายข้อความแทน
 *
 *   ≥tablet: right = GUTTER, bottom = safeArea.bottom + 8 (เหนือ BottomDock — safeArea.bottom = GUTTER + dock)
 *   phone  : อยู่ในก้อนเดียวกับคอลัมน์เครื่องมือ (ปุ่มนี้อยู่ล่างสุด คอลัมน์ยกขึ้นเหนือมัน) ที่
 *            `phoneToolsBottom(snap, phonePeekPx)` — ขยับตามแผ่นเลื่อนจังหวะเดียวกับคอลัมน์
 *   ≥tablet ที่จอเตี้ย (tablet แนวนอน 844×390): ถ้าอยู่ใต้คอลัมน์เครื่องมือแล้วขอบบนของปุ่มชิดขอบล่างของคอลัมน์
 *            (วัดจริง) น้อยกว่า `FAB_TOOLS_CLEARANCE` → ย้ายไป **ซ้าย** ของคอลัมน์ (`reportFabPlacement`) — ปุ่ม
 *            เคยทับปุ่มหมุน (orbit) จนกดไม่ได้; ซ้ายของคอลัมน์ยังไม่พอ (ชน drawer) → ปุ่มไอคอนอย่างเดียว (ชื่ออยู่ใน aria-label)
 *   แผงด้านขวา (กล้อง/รายงาน/ฟอร์ม) เปิดอยู่ = **ซ่อน** ทุก tier: บนจอกว้างแผงกินขอบขวาจาก dock ถึง TopBar
 *   ถ้าเลื่อนไปทางซ้ายของแผงจะไปทับ drawer (laptop: ขอบซ้ายแผง 628 − ปุ่ม ~180 < safeArea.left 456)
 *   บนมือถือแผงเต็มจอทับอยู่แล้ว
 *
 * ขนาดของปุ่มเป็น **ค่าที่วัด** (ป้ายต่างกันตามภาษา/tier/สถานะ) — ผู้เรียกส่งกล่องที่ ResizeObserver วัดได้มา
 */
import { rightSheetBox } from "./rightSheet";
import { GUTTER, TOOLS_W, phoneFloatBottomPx, type ShellSafeArea, type Tier } from "./shellLayout";

/** ช่องไฟระหว่าง FAB กับสิ่งที่อยู่ข้าง ๆ (แถบคำแนะนำ/ป้าย "แผ่นน้ำจำลอง") */
export const FAB_GAP = 8;
/** ช่องไฟระหว่างคอลัมน์เครื่องมือกับ FAB บนมือถือ — ห่างกว่าช่องไฟในคอลัมน์ (6) ให้เห็นว่าเป็นคนละกลุ่ม */
export const PHONE_FAB_TOOLS_GAP = 12;
/** ขอบขวาของหัวข้อ/แถบคำแนะนำเมื่อไม่มีอะไรอื่น — ห้ามวิ่งใต้คอลัมน์เครื่องมือ */
export const TITLE_RIGHT = GUTTER + TOOLS_W + GUTTER;
/** มือถือ: ความสูงของป้าย "แผ่นน้ำจำลอง" ที่มุมซ้ายล่าง + ช่องไฟ — แถบคำแนะนำอยู่เหนือมัน */
export const PHONE_BADGE_CLEARANCE_PX = 34;
/** แถบคำแนะนำแคบกว่านี้ (px) อ่านไม่ได้แล้ว — ซ่อนแทน (ฟอร์มมีข้อความ "แตะอีกครั้งเพื่อย้ายหมุด" ของตัวเอง) */
export const PLACING_HINT_MIN_W = 200;

/** ความสูงของ FAB — จอสัมผัส (phone/tablet) ≥ 44 ตามเป้าแตะขั้นต่ำ, laptop/wide 40 (= IconButton `lg`) */
export function reportFabHeightPx(tier: Tier): number {
  return tier === "phone" || tier === "tablet" ? 44 : 40;
}

/** ช่องว่างขั้นต่ำระหว่างขอบล่างของคอลัมน์เครื่องมือกับขอบบนของ FAB ที่อยู่ใต้มัน */
export const FAB_TOOLS_CLEARANCE = 8;
/** ปุ่มไอคอนอย่างเดียว (กว้าง = สูง) — ทางสุดท้ายเมื่อป้ายเต็มไม่มีที่ */
export const FAB_ICON_ONLY_W = 44;

/**
 * ปุ่มแสดงไหม — ต้องมีการกระทำกับรายงาน (`communityActions`) และไม่มีแผงด้านขวาเปิดอยู่: แผงกล้อง/แผงรายงาน
 * (`infoSheetOpen`) หรือฟอร์ม (`composeOpen` = หมุดชั่วคราวถูกวางแล้ว) — แผงกินขอบขวาลงมาถึงแถวของปุ่ม
 * (มือถือ: เต็มจอ) และเลื่อนไปซ้ายของแผงจะชน drawer
 */
export function reportFabVisible({
  hasActions,
  infoSheetOpen,
  composeOpen,
}: {
  hasActions: boolean;
  infoSheetOpen: boolean;
  composeOpen: boolean;
}): boolean {
  return hasActions && !infoSheetOpen && !composeOpen;
}

/** กล่อง FAB ที่วัดได้ (ขนาดตอนนี้) — null = ไม่แสดง */
export interface FabSize {
  width: number;
  height: number;
}

/** FAB ที่วางแล้ว: ขนาดที่วัดได้ + ระยะจากขอบขวาของ viewport — แถบคำแนะนำหดให้พ้นกล่องนี้ */
export interface FabBox extends FabSize {
  right: number;
}

export interface FabPlacementInput {
  tier: Tier;
  safeArea: ShellSafeArea;
  viewportW: number;
  viewportH: number;
  /** ความสูงของ FAB (`reportFabHeightPx`) */
  fabHeight: number;
  /** ความกว้างของ FAB แบบป้ายเต็ม (วัดตอนแสดงป้ายเต็ม) — null = ยังไม่เคยวัด */
  fullWidth: number | null;
  /** คอลัมน์เครื่องมือด้านขวาบน (วัดจริง): ขอบล่าง (px จากบนจอ) + ความกว้าง — null = ยังไม่ได้วัด */
  tools: { bottom: number; width: number } | null;
}

export interface FabPlacement {
  right: number;
  bottom: number;
  /** "full" = ไอคอน + ป้าย; "icon" = ไอคอนอย่างเดียว (ชื่อเต็มใน aria-label/title) */
  label: "full" | "icon";
}

/**
 * ตำแหน่งของ FAB บน ≥tablet (มือถือใช้ `phoneToolsBottom` ของก้อนคอลัมน์เครื่องมือ — ไม่ผ่านที่นี่)
 *
 *   bottom = safeArea.bottom + 8 (เหนือ dock) เสมอ
 *   ใต้คอลัมน์ (right = GUTTER) ถ้า  viewportH − bottom − fabHeight ≥ tools.bottom + FAB_TOOLS_CLEARANCE
 *   ไม่อย่างนั้นซ้ายของคอลัมน์: right = GUTTER + tools.width + GUTTER (= TITLE_RIGHT เมื่อคอลัมน์กว้าง TOOLS_W)
 *     และถ้าป้ายเต็มจะล้นขอบซ้ายของพื้นที่แผนที่ (safeArea.left + 4 — rail/drawer) → ไอคอนอย่างเดียว
 */
export function reportFabPlacement({
  tier,
  safeArea,
  viewportW,
  viewportH,
  fabHeight,
  fullWidth,
  tools,
}: FabPlacementInput): FabPlacement {
  const bottom = safeArea.bottom + 8;
  if (tier === "phone" || !tools) return { right: GUTTER, bottom, label: "full" };
  const fabTop = viewportH - bottom - fabHeight;
  if (fabTop >= tools.bottom + FAB_TOOLS_CLEARANCE) return { right: GUTTER, bottom, label: "full" };
  const right = Math.max(TITLE_RIGHT, GUTTER + tools.width + GUTTER);
  const mapLeft = safeArea.left + 4;
  const fits = fullWidth === null || viewportW - right - fullWidth >= mapLeft;
  return { right, bottom, label: fits ? "full" : "icon" };
}

export interface PlacingHintInput {
  tier: Tier;
  safeArea: ShellSafeArea;
  viewportW: number;
  /** กล่อง FAB ที่วางจริง (ขนาดที่วัด + `right` จาก `reportFabPlacement`, มือถือ = GUTTER) — null = ไม่แสดง */
  fab: FabBox | null;
  /** ฟอร์มรายงานเปิดอยู่ (หมุดชั่วคราวถูกวางแล้ว) */
  composeOpen: boolean;
  /** มือถือ: ป้าย "แผ่นน้ำจำลอง" อยู่ที่มุมซ้ายล่าง */
  sheetBadge: boolean;
  /**
   * มือถือ: ความสูง peek ของแผ่นเลื่อนที่วัดได้ (`MobileSheet`) — แถวของ FAB/ป้าย/แถบอยู่เหนือขอบบนของ peek 8 px
   * (`phoneFloatBottomPx`); null/ไม่ส่ง = ยังไม่ได้วัด ใช้เพดาน
   */
  phonePeekPx?: number | null;
}

export interface PlacingHintBox {
  /** CSS px จากขอบซ้าย/ขวา/ล่างของ viewport */
  left: number;
  right: number;
  bottom: number;
  align: "center" | "start";
  /**
   * แถบมีปุ่ม "ยกเลิก" ของตัวเองไหม — FAB แสดงอยู่ = ไม่มี (FAB เป็นปุ่มยกเลิกอยู่แล้ว สองปุ่มติดกันซ้ำซ้อน และบนมือถือ
   * ทำให้ข้อความห่อ) FAB ถูกซ่อน (แผงด้านขวา/ฟอร์มเปิด) = แถบเป็นทางยกเลิกบนแผนที่ทางเดียว จึงมีปุ่มเหมือนเดิม
   */
  cancel: boolean;
}

/**
 * กล่องของแถบคำแนะนำโหมดปักหมุด — `null` = ไม่มีที่พอ (ซ่อน)
 *
 *   left   = safeArea.left + 4 (ขอบเดียวกับหัวข้อจังหวัด)
 *   bottom = ≥tablet: safeArea.bottom + 8 (แถวของ FAB เหนือ dock)
 *            มือถือ: `phoneFloatBottomPx(phonePeekPx)` (แถวของ FAB/ป้าย เหนือ peek ที่วัดได้ 8 px)
 *            + `PHONE_BADGE_CLEARANCE_PX` ถ้ามีป้าย "แผ่นน้ำจำลอง"
 *   right  : FAB แสดงอยู่ = หดขอบขวาให้พ้น FAB (fab.right + ความกว้างที่วัด + FAB_GAP) ทุก tier เพราะ FAB อยู่
 *            แถวเดียวกัน (≥tablet: safeArea.bottom + 8; มือถือที่ peek: `phoneFloatBottomPx` เหมือนกัน)
 *            ไม่ต่ำกว่า `TITLE_RIGHT` (คอลัมน์เครื่องมือ)
 *            ฟอร์มเปิดบน ≥tablet = FAB ถูกซ่อน แถบชิดซ้ายและจบก่อนขอบซ้ายของแผงด้านขวา (`rightSheetBox`) —
 *            แผง (z-30) ต่ำลงมาถึงแถวเดียวกับแถบ ถ้าแถบยาวข้ามไปจะถูกแผงบัง
 *   cancel = FAB ไม่แสดง — มีปุ่ม "ยกเลิก" บนแผนที่ได้ทีละปุ่ม (Escape ยกเลิกได้เสมอ)
 *   เหลือกว้างไม่ถึง `PLACING_HINT_MIN_W` (tablet + drawer เปิด + ฟอร์มเปิด: ขอบซ้ายแผง = safeArea.left) → null
 */
export function placingHintBox({
  tier,
  safeArea,
  viewportW,
  fab,
  composeOpen,
  sheetBadge,
  phonePeekPx = null,
}: PlacingHintInput): PlacingHintBox | null {
  const left = safeArea.left + 4;
  const phone = tier === "phone";
  const bottom = phone
    ? phoneFloatBottomPx(phonePeekPx) + (sheetBadge ? PHONE_BADGE_CLEARANCE_PX : 0)
    : safeArea.bottom + 8;
  let right = TITLE_RIGHT;
  let align: PlacingHintBox["align"] = "center";
  if (fab) right = Math.max(right, fab.right + fab.width + FAB_GAP);
  if (composeOpen && !phone) {
    const box = rightSheetBox(tier, safeArea, viewportW);
    right = Math.max(right, box.right + (box.width ?? 0) + GUTTER);
    align = "start";
  }
  if (viewportW - left - right < PLACING_HINT_MIN_W) return null;
  return { left, right, bottom, align, cancel: fab === null };
}

/** มือถือ: ขอบขวาของก้อนป้าย "แผ่นน้ำจำลอง" (มุมซ้ายล่าง แถวเดียวกับ FAB) — ห้ามวิ่งใต้ FAB/คอลัมน์ */
export function phoneBadgeRight(fab: FabSize | null): number {
  return fab ? Math.max(TITLE_RIGHT, GUTTER + fab.width + FAB_GAP) : TITLE_RIGHT;
}
