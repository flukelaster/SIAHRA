import { describe, expect, it } from "vitest";
import type { ThresholdCondition, ThresholdRule } from "@siahra/shared-types";
import { evaluateCondition, evaluateRule, THRESHOLD_RULES } from "./thresholdRules.js";

describe("thresholdRules module", () => {
  const sampleCondition: ThresholdCondition = {
    parameter: "water_level_msl",
    operator: ">=",
    triggerValue: 4.0,
    clearValue: 3.5,
  };

  it("triggers when condition exceeds triggerValue (inactive state)", () => {
    expect(evaluateCondition(sampleCondition, 3.9, false)).toBe(false);
    expect(evaluateCondition(sampleCondition, 4.0, false)).toBe(true);
    expect(evaluateCondition(sampleCondition, 4.2, false)).toBe(true);
  });

  it("maintains active state until falling below hysteresis clearValue", () => {
    // When currently triggered, 3.8 is still active (since clear is 3.5)
    expect(evaluateCondition(sampleCondition, 3.8, true)).toBe(true);
    expect(evaluateCondition(sampleCondition, 3.6, true)).toBe(true);
    // Once below 3.5, it clears
    expect(evaluateCondition(sampleCondition, 3.4, true)).toBe(false);
  });

  it("handles null or non-finite telemetry safely", () => {
    expect(evaluateCondition(sampleCondition, null, false)).toBe(false);
    expect(evaluateCondition(sampleCondition, NaN, false)).toBe(false);
    expect(evaluateCondition(sampleCondition, Infinity, false)).toBe(false);
  });

  it("evaluates a full rule and generates AlertEvents for affected local authorities", () => {
    const rule: ThresholdRule = THRESHOLD_RULES.find((r) => r.id === "RULE-90-01-WARN")!;
    expect(rule).toBeDefined();

    const telemetry = {
      water_level_msl: 4.5,
    };

    const events = evaluateRule(rule, telemetry, new Set(), "2026-08-22T15:00:00Z");
    expect(events.length).toBe(rule.affectedLocalAuthorityIds.length);
    expect(events[0].ruleId).toBe("RULE-90-01-WARN");
    expect(events[0].severity).toBe("warning");
    expect(events[0].localAuthorityId).toBe("TH-LAO-901101");
    expect(events[0].reasonTh).toContain("คลองอู่ตะเภา");
  });
});
