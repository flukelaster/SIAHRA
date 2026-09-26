import { describe, expect, it } from "vitest";
import { sparklineRange } from "./sparklineRange";

describe("sparklineRange", () => {
  it("ป้ายแกนเป็นค่าที่วัดได้จริง แม้ช่วงวาดถูกขยาย (อัตราการไหล C.2 ยอด 1,827 ไม่ใช่ 1851)", () => {
    const r = sparklineRange([1800, 1815, 1827], null, true);
    expect(r.observedMax).toBe(1827);
    expect(r.observedMin).toBe(1800);
    // ช่วงวาดขยายเป็น ≥ 5% ของค่าสูงสุด — ใช้วาดเท่านั้น
    expect(r.scaleMax).toBeGreaterThan(1827);
    expect(r.scaleMin).toBeLessThan(1800);
    expect(r.scaleMax - r.scaleMin).toBeCloseTo(1827 * 0.05, 6);
  });

  it("ระดับน้ำที่แทบนิ่ง: ช่วงวาดกว้างอย่างน้อย 0.2 ม. แต่ป้ายยังเป็นค่าจริง", () => {
    const r = sparklineRange([13.41, 13.42], null, false);
    expect(r.observedMin).toBe(13.41);
    expect(r.observedMax).toBe(13.42);
    expect(r.scaleMax - r.scaleMin).toBeCloseTo(0.2, 9);
  });

  it("เส้นตลิ่งอยู่ในช่วงวาด แต่ไม่ถูกพิมพ์เป็นค่าต่ำสุด/สูงสุดของอนุกรม", () => {
    const r = sparklineRange([10, 11], 14, false);
    expect(r.scaleMax).toBe(14);
    expect(r.scaleMin).toBe(10);
    expect(r.observedMax).toBe(11);
    expect(r.observedMin).toBe(10);
  });

  it("ช่วงกว้างพออยู่แล้ว → ไม่ขยาย", () => {
    const r = sparklineRange([100, 400], null, true);
    expect(r).toEqual({ observedMin: 100, observedMax: 400, scaleMin: 100, scaleMax: 400 });
  });
});
