/**
 * สถานะของชิปเวลา (`TimeChip`, E18.4) — pure module ไม่มี React/DOM
 *
 * ชิปบอก "กำลังดูเวลาไหน" ในสามสถานะที่ **ห้ามกำกวมต่อกัน** และ derive จาก props ล้วน ๆ
 * (ไม่ดึงข้อมูลเอง — devops C3):
 *
 *   historical — `atIso !== null`: ค่าตรวจวัดย้อนหลัง (ถ้อยคำ/สีเดียวกับป้าย "ดูย้อนหลัง")
 *   forecast   — `forecastAtIso !== null`: ขั้นของแบบจำลอง TMD NWP (เชิงกำหนด ไม่ใช่ความน่าจะเป็น)
 *   live       — ทั้งคู่เป็น null: ค่าตรวจวัดล่าสุด
 *
 * ลำดับ: `atIso` ชนะ `forecastAtIso` — กติกาเดียวกับ permalink (`t` ชนะ `f`); App.tsx ไม่ยอมให้
 * สองค่านี้ non-null พร้อมกันอยู่แล้ว
 *
 * ความซื่อสัตย์ของสถานะ live — เวลาที่ชิปแสดงคือ `latestObservedAt` (เวลาตรวจวัดล่าสุดของสถานี)
 * **ไม่เคย** เป็น `fetchedAt` หรือเวลาปัจจุบัน:
 *   - คำขอกำลังวิ่ง (เปลี่ยนจังหวัด / เพิ่งกลับจากย้อนหลัง — ข้อมูลที่ค้างอยู่อาจเป็นเฟรมย้อนหลัง)
 *     → "loading" ไม่ใช่เวลาของเฟรมนั้น
 *   - คำขอของเราเองล้มเหลว → "failed" (บอกได้แค่ว่า *เราถามไม่ได้* ไม่ใช่ว่าต้นทางเงียบ)
 *   - backend ตอบแต่ `fetchedAt: null` (ยังไม่เคยดึงจาก ThaiWater สำเร็จ) → "never" ไม่มีเวลา
 *   - ดึงได้แต่ไม่มีเวลาตรวจวัดของสถานีใดเลย → "noObservationTime" (ไม่แทนด้วย fetchedAt)
 */
export interface TimeChipObservations {
  /** มีคำตอบของ /observations อยู่ในมือไหม */
  hasData: boolean;
  loading: boolean;
  /** คำขอล่าสุดล้มเหลว */
  failed: boolean;
  fetchedAt: string | null;
  latestObservedAt: string | null;
}

export type LiveStatus = "time" | "loading" | "failed" | "never" | "noObservationTime";

export type TimeChipState =
  | { kind: "historical"; iso: string }
  | { kind: "forecast"; iso: string }
  | { kind: "live"; status: "time"; iso: string }
  | { kind: "live"; status: Exclude<LiveStatus, "time">; iso: null };

export function timeChipState(
  atIso: string | null,
  forecastAtIso: string | null,
  obs: TimeChipObservations,
): TimeChipState {
  if (atIso !== null) return { kind: "historical", iso: atIso };
  if (forecastAtIso !== null) return { kind: "forecast", iso: forecastAtIso };
  if (obs.loading) return { kind: "live", status: "loading", iso: null };
  if (obs.failed) return { kind: "live", status: "failed", iso: null };
  if (!obs.hasData) return { kind: "live", status: "loading", iso: null };
  if (obs.fetchedAt === null) return { kind: "live", status: "never", iso: null };
  if (obs.latestObservedAt === null) return { kind: "live", status: "noObservationTime", iso: null };
  return { kind: "live", status: "time", iso: obs.latestObservedAt };
}

/** ชิปมีปุ่ม "กลับไปปัจจุบัน" เฉพาะเมื่อไม่ได้อยู่ที่ค่าปัจจุบัน */
export function offersBackToLive(state: TimeChipState): boolean {
  return state.kind !== "live";
}
