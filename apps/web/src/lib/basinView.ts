/**
 * ตรรกะล้วนของแผง "ลุ่มน้ำ" (`components/hazard/BasinCard.tsx`) — แยกจากคอมโพเนนต์ให้เทสได้ใน node
 *
 * การจัดกลุ่มเป็นของฝั่ง API (ป้ายลุ่มน้ำของ ThaiWater, `packages/shared-types/src/basins.ts`) — ไฟล์นี้ไม่จัดกลุ่มใหม่
 * ไม่มีลำดับต้นน้ำ→ปลายน้ำ ไม่มีเวลาที่น้ำจะมาถึง ไม่มีค่าล่วงหน้า ไม่มีคะแนนที่คิดเอง
 *
 * กฎความซื่อสัตย์ (AGENTS.md) — เกณฑ์เดียวกับส่วนสรุปของหัวข้อภาพรวม (`overviewSummary.ts`) และแผงน้ำเหนือ (`provinceSeverity.ts`):
 * - ระดับของสถานีหนึ่งใช้เฉพาะเกณฑ์ที่ต้นทางประกาศ: ThaiWater `situationLevel` 5 → severe, 4 → high; สถานีที่ไม่มีระดับใช้ระยะต่ำกว่าตลิ่ง
 *   (≤ 0 severe, ≤ `BASIN_FREEBOARD_NEAR_M` high) ตามกฎเดียวกับหมุดบนแผนที่ — `classifyBasinReading` เป็นสำเนาที่เทสยืนยันว่าเท่ากับ
 *   `classifyReading` (provinceSeverity) และ `classifyWater` (overviewSummary) ทุกกรณี — ไม่ import ตรงเพราะ `provinceSeverity`
 *   ลากก้อน `northRoute` ทั้งก้อนเข้า chunk ของแผงนี้
 * - ค่าที่เก่ากว่า `BASIN_MAX_READING_AGE_MS` (6 ชม., ขอบพอดียังนับ) หรือไม่มีเวลาตรวจวัด **ไม่ถูกนับ แต่ถูกนับแยกให้เห็น** ไม่ทิ้งเงียบ ๆ
 * - `none` = มีค่าปัจจุบันที่จัดระดับได้อย่างน้อยหนึ่งสถานีและไม่มีสถานีใดเกินเกณฑ์ (**ไม่ใช่ปลอดภัย**); ไม่มีค่าปัจจุบันที่จัดระดับได้เลย =
 *   `no-data` — ไม่เคยเป็น "ไม่เกินเกณฑ์"
 */
import type { BasinBucket, BasinDam, BasinGroup, BasinStation, BasinsResponse } from "@siahra/shared-types";
import { PROVINCES } from "../data/provinces";
import { BASINS_INTERVAL_MS } from "./pollSchedule";

/** ค่าเดียวกับ `OVERVIEW_MAX_READING_AGE_MS` (overviewSummary.ts) และ `SHEET_MAX_READING_AGE_MS` — เทสยืนยันว่าเท่ากัน */
export const BASIN_MAX_READING_AGE_MS = 6 * 3_600_000;
/** ค่าเดียวกับ `OVERVIEW_SITUATION_MIN` — ระดับสถานการณ์ของ ThaiWater ที่นับว่าเกินเกณฑ์ (4 น้ำมาก, 5 ล้นตลิ่ง) */
export const BASIN_SITUATION_MIN = 4;
/** ค่าเดียวกับ `FREEBOARD_NEAR_M` (northRoute.ts / overviewSummary.ts) — ระยะต่ำกว่าตลิ่ง (ม.) ที่นับว่า "ใกล้ตลิ่ง" */
export const BASIN_FREEBOARD_NEAR_M = 1;
/**
 * เขื่อนถูกดึงแบบ lazy (เมื่อมีคนขอ `/api/v1/dams`) ไม่ได้ดึงทุกรอบ — เก่ากว่านี้ = หรี่แถวเขื่อนและบอกเวลา
 * ค่าเดียวกับ `staleAfterSeconds` ของ descriptor `thaiwater-dams` ฝั่ง API (3 ชม.) จึงตรงกับแผงเขื่อน
 */
export const BASIN_DAMS_STALE_MS = 3 * 3_600_000;

/**
 * ขอบของความ "ค้าง" ของชุดข้อมูลที่ถืออยู่ในเบราว์เซอร์ — ไม่ใช่ `layer.staleAfterSeconds` เฉย ๆ
 * อายุที่เห็นบนจอ = (API ดึง ThaiWater → เขียนแถวใหม่ ทุก ≤ `staleAfterSeconds`) + (แคชที่ขอบเก็บคำตอบได้อีก `s-maxage` 300 วิ,
 * `apps/api/src/cachePolicy.ts`) + (เว็บถามทุก `BASINS_INTERVAL_MS` 10 นาที) — ท่อที่ปกติดีจึงให้อายุ 0–25 นาทีได้ (API ≤ 10 + ขอบ 5 + เว็บ 10)
 * ซึ่งเกินเกณฑ์ 15 นาทีเดิมของรอบ 5 นาที จึงต้องขยับพร้อมกัน: เกณฑ์ = 30 นาที (3 รอบดึง) + 5 + 10 = 45 นาที; รวมสามส่วนนี้เป็นเกณฑ์
 * ผิดเกณฑ์ = ค้างจริง (หรี่ + บอก ไม่ซ่อน)
 */
export const BASIN_EDGE_MAX_AGE_MS = 300_000;
export function basinStaleLimitMs(staleAfterSeconds: number): number {
  return staleAfterSeconds * 1000 + BASIN_EDGE_MAX_AGE_MS + BASINS_INTERVAL_MS;
}
/** อายุ (ms) ของชุดที่ถืออยู่ ณ `nowMs` — null = `fetchedAt` เป็น null/อ่านไม่ได้ (ไม่ใช่ "ตอนนี้") */
export function basinAgeMs(fetchedAt: string | null, nowMs: number): number | null {
  if (fetchedAt === null) return null;
  const ms = Date.parse(fetchedAt);
  return Number.isFinite(ms) ? nowMs - ms : null;
}
/** ค้าง = อายุเกินเกณฑ์รวมข้างบน (ตัดด้วย `>`); ไม่รู้อายุ = ไม่ตัดสินว่าค้าง (ยังไม่เคยดึงมีข้อความของตัวเอง) */
export function isBasinsStale(fetchedAt: string | null, staleAfterSeconds: number, nowMs: number): boolean {
  const age = basinAgeMs(fetchedAt, nowMs);
  return age !== null && age > basinStaleLimitMs(staleAfterSeconds);
}

const KNOWN_PROVINCES: ReadonlySet<string> = new Set(PROVINCES.map((p) => p.code));
/**
 * รหัสจังหวัดที่เป็นหนึ่งใน 77 จังหวัดจริง หรือ null — ThaiWater ให้สถานีในกลุ่ม "นอกประเทศไทย" รหัส "10499" ซึ่งไม่ใช่จังหวัด
 * (ไม่มีฉาก ไม่มี /provinces/10499/…) จึงนับเป็น "ไม่ระบุจังหวัด" ทุกที่ในแผงนี้ — ไม่แสดงรหัสดิบ ไม่เปิดบนแผนที่
 */
export function knownProvinceCode(code: string | null): string | null {
  return code !== null && KNOWN_PROVINCES.has(code) ? code : null;
}

/** กฎที่ใช้จัดสถานีหนึ่ง — ชนิดเดียวกับ `WaterRule` ใน `overviewSummary.ts` */
export type WaterRule = "situation" | "bank";

/** ที่ที่ผู้ใช้เลือกดู: ลุ่มน้ำหนึ่ง หรือสองกลุ่มที่ **ไม่ใช่ลุ่มน้ำ** (นอกประเทศ / ไม่ระบุลุ่มน้ำ) */
export type BasinSelection = { kind: "basin"; key: string } | { kind: "outside" } | { kind: "unassigned" };

export function sameSelection(a: BasinSelection | null, b: BasinSelection | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === "basin" ? a.key === (b as { key: string }).key : true;
}

/** สำเนาของ `classifyWater` (overviewSummary.ts) — เกณฑ์เดียวกับหมุดบนแผนที่ */
export function classifyBasinReading(
  r: Pick<BasinStation, "situationLevel" | "freeboardM">,
): { tone: "severe" | "high" | "none"; rule: WaterRule | null } {
  if (r.situationLevel !== null) {
    if (r.situationLevel >= 5) return { tone: "severe", rule: "situation" };
    if (r.situationLevel >= BASIN_SITUATION_MIN) return { tone: "high", rule: "situation" };
    return { tone: "none", rule: "situation" };
  }
  const fb = r.freeboardM;
  if (fb === null || !Number.isFinite(fb)) return { tone: "none", rule: null };
  if (fb <= 0) return { tone: "severe", rule: "bank" };
  if (fb <= BASIN_FREEBOARD_NEAR_M) return { tone: "high", rule: "bank" };
  return { tone: "none", rule: "bank" };
}

export type Freshness = "current" | "stale" | "undated";

/** อายุของค่า ณ เวลาอ้างอิง — ขอบ 6 ชม. พอดียังเป็น `current` (ตัดด้วย `>`) */
export function readingFreshness(observedAt: string | null, refMs: number): Freshness {
  if (!observedAt) return "undated";
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return "undated";
  return refMs - t > BASIN_MAX_READING_AGE_MS ? "stale" : "current";
}

/** สถานะของสถานีหนึ่ง: ค่าที่นับได้แบ่งตามเกณฑ์ (`severe`/`high`/`none`/`unclassified`) ส่วนที่นับไม่ได้ = `stale`/`undated` */
export type StationStatus = "severe" | "high" | "none" | "unclassified" | "stale" | "undated";

export interface EvaluatedStation {
  station: BasinStation;
  status: StationStatus;
  /** กฎที่จัดสถานีนี้ (เฉพาะ severe/high/none) — null = ไม่มีระดับและไม่มีระยะถึงตลิ่งให้เทียบ หรือนับไม่ได้ */
  rule: WaterRule | null;
}

export function evaluateStation(station: BasinStation, refMs: number): EvaluatedStation {
  const f = readingFreshness(station.observedAt, refMs);
  if (f !== "current") return { station, status: f, rule: null };
  const { tone, rule } = classifyBasinReading(station);
  if (rule === null) return { station, status: "unclassified", rule: null };
  return { station, status: tone, rule };
}

/** ลำดับของสถานะ (มาก = ควรเห็นก่อน) */
const STATUS_RANK: Record<StationStatus, number> = { severe: 5, high: 4, none: 3, unclassified: 2, stale: 1, undated: 0 };

function compareEvaluated(a: EvaluatedStation, b: EvaluatedStation): number {
  const byStatus = STATUS_RANK[b.status] - STATUS_RANK[a.status];
  if (byStatus !== 0) return byStatus;
  // ใกล้ตลิ่งกว่าก่อน (ไม่มีค่าไปท้าย) แล้วรหัสน้อยกว่า — ลำดับแน่นอน
  const fa = a.station.freeboardM ?? Infinity;
  const fb = b.station.freeboardM ?? Infinity;
  if (fa !== fb) return fa < fb ? -1 : 1;
  return a.station.id - b.station.id;
}

/** สถานีทั้งหมดของกลุ่ม เรียงแย่สุดก่อน (ลำดับแน่นอน) */
export function rankStations(stations: readonly BasinStation[], refMs: number): EvaluatedStation[] {
  return stations.map((s) => evaluateStation(s, refMs)).sort(compareEvaluated);
}

export type BasinTone = "severe" | "high" | "none" | "no-data";

const TONE_RANK: Record<BasinTone, number> = { severe: 3, high: 2, none: 1, "no-data": 0 };

export interface BucketSummary {
  stationCount: number;
  /** ค่าปัจจุบันที่จัดระดับได้ (ฐานของ tone) */
  counted: number;
  /** ThaiWater ระดับ 5 / ระดับ 4 */
  level5: number;
  level4: number;
  /** ไม่มีระดับของ ThaiWater: ถึงหรือเกินตลิ่ง / ต่ำกว่าตลิ่งไม่เกิน `BASIN_FREEBOARD_NEAR_M` */
  atBank: number;
  nearBank: number;
  /** ค่าปัจจุบันที่ไม่ผ่านเกณฑ์ใดเลย (จัดระดับได้) */
  belowThreshold: number;
  /** ค่าปัจจุบันที่จัดระดับไม่ได้ (ไม่มีระดับ ThaiWater และไม่มีระยะถึงตลิ่ง) */
  unclassified: number;
  stale: number;
  undated: number;
  tone: BasinTone;
  /** เวลาตรวจวัดใหม่สุดของสถานีในกลุ่ม (ทุกสถานี รวมที่ค้าง) — null = ไม่มีสถานีใดมีเวลา */
  latestObservedAt: string | null;
}

/** ระดับของกลุ่มจากค่าที่นับได้ — `severe`/`high` ถ้ามีสถานีเกินเกณฑ์; `none` ก็ต่อเมื่อมีค่าที่นับได้ */
export function toneOf(evaluated: readonly EvaluatedStation[]): BasinTone {
  let counted = 0;
  let high = false;
  for (const e of evaluated) {
    if (e.status === "severe") return "severe";
    if (e.status === "high") high = true;
    if (e.status === "high" || e.status === "none") counted += 1;
  }
  return high ? "high" : counted > 0 ? "none" : "no-data";
}

function newestTime(stations: readonly BasinStation[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const s of stations) {
    if (s.observedAt === null) continue;
    const ms = Date.parse(s.observedAt);
    if (Number.isFinite(ms) && ms > bestMs) {
      best = s.observedAt;
      bestMs = ms;
    }
  }
  return best;
}

export function summarizeStations(stations: readonly BasinStation[], refMs: number): BucketSummary {
  return summarizeEvaluated(
    stations.map((s) => evaluateStation(s, refMs)),
    newestTime(stations),
  );
}

function summarizeEvaluated(evaluated: readonly EvaluatedStation[], latestObservedAt: string | null): BucketSummary {
  const out: BucketSummary = {
    stationCount: evaluated.length,
    counted: 0,
    level5: 0,
    level4: 0,
    atBank: 0,
    nearBank: 0,
    belowThreshold: 0,
    unclassified: 0,
    stale: 0,
    undated: 0,
    tone: "no-data",
    latestObservedAt,
  };
  for (const e of evaluated) {
    switch (e.status) {
      case "stale":
        out.stale += 1;
        break;
      case "undated":
        out.undated += 1;
        break;
      case "unclassified":
        out.unclassified += 1;
        break;
      case "none":
        out.counted += 1;
        out.belowThreshold += 1;
        break;
      case "severe":
      case "high": {
        out.counted += 1;
        const bySituation = e.rule === "situation";
        if (e.status === "severe") {
          if (bySituation) out.level5 += 1;
          else out.atBank += 1;
        } else if (bySituation) out.level4 += 1;
        else out.nearBank += 1;
        break;
      }
    }
  }
  out.tone = toneOf(evaluated);
  return out;
}

export interface ProvinceRow {
  /** null = สถานีที่ต้นทางไม่ระบุจังหวัด หรือให้รหัสที่ไม่ใช่จังหวัดของไทย (`knownProvinceCode`) — นับและแสดง ไม่เดาให้ */
  provinceCode: string | null;
  tone: BasinTone;
  /** สถานีที่แย่สุด — เฉพาะ `severe` / `high` */
  worst: EvaluatedStation | null;
  /** สถานีที่แถวนี้เปิดบนแผนที่: สถานีที่แย่สุด ไม่มีก็สถานีที่มีค่าปัจจุบัน ไม่มีก็สถานีแรก (id น้อยสุด) */
  focus: BasinStation;
  summary: BucketSummary;
}

/**
 * ทุกจังหวัดที่กลุ่มมีสถานี เรียงแย่สุดก่อน: severe → high → none → no-data แล้วจำนวนสถานีที่นับได้มากกว่า แล้วรหัสจังหวัด (null ท้ายสุด)
 * — ไม่มีแถวของจังหวัดที่ไม่มีสถานีในกลุ่ม และสถานีที่ไม่มีจังหวัดถูกรวมเป็นแถว `provinceCode: null` (ไม่ถูกทิ้ง)
 */
export function provinceRows(stations: readonly BasinStation[], refMs: number): ProvinceRow[] {
  const groups = new Map<string | null, EvaluatedStation[]>();
  for (const s of stations) {
    const e = evaluateStation(s, refMs);
    const code = knownProvinceCode(s.provinceCode);
    const g = groups.get(code);
    if (g) g.push(e);
    else groups.set(code, [e]);
  }
  const rows = [...groups.entries()].map(([provinceCode, evaluated]): ProvinceRow => {
    const ranked = [...evaluated].sort(compareEvaluated);
    const top = ranked[0]!;
    const worst = top.status === "severe" || top.status === "high" ? top : null;
    const current = ranked.find((e) => e.status === "severe" || e.status === "high" || e.status === "none" || e.status === "unclassified");
    const byId = [...evaluated].sort((a, b) => a.station.id - b.station.id)[0]!;
    const summary = summarizeEvaluated(evaluated, newestTime(evaluated.map((e) => e.station)));
    return { provinceCode, tone: summary.tone, worst, focus: (worst ?? current ?? byId).station, summary };
  });
  return rows.sort((a, b) => {
    const t = TONE_RANK[b.tone] - TONE_RANK[a.tone];
    if (t !== 0) return t;
    const c = b.summary.counted - a.summary.counted;
    if (c !== 0) return c;
    if (a.provinceCode === b.provinceCode) return 0;
    if (a.provinceCode === null) return 1;
    if (b.provinceCode === null) return -1;
    return a.provinceCode < b.provinceCode ? -1 : 1;
  });
}

// ── เขื่อน ───────────────────────────────────────────────────────────────

/**
 * สถานะความสดของแถวเขื่อนทั้งก้อน — เขื่อนถูกดึงแยกจากระดับน้ำ (lazy): `never` = ไม่เคยดึงเขื่อน (ไม่ใช่ "ไม่มีเขื่อน"),
 * `stale` = ดึงล่าสุดเก่ากว่า `BASIN_DAMS_STALE_MS`, `ok` = ไม่เกินเกณฑ์นั้น (ค่าตรวจวัดของแต่ละเขื่อนมีเวลาของตัวเองแสดงอยู่ข้างแถว)
 */
export function damsFreshness(damsFetchedAt: string | null, nowMs: number): "never" | "stale" | "ok" {
  if (damsFetchedAt === null) return "never";
  const ms = Date.parse(damsFetchedAt);
  if (!Number.isFinite(ms)) return "never";
  return nowMs - ms > BASIN_DAMS_STALE_MS ? "stale" : "ok";
}

/** เขื่อนใหญ่ก่อน แล้วความจุที่เก็บมากก่อน (ไม่มีค่าไปท้าย) แล้ว id — เหมือนแผงเขื่อน (`DamCard`) */
export function sortDams(dams: readonly BasinDam[]): BasinDam[] {
  return [...dams].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "large" ? -1 : 1;
    const pa = a.storagePercent ?? -1;
    const pb = b.storagePercent ?? -1;
    if (pa !== pb) return pb - pa;
    return a.id - b.id;
  });
}

// ── ตัวเลือกลุ่มน้ำ ───────────────────────────────────────────────────────

export interface PickerRow {
  selection: BasinSelection;
  /** ข้อความที่ต้นทางเขียน (ลุ่มน้ำ) — สองกลุ่มที่ไม่ใช่ลุ่มน้ำใช้ป้ายของ UI แทน จึงเป็น null */
  nameTh: string | null;
  stationCount: number;
  damCount: number;
  tone: BasinTone;
}

/** ตัดตัวเลือกด้วยข้อความค้นหา (ไม่แยกตัวพิมพ์ใหญ่เล็ก) — ค้นทั้งชื่อที่ต้นทางเขียนและคีย์ */
export function filterBasins(basins: readonly BasinGroup[], query: string): BasinGroup[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...basins];
  return basins.filter((b) => b.nameTh.toLowerCase().includes(q) || b.key.toLowerCase().includes(q));
}

/**
 * แถวตัวเลือกของลุ่มน้ำที่ผ่านตัวกรอง เรียงแย่สุดก่อน (severe → high → none → no-data) แล้วจำนวนสถานีมากก่อน แล้วคีย์ตามรหัสอักขระ
 * ตามด้วย "นอกประเทศไทย" และ "ไม่ระบุลุ่มน้ำ" (ไม่ใช่ลุ่มน้ำ) เฉพาะที่มีสถานีหรือเขื่อน — ไม่ทิ้งกลุ่มใดเงียบ ๆ และไม่ผ่านตัวกรองข้อความ
 * (ตัวกรองคือการค้นหาลุ่มน้ำ ทั้งสองกลุ่มนี้ต้องยังเห็นได้เสมอ)
 */
export function pickerRows(data: BasinsResponse, query: string, refMs: number): { basins: PickerRow[]; others: PickerRow[] } {
  const basins = filterBasins(data.basins, query).map(
    (b): PickerRow => ({
      selection: { kind: "basin", key: b.key },
      nameTh: b.nameTh,
      stationCount: b.stations.length,
      damCount: b.dams.length,
      tone: summarizeStations(b.stations, refMs).tone,
    }),
  );
  basins.sort((a, b) => {
    const t = TONE_RANK[b.tone] - TONE_RANK[a.tone];
    if (t !== 0) return t;
    if (a.stationCount !== b.stationCount) return b.stationCount - a.stationCount;
    const ka = (a.selection as { key: string }).key;
    const kb = (b.selection as { key: string }).key;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const others: PickerRow[] = [];
  const extra = (selection: BasinSelection, bucket: BasinBucket): void => {
    if (bucket.stations.length === 0 && bucket.dams.length === 0) return;
    others.push({
      selection,
      nameTh: null,
      stationCount: bucket.stations.length,
      damCount: bucket.dams.length,
      tone: summarizeStations(bucket.stations, refMs).tone,
    });
  };
  extra({ kind: "outside" }, data.outsideThailand);
  extra({ kind: "unassigned" }, data.unassigned);
  return { basins, others };
}

/** กลุ่มที่เลือก — null = ไม่มีกลุ่มนี้ในข้อมูลปัจจุบัน (เช่นลุ่มน้ำหายไปจากคำตอบใหม่) UI บอกตรง ๆ ไม่เดาแทน */
export function bucketFor(
  data: BasinsResponse,
  selection: BasinSelection,
): { bucket: BasinBucket; nameTh: string | null } | null {
  if (selection.kind === "outside") return { bucket: data.outsideThailand, nameTh: null };
  if (selection.kind === "unassigned") return { bucket: data.unassigned, nameTh: null };
  const g = data.basins.find((b) => b.key === selection.key);
  return g ? { bucket: g, nameTh: g.nameTh } : null;
}
