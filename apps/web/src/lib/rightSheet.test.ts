import { describe, expect, it } from "vitest";
import { RIGHT_SHEET_MIN_W, RIGHT_SHEET_W, SWIPE_CLOSE_PX, rightSheetBox, swipeShouldClose } from "./rightSheet";
import { GUTTER, TOOLS_W, computeSafeArea } from "./shellLayout";

describe("swipeShouldClose", () => {
  it("ปัดขวาเกินเกณฑ์ = ปิด", () => {
    expect(swipeShouldClose(SWIPE_CLOSE_PX, 0, 0)).toBe(true);
    expect(swipeShouldClose(120, 30, 0.1)).toBe(true);
  });

  it("ปัดขวาไม่ถึงเกณฑ์และช้า = เด้งกลับ", () => {
    expect(swipeShouldClose(SWIPE_CLOSE_PX - 1, 0, 0.2)).toBe(false);
  });

  it("สะบัดเร็วแม้ระยะสั้น = ปิด แต่ต้องขยับจริงอย่างน้อยนิดหนึ่ง", () => {
    expect(swipeShouldClose(40, 5, 0.8)).toBe(true);
    expect(swipeShouldClose(10, 0, 2)).toBe(false);
  });

  it("ปัดซ้ายหรือแนวตั้งเด่นกว่า = ไม่ปิด (กำลังเลื่อนเนื้อหา)", () => {
    expect(swipeShouldClose(-120, 0, -1)).toBe(false);
    expect(swipeShouldClose(90, 200, 0.9)).toBe(false);
  });
});

describe("rightSheetBox", () => {
  const toolsRight = GUTTER + TOOLS_W + GUTTER;

  it("มือถือ: เต็มจอ", () => {
    const sa = computeSafeArea({ tier: "phone", drawerOpen: false, dockHeight: 0 });
    expect(rightSheetBox("phone", sa, 390)).toEqual({ top: 0, right: 0, bottom: 0, left: 0, width: null });
  });

  it("จอกว้าง: ใต้ TopBar เหนือ dock และอยู่ซ้ายของคอลัมน์เครื่องมือ", () => {
    const sa = computeSafeArea({ tier: "wide", drawerOpen: true, dockHeight: 100 });
    const box = rightSheetBox("wide", sa, 1536);
    expect(box.top).toBe(sa.top);
    expect(box.bottom).toBe(sa.bottom + 8);
    expect(box.right).toBe(toolsRight);
    expect(box.width).toBe(RIGHT_SHEET_W);
  });

  it("tablet ที่ drawer เปิด: หดได้แต่ไม่ต่ำกว่าความกว้างขั้นต่ำ", () => {
    const sa = computeSafeArea({ tier: "tablet", drawerOpen: true, dockHeight: 100 });
    const box = rightSheetBox("tablet", sa, 768);
    expect(box.width).toBe(RIGHT_SHEET_MIN_W);
    // ไม่เลยขอบซ้ายของ viewport
    expect(768 - box.right - (box.width ?? 0)).toBeGreaterThanOrEqual(GUTTER);
  });

  it("tablet ที่ drawer ปิด: เต็ม RIGHT_SHEET_W", () => {
    const sa = computeSafeArea({ tier: "tablet", drawerOpen: false, dockHeight: 100 });
    expect(rightSheetBox("tablet", sa, 800).width).toBe(RIGHT_SHEET_W);
  });
});
