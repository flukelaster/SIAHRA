import type { AlertSeverityTier, ExposureFactors, ExposureLevel, StationExposure } from "@siahra/shared-types";

/**
 * Pure hysteresis state machine for one `ThresholdRule` — extracted out of
 * `AlertEngineDO` so the evaluation LOGIC can be fixture-tested without any
 * SQL/Durable-Object plumbing (`durable-objects/alert-engine.ts` is the only
 * caller; it just reads/writes this shape to/from `rule_state` rows).
 *
 * Three invariants this module holds — see the fixture tests in
 * `test/alerts/evaluate.test.ts` for one case per invariant:
 * 1. A station missing from the batch (`station === undefined`) HOLDS the
 *    prior state exactly — `stale` flips to `true`, nothing else moves.
 * 2. A station that reports but whose `ExposureFactors` are all `null` is
 *    "no evidence", not "low" — it must not advance the clear countdown
 *    (see `../exposure/compute.ts`'s `levelOf()` doc comment on why an
 *    all-null station gets `level: "low"`, and why that default is wrong to
 *    reuse here).
 * 3. `triggeredAt`/`clearedAt` only move on a genuine tier crossing sustained
 *    for `minimumDurationMinutes`, gated on entry by `cooldownMinutes` since
 *    the last real clear.
 */

/** Same ordering `../exposure/compute.ts` uses internally — not exported there, so declared once here. */
export const EXPOSURE_LEVEL_RANK: Record<ExposureLevel, number> = { low: 0, elevated: 1, high: 2, severe: 3 };

/** A station with every observed factor `null` produced no evidence at all — see invariant 2 above. */
export function hasUsableFactors(f: ExposureFactors): boolean {
  return (
    f.rain1hMm !== null ||
    f.rain24hMm !== null ||
    f.freeboardM !== null ||
    f.freeboardTrendMPerH !== null ||
    f.situationLevel !== null
  );
}

export interface RuleState {
  active: boolean;
  triggeredAtMs: number | null;
  clearedAtMs: number | null;
  /** True when the triggering station was missing from the batch as of this state. */
  stale: boolean;
  risingSinceMs: number | null;
  fallingSinceMs: number | null;
  lastLevel: ExposureLevel | null;
  lastObservedAt: string | null;
}

export const INITIAL_RULE_STATE: RuleState = {
  active: false,
  triggeredAtMs: null,
  clearedAtMs: null,
  stale: false,
  risingSinceMs: null,
  fallingSinceMs: null,
  lastLevel: null,
  lastObservedAt: null,
};

/**
 * Field-by-field equality — used by `AlertEngineDO` to skip a `rule_state`
 * write when a tick produced no real change. A DO's SQLite `rows_written`
 * quota is finite (see `../durable-objects/observation-cache.ts`'s comment
 * on the same failure mode with the station tables); writing all ~300 rules
 * unconditionally on every 5-minute tick is the same blowout with a smaller
 * number. Deliberately no `lastSeenMs`/last-tick-timestamp field on
 * `RuleState` at all — a field that changes every tick by definition would
 * defeat this comparison and isn't read anywhere else in this module.
 */
export function ruleStatesEqual(a: RuleState, b: RuleState): boolean {
  return (
    a.active === b.active &&
    a.triggeredAtMs === b.triggeredAtMs &&
    a.clearedAtMs === b.clearedAtMs &&
    a.stale === b.stale &&
    a.risingSinceMs === b.risingSinceMs &&
    a.fallingSinceMs === b.fallingSinceMs &&
    a.lastLevel === b.lastLevel &&
    a.lastObservedAt === b.lastObservedAt
  );
}

export interface RuleTiming {
  alertAtLevel: AlertSeverityTier;
  minimumDurationMinutes: number;
  cooldownMinutes: number;
}

/**
 * One tick's transition. `station === undefined` means this rule's station
 * is missing from the current observation batch — held, not cleared.
 */
export function nextRuleState(
  rule: RuleTiming,
  station: StationExposure | undefined,
  prev: RuleState,
  nowMs: number,
): RuleState {
  if (!station) {
    // Missing this tick: hold everything, flag stale. No evidence either
    // way, so neither the rise nor the fall countdown may advance.
    return { ...prev, stale: true };
  }

  const usable = hasUsableFactors(station.factors);
  const meetsAlert = usable && EXPOSURE_LEVEL_RANK[station.level] >= EXPOSURE_LEVEL_RANK[rule.alertAtLevel];
  const durationMs = rule.minimumDurationMinutes * 60_000;
  const cooldownMs = rule.cooldownMinutes * 60_000;

  let { active, triggeredAtMs, clearedAtMs, risingSinceMs, fallingSinceMs } = prev;

  if (meetsAlert) {
    fallingSinceMs = null;
    if (risingSinceMs === null) risingSinceMs = nowMs;
    if (!active && nowMs - risingSinceMs >= durationMs && (clearedAtMs === null || nowMs - clearedAtMs >= cooldownMs)) {
      active = true;
      triggeredAtMs = nowMs;
    }
  } else {
    risingSinceMs = null;
    // Only a station that actually reported a usable factor counts as
    // evidence the tier was genuinely left — an all-null tick must not
    // advance this countdown (invariant 2 above).
    if (usable) {
      if (fallingSinceMs === null) fallingSinceMs = nowMs;
      if (active && nowMs - fallingSinceMs >= durationMs) {
        active = false;
        clearedAtMs = nowMs;
      }
    }
  }

  return {
    active,
    triggeredAtMs,
    clearedAtMs,
    stale: false,
    risingSinceMs,
    fallingSinceMs,
    lastLevel: station.level,
    lastObservedAt: station.observedAt,
  };
}
