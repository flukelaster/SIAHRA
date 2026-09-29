/**
 * ตรรกะล้วนของรายการ "ความรุนแรงรายจังหวัด" บนแผงเส้นทางน้ำเหนือ (`NorthWaterCard`)
 *
 * กฎความซื่อสัตย์ (AGENTS.md) — เหมือนส่วนสรุปของหัวข้อภาพรวม (`overviewSummary.ts`):
 * - ระดับของสถานีหนึ่งใช้เกณฑ์เดียวกับ `classifyWater` ของภาพรวม (`classifyReading` เป็นสำเนาที่เทสยืนยันว่าเท่ากัน): ThaiWater `situationLevel` 5 → severe,
 *   4 → high; ไม่มีระดับ ใช้ระยะต่ำกว่าตลิ่ง (≤ 0 severe, ≤ `FREEBOARD_NEAR_M` high) — ค่าย้อนหลังทุกจุด
 *   ไม่มีระดับของ ThaiWater จึงใช้กฎตลิ่ง และแถวบอกว่าใช้กฎไหน (`worstRule`)
 * - จังหวัดหนึ่ง = สถานีที่แย่สุดในบรรดาค่าที่ **ไม่ค้าง** (`NodeReading.stale` = เก่ากว่า `STALE_OBS_MS`
 *   หรือไม่มีเวลาตรวจวัด) — ค่าค้าง/ไม่มีเวลา/ไม่มีค่า นับแยกให้เห็น ไม่ถูกทิ้งเงียบ ๆ
 * - `none` = มีค่าปัจจุบันที่จัดระดับได้อย่างน้อยหนึ่งสถานีและไม่มีสถานีใดเกินเกณฑ์ (**ไม่ใช่ปลอดภัย**);
 *   ไม่มีค่าปัจจุบันที่จัดระดับได้เลย = `no-data` — ไม่เคยเป็น "ไม่เกินเกณฑ์"
 * - เวลายอด 48 ชม. คือค่าที่ **เกิดไปแล้ว** (`peaks48h`) — ไม่มีเวลาที่น้ำจะมาถึง ไม่มีค่าล่วงหน้า
 */
import type { NorthRouteHistoryPoint } from "@siahra/shared-types";
import { FREEBOARD_NEAR_M, peaks48h, type NodeReading, type Peak } from "./northRoute";

/** กฎที่ใช้จัดสถานีหนึ่ง — ชนิดเดียวกับ `WaterRule` ใน `overviewSummary.ts` */
export type WaterRule = "situation" | "bank";

/**
 * ระดับสถานการณ์ของ ThaiWater ที่นับว่าเกินเกณฑ์ (4 น้ำมาก, 5 ล้นตลิ่ง) — **ค่าเดียวกับ**
 * `OVERVIEW_SITUATION_MIN` ใน `lib/overviewSummary.ts` ไม่ import ตรงด้วยเหตุผลเดียวกับที่ไฟล์นั้นบอกไว้
 * (การ import ข้าม chunk ทำให้ bundler จัดกลุ่ม entry ใหม่ และ entry โตขึ้น) — เทส `provinceSeverity.test.ts`
 * ยืนยันว่าค่านี้และ `classifyReading` ให้ผลเท่ากับ `classifyWater` ทุกกรณี
 */
export const SEVERITY_SITUATION_MIN = 4;

/** สำเนาของ `classifyWater` (overviewSummary.ts) ที่อ่านจาก `NodeReading` — เกณฑ์เดียวกับหมุดบนแผนที่ */
export function classifyReading(
  r: Pick<NodeReading, "situationLevel" | "freeboardM">,
): { tone: "severe" | "high" | "none"; rule: WaterRule | null } {
  if (r.situationLevel !== null) {
    if (r.situationLevel >= 5) return { tone: "severe", rule: "situation" };
    if (r.situationLevel >= SEVERITY_SITUATION_MIN) return { tone: "high", rule: "situation" };
    return { tone: "none", rule: "situation" };
  }
  const fb = r.freeboardM;
  if (fb === null || !Number.isFinite(fb)) return { tone: "none", rule: null };
  if (fb <= 0) return { tone: "severe", rule: "bank" };
  if (fb <= FREEBOARD_NEAR_M) return { tone: "high", rule: "bank" };
  return { tone: "none", rule: "bank" };
}

export type ProvinceTone = "severe" | "high" | "none" | "no-data";

export interface ProvinceSeverity {
  provinceCode: string;
  tone: ProvinceTone;
  /** สถานีที่แย่สุด — เฉพาะ `severe` / `high` */
  worstCode: string | null;
  /** กฎที่จัดสถานีนั้นเป็น severe/high: ระดับสถานการณ์ของ ThaiWater หรือระยะถึงตลิ่ง */
  worstRule: WaterRule | null;
  /** สถานีที่แถวนี้เปิดบนแผนที่: สถานีที่แย่สุด ไม่มีก็สถานีแรกของจังหวัดในผัง */
  focusCode: string;
  /** ยอดระดับน้ำ 48 ชม. ที่วัดได้ของสถานีที่แย่สุด — null = ไม่มีสถานีที่แย่สุด หรือไม่มีจุดระดับน้ำ */
  peak: Peak | null;
  stationCount: number;
  /** ค่าปัจจุบันที่จัดระดับได้ (ฐานของ tone) */
  counted: number;
  /** ค่าปัจจุบันที่จัดระดับไม่ได้ (ไม่มีระดับ ThaiWater และไม่มีระยะถึงตลิ่ง) */
  unclassified: number;
  stale: number;
  undated: number;
  /** ไม่มีค่าเลย (ไม่อยู่ในฟีด หรือไม่มีจุดที่เวลานั้น) */
  missing: number;
}

export interface SeverityStationRef {
  ridCode: string;
  provinceCode: string | null;
}

const TONE_RANK = { severe: 3, high: 2, none: 1, "no-data": 0 } as const;
const WORST_RANK = { severe: 2, high: 1 } as const;

/**
 * ทุกจังหวัดที่ผังมีสถานี เรียง severe → high → none → no-data (เท่ากัน = ลำดับที่จังหวัดปรากฏในผัง)
 * — ไม่มีแถวของจังหวัดที่ไม่มีสถานี สถานีที่ไม่ตกในจังหวัดใด (`provinceCode` null) ไม่ถูกเดาให้
 */
export function provinceSeverities(
  stations: readonly SeverityStationRef[],
  readings: ReadonlyMap<string, NodeReading>,
  histories: ReadonlyMap<string, readonly NorthRouteHistoryPoint[]>,
  endMs: number,
): ProvinceSeverity[] {
  const order: string[] = [];
  const groups = new Map<string, SeverityStationRef[]>();
  for (const s of stations) {
    if (s.provinceCode === null) continue;
    let g = groups.get(s.provinceCode);
    if (!g) {
      g = [];
      groups.set(s.provinceCode, g);
      order.push(s.provinceCode);
    }
    g.push(s);
  }

  const rows = order.map((provinceCode): ProvinceSeverity => {
    const group = groups.get(provinceCode)!;
    let counted = 0;
    let unclassified = 0;
    let stale = 0;
    let undated = 0;
    let missing = 0;
    let worst: { code: string; tone: "severe" | "high"; rule: WaterRule; freeboard: number } | null = null;
    for (const s of group) {
      const r = readings.get(s.ridCode);
      if (!r || r.missing) {
        missing += 1;
        continue;
      }
      if (r.observedAt === null) {
        undated += 1;
        continue;
      }
      if (r.stale) {
        stale += 1;
        continue;
      }
      const { tone, rule } = classifyReading(r);
      if (rule === null) {
        unclassified += 1;
        continue;
      }
      counted += 1;
      if (tone === "none") continue;
      const freeboard = r.freeboardM ?? Infinity;
      const better =
        worst === null ||
        WORST_RANK[tone] > WORST_RANK[worst.tone] ||
        (WORST_RANK[tone] === WORST_RANK[worst.tone] &&
          (freeboard < worst.freeboard || (freeboard === worst.freeboard && s.ridCode < worst.code)));
      if (better) worst = { code: s.ridCode, tone, rule, freeboard };
    }
    const tone: ProvinceTone = worst ? worst.tone : counted > 0 ? "none" : "no-data";
    const worstHistory = worst ? histories.get(worst.code) : undefined;
    return {
      provinceCode,
      tone,
      worstCode: worst?.code ?? null,
      worstRule: worst?.rule ?? null,
      focusCode: worst?.code ?? group[0].ridCode,
      peak: worstHistory ? peaks48h(worstHistory, endMs).level : null,
      stationCount: group.length,
      counted,
      unclassified,
      stale,
      undated,
      missing,
    };
  });
  // Array.prototype.sort เสถียร — จังหวัดที่ระดับเท่ากันคงลำดับตามผัง
  return rows.sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone]);
}
