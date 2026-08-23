import { describe, expect, it } from "vitest";
import type { ThresholdRule } from "@siahra/shared-types";
import { ALERT_RULES, ALERT_RULES_DROPPED_COUNT, validateAlertRules } from "../../src/data/alertRules";

/**
 * E11.5 — load-time validator for the baked rule table. `validateAlertRules`
 * is pure (takes rules + a known-id set, returns which pass), so this file
 * can exercise the "unknown TH-LAO-* id" case directly without editing the
 * committed `alertRules.json` fixture.
 */

function rule(over: Partial<ThresholdRule> = {}): ThresholdRule {
  return {
    id: "alert-rule-waterlevel-1",
    stationId: 1,
    stationKind: "waterlevel",
    affectedLocalAuthorityIds: ["TH-LAO-1100101"],
    alertAtLevel: "high",
    minimumDurationMinutes: 30,
    cooldownMinutes: 60,
    version: "1",
    ...over,
  };
}

describe("validateAlertRules", () => {
  const known = new Set(["TH-LAO-1100101", "TH-LAO-1100102"]);

  it("keeps a rule whose every affectedLocalAuthorityIds entry is a known id", () => {
    const result = validateAlertRules([rule()], known);
    expect(result.valid).toHaveLength(1);
    expect(result.droppedCount).toBe(0);
    expect(result.droppedIds).toEqual([]);
  });

  it("drops a rule that references an unknown TH-LAO-* id — does not keep it partially", () => {
    const bad = rule({ id: "alert-rule-waterlevel-2", affectedLocalAuthorityIds: ["TH-LAO-9999999"] });
    const result = validateAlertRules([rule(), bad], known);
    expect(result.valid.map((r) => r.id)).toEqual(["alert-rule-waterlevel-1"]);
    expect(result.droppedCount).toBe(1);
    expect(result.droppedIds).toEqual(["alert-rule-waterlevel-2"]);
  });

  it("drops the whole rule when only SOME of its authority ids are unknown — never a partial fan-out", () => {
    const mixed = rule({
      id: "alert-rule-waterlevel-3",
      affectedLocalAuthorityIds: ["TH-LAO-1100101", "TH-LAO-9999999"],
    });
    const result = validateAlertRules([mixed], known);
    expect(result.valid).toEqual([]);
    expect(result.droppedCount).toBe(1);
  });

  it("the real baked table (apps/api/src/data/alertRules.json) loads with zero dropped rules", () => {
    // อ้างค่าจากโมดูลที่โหลดจริง (ผ่าน validateAlertRules ไปแล้วตอน import) — ถ้า
    // ใครแก้ localAuthorities.json หรือ alertRules.json แล้วเกิดอ้างถึง id ที่ไม่มีจริง
    // เทสนี้จะจับได้ทันทีที่ build ไม่ใช่ตอนที่ /health ขึ้นแดงบน production
    expect(ALERT_RULES_DROPPED_COUNT).toBe(0);
    expect(ALERT_RULES.length).toBeGreaterThan(0);
  });
});
