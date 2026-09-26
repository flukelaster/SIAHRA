import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import { buildRegionOutline, clipToRegion, isoOf, REGION_BBOX } from "./build-region-outline.js";

const square = (x0: number, y0: number, x1: number, y1: number): Polygon => ({
  type: "Polygon",
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});

describe("build-region-outline", () => {
  it("ตัดทุกอย่างเหลือเฉพาะกรอบ lon 80–150 / lat −5–35", () => {
    const g = clipToRegion(square(140, 30, 160, 40));
    expect(g).not.toBeNull();
    const xs = (g as Polygon).coordinates[0].map((p) => p[0]);
    const ys = (g as Polygon).coordinates[0].map((p) => p[1]);
    expect(Math.max(...xs)).toBeLessThanOrEqual(REGION_BBOX[2]);
    expect(Math.max(...ys)).toBeLessThanOrEqual(REGION_BBOX[3]);
  });

  it("ประเทศนอกกรอบทั้งหมดถูกทิ้ง ไม่ใช่เหลือเป็นวงเสื่อม", () => {
    expect(clipToRegion(square(0, 40, 10, 50))).toBeNull();
  });

  it("ADM0_A3 มาก่อน ISO_A3 (-99 ของ Natural Earth ไม่ใช่รหัส)", () => {
    expect(isoOf({ ADM0_A3: "THA", ISO_A3: "THA" })).toBe("THA");
    expect(isoOf({ ADM0_A3: "-99", ISO_A3: "FRA" })).toBe("FRA");
  });

  it("เหลือ property แค่ iso/name/thailand และติดธงไทยถูกประเทศ", () => {
    const out = buildRegionOutline(
      {
        features: [
          { type: "Feature", properties: { ADM0_A3: "THA", NAME_EN: "Thailand", POP_EST: 1 }, geometry: square(98, 6, 105, 20) },
          { type: "Feature", properties: { ADM0_A3: "LAO", NAME_EN: "Laos" }, geometry: square(100, 14, 107, 22) },
          { type: "Feature", properties: { ADM0_A3: "FRA", NAME_EN: "France" }, geometry: square(0, 42, 8, 51) },
          { type: "Feature", properties: { ADM0_A3: "ATA" }, geometry: null },
        ],
      },
      "2026-09-26T00:00:00.000Z",
    );
    expect(out.features.map((f) => f.properties)).toEqual([
      { iso: "LAO", name: "Laos", thailand: false },
      { iso: "THA", name: "Thailand", thailand: true },
    ]);
    expect(out.source.builtAt).toBe("2026-09-26T00:00:00.000Z");
    expect(out.source.license).toMatch(/public domain/i);
  });
});
