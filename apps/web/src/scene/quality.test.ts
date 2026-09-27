import { describe, expect, it } from "vitest";
import { deviceClassFor, initialLevelFor, memoryBudgetsFor, presetsFor } from "./quality";

describe("deviceClassFor", () => {
  it("เมาส์ (pointer ไม่ coarse) = desktop ไม่ว่าจอจะเล็กแค่ไหน", () => {
    expect(deviceClassFor(false, 390)).toBe("desktop");
    expect(deviceClassFor(false, 1440)).toBe("desktop");
  });
  it("จอสัมผัส ด้านสั้น < 768 = phone, ≥ 768 = tablet (เกณฑ์เดียวกับ tierFor)", () => {
    expect(deviceClassFor(true, 390)).toBe("phone");
    expect(deviceClassFor(true, 767)).toBe("phone");
    expect(deviceClassFor(true, 768)).toBe("tablet");
    expect(deviceClassFor(true, 1024)).toBe("tablet");
  });
});

describe("initialLevelFor", () => {
  it("phone → low, tablet → balanced, desktop → high (desktop เหมือนเดิม)", () => {
    expect(initialLevelFor("phone")).toBe("low");
    expect(initialLevelFor("tablet")).toBe("balanced");
    expect(initialLevelFor("desktop")).toBe("high");
  });
});

describe("presetsFor", () => {
  it("desktop: ค่าเดิมทุกตัว (DPR ≤ 2, balanced = 0.75×, เงาเปิดยกเว้น low)", () => {
    const p = presetsFor("desktop", 2);
    expect(p.high).toEqual({ pixelRatio: 2, shadows: true, splitFactor: 2.3, imageryZoomOffset: 0 });
    expect(p.balanced).toEqual({ pixelRatio: 1.5, shadows: true, splitFactor: 2.0, imageryZoomOffset: 0 });
    expect(p.low).toEqual({ pixelRatio: 1, shadows: false, splitFactor: 1.6, imageryZoomOffset: -1 });
    expect(presetsFor("desktop", 3).high.pixelRatio).toBe(2);
  });
  it("phone: ทุกระดับปิดเงาและ DPR ≤ 1.5 (auto ขยับขึ้น high ได้ แต่ไม่กลับไปวาดเงา)", () => {
    const p = presetsFor("phone", 3);
    for (const level of ["high", "balanced", "low"] as const) {
      expect(p[level].shadows).toBe(false);
      expect(p[level].pixelRatio).toBeLessThanOrEqual(1.5);
    }
    expect(p.low.pixelRatio).toBe(1);
    expect(p.high.pixelRatio).toBe(1.5);
  });
  it("tablet: เงาเปิดได้ DPR ≤ 2", () => {
    const p = presetsFor("tablet", 2);
    expect(p.balanced.shadows).toBe(true);
    expect(p.high.pixelRatio).toBe(2);
  });
  it("DPR 0/undefined ถูกปัดเป็น 1", () => {
    expect(presetsFor("desktop", 0).high.pixelRatio).toBe(1);
  });
});

describe("memoryBudgetsFor", () => {
  it("มือถือได้งบแคบที่สุด (อาคาร ~80 MB) desktop ~400 MB", () => {
    const MB = 1024 * 1024;
    expect(memoryBudgetsFor("phone").buildingBytes).toBe(80 * MB);
    expect(memoryBudgetsFor("desktop").buildingBytes).toBe(400 * MB);
    expect(memoryBudgetsFor("phone").terrainTextureBytes).toBeLessThan(memoryBudgetsFor("tablet").terrainTextureBytes);
    expect(memoryBudgetsFor("tablet").terrainTextureBytes).toBeLessThan(memoryBudgetsFor("desktop").terrainTextureBytes);
    expect(memoryBudgetsFor("phone").terrainGeometryBytes).toBe(40 * MB);
    expect(memoryBudgetsFor("tablet").terrainGeometryBytes).toBe(80 * MB);
    expect(memoryBudgetsFor("desktop").terrainGeometryBytes).toBe(200 * MB);
  });
});
