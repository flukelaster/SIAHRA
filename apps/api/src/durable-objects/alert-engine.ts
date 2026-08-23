import { DurableObject } from "cloudflare:workers";
import {
  SOURCES,
  type ActiveAlertsResponse,
  type AlertEvent,
  type ObservationsResponse,
  type SourceStatus,
  type StationExposure,
  type ThresholdRule,
  type ThresholdRulesResponse,
} from "@siahra/shared-types";
import { INITIAL_RULE_STATE, nextRuleState, ruleStatesEqual, type RuleState } from "../alerts/evaluate.js";
import { ALERT_RULES, ALERT_RULES_DROPPED_COUNT, queryAlertRules } from "../data/alertRules.js";
import { getLocalAuthorityById } from "../data/localAuthorities.js";
import { DEFAULT_EXPOSURE_THRESHOLDS, computeExposure, type StationHourlyLevels } from "../exposure/compute.js";
import { deriveSourceHealth } from "../sourceHealth.js";
import { errorText, logError, logInfo } from "../log.js";
import { META_TABLE_DDL, readMeta, writeMeta } from "./metaKv.js";

/**
 * Threshold/alert engine (E11.5) — binds real ThaiWater stations to real
 * local authorities and reports when a station's computed `ExposureLevel`
 * (from `../exposure/compute.ts`, the same cited threshold table the
 * flood-exposure layer uses) reaches a declared tier for `minimumDurationMinutes`.
 *
 * REPLACES a fully-reverted implementation. See `packages/shared-types/src/threshold.ts`
 * for the full list of what that version got wrong and what every rule here
 * must never repeat: invented station ids, invented numeric trigger values,
 * `evaluatedAt` backdated to "now", and — the one this DO structurally cannot
 * reproduce because there is no write route at all — an unauthenticated
 * evaluate endpoint that could wipe every active alert.
 *
 * Three invariants this file exists to hold:
 * 1. **Evaluation only happens in `alarm()`/`ensureFresh()`**, both driven by
 *    the cron via `scheduled()` (see `src/index.ts`). `getActiveAlerts()`,
 *    `getRules()` and `status()` are pure reads of already-computed state —
 *    calling `ensureFresh()` from a read path would make `evaluatedAt: null`
 *    unobservable (the first GET would silently evaluate).
 * 2. **A station missing from the current observation batch holds its alert,
 *    it does not clear it** — `stale: true`, `active` untouched. A real clear
 *    needs the station to report again and genuinely drop below the tier.
 * 3. **A station that reports with every `ExposureFactors` field `null`
 *    counts as "no evidence", not as `low`.** `levelOf()` in `../exposure/compute.ts`
 *    documents that an all-null station gets `level: "low"` — a real, useful
 *    default for the exposure map, but fatal here: clearing on that alone
 *    would be the same silent-wipe bug this DO exists to replace, just paced
 *    by a dead sensor instead of an empty POST body. See `hasUsableFactors()`.
 */

/** Evaluate every 5 minutes — frequent enough against a 30-minute hysteresis window. */
const REFRESH_MS = 5 * 60 * 1000;
const RETRY_BASE_MS = 2 * 60 * 1000;
const RETRY_MAX_MS = 15 * 60 * 1000;
/** No successful evaluation for this long ⇒ the engine itself is stale (distinct from any one alert's `stale`). */
const STALE_AFTER_MS = 30 * 60 * 1000;

interface RuleStateRow extends Record<string, SqlStorageValue> {
  rule_id: string;
  active: number;
  triggered_at_ms: number | null;
  cleared_at_ms: number | null;
  stale: number;
  rising_since_ms: number | null;
  falling_since_ms: number | null;
  last_level: string | null;
  last_observed_at: string | null;
}

export class AlertEngineDO extends DurableObject<Env> {
  private inflight: Promise<boolean> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS rule_state (
          rule_id TEXT PRIMARY KEY,
          active INTEGER NOT NULL DEFAULT 0,
          triggered_at_ms INTEGER,
          cleared_at_ms INTEGER,
          stale INTEGER NOT NULL DEFAULT 0,
          rising_since_ms INTEGER,
          falling_since_ms INTEGER,
          last_level TEXT,
          last_observed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_rule_state_active ON rule_state(active);
        ${META_TABLE_DDL}
      `);
    });
  }

  private readMeta(key: string): string | null {
    return readMeta(this.ctx.storage.sql, key);
  }

  private writeMeta(key: string, value: string | null): void {
    writeMeta(this.ctx.storage.sql, key, value);
  }

  private failureCount(): number {
    return Number(this.readMeta("failureCount") ?? "0");
  }

  private async armAlarm(delay = REFRESH_MS): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== null && existing > Date.now()) return;
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }

  /** ระยะรอครั้งถัดไปเมื่อล้มติดกัน n ครั้ง: 2m, 4m, 8m, 15m… (+jitter) — เหมือน FloodExtentDO */
  private backoffMs(failures: number): number {
    const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));
    return Math.min(RETRY_MAX_MS, Math.round(base * (0.85 + Math.random() * 0.3)));
  }

  async alarm(): Promise<void> {
    const ok = await this.evaluateOnce();
    await this.armAlarm(ok ? REFRESH_MS : this.backoffMs(this.failureCount()));
  }

  /**
   * The ONLY entry point that may run an evaluation from outside `alarm()` —
   * and it is only ever called from `scheduled()` (see `src/index.ts`), never
   * from a GET route. A read route calling this would make `evaluatedAt`
   * flip from `null` to "now" on the very first request after deploy, which
   * is exactly the dishonest render this DO's contract forbids.
   */
  async ensureFresh(): Promise<void> {
    const nowMs = Date.now();
    const lastAttempt = this.readMeta("lastAttemptAt");
    const lastAttemptMs = lastAttempt ? Date.parse(lastAttempt) : NaN;
    const due = !Number.isFinite(lastAttemptMs) || nowMs - lastAttemptMs >= REFRESH_MS;
    if (due) await this.evaluateOnce();
    await this.armAlarm(this.readMeta("evaluatedAt") === null ? this.backoffMs(this.failureCount()) : REFRESH_MS);
  }

  private evaluateOnce(): Promise<boolean> {
    if (!this.inflight) {
      this.inflight = this.evaluate(Date.now()).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /**
   * One evaluation tick. Returns `false` (and leaves `evaluatedAt` and every
   * `rule_state` row untouched) when reading the observation cache itself
   * failed — that is an ATTEMPT, not an evaluation, and AGENTS.md's "never
   * state a source's condition unless it was actually probed" applies: we
   * could not ask, so we say nothing new, rather than silently reporting
   * `total: 0` next to a freshly-bumped `evaluatedAt`.
   */
  private async evaluate(nowMs: number): Promise<boolean> {
    this.writeMeta("lastAttemptAt", new Date(nowMs).toISOString());
    const stub = this.env.OBSERVATION_CACHE.getByName("thaiwater");
    let observations: ObservationsResponse;
    let hourlyLevels: StationHourlyLevels[];
    try {
      observations = await stub.getObservations();
      // ใช้ history window เดียวกับที่ exposure-illustrative ใช้จริง เพื่อให้
      // ระดับที่ engine นี้คำนวณกับระดับที่ /api/v1/provinces/{NN}/exposure/latest
      // รายงานสำหรับสถานีเดียวกันตรงกันเป๊ะ ไม่ใช่คนละคำตอบสำหรับสถานีเดียวกัน
      hourlyLevels = await stub.getExposureHistory(DEFAULT_EXPOSURE_THRESHOLDS.historyWindowH);
    } catch (err) {
      const failures = this.failureCount() + 1;
      this.writeMeta("failureCount", String(failures));
      this.writeMeta("lastError", String(err).slice(0, 300));
      logError("alert engine failed to read observations", {
        error: errorText(err),
        consecutiveFailures: failures,
      });
      return false;
    }

    const run = computeExposure(
      {
        rainfall: observations.rainfall,
        waterlevel: observations.waterlevel,
        fetchedAt: observations.summary.fetchedAt,
      },
      hourlyLevels,
      DEFAULT_EXPOSURE_THRESHOLDS,
      new Date(nowMs),
    );
    const byKey = new Map<string, StationExposure>(run.stations.map((s) => [`${s.stationKind}:${s.stationId}`, s]));

    for (const rule of ALERT_RULES) {
      this.evaluateRule(rule, byKey.get(`${rule.stationKind}:${rule.stationId}`), nowMs);
    }

    this.writeMeta("evaluatedAt", new Date(nowMs).toISOString());
    this.writeMeta("lastError", null);
    this.writeMeta("failureCount", "0");
    logInfo("alert engine evaluated", { rules: ALERT_RULES.length, thaiwaterFetchedAt: observations.summary.fetchedAt });
    return true;
  }

  private readRuleState(ruleId: string): RuleState {
    const row = this.ctx.storage.sql.exec<RuleStateRow>("SELECT * FROM rule_state WHERE rule_id = ?", ruleId).toArray()[0];
    if (!row) return INITIAL_RULE_STATE;
    return {
      active: row.active === 1,
      triggeredAtMs: row.triggered_at_ms,
      clearedAtMs: row.cleared_at_ms,
      stale: row.stale === 1,
      risingSinceMs: row.rising_since_ms,
      fallingSinceMs: row.falling_since_ms,
      lastLevel: row.last_level as RuleState["lastLevel"],
      lastObservedAt: row.last_observed_at,
    };
  }

  private writeRuleState(ruleId: string, state: RuleState): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO rule_state (rule_id, active, triggered_at_ms, cleared_at_ms, stale, rising_since_ms, falling_since_ms, last_level, last_observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(rule_id) DO UPDATE SET
         active = excluded.active,
         triggered_at_ms = excluded.triggered_at_ms,
         cleared_at_ms = excluded.cleared_at_ms,
         stale = excluded.stale,
         rising_since_ms = excluded.rising_since_ms,
         falling_since_ms = excluded.falling_since_ms,
         last_level = excluded.last_level,
         last_observed_at = excluded.last_observed_at`,
      ruleId,
      state.active ? 1 : 0,
      state.triggeredAtMs,
      state.clearedAtMs,
      state.stale ? 1 : 0,
      state.risingSinceMs,
      state.fallingSinceMs,
      state.lastLevel,
      state.lastObservedAt,
    );
  }

  /**
   * One rule's hysteresis state machine for one tick — the SQL read/write
   * around the pure transition in `../alerts/evaluate.ts` (`nextRuleState`),
   * which is what carries the actual decision logic and is what the fixture
   * tests in `test/alerts/evaluate.test.ts` exercise directly.
   *
   * Skips the write entirely when nothing changed (`ruleStatesEqual`) — a
   * DO's SQLite `rows_written` quota is finite (see `observation-cache.ts`'s
   * comment on the exact same failure mode with the station tables), and
   * ~300 rules unconditionally upserted on every 5-minute tick would eat a
   * meaningful share of it for no benefit: most stations report unchanged
   * readings between one tick and the next.
   */
  private evaluateRule(rule: ThresholdRule, station: StationExposure | undefined, nowMs: number): void {
    const prev = this.readRuleState(rule.id);
    const next = nextRuleState(rule, station, prev, nowMs);
    if (ruleStatesEqual(prev, next)) return;
    this.writeRuleState(rule.id, next);
  }

  /**
   * Pure read: every currently-active alert, fanned out one record per
   * `ThresholdRule.affectedLocalAuthorityIds` entry. Never triggers an
   * evaluation — see invariant 1 in the file header.
   */
  async getActiveAlerts(filter: { provinceCode?: string; localAuthorityId?: string } = {}): Promise<ActiveAlertsResponse> {
    const evaluatedAt = this.readMeta("evaluatedAt");
    const rows = this.ctx.storage.sql.exec<RuleStateRow>("SELECT * FROM rule_state WHERE active = 1").toArray();
    const alerts: AlertEvent[] = [];
    for (const row of rows) {
      const rule = ALERT_RULES.find((r) => r.id === row.rule_id);
      // Rule table baked into the running Worker no longer names this rule
      // (e.g. redeployed with a smaller table) — nothing left to describe an
      // alert with, so it is skipped here rather than shown with fabricated
      // fields. The next evaluation tick will naturally stop touching this row.
      if (!rule) continue;
      for (const localAuthorityId of rule.affectedLocalAuthorityIds) {
        const authority = getLocalAuthorityById(localAuthorityId);
        if (!authority) continue;
        alerts.push({
          // Folds `triggered_at_ms` in so a re-trigger after a genuine clear
          // gets a NEW id, matching `AlertEvent.id`'s doc comment in
          // packages/shared-types/src/threshold.ts ("a new episode after a
          // real clear gets a new id") — E11.6 can use this as a stable
          // React key / dedup key without collapsing two distinct episodes.
          id: `${rule.id}:${localAuthorityId}:${row.triggered_at_ms as number}`,
          ruleId: rule.id,
          ruleVersion: rule.version,
          localAuthorityId,
          provinceCode: authority.provinceCode,
          level: rule.alertAtLevel,
          // active === 1 is only ever set alongside triggered_at_ms in the
          // same write (see evaluateRule) — never null on an active row.
          triggeredAt: new Date(row.triggered_at_ms as number).toISOString(),
          clearedAt: null,
          stale: row.stale === 1,
          inputSnapshot: {
            stationId: rule.stationId,
            level: row.last_level ?? rule.alertAtLevel,
            observedAt: row.last_observed_at,
          },
        });
      }
    }
    const filtered = alerts.filter(
      (a) =>
        (filter.provinceCode === undefined || a.provinceCode === filter.provinceCode) &&
        (filter.localAuthorityId === undefined || a.localAuthorityId === filter.localAuthorityId),
    );
    return { total: filtered.length, evaluatedAt, alerts: filtered };
  }

  /** Pure read of the baked rule table — no storage access, no evaluation. */
  async getRules(filter: { stationId?: number } = {}): Promise<ThresholdRulesResponse> {
    const rules = queryAlertRules(filter);
    return { total: rules.length, rules };
  }

  async status(): Promise<SourceStatus> {
    const nowMs = Date.now();
    const evaluatedAt = this.readMeta("evaluatedAt");
    const lastError = this.readMeta("lastError");
    // ห้ามใช้ `evaluatedAt` เป็น `latestObservedAt` — สัญญาของฟิลด์นี้คือ "เวลา
    // ตรวจวัดใหม่สุดที่ถืออยู่จริง" ไม่ใช่เวลาที่ engine รันรอบล่าสุด (สถานีทุกตัว
    // อาจรายงานครั้งสุดท้ายเมื่อสามชั่วโมงก่อน แต่ evaluate() ยังรันทุก 5 นาที) —
    // ค่าจริงคือ MAX ของ last_observed_at ที่เก็บไว้จริงในตาราง
    const latestObservedAt =
      this.ctx.storage.sql
        .exec<{ v: string | null }>("SELECT MAX(last_observed_at) AS v FROM rule_state")
        .toArray()[0]?.v ?? null;
    const health = deriveSourceHealth({
      nowMs,
      fetchedAt: evaluatedAt,
      lastError,
      latestObservedAt,
      staleAfterSeconds: STALE_AFTER_MS / 1000,
      // การประเมินคือ "เหตุการณ์วัด" ของชั้นนี้เอง ไม่มีคาบตรวจวัดต้นทางแยกต่างหาก
      // ให้เทียบ — `staleAfterSeconds` ครอบคลุม "ไม่ได้รันมานาน" อยู่แล้ว
      observedLagSeconds: null,
    });
    const activeCount = Number(
      this.ctx.storage.sql.exec<{ c: number }>("SELECT COUNT(*) AS c FROM rule_state WHERE active = 1").toArray()[0]?.c ?? 0,
    );
    const staleActiveCount = Number(
      this.ctx.storage.sql
        .exec<{ c: number }>("SELECT COUNT(*) AS c FROM rule_state WHERE active = 1 AND stale = 1")
        .toArray()[0]?.c ?? 0,
    );
    // getActiveAlerts() skips a rule_state row whose rule_id no longer names a
    // baked rule (e.g. after a rule-table rebuild drops a station) — real,
    // permanent (evaluate() only ever touches rows in ALERT_RULES again), and
    // must stay visible somewhere rather than only widening activeCount's gap
    // from what /alerts/active reports. Filtering activeCount the same way
    // would make the two surfaces agree by hiding the row from both, which is
    // the silent-disappearance AGENTS.md forbids — so it is its own counter.
    const knownRuleIds = new Set(ALERT_RULES.map((r) => r.id));
    const activeRuleIds = this.ctx.storage.sql
      .exec<{ rule_id: string }>("SELECT rule_id FROM rule_state WHERE active = 1")
      .toArray();
    const orphanedActiveRows = activeRuleIds.filter((r) => !knownRuleIds.has(r.rule_id)).length;
    const alarmAtMs = await this.ctx.storage.getAlarm();
    return {
      id: "alert-engine",
      labelTh: SOURCES["alert-engine"].nameTh,
      labelEn: SOURCES["alert-engine"].nameEn,
      health,
      fetchedAt: evaluatedAt,
      latestObservedAt,
      lastAttemptAt: this.readMeta("lastAttemptAt"),
      lastError,
      detail: {
        rules: ALERT_RULES.length,
        droppedRules: ALERT_RULES_DROPPED_COUNT,
        activeAlerts: activeCount,
        staleActiveAlerts: staleActiveCount,
        orphanedActiveRows,
        consecutiveFailures: this.failureCount(),
      },
      staleAfterSeconds: STALE_AFTER_MS / 1000,
      observedLagSeconds: null,
      nextAttemptAt: alarmAtMs === null ? null : new Date(alarmAtMs).toISOString(),
    };
  }
}
