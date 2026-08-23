import { describe, expect, it } from "vitest";
import type { StationExposure } from "@siahra/shared-types";
import { INITIAL_RULE_STATE, hasUsableFactors, nextRuleState, ruleStatesEqual, type RuleState, type RuleTiming } from "../../src/alerts/evaluate";

/**
 * E11.5 — fixture tests for the alert engine's pure hysteresis state machine
 * (`nextRuleState`). These exercise the decision logic directly, with no
 * Durable Object / SQL involved — see `test/alerts/alertEngine.test.ts` for
 * the same rules exercised through the real route + DO.
 */

const RULE: RuleTiming = { alertAtLevel: "high", minimumDurationMinutes: 30, cooldownMinutes: 60 };
const MIN = 60_000;
const T0 = Date.UTC(2026, 7, 20, 0, 0, 0);

function station(over: Partial<StationExposure> = {}): StationExposure {
  return {
    stationId: 21,
    stationKind: "waterlevel",
    provinceCode: "11",
    lat: 13.6,
    lon: 100.8,
    level: "severe",
    factors: {
      rain1hMm: null,
      rain24hMm: null,
      freeboardM: 0.1,
      freeboardTrendMPerH: null,
      situationLevel: 5,
    },
    observedAt: new Date(T0).toISOString(),
    latestObservedAt: new Date(T0).toISOString(),
    ...over,
  };
}

const allNullFactors = (): StationExposure["factors"] => ({
  rain1hMm: null,
  rain24hMm: null,
  freeboardM: null,
  freeboardTrendMPerH: null,
  situationLevel: null,
});

describe("nextRuleState — rising to active", () => {
  it("stays inactive before minimumDurationMinutes elapses, even while at/above the tier", () => {
    let state: RuleState = INITIAL_RULE_STATE;
    state = nextRuleState(RULE, station(), state, T0);
    expect(state.active).toBe(false);
    expect(state.risingSinceMs).toBe(T0);

    // 29 minutes later, still below the 30-minute bar
    state = nextRuleState(RULE, station({ observedAt: new Date(T0 + 29 * MIN).toISOString() }), state, T0 + 29 * MIN);
    expect(state.active).toBe(false);
  });

  it("activates once the tier has been sustained for minimumDurationMinutes", () => {
    let state: RuleState = INITIAL_RULE_STATE;
    state = nextRuleState(RULE, station(), state, T0);
    state = nextRuleState(RULE, station(), state, T0 + 30 * MIN);
    expect(state.active).toBe(true);
    expect(state.triggeredAtMs).toBe(T0 + 30 * MIN);
  });

  it("cooldown blocks an immediate re-trigger right after a real clear", () => {
    let state: RuleState = INITIAL_RULE_STATE;
    state = nextRuleState(RULE, station(), state, T0);
    state = nextRuleState(RULE, station(), state, T0 + 30 * MIN); // active
    expect(state.active).toBe(true);

    const lowStation = station({ level: "low", factors: { rain1hMm: null, rain24hMm: null, freeboardM: 5, freeboardTrendMPerH: null, situationLevel: 1 } });
    state = nextRuleState(RULE, lowStation, state, T0 + 60 * MIN);
    state = nextRuleState(RULE, lowStation, state, T0 + 90 * MIN); // cleared (30 min below tier)
    expect(state.active).toBe(false);
    expect(state.clearedAtMs).toBe(T0 + 90 * MIN);

    // Tier reached again immediately — but cooldownMinutes (60) has not elapsed since the clear
    state = nextRuleState(RULE, station(), state, T0 + 91 * MIN);
    state = nextRuleState(RULE, station(), state, T0 + 121 * MIN); // would be 30 min of rising, but…
    expect(state.active, "cooldown must still be blocking re-trigger").toBe(false);

    // Past cooldown (60 min since clearedAtMs) AND past minimumDurationMinutes of rising
    state = nextRuleState(RULE, station(), state, T0 + 151 * MIN);
    expect(state.active).toBe(true);
  });
});

describe("nextRuleState — invariant: missing from the batch holds, does not clear", () => {
  it("a station missing from the batch flags stale and leaves active/timers untouched", () => {
    const active: RuleState = {
      active: true,
      triggeredAtMs: T0,
      clearedAtMs: null,
      stale: false,
      risingSinceMs: T0,
      fallingSinceMs: null,
      lastLevel: "severe",
      lastObservedAt: new Date(T0).toISOString(),
    };
    const next = nextRuleState(RULE, undefined, active, T0 + 10 * MIN);
    expect(next.active).toBe(true);
    expect(next.stale).toBe(true);
    // Nothing else moved — same object contents modulo `stale`.
    expect(next.triggeredAtMs).toBe(active.triggeredAtMs);
    expect(next.risingSinceMs).toBe(active.risingSinceMs);
    expect(next.lastObservedAt).toBe(active.lastObservedAt);
  });

  it("reappearing (present again) clears the stale flag", () => {
    const stale: RuleState = {
      active: true,
      triggeredAtMs: T0,
      clearedAtMs: null,
      stale: true,
      risingSinceMs: T0,
      fallingSinceMs: null,
      lastLevel: "severe",
      lastObservedAt: new Date(T0).toISOString(),
    };
    const next = nextRuleState(RULE, station({ observedAt: new Date(T0 + 20 * MIN).toISOString() }), stale, T0 + 20 * MIN);
    expect(next.stale).toBe(false);
    expect(next.active).toBe(true);
  });
});

describe("nextRuleState — invariant: an all-null-factor reading is not evidence to clear", () => {
  it("hasUsableFactors is false when every ExposureFactors field is null", () => {
    expect(hasUsableFactors(allNullFactors())).toBe(false);
    expect(hasUsableFactors({ ...allNullFactors(), freeboardM: 1 })).toBe(true);
  });

  it("an active alert does NOT clear when the station reports but every factor is null, even after 30+ minutes", () => {
    let state: RuleState = INITIAL_RULE_STATE;
    state = nextRuleState(RULE, station(), state, T0);
    state = nextRuleState(RULE, station(), state, T0 + 30 * MIN); // active
    expect(state.active).toBe(true);

    // `levelOf()` in ../exposure/compute.ts would compute "low" for this station
    // (no usable factor) — the bug this invariant exists to prevent is treating
    // that "low" as real evidence the tier was left.
    const deadSensor = station({ level: "low", factors: allNullFactors() });
    for (let i = 1; i <= 6; i++) {
      state = nextRuleState(RULE, deadSensor, state, T0 + (30 + i * 10) * MIN);
    }
    expect(state.active, "an all-null reading must never clear an active alert").toBe(true);
    expect(state.fallingSinceMs, "the clear countdown must never start on no-evidence ticks").toBeNull();
  });
});

describe("ruleStatesEqual — the write-skip check AlertEngineDO relies on to stay inside the DO rows_written budget", () => {
  it("a repeated tick with the same observation (unchanged level/observedAt) produces an equal state — no write needed", () => {
    let state: RuleState = INITIAL_RULE_STATE;
    const first = nextRuleState(RULE, station(), state, T0);
    // Same station, same observedAt, later tick — nothing genuinely new.
    const second = nextRuleState(RULE, station(), first, T0 + 5 * MIN);
    expect(ruleStatesEqual(first, second), "an unchanged reading must not force a write").toBe(true);
  });

  it("a station that is missing two ticks in a row is equal on the second tick (stale already recorded once)", () => {
    const activeState: RuleState = {
      active: true,
      triggeredAtMs: T0,
      clearedAtMs: null,
      stale: false,
      risingSinceMs: T0,
      fallingSinceMs: null,
      lastLevel: "severe",
      lastObservedAt: new Date(T0).toISOString(),
    };
    const firstMissingTick = nextRuleState(RULE, undefined, activeState, T0 + 5 * MIN);
    expect(ruleStatesEqual(activeState, firstMissingTick), "stale just flipped — this tick must write").toBe(false);
    const secondMissingTick = nextRuleState(RULE, undefined, firstMissingTick, T0 + 10 * MIN);
    expect(ruleStatesEqual(firstMissingTick, secondMissingTick), "still missing, already flagged stale — no new write").toBe(true);
  });

  it("a new reading (different observedAt) is never equal, even at the same level", () => {
    let state: RuleState = INITIAL_RULE_STATE;
    const first = nextRuleState(RULE, station(), state, T0);
    const second = nextRuleState(RULE, station({ observedAt: new Date(T0 + 10 * MIN).toISOString() }), first, T0 + 10 * MIN);
    expect(ruleStatesEqual(first, second)).toBe(false);
  });
});

describe("nextRuleState — a genuine drop below the tier clears after minimumDurationMinutes", () => {
  it("clears once a real (non-null) reading stays below the tier for the full duration", () => {
    let state: RuleState = INITIAL_RULE_STATE;
    state = nextRuleState(RULE, station(), state, T0);
    state = nextRuleState(RULE, station(), state, T0 + 30 * MIN); // active
    expect(state.active).toBe(true);

    const lowStation = station({ level: "low", factors: { rain1hMm: null, rain24hMm: null, freeboardM: 5, freeboardTrendMPerH: null, situationLevel: 1 } });
    state = nextRuleState(RULE, lowStation, state, T0 + 40 * MIN);
    expect(state.active, "not yet 30 minutes below the tier").toBe(true);
    state = nextRuleState(RULE, lowStation, state, T0 + 70 * MIN);
    expect(state.active).toBe(false);
    expect(state.clearedAtMs).toBe(T0 + 70 * MIN);
  });
});
