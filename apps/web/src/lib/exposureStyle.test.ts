import { describe, expect, it } from "vitest";
import type { ExposureFactors, StationExposure } from "@siahra/shared-types";
import {
  EXPOSURE_DRAPED_LEVELS,
  EXPOSURE_HALO,
  EXPOSURE_RGB,
  countExposureClasses,
  exposureRenderClass,
  hasUsableFactor,
} from "./exposureStyle";

const NO_FACTORS: ExposureFactors = {
  rain1hMm: null,
  rain24hMm: null,
  freeboardM: null,
  freeboardTrendMPerH: null,
  situationLevel: null,
};

function station(factors: Partial<ExposureFactors>, level: StationExposure["level"] = "low"): StationExposure {
  return {
    stationId: 1,
    stationKind: "rainfall",
    provinceCode: "14",
    lat: 14.4,
    lon: 100.5,
    level,
    factors: { ...NO_FACTORS, ...factors },
    observedAt: "2026-08-20T06:00:00.000Z",
  };
}

/**
 * หัวใจของ E10.4: `level: "low"` แปลได้สองอย่าง และตัวเรนเดอร์ห้ามยุบรวมกัน
 * (ดู docs/roadmap.md §E10.4 และ packages/shared-types/src/exposure.ts)
 */
describe("exposureRenderClass แยก 'วัดแล้วอยู่แถบต่ำสุด' ออกจาก 'ไม่มีปัจจัยใดวัดได้'", () => {
  it("ทุกปัจจัยเป็น null → no-data ไม่ใช่ low", () => {
    expect(exposureRenderClass(station({}))).toBe("no-data");
  });

  it("ฝนวัดได้ 0 มม. คือค่าที่วัดมาแล้ว → low (ไม่ใช่ no-data)", () => {
    expect(exposureRenderClass(station({ rain1hMm: 0, rain24hMm: 0 }))).toBe("low");
  });

  it.each([
    ["rain1hMm", { rain1hMm: 0 }],
    ["rain24hMm", { rain24hMm: 0.2 }],
    ["freeboardM", { freeboardM: 4.5 }],
    ["freeboardTrendMPerH", { freeboardTrendMPerH: 0 }],
  ] as const)("ปัจจัยเดียวที่วัดได้ (%s) ก็พอให้เป็นค่าที่วัดมาแล้ว", (_name, f) => {
    expect(hasUsableFactor({ ...NO_FACTORS, ...f })).toBe(true);
  });

  it("situationLevel ของ ThaiWater นับเป็นปัจจัยที่ใช้ได้ แม้จะเป็นแถบต่ำสุด (1)", () => {
    expect(exposureRenderClass(station({ situationLevel: 1 }))).toBe("low");
  });

  /** กฎเดียวกับ bandOfRising/bandOfFalling ฝั่ง api: ค่าที่ไม่ใช่จำนวนจำกัดไม่เกิดแถบ */
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "ค่าที่ไม่ใช่จำนวนจำกัด (%p) ไม่นับเป็นปัจจัยที่วัดได้",
    (v) => {
      expect(exposureRenderClass(station({ rain24hMm: v }))).toBe("no-data");
    },
  );

  it("สถานีที่วัดได้และอยู่แถบสูง คงระดับเดิมไว้", () => {
    expect(exposureRenderClass(station({ freeboardM: 0.7 }, "high"))).toBe("high");
  });

  it("นับสถานีแยกตามสถานะที่จะเรนเดอร์ โดย no-data ไม่ไปรวมกับ low", () => {
    const counts = countExposureClasses([
      station({}),
      station({}),
      station({ rain24hMm: 0 }),
      station({ situationLevel: 4 }, "high"),
    ]);
    expect(counts).toEqual({ low: 1, elevated: 0, high: 1, severe: 0, "no-data": 2 });
  });
});

describe("ภาษาภาพ", () => {
  it("สีของ no-data ไม่เท่ากับสีของแถบใดในสเกล", () => {
    for (const level of ["low", "elevated", "high", "severe"] as const) {
      expect(EXPOSURE_RGB["no-data"]).not.toEqual(EXPOSURE_RGB[level]);
    }
  });

  it("แถบต่ำสุดไม่ถูกระบายลงบนภูมิประเทศ (ไม่งั้น 'ขณะนี้' ไม่มีความหมาย)", () => {
    expect(EXPOSURE_DRAPED_LEVELS).not.toContain("low");
    expect([...EXPOSURE_DRAPED_LEVELS]).toEqual(["elevated", "high", "severe"]);
  });

  /**
   * `hazardOverlay.updateExposure` ตัดสินว่าจะระบายไหมจากความแรงของฮาโล ไม่ได้อ่าน
   * รายชื่อข้างบน — สองค่านี้จึงต้องตรงกันเสมอ ไม่งั้นแถบใดแถบหนึ่งจะเงียบหายไป
   */
  it("ความแรงของฮาโล > 0 เฉพาะแถบที่ประกาศว่าจะระบาย", () => {
    const painted = (["low", "elevated", "high", "severe"] as const).filter(
      (l) => EXPOSURE_HALO[l].strength > 0,
    );
    expect(painted).toEqual([...EXPOSURE_DRAPED_LEVELS]);
  });
});
