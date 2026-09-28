import { describe, expect, it } from "vitest";
import {
  FAB_GAP,
  PHONE_BADGE_CLEARANCE_PX,
  PLACING_HINT_MIN_W,
  TITLE_RIGHT,
  phoneBadgeRight,
  placingHintBox,
  FAB_TOOLS_CLEARANCE,
  reportFabHeightPx,
  reportFabPlacement,
  reportFabVisible,
  type FabBox,
} from "./reportFab";
import { rightSheetBox } from "./rightSheet";
import { GUTTER, TOOLS_W, computeSafeArea, type Tier } from "./shellLayout";

const DOCK_H = 96;
const saFor = (tier: Tier, drawerOpen = false) => computeSafeArea({ tier, drawerOpen, dockHeight: DOCK_H });
/**
 * ขนาดโดยประมาณ — ค่าที่เทสใช้ไม่สำคัญเท่าความสัมพันธ์ (ขอบของแถบพ้นขอบของปุ่ม) แถบคำแนะนำมีเฉพาะตอนปักหมุด
 * ซึ่ง FAB เป็นปุ่ม "ยกเลิก" (แคบกว่าป้ายเต็ม) แต่เทสทั้งสองขนาด
 */
const FAB_CANCEL: FabBox = { width: 104, height: 44, right: GUTTER };
const FAB_FULL: FabBox = { width: 176, height: 40, right: GUTTER };
const FAB_PHONE = FAB_CANCEL;

/** ช่วงแนวนอนของ FAB (x จากซ้าย) บนจอกว้าง `vw` */
const fabSpan = (vw: number, fab: FabBox) => [vw - fab.right - fab.width, vw - fab.right] as const;

describe("reportFab — ความสูง", () => {
  it("จอสัมผัส (phone/tablet) ≥ 44; laptop/wide ≥ 40", () => {
    expect(reportFabHeightPx("phone")).toBeGreaterThanOrEqual(44);
    expect(reportFabHeightPx("tablet")).toBeGreaterThanOrEqual(44);
    expect(reportFabHeightPx("laptop")).toBeGreaterThanOrEqual(40);
    expect(reportFabHeightPx("wide")).toBeGreaterThanOrEqual(40);
  });
});

describe("reportFab — แสดงเมื่อไร", () => {
  it("ต้องมี communityActions และไม่มีแผงด้านขวา/ฟอร์มเปิดอยู่", () => {
    expect(reportFabVisible({ hasActions: true, infoSheetOpen: false, composeOpen: false })).toBe(true);
    expect(reportFabVisible({ hasActions: false, infoSheetOpen: false, composeOpen: false })).toBe(false);
    expect(reportFabVisible({ hasActions: true, infoSheetOpen: true, composeOpen: false })).toBe(false);
    expect(reportFabVisible({ hasActions: true, infoSheetOpen: false, composeOpen: true })).toBe(false);
  });
});

/**
 * dock ที่วัดได้จริงต่อขนาดจอ (safeArea.bottom − GUTTER) และขอบล่างของคอลัมน์เครื่องมือ (วัดจาก dev server
 * 2026-09-28: layers + เข็มทิศ + กลุ่มลูกศร/มือ/ซูม/เต็มจอ จาก top 80 ≈ 434)
 */
const TOOLS = { bottom: 434, width: TOOLS_W };
const placementAt = (tier: Tier, vw: number, vh: number, dock: number, fullWidth: number | null = 162, drawerOpen = false) =>
  reportFabPlacement({
    tier,
    safeArea: computeSafeArea({ tier, drawerOpen, dockHeight: dock }),
    viewportW: vw,
    viewportH: vh,
    fabHeight: reportFabHeightPx(tier),
    fullWidth,
    tools: TOOLS,
  });

describe("reportFab — ตำแหน่งบน ≥tablet", () => {
  it.each(["tablet", "laptop", "wide"] as const)("%s จอสูง: มุมขวาล่างใต้คอลัมน์ เหนือ dock (safeArea.bottom + 8)", (tier) => {
    const sa = saFor(tier);
    const p = reportFabPlacement({
      tier,
      safeArea: sa,
      viewportW: 1300,
      viewportH: 1000,
      fabHeight: reportFabHeightPx(tier),
      fullWidth: 176,
      tools: TOOLS,
    });
    expect(p).toEqual({ right: GUTTER, bottom: sa.bottom + 8, label: "full" });
    // ขอบล่างของ FAB สูงกว่าขอบบนของ dock (GUTTER + dock จากขอบล่าง)
    expect(p.bottom).toBeGreaterThan(GUTTER + DOCK_H);
  });

  it("1280×600 (wide, dock 71): เหลือช่องใต้คอลัมน์ — ที่เดิม", () => {
    const p = placementAt("wide", 1280, 600, 71, 176);
    expect(p.right).toBe(GUTTER);
    expect(p.label).toBe("full");
    const fabTop = 600 - p.bottom - reportFabHeightPx("wide");
    expect(fabTop).toBeGreaterThanOrEqual(TOOLS.bottom + FAB_TOOLS_CLEARANCE);
  });

  it.each([
    ["tablet", 844, 390, 134],
    ["laptop", 1024, 500, 87],
  ] as const)("%s %i×%i: ใต้คอลัมน์จะทับปุ่มหมุน → ย้ายไปซ้ายของคอลัมน์ ป้ายเต็ม", (tier, vw, vh, dock) => {
    const p = placementAt(tier, vw, vh, dock);
    const fabTop = vh - p.bottom - reportFabHeightPx(tier);
    expect(fabTop).toBeLessThan(TOOLS.bottom + FAB_TOOLS_CLEARANCE);
    expect(p.right).toBe(TITLE_RIGHT);
    // ขอบขวาของปุ่มอยู่ซ้ายของขอบซ้ายของคอลัมน์ (vw − GUTTER − TOOLS_W) อย่างน้อย GUTTER
    expect(vw - p.right).toBeLessThanOrEqual(vw - GUTTER - TOOLS.width - GUTTER);
    expect(p.label).toBe("full");
  });

  it("ซ้ายของคอลัมน์ป้ายเต็มล้นเข้า drawer → ไอคอนอย่างเดียว", () => {
    // tablet 768 + drawer เปิด: พื้นที่แผนที่ 428…696 = 268 px — ป้ายเต็มสมมุติ 300 px ไม่พอ
    expect(placementAt("tablet", 768, 390, 134, 300, true).label).toBe("icon");
    expect(placementAt("tablet", 768, 390, 134, 162, true).label).toBe("full");
  });

  it("ยังไม่ได้วัดคอลัมน์ / มือถือ: ที่เดิม", () => {
    const sa = saFor("tablet");
    expect(
      reportFabPlacement({ tier: "tablet", safeArea: sa, viewportW: 844, viewportH: 390, fabHeight: 44, fullWidth: 162, tools: null }).right,
    ).toBe(GUTTER);
  });

  it("แถบคำแนะนำพ้น FAB ที่ย้ายไปซ้ายของคอลัมน์ (844×390)", () => {
    const p = placementAt("tablet", 844, 390, 134);
    const fab: FabBox = { width: 104, height: 44, right: p.right };
    const hint = placingHintBox({
      tier: "tablet",
      safeArea: computeSafeArea({ tier: "tablet", drawerOpen: false, dockHeight: 134 }),
      viewportW: 844,
      fab,
      composeOpen: false,
      sheetBadge: false,
    });
    expect(hint).not.toBeNull();
    expect(844 - hint!.right).toBeLessThanOrEqual(fabSpan(844, fab)[0] - FAB_GAP);
  });
});

describe("reportFab — แถบคำแนะนำไม่ทับ FAB", () => {
  const cases: Array<[Tier, number, boolean, FabBox]> = [
    ["phone", 390, false, FAB_PHONE],
    ["phone", 360, false, FAB_PHONE],
    ["tablet", 820, false, FAB_FULL],
    ["tablet", 820, true, FAB_CANCEL],
    ["tablet", 1023, true, FAB_FULL],
    ["laptop", 1100, false, FAB_FULL],
    ["laptop", 1100, true, FAB_FULL],
    ["wide", 1440, true, FAB_FULL],
  ];
  it.each(cases)("%s %ipx drawer=%s: ขอบขวาของแถบอยู่ซ้ายของ FAB อย่างน้อย FAB_GAP", (tier, vw, drawer, fab) => {
    const hint = placingHintBox({
      tier,
      safeArea: saFor(tier, drawer),
      viewportW: vw,
      fab,
      composeOpen: false,
      sheetBadge: false,
    });
    expect(hint).not.toBeNull();
    const hintRightX = vw - hint!.right;
    expect(hintRightX).toBeLessThanOrEqual(fabSpan(vw, fab)[0] - FAB_GAP);
    // และยังพ้นคอลัมน์เครื่องมือเหมือนเดิม
    expect(hint!.right).toBeGreaterThanOrEqual(TITLE_RIGHT);
    expect(hint!.align).toBe("center");
    // FAB เป็นปุ่มยกเลิกแล้ว — แถบไม่มีปุ่มซ้ำ
    expect(hint!.cancel).toBe(false);
    // แถวเดียวกับ FAB (≥tablet) — จึงต้องหด ไม่ใช่ยก
    expect(hint!.bottom).toBe(saFor(tier, drawer).bottom + 8);
  });

  it("ไม่มี FAB (ไม่มี communityActions/แผงขวาเปิด) = ขอบเดิม TITLE_RIGHT", () => {
    const hint = placingHintBox({
      tier: "wide",
      safeArea: saFor("wide"),
      viewportW: 1440,
      fab: null,
      composeOpen: false,
      sheetBadge: false,
    });
    expect(hint?.right).toBe(TITLE_RIGHT);
    // ไม่มี FAB = แถบเป็นทางยกเลิกบนแผนที่ทางเดียว
    expect(hint?.cancel).toBe(true);
  });

  it("มือถือ + ป้าย 'แผ่นน้ำจำลอง': ยกขึ้นเหนือป้าย และยังพ้น FAB", () => {
    const sa = saFor("phone");
    const hint = placingHintBox({ tier: "phone", safeArea: sa, viewportW: 390, fab: FAB_PHONE, composeOpen: false, sheetBadge: true });
    expect(hint?.bottom).toBe(sa.bottom + 8 + PHONE_BADGE_CLEARANCE_PX);
    expect(390 - hint!.right).toBeLessThanOrEqual(fabSpan(390, FAB_PHONE)[0] - FAB_GAP);
  });

  it("มือถือ: ก้อนป้าย 'แผ่นน้ำจำลอง' หดพ้น FAB ด้วย", () => {
    expect(phoneBadgeRight(FAB_PHONE)).toBe(GUTTER + FAB_PHONE.width + FAB_GAP);
    expect(phoneBadgeRight(null)).toBe(TITLE_RIGHT);
    // ปุ่มแคบกว่าคอลัมน์ (เป็นไปไม่ได้จริง แต่ไม่ควรวิ่งใต้คอลัมน์)
    expect(phoneBadgeRight({ width: 20, height: 44 })).toBe(TITLE_RIGHT);
  });
});

describe("reportFab — ฟอร์มเปิด (แถบชิดซ้าย) บน ≥tablet", () => {
  it.each([
    ["wide", 1440, true],
    ["wide", 1440, false],
    ["laptop", 1100, false],
    ["laptop", 1279, true],
    ["tablet", 820, false],
  ] as const)("%s %ipx drawer=%s: แถบจบก่อนขอบซ้ายของแผงด้านขวา", (tier, vw, drawer) => {
    const sa = saFor(tier, drawer);
    const hint = placingHintBox({ tier, safeArea: sa, viewportW: vw, fab: null, composeOpen: true, sheetBadge: false });
    expect(hint).not.toBeNull();
    const box = rightSheetBox(tier, sa, vw);
    const sheetLeftX = vw - box.right - (box.width ?? 0);
    expect(vw - hint!.right).toBeLessThanOrEqual(sheetLeftX - GUTTER);
    expect(hint!.align).toBe("start");
    // ฟอร์มเปิด = FAB ซ่อน → แถบคงปุ่มยกเลิกของตัวเอง
    expect(hint!.cancel).toBe(true);
    expect(vw - hint!.right - hint!.left).toBeGreaterThanOrEqual(PLACING_HINT_MIN_W);
  });

  it.each([
    ["tablet", 820],
    ["laptop", 1100],
  ] as const)("%s %ipx + drawer เปิด: ช่องระหว่าง drawer กับแผงแคบกว่า PLACING_HINT_MIN_W → null (ซ่อน ไม่ใช่ความกว้างติดลบหรือถูกแผงบัง)", (tier, vw) => {
    const sa = saFor(tier, true);
    expect(placingHintBox({ tier, safeArea: sa, viewportW: vw, fab: null, composeOpen: true, sheetBadge: false })).toBeNull();
  });

  it("มือถือ: ฟอร์มเต็มจอ — ไม่ใช้กรอบแผงด้านขวา แถบยังอยู่กลาง", () => {
    const hint = placingHintBox({ tier: "phone", safeArea: saFor("phone"), viewportW: 390, fab: null, composeOpen: true, sheetBadge: false });
    expect(hint?.align).toBe("center");
    expect(hint?.right).toBe(TITLE_RIGHT);
  });
});
