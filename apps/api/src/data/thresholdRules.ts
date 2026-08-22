import type { AlertEvent, ThresholdCondition, ThresholdRule } from "@siahra/shared-types";
import { LOCAL_AUTHORITIES } from "./localAuthorities.js";

/**
 * Curated Deterministic Threshold Rules linking Telemetry Stations to Local Authorities.
 */
export const THRESHOLD_RULES: readonly ThresholdRule[] = [
  // ── Hat Yai / Songkhla (U-Tapao Basin) ──────────────────────────────────
  {
    id: "RULE-90-01-WARN",
    name: "ระดับน้ำคลองอู่ตะเภาเตือนภัย เทศบาลนครหาดใหญ่",
    stationId: 9001,
    stationKind: "waterlevel",
    basinCode: "BASIN-SOUTHERN-EAST-01",
    affectedLocalAuthorityIds: ["TH-LAO-901101", "TH-LAO-901102", "TH-LAO-901103"],
    severity: "warning",
    conditions: [
      {
        parameter: "water_level_msl",
        operator: ">=",
        triggerValue: 4.2,
        clearValue: 3.8,
      },
    ],
    minimumDurationMinutes: 15,
    cooldownMinutes: 60,
    sourceId: "thaiwater",
    version: "2026.1",
  },
  {
    id: "RULE-90-01-SEV",
    name: "ระดับน้ำคลองอู่ตะเภาล้นตลิ่งวิกฤต เทศบาลนครหาดใหญ่",
    stationId: 9001,
    stationKind: "waterlevel",
    basinCode: "BASIN-SOUTHERN-EAST-01",
    affectedLocalAuthorityIds: ["TH-LAO-901101", "TH-LAO-901102", "TH-LAO-901103"],
    severity: "severe",
    conditions: [
      {
        parameter: "water_level_msl",
        operator: ">=",
        triggerValue: 5.0,
        clearValue: 4.5,
      },
    ],
    minimumDurationMinutes: 15,
    cooldownMinutes: 60,
    sourceId: "thaiwater",
    version: "2026.1",
  },
  {
    id: "RULE-90-RAIN-WARN",
    name: "ฝนสะสม 24 ชม. หนักมาก ลุ่มน้ำคลองอู่ตะเภา",
    stationId: 9010,
    stationKind: "rainfall",
    basinCode: "BASIN-SOUTHERN-EAST-01",
    affectedLocalAuthorityIds: ["TH-LAO-901101", "TH-LAO-901104"],
    severity: "warning",
    conditions: [
      {
        parameter: "rain_24h_mm",
        operator: ">=",
        triggerValue: 90.0,
        clearValue: 70.0,
      },
    ],
    minimumDurationMinutes: 30,
    cooldownMinutes: 120,
    sourceId: "thaiwater",
    version: "2026.1",
  },
  // ── Chiang Mai (Ping Basin - Station P.1) ──────────────────────────────
  {
    id: "RULE-50-01-WARN",
    name: "ระดับน้ำแม่น้ำปิงสะพานนวรัฐเตือนภัย เทศบาลนครเชียงใหม่",
    stationId: 5001,
    stationKind: "waterlevel",
    basinCode: "BASIN-PING-01",
    affectedLocalAuthorityIds: ["TH-LAO-500101"],
    severity: "warning",
    conditions: [
      {
        parameter: "water_level_msl",
        operator: ">=",
        triggerValue: 3.7,
        clearValue: 3.5,
      },
    ],
    minimumDurationMinutes: 15,
    cooldownMinutes: 60,
    sourceId: "thaiwater",
    version: "2026.1",
  },
  {
    id: "RULE-50-01-SEV",
    name: "ระดับน้ำแม่น้ำปิงสะพานนวรัฐวิกฤต เทศบาลนครเชียงใหม่",
    stationId: 5001,
    stationKind: "waterlevel",
    basinCode: "BASIN-PING-01",
    affectedLocalAuthorityIds: ["TH-LAO-500101"],
    severity: "severe",
    conditions: [
      {
        parameter: "water_level_msl",
        operator: ">=",
        triggerValue: 4.2,
        clearValue: 3.9,
      },
    ],
    minimumDurationMinutes: 15,
    cooldownMinutes: 60,
    sourceId: "thaiwater",
    version: "2026.1",
  },
  // ── Nakhon Ratchasima (Lam Takhong Basin) ──────────────────────────────
  {
    id: "RULE-30-01-WARN",
    name: "ระดับน้ำลำตะคองเตือนภัย เทศบาลนครนครราชสีมา",
    stationId: 3001,
    stationKind: "waterlevel",
    basinCode: "BASIN-MUN-01",
    affectedLocalAuthorityIds: ["TH-LAO-300101", "TH-LAO-300102"],
    severity: "warning",
    conditions: [
      {
        parameter: "water_level_msl",
        operator: ">=",
        triggerValue: 3.5,
        clearValue: 3.2,
      },
    ],
    minimumDurationMinutes: 15,
    cooldownMinutes: 60,
    sourceId: "thaiwater",
    version: "2026.1",
  },
  // ── Ubon Ratchathani (Mun Basin - Station M.7) ──────────────────────────
  {
    id: "RULE-34-01-WARN",
    name: "ระดับน้ำแม่น้ำมูลสะพานเสรีประชาธิปไตยเตือนภัย เทศบาลนครอุบลราชธานี",
    stationId: 3401,
    stationKind: "waterlevel",
    basinCode: "BASIN-MUN-04",
    affectedLocalAuthorityIds: ["TH-LAO-340101", "TH-LAO-341501"],
    severity: "warning",
    conditions: [
      {
        parameter: "water_level_msl",
        operator: ">=",
        triggerValue: 112.0,
        clearValue: 111.5,
      },
    ],
    minimumDurationMinutes: 15,
    cooldownMinutes: 60,
    sourceId: "thaiwater",
    version: "2026.1",
  },
];

const LAO_BY_ID = new Map(LOCAL_AUTHORITIES.map((l) => [l.id, l]));

/**
 * Checks if a numerical telemetry value triggers a threshold condition.
 */
export function evaluateCondition(
  condition: ThresholdCondition,
  currentValue: number | null,
  isCurrentlyTriggered: boolean,
): boolean {
  if (currentValue === null || !Number.isFinite(currentValue)) {
    return false;
  }

  // Use hysteresis clear threshold if currently active
  const threshold = isCurrentlyTriggered ? condition.clearValue : condition.triggerValue;

  switch (condition.operator) {
    case ">":
      return currentValue > threshold;
    case ">=":
      return currentValue >= threshold;
    case "<":
      return currentValue < threshold;
    case "<=":
      return currentValue <= threshold;
    default:
      return false;
  }
}

/**
 * Evaluates a threshold rule against telemetry input readings.
 */
export function evaluateRule(
  rule: ThresholdRule,
  telemetry: Record<string, number | null>,
  activeRuleIds: Set<string>,
  nowIso: string,
): AlertEvent[] {
  const isCurrentlyActive = activeRuleIds.has(rule.id);

  // All conditions must be satisfied
  const allSatisfied = rule.conditions.every((cond) => {
    const val = telemetry[cond.parameter] ?? null;
    return evaluateCondition(cond, val, isCurrentlyActive);
  });

  if (!allSatisfied) {
    return [];
  }

  // Generate an AlertEvent for each affected local authority
  return rule.affectedLocalAuthorityIds.map((laoId) => {
    const lao = LAO_BY_ID.get(laoId);
    const provinceCode = lao ? lao.provinceCode : "10";

    const reasonTh = `เกณฑ์ ${rule.name}: ตรวจพบค่าเกินเกณฑ์เตือนภัย (รหัสสถานี ${rule.stationId})`;
    const reasonEn = `Rule ${rule.name}: Threshold exceeded at station #${rule.stationId}`;

    return {
      id: `ALERT-${rule.id}-${laoId}`,
      ruleId: rule.id,
      ruleVersion: rule.version,
      localAuthorityId: laoId,
      provinceCode,
      severity: rule.severity,
      triggeredAt: nowIso,
      clearedAt: null,
      reasonTh,
      reasonEn,
      inputSnapshot: { ...telemetry },
    };
  });
}
