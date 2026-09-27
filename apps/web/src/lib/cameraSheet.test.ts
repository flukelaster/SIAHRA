import { describe, expect, it } from "vitest";
import { isClickRelease } from "./cameraSheet";

describe("isClickRelease", () => {
  it("เมาส์: ขยับ ≤ 5 px และกดไม่เกิน 600 ms = คลิก", () => {
    expect(isClickRelease(0, 80, false)).toBe(true);
    expect(isClickRelease(5, 600, false)).toBe(true);
  });

  it("เมาส์: ลากเกิน 5 px = ไม่ใช่คลิก (การเลื่อนแผนที่ที่จบบนหมุดไม่เปิดหมุด)", () => {
    expect(isClickRelease(6, 50, false)).toBe(false);
    expect(isClickRelease(40, 300, false)).toBe(false);
  });

  it("กดค้างนานเกิน = ไม่ใช่คลิก", () => {
    expect(isClickRelease(0, 601, false)).toBe(false);
    expect(isClickRelease(0, 601, true)).toBe(false);
  });

  it("นิ้ว: ยอมสั่นได้ถึง 10 px", () => {
    expect(isClickRelease(9, 100, true)).toBe(true);
    expect(isClickRelease(11, 100, true)).toBe(false);
  });
});
