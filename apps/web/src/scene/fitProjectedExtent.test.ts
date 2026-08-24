import { describe, expect, it } from "vitest";
import { fitProjectedExtent } from "./fitProjectedExtent";

// กรอบ 1000×500 กึ่งกลาง (600, 350) — เหมือน safe area จริง (ซ้าย 100 บน 100)
const free = { left: 100, top: 100, right: 1100, bottom: 600 };

describe("fitProjectedExtent", () => {
  it("ทุกจุดอยู่ในกรอบ → 1 (ไม่ขยับกล้องของจังหวัดที่พอดีอยู่แล้ว)", () => {
    expect(fitProjectedExtent([{ x: 200, y: 150 }, { x: 1000, y: 550 }, { x: 600, y: 350 }], free)).toBe(1);
    expect(fitProjectedExtent([{ x: 100, y: 100 }, { x: 1100, y: 600 }], free)).toBe(1);
  });

  it("ขอบล่างเกินไป 10% ของความสูงกรอบ → 1.2 (วัดจากกึ่งกลาง: 0.5 + 0.1 ของความสูง / ครึ่งกรอบ)", () => {
    // จุดใต้สุดอยู่ที่ bottom + 50px (= 10% ของ 500) → ห่างกึ่งกลาง 300 / ครึ่งกรอบ 250
    expect(fitProjectedExtent([{ x: 600, y: 150 }, { x: 600, y: 650 }], free)).toBeCloseTo(1.2, 6);
  });

  it("กว้างกว่าสูง → ใช้อัตราส่วนแนวนอน", () => {
    // ซ้าย/ขวาเกินกรอบข้างละ 100px (ห่างกึ่งกลาง 600 / ครึ่งกรอบ 500) แนวตั้งพอดี
    expect(fitProjectedExtent([{ x: 0, y: 350 }, { x: 1200, y: 350 }], free)).toBeCloseTo(1.2, 6);
    // แนวนอนเกินมากกว่าแนวตั้ง → เอาค่ามากสุด
    expect(fitProjectedExtent([{ x: 0, y: 620 }, { x: 1200, y: 100 }], free)).toBeCloseTo(1.2, 6);
  });

  it("จุดกระจายไม่สมมาตร: ฟิตจุดที่ไกลที่สุดจากกึ่งกลาง ไม่ใช่ช่วงกว้างรวม", () => {
    // บนพอดี (100) ล่างเกิน 50 — ช่วงกว้าง 550/500 = 1.1 จะยังปล่อยให้ล่างเกินอยู่
    expect(fitProjectedExtent([{ x: 600, y: 100 }, { x: 600, y: 650 }], free)).toBeCloseTo(1.2, 6);
  });

  it("กรอบเสื่อม (ขนาดศูนย์/ติดลบ) หรือไม่มีจุด → 1 ไม่ใช่ Infinity/NaN", () => {
    expect(fitProjectedExtent([{ x: 0, y: 0 }], { left: 0, top: 0, right: 0, bottom: 0 })).toBe(1);
    expect(fitProjectedExtent([{ x: 0, y: 0 }], { left: 10, top: 0, right: 0, bottom: 100 })).toBe(1);
    expect(fitProjectedExtent([], free)).toBe(1);
    expect(fitProjectedExtent([{ x: Number.NaN, y: 0 }], free)).toBe(1);
  });
});
