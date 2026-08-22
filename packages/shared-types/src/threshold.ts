/**
 * Severity tier of an operational threshold rule.
 */
export type ThresholdSeverity = "watch" | "advisory" | "warning" | "severe";

/**
 * Single numerical condition evaluated against telemetry factors.
 */
export interface ThresholdCondition {
  parameter:
    | "water_level_msl"
    | "freeboard_m"
    | "rate_of_rise_m_per_h"
    | "rain_1h_mm"
    | "rain_24h_mm";
  operator: ">" | ">=" | "<" | "<=";
  triggerValue: number;
  /** Hysteresis threshold to prevent alert oscillation. */
  clearValue: number;
}

/**
 * Deterministic threshold rule connecting a sensor station to downstream local authorities.
 */
export interface ThresholdRule {
  id: string;
  name: string;
  stationId: number;
  stationKind: "waterlevel" | "rainfall";
  basinCode: string;
  affectedLocalAuthorityIds: string[];
  severity: ThresholdSeverity;
  conditions: ThresholdCondition[];
  minimumDurationMinutes: number;
  cooldownMinutes: number;
  sourceId: string;
  version: string;
}

/**
 * Recorded alert event with deterministic input audit trail.
 */
export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleVersion: string;
  localAuthorityId: string;
  severity: ThresholdSeverity;
  triggeredAt: string;
  clearedAt: string | null;
  reasonTh: string;
  reasonEn: string;
  inputSnapshot: Record<string, number | null>;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
}
