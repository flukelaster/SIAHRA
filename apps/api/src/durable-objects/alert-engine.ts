import { DurableObject } from "cloudflare:workers";
import type {
  ActiveAlertsResponse,
  AlertEvent,
  ThresholdRule,
  ThresholdRulesResponse,
} from "@siahra/shared-types";
import { evaluateRule, THRESHOLD_RULES } from "../data/thresholdRules.js";

interface AlertRow extends Record<string, SqlStorageValue> {
  id: string;
  rule_id: string;
  rule_version: string;
  local_authority_id: string;
  province_code: string;
  severity: string;
  triggered_at: string;
  reason_th: string;
  reason_en: string;
  input_snapshot: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
}

interface MetaRow extends Record<string, SqlStorageValue> {
  value: string;
}

export class AlertEngineDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS active_alerts (
          id TEXT PRIMARY KEY,
          rule_id TEXT NOT NULL,
          rule_version TEXT NOT NULL,
          local_authority_id TEXT NOT NULL,
          province_code TEXT NOT NULL,
          severity TEXT NOT NULL,
          triggered_at TEXT NOT NULL,
          reason_th TEXT NOT NULL,
          reason_en TEXT NOT NULL,
          input_snapshot TEXT NOT NULL,
          acknowledged_by TEXT,
          acknowledged_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_active_province ON active_alerts(province_code);
        CREATE INDEX IF NOT EXISTS idx_active_lao ON active_alerts(local_authority_id);

        CREATE TABLE IF NOT EXISTS alert_audit_log (
          id TEXT PRIMARY KEY,
          alert_id TEXT NOT NULL,
          rule_id TEXT NOT NULL,
          local_authority_id TEXT NOT NULL,
          province_code TEXT NOT NULL,
          severity TEXT NOT NULL,
          triggered_at TEXT NOT NULL,
          cleared_at TEXT,
          reason_th TEXT NOT NULL,
          reason_en TEXT NOT NULL,
          input_snapshot TEXT NOT NULL,
          acknowledged_by TEXT,
          acknowledged_at TEXT
        );

        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
    });
  }

  private readMeta(key: string): string | null {
    return (
      this.ctx.storage.sql.exec<MetaRow>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]
        ?.value ?? null
    );
  }

  private writeMeta(key: string, value: string | null): void {
    if (value === null) this.ctx.storage.sql.exec("DELETE FROM meta WHERE key = ?", key);
    else
      this.ctx.storage.sql.exec(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        key,
        value,
      );
  }

  private rowToAlert(row: AlertRow): AlertEvent {
    return {
      id: row.id,
      ruleId: row.rule_id,
      ruleVersion: row.rule_version,
      localAuthorityId: row.local_authority_id,
      provinceCode: row.province_code,
      severity: row.severity as AlertEvent["severity"],
      triggeredAt: row.triggered_at,
      clearedAt: null,
      reasonTh: row.reason_th,
      reasonEn: row.reason_en,
      inputSnapshot: JSON.parse(row.input_snapshot) as Record<string, number | null>,
      acknowledgedBy: row.acknowledged_by ?? undefined,
      acknowledgedAt: row.acknowledged_at ?? undefined,
    };
  }

  /**
   * Evaluates station telemetry readings against all threshold rules deterministically.
   */
  async evaluateTelemetry(
    stationReadings: Array<{ stationId: number; telemetry: Record<string, number | null> }>,
    nowIso = new Date().toISOString(),
  ): Promise<ActiveAlertsResponse> {
    const readingMap = new Map<number, Record<string, number | null>>(
      stationReadings.map((r) => [r.stationId, r.telemetry]),
    );

    // Get currently active rule IDs
    const currentRows = this.ctx.storage.sql.exec<AlertRow>("SELECT * FROM active_alerts").toArray();
    const activeRuleIds = new Set<string>(currentRows.map((r) => r.rule_id));

    const newlyTriggered: AlertEvent[] = [];
    const activeRuleIdsAfterEval = new Set<string>();

    for (const rule of THRESHOLD_RULES) {
      const telemetry = readingMap.get(rule.stationId);
      if (!telemetry) continue;

      const events = evaluateRule(rule, telemetry, activeRuleIds, nowIso);
      if (events.length > 0) {
        newlyTriggered.push(...events);
        activeRuleIdsAfterEval.add(rule.id);
      }
    }

    // Identify cleared rules that were active before but not in newlyTriggered
    for (const oldRow of currentRows) {
      if (!activeRuleIdsAfterEval.has(oldRow.rule_id)) {
        // Rule has cleared due to hysteresis!
        // Record in audit log
        this.ctx.storage.sql.exec(
          `INSERT INTO alert_audit_log (
            id, alert_id, rule_id, local_authority_id, province_code, severity,
            triggered_at, cleared_at, reason_th, reason_en, input_snapshot, acknowledged_by, acknowledged_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          `AUDIT-${oldRow.id}-${Date.now()}`,
          oldRow.id,
          oldRow.rule_id,
          oldRow.local_authority_id,
          oldRow.province_code,
          oldRow.severity,
          oldRow.triggered_at,
          nowIso,
          oldRow.reason_th,
          oldRow.reason_en,
          oldRow.input_snapshot,
          oldRow.acknowledged_by,
          oldRow.acknowledged_at,
        );

        // Delete from active_alerts
        this.ctx.storage.sql.exec("DELETE FROM active_alerts WHERE id = ?", oldRow.id);
      }
    }

    // Insert or update newly triggered active alerts
    for (const ev of newlyTriggered) {
      this.ctx.storage.sql.exec(
        `INSERT INTO active_alerts (
          id, rule_id, rule_version, local_authority_id, province_code, severity,
          triggered_at, reason_th, reason_en, input_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          severity = excluded.severity,
          input_snapshot = excluded.input_snapshot`,
        ev.id,
        ev.ruleId,
        ev.ruleVersion,
        ev.localAuthorityId,
        ev.provinceCode,
        ev.severity,
        ev.triggeredAt,
        ev.reasonTh,
        ev.reasonEn,
        JSON.stringify(ev.inputSnapshot),
      );
    }

    this.writeMeta("lastEvaluatedAt", nowIso);
    return this.getActiveAlerts();
  }

  /**
   * Retrieves active alert events with optional filtering.
   */
  async getActiveAlerts(filter?: {
    provinceCode?: string;
    localAuthorityId?: string;
  }): Promise<ActiveAlertsResponse> {
    let query = "SELECT * FROM active_alerts";
    const params: SqlStorageValue[] = [];

    if (filter?.provinceCode) {
      query += " WHERE province_code = ?";
      params.push(filter.provinceCode);
    } else if (filter?.localAuthorityId) {
      query += " WHERE local_authority_id = ?";
      params.push(filter.localAuthorityId);
    }

    const rows = this.ctx.storage.sql.exec<AlertRow>(query, ...params).toArray();
    const evaluatedAt = this.readMeta("lastEvaluatedAt") ?? new Date().toISOString();

    return {
      total: rows.length,
      evaluatedAt,
      alerts: rows.map((r) => this.rowToAlert(r)),
    };
  }

  /**
   * Retrieves threshold rules.
   */
  async getRules(filter?: { stationId?: number; basinCode?: string }): Promise<ThresholdRulesResponse> {
    let rules: ThresholdRule[] = [...THRESHOLD_RULES];

    if (filter?.stationId) {
      rules = rules.filter((r) => r.stationId === filter.stationId);
    }
    if (filter?.basinCode) {
      rules = rules.filter((r) => r.basinCode === filter.basinCode);
    }

    return {
      total: rules.length,
      rules,
    };
  }

  /**
   * Acknowledges an active alert.
   */
  async acknowledgeAlert(alertId: string, author: string): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const res = this.ctx.storage.sql.exec(
      "UPDATE active_alerts SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ?",
      author,
      nowIso,
      alertId,
    );
    return res.rowsWritten > 0;
  }
}
