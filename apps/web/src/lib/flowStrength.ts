/**
 * ตรรกะล้วนของ "ความแรงของการไหล" บนแผงเส้นทางน้ำเหนือ (`NorthWaterCard`) — แยกจากคอมโพเนนต์
 * ให้เทสได้โดยไม่ต้องมี DOM
 *
 * กฎความซื่อสัตย์ (AGENTS.md):
 * - ทุกค่ามาจากอัตราการไหลที่ **วัดได้** (ThaiWater/RID) เทียบกับ qmax ที่ต้นทางเผยแพร่ — ไม่มีค่า
 *   ล่วงหน้า ไม่มีเวลาที่น้ำจะมาถึง; ลูกศรแนวโน้มคือสิ่งที่ **เกิดขึ้นแล้ว** ใน 3 ชม. ที่ผ่านมา
 * - ขาด qmax หรืออัตราการไหล = ไม่มีแถบ (`null`) ไม่ใช่ "ปกติ"; ค่าค้างไม่มีลูกศร
 */
import type { NorthRouteHistoryPoint } from "@siahra/shared-types";
import { NODE_COLOR, TREND_WINDOW_HOURS, type NodeReading } from "./northRoute";

const HOUR_MS = 3_600_000;

/**
 * เกณฑ์ "ใกล้ความจุ" (% ของ qmax) — **เป็นเกณฑ์แสดงผลของเราเอง** ไม่ใช่เกณฑ์ที่ต้นทางประกาศ:
 * ขอบที่ต้นทางเผยแพร่มีเพียง 100 % ของ qmax เท่านั้น (เกิน = `over`) ค่า 80 เป็นข้อตกลงของ SIAHRA
 * ที่ให้ผู้อ่านเห็นก่อนถึงความจุ — รอเจ้าของโครงการยืนยัน/ปรับ (แก้ที่นี่ที่เดียว ข้อความในแผง
 * อ่านค่านี้ ไม่ได้พิมพ์ซ้ำ)
 */
export const NEAR_CAPACITY_PCT = 80;

/**
 * เกณฑ์ "ทรงตัว" ของแนวโน้มอัตราการไหล: การเปลี่ยนใน 3 ชม. น้อยกว่า 2 % ของ qmax — **เป็นข้อตกลงของ
 * เราเอง** (ต้นทางไม่ประกาศเกณฑ์แนวโน้ม) รอเจ้าของโครงการยืนยัน; ใช้ % ของ qmax เพื่อให้แม่น้ำเล็ก
 * และใหญ่วัดด้วยสัดส่วนเดียวกัน
 */
export const STEADY_PCT_OF_QMAX = 2;

export type CapacityBand = "over" | "near" | "normal";

/**
 * แถบเทียบความจุลำน้ำจาก % ของ qmax: > 100 = `over` (ขอบที่ต้นทางเผยแพร่ — เท่ากับ 100 พอดียังไม่เกิน),
 * ≥ `NEAR_CAPACITY_PCT` = `near`, ต่ำกว่านั้น = `normal`; null/ไม่ใช่ตัวเลข = null (ไม่มีแถบ ไม่ใช่ปกติ)
 */
export function capacityBand(qmaxPct: number | null): CapacityBand | null {
  if (qmaxPct === null || !Number.isFinite(qmaxPct)) return null;
  if (qmaxPct > 100) return "over";
  if (qmaxPct >= NEAR_CAPACITY_PCT) return "near";
  return "normal";
}

/** สี/รูปทรงของแถบ — สีอ่านจาก `NODE_COLOR` ตัวเดียวกับโหนด (แถบต้องมีรูปทรงและข้อความคู่กับสีเสมอ) */
export const BAND_COLOR: Record<CapacityBand, string> = {
  over: NODE_COLOR.red,
  near: NODE_COLOR.orange,
  normal: NODE_COLOR.green,
};
export const BAND_SHAPE: Record<CapacityBand, "square" | "triangle" | "circle"> = {
  over: "square",
  near: "triangle",
  normal: "circle",
};

export type DischargeTrend = "rising" | "steady" | "falling";

/**
 * แนวโน้มอัตราการไหลใน `TREND_WINDOW_HOURS` (3 ชม.) ที่จบที่ `endMs` — จุดแรกกับจุดสุดท้ายของ
 * หน้าต่าง (เรียงด้วย (เวลา, ค่า) เหมือน `freeboardTrendMPerH`) แล้วปรับเป็นการเปลี่ยนต่อ 3 ชม.
 *
 * - `|ΔQ| < STEADY_PCT_OF_QMAX % ของ qmax` = `steady` (เท่ากับเกณฑ์พอดี = ไม่ใช่ทรงตัว)
 * - null = ตัดสินไม่ได้: qmax ไม่มี/≤ 0, ค่าที่ใช้อยู่ค้าง (`stale`), มีจุดที่มีอัตราการไหลไม่ถึงสองจุด
 *   ในหน้าต่าง หรือทุกจุดอยู่ที่เวลาเดียวกัน
 */
export function dischargeTrend(
  history: readonly NorthRouteHistoryPoint[],
  endMs: number,
  qmaxM3s: number | null,
  stale: boolean,
): DischargeTrend | null {
  if (stale || qmaxM3s === null || !Number.isFinite(qmaxM3s) || !(qmaxM3s > 0)) return null;
  const fromMs = endMs - TREND_WINDOW_HOURS * HOUR_MS;
  const usable = history
    .map((p) => ({ ms: Date.parse(p.t), q: p.discharge }))
    .filter(
      (p): p is { ms: number; q: number } =>
        Number.isFinite(p.ms) && p.q !== null && Number.isFinite(p.q) && p.ms >= fromMs && p.ms <= endMs,
    )
    .sort((a, b) => a.ms - b.ms || a.q - b.q);
  if (usable.length < 2) return null;
  const first = usable[0];
  const last = usable[usable.length - 1];
  const hours = (last.ms - first.ms) / HOUR_MS;
  if (hours <= 0) return null;
  // อัตราต่อชม. → การเปลี่ยนต่อ 3 ชม. (ปัด 3 ตำแหน่งกันเศษทศนิยมที่ขอบเกณฑ์)
  const delta3h = Math.round(((last.q - first.q) / hours) * TREND_WINDOW_HOURS * 1000) / 1000;
  if (Math.abs(delta3h) * 100 < STEADY_PCT_OF_QMAX * qmaxM3s) return "steady";
  return delta3h > 0 ? "rising" : "falling";
}

/**
 * แนวโน้มของสถานีหนึ่ง ณ มุมมองที่เลือก — `missing` หรือ `stale` (เทียบ `STALE_OBS_MS` กับเวลาที่
 * แสดงอยู่แล้วใน `NodeReading`) → null
 */
export function readingDischargeTrend(
  reading: Pick<NodeReading, "missing" | "stale">,
  history: readonly NorthRouteHistoryPoint[],
  endMs: number,
  qmaxM3s: number | null,
): DischargeTrend | null {
  if (reading.missing) return null;
  return dischargeTrend(history, endMs, qmaxM3s, reading.stale);
}

export interface BandCounts {
  over: number;
  near: number;
  normal: number;
  /** ไม่มี qmax หรืออัตราการไหล (หรือไม่มีค่าเลย) — นับแยก ไม่รวมเข้า `normal` */
  unknown: number;
  /** ค่าเก่ากว่า `STALE_OBS_MS` — แถบของค่าค้างไม่ถูกนับเป็นสถานะปัจจุบัน แต่ก็ไม่หายไป */
  stale: number;
}

/** นับแถบของกลุ่มสถานี: ทุกสถานีตกกลุ่มใดกลุ่มหนึ่งพอดี ผลรวม = จำนวนที่ส่งเข้ามา */
export function countBands(readings: Iterable<Pick<NodeReading, "missing" | "stale" | "qmaxPct">>): BandCounts {
  const out: BandCounts = { over: 0, near: 0, normal: 0, unknown: 0, stale: 0 };
  for (const r of readings) {
    if (r.missing) {
      out.unknown += 1;
      continue;
    }
    if (r.stale) {
      out.stale += 1;
      continue;
    }
    const band = capacityBand(r.qmaxPct);
    if (band === null) out.unknown += 1;
    else out[band] += 1;
  }
  return out;
}
