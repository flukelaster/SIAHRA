import { describe, expect, it } from "vitest";
import { calculateBuildingDamage } from "./damageCurves.js";

describe("damageCurves module (Depth-Damage Curves)", () => {
  it("returns zero loss when no buildings exposed or depth is zero", () => {
    const zero1 = calculateBuildingDamage(0, 100);
    expect(zero1.estimatedEconomicLossThb).toBe(0);

    const zero2 = calculateBuildingDamage(1.5, 0);
    expect(zero2.estimatedEconomicLossThb).toBe(0);
  });

  it("calculates shallow water damage (< 0.2m)", () => {
    const res = calculateBuildingDamage(0.15, 10);
    expect(res.structuralDamagePct).toBe(5);
    expect(res.contentDamagePct).toBe(10);
    expect(res.estimatedEconomicLossThb).toBeGreaterThan(0);
  });

  it("calculates medium water depth damage (0.5m - 1.0m)", () => {
    const res = calculateBuildingDamage(0.8, 50);
    expect(res.structuralDamagePct).toBe(35);
    expect(res.contentDamagePct).toBe(60);
    expect(res.estimatedEconomicLossThb).toBeGreaterThan(20_000_000);
  });

  it("calculates extreme water depth damage (>= 2.0m)", () => {
    const res = calculateBuildingDamage(2.5, 100);
    expect(res.structuralDamagePct).toBe(90);
    expect(res.contentDamagePct).toBe(100);
    expect(res.estimatedEconomicLossThb).toBeGreaterThan(100_000_000);
  });
});
