import { describe, expect, it } from "vitest";
import type { ActiveAlertsResponse, AlertEvent } from "@siahra/shared-types";
import { alertRailBadge, alertToastState } from "./alertSummary";

const alert = (id: string): AlertEvent =>
  ({ id, localAuthorityId: "la-1", level: "warning", triggeredAt: "2026-08-25T00:00:00Z", stale: false }) as unknown as AlertEvent;

const evaluated = (alerts: AlertEvent[]): ActiveAlertsResponse => ({
  total: alerts.length,
  evaluatedAt: "2026-08-25T01:00:00Z",
  alerts,
});
const neverEvaluated: ActiveAlertsResponse = { total: 0, evaluatedAt: null, alerts: [] };
const err = { key: "error.loadFailed" } as const;

describe("alertSummary — toast และ badge มาจากการตัดสินเดียวกัน", () => {
  it("กำลังโหลด ยังไม่มีอะไรเลย → ไม่มี toast ไม่มี badge", () => {
    const s = { data: null, loading: true, error: null };
    expect(alertToastState(s)).toBeNull();
    expect(alertRailBadge(s)).toBeNull();
  });

  it("error && !data = ติดต่อไม่ได้ (คนละเรื่องกับ 'ยังไม่เคยประเมิน')", () => {
    const s = { data: null, loading: false, error: err };
    expect(alertToastState(s)).toEqual({ kind: "unreachable" });
    expect(alertRailBadge(s)).toEqual({ kind: "unreachable" });
  });

  it("error && data = เสื่อม: รายการที่เห็นมาจากรอบก่อน", () => {
    const s = { data: evaluated([alert("a")]), loading: false, error: err };
    expect(alertToastState(s)).toEqual({ kind: "degraded", n: 1 });
    expect(alertRailBadge(s)).toEqual({ kind: "degraded" });
    // ไม่มีรายการค้างก็ยังเสื่อม — "ไม่มีอะไร active" ของรอบก่อนอาจไม่จริงแล้ว
    const empty = { data: evaluated([]), loading: false, error: err };
    expect(alertToastState(empty)).toEqual({ kind: "degraded", n: 0 });
    expect(alertRailBadge(empty)).toEqual({ kind: "degraded" });
  });

  it("evaluatedAt === null = ยังไม่เคยประเมิน → badge '?' แต่ไม่มี toast", () => {
    const s = { data: neverEvaluated, loading: false, error: null };
    expect(alertToastState(s)).toBeNull();
    expect(alertRailBadge(s)).toEqual({ kind: "neverEvaluated" });
  });

  it("ประเมินแล้ว ไม่มีอะไร active → เงียบทั้งคู่", () => {
    const s = { data: evaluated([]), loading: false, error: null };
    expect(alertToastState(s)).toBeNull();
    expect(alertRailBadge(s)).toBeNull();
  });

  it("มีรายการ active → toast และ badge บอกจำนวนเดียวกัน", () => {
    const s = { data: evaluated([alert("a"), alert("b"), alert("c")]), loading: false, error: null };
    expect(alertToastState(s)).toEqual({ kind: "active", n: 3 });
    expect(alertRailBadge(s)).toEqual({ kind: "count", n: 3 });
  });
});
