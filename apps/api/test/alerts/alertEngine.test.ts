import { env, exports as workerExports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveAlertsResponse, StationRef, ThresholdRulesResponse, WaterLevelObservation } from "@siahra/shared-types";
import type { AppEnv } from "../../src/types";

/**
 * `AlertEngineDO` deliberately has NO read route that triggers an
 * evaluation (invariant 1 — see `src/durable-objects/alert-engine.ts`), so
 * unlike `RadarDO`/`FloodExtentDO` tests there is no GET request that arms
 * the first alarm.
 *
 * `ensureFresh()` is the exact method `scheduled()` calls
 * (`GET /__scheduled?cron=*+*+*+*+*` in dev), and is used below ONLY for the
 * very first tick — real crons fire every minute but `ensureFresh()` itself
 * throttles to once per `REFRESH_MS` (5 min), so calling it twice within the
 * same real-wall-clock test run would no-op the second time. `alarm()` is
 * the unconditional periodic evaluator (armed by the first `ensureFresh()`
 * and fired every 5 minutes in production) — every subsequent forced tick in
 * this file calls it directly, the same role `runDurableObjectAlarm` plays
 * in the other DOs' tests, just invoked without requiring a pre-armed timer.
 */
interface AlertEngineInternals {
  ensureFresh(): Promise<void>;
  alarm(): Promise<void>;
}
const runEnsureFresh = () =>
  runInDurableObject(alertStub(), (instance) => (instance as unknown as AlertEngineInternals).ensureFresh());
const runAlarmTick = () =>
  runInDurableObject(alertStub(), (instance) => (instance as unknown as AlertEngineInternals).alarm());

/**
 * E11.5 — the real HTTP route + `AlertEngineDO`, end to end.
 *
 * Uses a rule that is genuinely baked into `apps/api/src/data/alertRules.json`
 * (`alert-rule-waterlevel-21`, station 21 → TH-LAO-6110604, province 11) —
 * same precedent as `test/localAuthorityImpact*.test.ts` referencing real
 * `TH-LAO-*` ids. The "serves the real baked rule table" test below fails
 * loudly (not silently passes on nothing) if the rule table is ever rebuilt
 * without this station matching a boundary any more.
 */
const appEnv = env as unknown as AppEnv;
const obsStub = () => appEnv.OBSERVATION_CACHE.getByName("thaiwater");
const alertStub = () => appEnv.ALERT_ENGINE.getByName("primary");
const call = (path: string, init?: RequestInit) =>
  workerExports.default.fetch(new Request(`https://siahra-radar.co${path}`, init));

const RULE_ID = "alert-rule-waterlevel-21";
const STATION_ID = 21;
const LAO_ID = "TH-LAO-6110604";
const PROVINCE = "11";

function station(id: number, provinceCode: string): StationRef {
  return {
    id,
    nameTh: null,
    nameEn: null,
    lat: 13.64,
    lon: 100.8,
    provinceCode,
    provinceNameTh: null,
    amphoeNameTh: null,
    basinNameTh: null,
    agencyShortTh: null,
  };
}

function water(situationLevel: 1 | 5 | null, observedAt: string): WaterLevelObservation {
  return {
    station: station(STATION_ID, PROVINCE),
    waterlevelMsl: 5,
    waterlevelLocalM: null,
    minBankMsl: 9,
    groundLevelMsl: null,
    freeboardM: situationLevel === 5 ? 0.1 : situationLevel === 1 ? 5 : null,
    situationLevel,
    storagePercent: null,
    observedAt,
  };
}

async function seedWaterlevel(rows: WaterLevelObservation[], fetchedAtIso: string): Promise<void> {
  await runInDurableObject(obsStub(), (_instance, state) => {
    const sql = state.storage.sql;
    sql.exec("DELETE FROM waterlevel");
    for (const w of rows) {
      sql.exec(
        "INSERT OR REPLACE INTO waterlevel (station_id, province_code, situation_level, observed_at, payload) VALUES (?, ?, ?, ?, ?)",
        w.station.id,
        w.station.provinceCode,
        w.situationLevel,
        w.observedAt,
        JSON.stringify(w),
      );
    }
    sql.exec(
      "INSERT INTO meta (key, value) VALUES ('fetchedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      fetchedAtIso,
    );
  });
}

interface RuleStatePatch {
  active: boolean;
  triggeredAtMs: number | null;
  clearedAtMs: number | null;
  stale: boolean;
  risingSinceMs: number | null;
  fallingSinceMs: number | null;
  lastLevel: string | null;
  lastObservedAt: string | null;
}

async function seedRuleState(ruleId: string, p: RuleStatePatch): Promise<void> {
  await runInDurableObject(alertStub(), (_instance, state) => {
    state.storage.sql.exec(
      `INSERT INTO rule_state (rule_id, active, triggered_at_ms, cleared_at_ms, stale, rising_since_ms, falling_since_ms, last_level, last_observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(rule_id) DO UPDATE SET
         active = excluded.active, triggered_at_ms = excluded.triggered_at_ms, cleared_at_ms = excluded.cleared_at_ms,
         stale = excluded.stale, rising_since_ms = excluded.rising_since_ms, falling_since_ms = excluded.falling_since_ms,
         last_level = excluded.last_level, last_observed_at = excluded.last_observed_at`,
      ruleId,
      p.active ? 1 : 0,
      p.triggeredAtMs,
      p.clearedAtMs,
      p.stale ? 1 : 0,
      p.risingSinceMs,
      p.fallingSinceMs,
      p.lastLevel,
      p.lastObservedAt,
    );
  });
}

beforeEach(() => {
  // Same network-disabled discipline as health.test.ts — nothing here should
  // need to actually reach ThaiWater; seeding writes rows and a fresh
  // `fetchedAt` directly so `getObservations()` never calls `refresh()`.
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("network disabled in this test");
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/v1/alerts/rules", () => {
  it("serves the real baked rule table — no write endpoint exists anywhere", async () => {
    const res = await call("/api/v1/alerts/rules");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ThresholdRulesResponse;
    expect(body.total).toBeGreaterThan(0);
    expect(body.rules.some((r) => r.id === RULE_ID)).toBe(true);
  });

  it("POST /api/v1/alerts/evaluate does not exist — the reverted write endpoint stays gone", async () => {
    const res = await call("/api/v1/alerts/evaluate", { method: "POST", body: "" });
    expect(res.status).toBe(404);
  });

  it("stationId filter narrows to just that station's rule(s)", async () => {
    const res = await call(`/api/v1/alerts/rules?stationId=${STATION_ID}`);
    const body = (await res.json()) as ThresholdRulesResponse;
    expect(body.rules.every((r) => r.stationId === STATION_ID)).toBe(true);
    expect(body.rules.some((r) => r.id === RULE_ID)).toBe(true);
  });
});

describe("GET /api/v1/alerts/active — evaluatedAt honesty", () => {
  it("is null before the engine has ever evaluated, and a real ISO string after the alarm runs", async () => {
    const before = (await (await call("/api/v1/alerts/active")).json()) as ActiveAlertsResponse;
    expect(before.evaluatedAt).toBeNull();
    expect(before.total).toBe(0);

    await seedWaterlevel([water(1, new Date().toISOString())], new Date().toISOString());
    await runEnsureFresh();

    const after = (await (await call("/api/v1/alerts/active")).json()) as ActiveAlertsResponse;
    expect(after.evaluatedAt).not.toBeNull();
    expect(Date.parse(after.evaluatedAt!)).toBeLessThanOrEqual(Date.now());
  });
});

describe("GET /api/v1/alerts/active — missing station holds, does not clear (E11.5's headline case)", () => {
  it("an active alert whose station drops out of the observation batch stays active with stale: true", async () => {
    const now = Date.now();
    await seedRuleState(RULE_ID, {
      active: true,
      triggeredAtMs: now - 60 * 60_000,
      clearedAtMs: null,
      stale: false,
      risingSinceMs: now - 90 * 60_000,
      fallingSinceMs: null,
      lastLevel: "severe",
      lastObservedAt: new Date(now - 60 * 60_000).toISOString(),
    });
    // Station 21 is NOT in the waterlevel table this tick — genuinely missing.
    await seedWaterlevel([], new Date().toISOString());

    await runAlarmTick();

    const body = (await (await call(`/api/v1/alerts/active?localAuthorityId=${LAO_ID}`)).json()) as ActiveAlertsResponse;
    expect(body.total).toBe(1);
    expect(body.alerts[0].stale).toBe(true);
    expect(body.alerts[0].clearedAt).toBeNull();
    expect(body.alerts[0].provinceCode).toBe(PROVINCE);
    expect(body.alerts[0].localAuthorityId).toBe(LAO_ID);
  });

  it("localAuthorityId also accepts the bare DLA code (not just the full TH-LAO-* id) and still matches", async () => {
    // Regression: the route validates a bare dlaCode fine (getLocalAuthorityById
    // accepts both forms), but AlertEngineDO stores/compares full `TH-LAO-*`
    // ids only — a bare code that isn't normalised before being forwarded looks
    // like a valid, honoured filter and silently returns nothing.
    const bareDlaCode = LAO_ID.replace("TH-LAO-", "");
    const res = await call(`/api/v1/alerts/active?localAuthorityId=${bareDlaCode}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActiveAlertsResponse;
    expect(body.total, "a bare dlaCode must resolve to the same alert as the full TH-LAO-* id").toBe(1);
    expect(body.alerts[0].localAuthorityId).toBe(LAO_ID);
  });

  it("an unknown localAuthorityId is rejected with 404, not silently accepted", async () => {
    const res = await call("/api/v1/alerts/active?localAuthorityId=TH-LAO-0000000");
    expect(res.status).toBe(404);
  });

  it("filters by province the same way, and rejects a province code that is not real", async () => {
    const res = await call(`/api/v1/alerts/active?province=${PROVINCE}`);
    const body = (await res.json()) as ActiveAlertsResponse;
    expect(body.alerts.some((a) => a.ruleId === RULE_ID)).toBe(true);

    const bad = await call("/api/v1/alerts/active?province=99");
    expect(bad.status).toBe(400);
  });

  it("the station reappearing clears the stale flag (still held active until it genuinely drops below the tier)", async () => {
    await seedWaterlevel([water(5, new Date().toISOString())], new Date().toISOString());
    await runAlarmTick();

    const body = (await (await call(`/api/v1/alerts/active?localAuthorityId=${LAO_ID}`)).json()) as ActiveAlertsResponse;
    expect(body.total).toBe(1);
    expect(body.alerts[0].stale).toBe(false);
  });

  it("a real, sustained drop below the tier clears the alert for real", async () => {
    const now = Date.now();
    // Pretend the falling countdown already started 31 minutes ago — the
    // alarm tick below supplies the confirming low reading.
    await seedRuleState(RULE_ID, {
      active: true,
      triggeredAtMs: now - 120 * 60_000,
      clearedAtMs: null,
      stale: false,
      risingSinceMs: null,
      fallingSinceMs: now - 31 * 60_000,
      lastLevel: "low",
      lastObservedAt: new Date(now - 31 * 60_000).toISOString(),
    });
    await seedWaterlevel([water(1, new Date().toISOString())], new Date().toISOString());

    await runAlarmTick();

    const body = (await (await call(`/api/v1/alerts/active?localAuthorityId=${LAO_ID}`)).json()) as ActiveAlertsResponse;
    expect(body.total, "a genuine sustained drop below the tier must clear the alert").toBe(0);
  });
});

describe("status() — an active row whose rule no longer exists stays visible, not silently dropped", () => {
  it("counts an orphaned active row separately, rather than folding it into activeAlerts or hiding it entirely", async () => {
    // A rule_state row for an id that has never been (and never will be) in
    // ALERT_RULES — simulates a rule-table rebuild that dropped a station
    // while it had an active alert. getActiveAlerts() correctly can't
    // describe this row (no rule left to name a อปท./level/version with) and
    // skips it — but status() must still say it exists, or the row becomes
    // permanently invisible everywhere (evaluate() only ever touches rows in
    // the current ALERT_RULES, so nothing will clear it on its own).
    await seedRuleState("orphan-rule-not-in-table", {
      active: true,
      triggeredAtMs: Date.now() - 60 * 60_000,
      clearedAtMs: null,
      stale: false,
      risingSinceMs: null,
      fallingSinceMs: null,
      lastLevel: "high",
      lastObservedAt: new Date().toISOString(),
    });

    const status = await alertStub().status();
    expect(status.detail?.orphanedActiveRows).toBe(1);

    // Not counted as a real, describable alert on the read surface a client
    // actually renders — this is the "correctly can't describe it" half.
    const active = (await (await call("/api/v1/alerts/active")).json()) as ActiveAlertsResponse;
    expect(active.alerts.some((a) => a.ruleId === "orphan-rule-not-in-table")).toBe(false);
  });
});
