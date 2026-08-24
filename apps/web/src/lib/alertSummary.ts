import type { ActiveAlertsResponse } from "@siahra/shared-types";

/**
 * สรุปสถานะการแจ้งเตือน อปท. ให้ toast บนแผนที่และ badge บน rail/แท็บ —
 * **จุดตัดสินเดียว** สำหรับทั้งสองที่ จะได้ไม่มีวันขัดกันเอง และตีความสี่สถานะ
 * ตามกติกาเดียวกับ `ActiveAlertBanner.tsx` (ดูคำอธิบายยาวที่นั่น):
 *
 *   - `error && !data`  = ติดต่อเอนจินไม่ได้ (ไม่มีอะไรค้างให้แสดงเลย)
 *   - `error && data`   = รอบล่าสุดดึงพลาด แต่ยังมีคำตอบรอบก่อนค้างอยู่ → อาจไม่ทันปัจจุบัน
 *   - `evaluatedAt === null` = ตอบสำเร็จแต่เอนจินยังไม่เคยประเมินเลย → "?" ไม่ใช่ "ไม่มี"
 *   - `alerts.length > 0`    = มีรายการ active จริง
 *
 * รับเฉพาะสามฟิลด์ที่ใช้ ไม่ผูกกับ hook ทั้งตัว จึงเทสได้แบบ pure
 */
export interface AlertSummaryInput {
  data: ActiveAlertsResponse | null;
  loading: boolean;
  error: unknown;
}

export type AlertToastState =
  | { kind: "active"; n: number }
  | { kind: "unreachable" }
  | { kind: "degraded"; n: number }
  | null;

export type AlertRailBadge =
  | { kind: "count"; n: number }
  | { kind: "unreachable" }
  | { kind: "degraded" }
  | { kind: "neverEvaluated" }
  | null;

/** toast โผล่เฉพาะเรื่องที่ผู้ใช้ต้องรู้แม้ drawer ปิดอยู่: มี active / ติดต่อไม่ได้ / เสื่อม */
export function alertToastState({ data, error }: AlertSummaryInput): AlertToastState {
  if (error && !data) return { kind: "unreachable" };
  if (error && data) return { kind: "degraded", n: data.alerts.length };
  if (!data) return null;
  if (data.evaluatedAt === null) return null;
  if (data.alerts.length > 0) return { kind: "active", n: data.alerts.length };
  return null;
}

/** badge ครอบทั้งสี่สถานะ รวม "ยังไม่เคยประเมิน" ที่ toast ไม่พูดถึง */
export function alertRailBadge({ data, error }: AlertSummaryInput): AlertRailBadge {
  if (error && !data) return { kind: "unreachable" };
  if (error && data) return { kind: "degraded" };
  if (!data) return null;
  if (data.evaluatedAt === null) return { kind: "neverEvaluated" };
  if (data.alerts.length > 0) return { kind: "count", n: data.alerts.length };
  return null;
}
