import { describe, expect, it } from "vitest";
import type { NorthRouteHistoryPoint } from "@siahra/shared-types";
import {
  BAND_COLOR,
  NEAR_CAPACITY_PCT,
  STEADY_PCT_OF_QMAX,
  capacityBand,
  countBands,
  dischargeTrend,
  readingDischargeTrend,
} from "./flowStrength";
import { NODE_COLOR } from "./northRoute";

const H = 3_600_000;
const END = Date.parse("2026-09-26T06:00:00.000Z");
const pt = (hoursAgo: number, discharge: number | null): NorthRouteHistoryPoint => ({
  t: new Date(END - hoursAgo * H).toISOString(),
  value: null,
  discharge,
});

describe("capacityBand", () => {
  it("เกณฑ์เป็นค่าที่ประกาศไว้ (80 / 2 %) — เปลี่ยนแล้วต้องแก้เทสนี้อย่างตั้งใจ", () => {
    expect(NEAR_CAPACITY_PCT).toBe(80);
    expect(STEADY_PCT_OF_QMAX).toBe(2);
  });

  it("เกิน 100 = over, เท่ากับ 100 พอดี = near (ขอบที่ต้นทางเผยแพร่คือ 'เกิน')", () => {
    expect(capacityBand(100.1)).toBe("over");
    expect(capacityBand(150)).toBe("over");
    expect(capacityBand(100)).toBe("near");
  });

  it("≥ 80 = near, ต่ำกว่า = normal (รวม 0)", () => {
    expect(capacityBand(NEAR_CAPACITY_PCT)).toBe("near");
    expect(capacityBand(79.9)).toBe("normal");
    expect(capacityBand(0)).toBe("normal");
  });

  it("ไม่มีค่า/ไม่ใช่ตัวเลข = null ไม่ใช่ normal", () => {
    expect(capacityBand(null)).toBeNull();
    expect(capacityBand(Number.NaN)).toBeNull();
    expect(capacityBand(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("สีของแถบอ่านจาก NODE_COLOR", () => {
    expect(BAND_COLOR).toEqual({ over: NODE_COLOR.red, near: NODE_COLOR.orange, normal: NODE_COLOR.green });
  });
});

describe("dischargeTrend", () => {
  const QMAX = 1000;
  it("ขึ้น/ลง/ทรงตัว ตาม ΔQ ใน 3 ชม. เทียบ 2 % ของ qmax", () => {
    expect(dischargeTrend([pt(3, 500), pt(0, 600)], END, QMAX, false)).toBe("rising");
    expect(dischargeTrend([pt(3, 600), pt(0, 500)], END, QMAX, false)).toBe("falling");
    expect(dischargeTrend([pt(3, 500), pt(0, 505)], END, QMAX, false)).toBe("steady");
    expect(dischargeTrend([pt(3, 500), pt(0, 500)], END, QMAX, false)).toBe("steady");
  });

  it("ขอบเกณฑ์: |Δ| = 2 % ของ qmax พอดี ไม่ใช่ทรงตัว, ต่ำกว่าเล็กน้อยคือทรงตัว", () => {
    expect(dischargeTrend([pt(3, 500), pt(0, 520)], END, QMAX, false)).toBe("rising");
    expect(dischargeTrend([pt(3, 520), pt(0, 500)], END, QMAX, false)).toBe("falling");
    expect(dischargeTrend([pt(3, 500), pt(0, 519.9)], END, QMAX, false)).toBe("steady");
    expect(dischargeTrend([pt(3, 520), pt(0, 500.1)], END, QMAX, false)).toBe("steady");
  });

  it("ปรับเป็นต่อ 3 ชม.: สองจุดห่างกัน 1 ชม. เปลี่ยน 10 = 30 ต่อ 3 ชม. (ขึ้น) ไม่ใช่ 10 (ทรงตัว)", () => {
    expect(dischargeTrend([pt(1, 500), pt(0, 510)], END, QMAX, false)).toBe("rising");
    // 0.5 ต่อ 1 ชม. = 1.5 ต่อ 3 ชม. < 20
    expect(dischargeTrend([pt(1, 500), pt(0, 500.5)], END, QMAX, false)).toBe("steady");
  });

  it("ใช้จุดแรกกับจุดสุดท้ายในหน้าต่าง ไม่ใช่จุดกลาง; จุดนอกหน้าต่างไม่นับ", () => {
    // จุด 4 ชม. ก่อนอยู่นอกหน้าต่าง; ในหน้าต่างมี 500 → 700 → 505 = ทรงตัว
    const h = [pt(4, 100), pt(3, 500), pt(1.5, 700), pt(0, 505)];
    expect(dischargeTrend(h, END, QMAX, false)).toBe("steady");
    // จุดหลัง endMs ไม่นับ
    expect(dischargeTrend([pt(3, 500), pt(0, 505), pt(-1, 900)], END, QMAX, false)).toBe("steady");
  });

  it("เรียงประวัติที่มาสลับลำดับก่อนหาจุดแรก/สุดท้าย", () => {
    expect(dischargeTrend([pt(0, 600), pt(3, 500)], END, QMAX, false)).toBe("rising");
  });

  it("null: น้อยกว่าสองจุดที่มีอัตราการไหลในหน้าต่าง", () => {
    expect(dischargeTrend([], END, QMAX, false)).toBeNull();
    expect(dischargeTrend([pt(1, 500)], END, QMAX, false)).toBeNull();
    expect(dischargeTrend([pt(3, null), pt(0, 500)], END, QMAX, false)).toBeNull();
    expect(dischargeTrend([pt(5, 100), pt(4, 900)], END, QMAX, false)).toBeNull();
  });

  it("null: จุดสองจุดที่เวลาเดียวกัน (ช่วงเวลา 0)", () => {
    expect(dischargeTrend([pt(1, 500), pt(1, 900)], END, QMAX, false)).toBeNull();
  });

  it("null: ค่าค้าง, ไม่มี qmax, qmax ≤ 0", () => {
    const h = [pt(3, 500), pt(0, 900)];
    expect(dischargeTrend(h, END, QMAX, true)).toBeNull();
    expect(dischargeTrend(h, END, null, false)).toBeNull();
    expect(dischargeTrend(h, END, 0, false)).toBeNull();
    expect(dischargeTrend(h, END, -5, false)).toBeNull();
  });

  it("ข้ามจุดที่เวลาเสีย", () => {
    const h = [{ t: "not-a-date", value: null, discharge: 1 }, pt(3, 500), pt(0, 600)];
    expect(dischargeTrend(h, END, QMAX, false)).toBe("rising");
  });
});

describe("readingDischargeTrend", () => {
  const h = [pt(3, 500), pt(0, 600)];
  it("missing หรือ stale → null; ปกติ → ตามแนวโน้ม", () => {
    expect(readingDischargeTrend({ missing: true, stale: false }, h, END, 1000)).toBeNull();
    expect(readingDischargeTrend({ missing: false, stale: true }, h, END, 1000)).toBeNull();
    expect(readingDischargeTrend({ missing: false, stale: false }, h, END, 1000)).toBe("rising");
  });
});

describe("countBands", () => {
  const r = (over: Partial<{ missing: boolean; stale: boolean; qmaxPct: number | null }> = {}) => ({
    missing: false,
    stale: false,
    qmaxPct: 50 as number | null,
    ...over,
  });
  it("ทุกสถานีตกหนึ่งกลุ่ม; ไม่มี qmax/อัตราการไหล = unknown ไม่ใช่ normal; ค่าค้างนับแยก", () => {
    const rs = [
      r({ qmaxPct: 120 }),
      r({ qmaxPct: 85 }),
      r({ qmaxPct: 10 }),
      r({ qmaxPct: null }),
      r({ missing: true, qmaxPct: null }),
      r({ stale: true, qmaxPct: 120 }),
    ];
    expect(countBands(rs)).toEqual({ over: 1, near: 1, normal: 1, unknown: 2, stale: 1 });
  });
  it("ว่าง = ศูนย์ทุกกลุ่ม", () => {
    expect(countBands([])).toEqual({ over: 0, near: 0, normal: 0, unknown: 0, stale: 0 });
  });
});
