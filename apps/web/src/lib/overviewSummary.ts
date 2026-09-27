/**
 * ตรรกะล้วนของส่วนสรุปบนหัวข้อ "ภาพรวม" (redesign PR 2, E18.2) — การ์ดสถานะ + รายการ "ควรดูก่อน"
 * แยกจากคอมโพเนนต์ (`components/hazard/OverviewSummary.tsx`) ให้เทสได้ใน node
 *
 * กฎความซื่อสัตย์ที่ไฟล์นี้ถือ (AGENTS.md):
 * - นับด้วยเกณฑ์ที่ต้นทางประกาศเท่านั้น: ระดับสถานการณ์ของ ThaiWater (`situationLevel` 4–5) และ
 *   แถบฝน 24 ชม. ของกรมอุตุฯ (`bandRain24h` / `TMD_RAIN_24H_BANDS`, เกินเกณฑ์แบบ `>`) — ไม่มี
 *   คะแนนความเสี่ยงที่คิดเอง ไม่มีตัวเลขล่วงหน้า
 * - สถานีที่ไม่มีระดับของ ThaiWater (ค่าย้อนหลังทุกสถานี และค่าสดบางสถานี) ใช้ระยะต่ำกว่าตลิ่ง
 *   ตามกฎเดียวกับหมุดบนแผนที่ (`freeboardColor` ใน scene/StationMarkers.ts, `nodeColor` +
 *   `FREEBOARD_NEAR_M` ใน lib/northRoute.ts) และนับแยกกลุ่ม เพื่อให้ UI บอกได้ว่าสีมาจากกฎไหน
 * - ค่าที่เก่ากว่า `OVERVIEW_MAX_READING_AGE_MS` จากเวลาอ้างอิง (เวลาที่เลือก หรือตอนนี้) ไม่ถูกนับ
 *   เข้ากลุ่มเกินเกณฑ์และไม่อยู่ในรายการ แต่ **ถูกนับแยกให้เห็น** ค่าที่ไม่มีเวลาตรวจวัดก็เช่นกัน
 * - `fetchedAt: null` = ยังไม่เคยได้ข้อมูล — เป็นสถานะของตัวเอง ไม่ใช่ "ไม่มีอะไรเกินเกณฑ์"
 * - ย้อนหลังแล้วรายการว่าง ≠ จังหวัดไม่มีสถานี (เซิร์ฟเวอร์ตัดสถานีที่ไม่มีจุดประวัติใกล้เวลานั้นทิ้ง)
 */
import {
  bandRain24h,
  type ObservationsResponse,
  type RainfallObservation,
  type WaterLevelObservation,
} from "@siahra/shared-types";
import type { ErrorMessage } from "./errorMessage";

/**
 * ค่าที่เก่ากว่านี้ (นับจากเวลาอ้างอิง) ไม่นับเป็น "ค่าปัจจุบัน" — **ค่าเดียวกับ**
 * `SHEET_MAX_READING_AGE_MS` (6 ชม.) ของแผ่นน้ำจำลองจากสถานี (`lib/stationSheetField.ts`) และขอบ
 * เท่ากันพอดี (อายุ = 6 ชม.) ยังนับ เหมือน `selectSheetStations` — ประกาศซ้ำเป็นตัวเลขแทนการ import
 * เพราะ import ข้าม chunk ทำให้ bundler แยก stationSheetField ออกเป็น chunk ร่วมและจัดกลุ่ม entry ใหม่
 * (entry โตขึ้น ~1 kB gz) — เทส `overviewSummary.test.ts` ยืนยันว่าสองค่านี้เท่ากันเสมอ
 */
export const OVERVIEW_MAX_READING_AGE_MS = 6 * 3_600_000;

/** แถวสูงสุดของรายการ "ควรดูก่อน" */
export const OVERVIEW_WATCH_MAX = 5;

/** ระดับสถานการณ์ของ ThaiWater ที่นับว่าเกินเกณฑ์ — 4 น้ำมาก, 5 ล้นตลิ่ง (ชื่อระดับเป็นของต้นทาง) */
export const OVERVIEW_SITUATION_MIN = 4;

/**
 * ระยะต่ำกว่าตลิ่ง (ม.) ที่นับว่า "ใกล้ตลิ่ง" สำหรับสถานีที่ไม่มีระดับของ ThaiWater — **ค่าเดียวกับ**
 * `FREEBOARD_NEAR_M` ใน `lib/northRoute.ts` และ `freeboardColor` ของหมุด (scene/StationMarkers.ts)
 * ไม่ import ตรงด้วยเหตุผลเดียวกับค่าอายุข้างบน (northRoute เป็น chunk ที่ Map3DCanvas โหลดแบบ
 * dynamic) — เทสยืนยันว่าเท่ากันเสมอ
 */
export const FREEBOARD_NEAR_M = 1;

/** ระดับความรุนแรงของแถว/การ์ด — `none` = ไม่มีสถานีที่เกินเกณฑ์ในค่าที่นับได้ (ไม่ใช่ "ปลอดภัย") */
export type OverviewTone = "severe" | "high" | "none";

/** กฎที่ใช้จัดสถานีระดับน้ำหนึ่งสถานี */
export type WaterRule = "situation" | "bank";

export type WatchRow =
  | {
      kind: "waterlevel";
      obs: WaterLevelObservation;
      tone: Exclude<OverviewTone, "none">;
      rule: WaterRule;
    }
  | {
      kind: "rainfall";
      obs: RainfallObservation;
      tone: Exclude<OverviewTone, "none">;
    };

export interface WaterCounts {
  /** สถานีที่มีค่าไม่เก่ากว่าเกณฑ์อายุ */
  current: number;
  /** ThaiWater ระดับ 5 ล้นตลิ่ง / ระดับ 4 น้ำมาก */
  level5: number;
  level4: number;
  /** ไม่มีระดับจาก ThaiWater: น้ำถึงหรือเกินตลิ่ง / ต่ำกว่าตลิ่งไม่เกิน `FREEBOARD_NEAR_M` */
  atBank: number;
  nearBank: number;
  /** ไม่มีระดับจาก ThaiWater และไม่มีระยะถึงตลิ่งให้เทียบ — จัดกลุ่มไม่ได้ */
  unclassified: number;
  /** ค่าเก่ากว่าเกณฑ์อายุ */
  stale: number;
  /** ไม่มีเวลาตรวจวัด (ตัดสินอายุไม่ได้) */
  undated: number;
}

export interface RainCounts {
  current: number;
  /** > 90 มม./24 ชม. (`severe`) */
  severe: number;
  /** > 35 มม./24 ชม. (`high`) */
  high: number;
  /** มีสถานีแต่ไม่มีค่าฝน 24 ชม. */
  noValue: number;
  stale: number;
  undated: number;
}

export type OverviewSummary =
  | { state: "loading" }
  | { state: "error"; error: ErrorMessage }
  | { state: "never-fetched" }
  /** สด: จังหวัดนี้ไม่มีสถานีวัดระดับน้ำหรือน้ำฝนในข้อมูลของ ThaiWater */
  | { state: "no-stations"; fetchedAt: string }
  /** ย้อนหลัง: ไม่มีค่าที่เก็บไว้ใกล้เวลานั้นเลย (ไม่ได้แปลว่าไม่มีสถานี) */
  | { state: "no-values-at-time"; atIso: string }
  | {
      state: "ready";
      historical: boolean;
      /** เวลาที่การ์ดนี้บรรยาย: เวลาที่เลือก (ย้อนหลัง) หรือเวลาที่ดึงจาก ThaiWater สำเร็จล่าสุด (สด) */
      describedAt: string;
      tone: OverviewTone;
      water: WaterCounts;
      rain: RainCounts;
      /**
       * ไม่มีรายการฝนเลย — ย้อนหลัง = "ไม่มีค่าฝนที่เก็บไว้สำหรับเวลานี้" (ไม่ใช่ฝนเป็นศูนย์)
       * สด = จังหวัดนี้ไม่มีสถานีวัดน้ำฝน
       */
      rainMissing: boolean;
      watch: WatchRow[];
      /** จำนวนแถวที่ผ่านเกณฑ์ทั้งหมดก่อนตัดเหลือ `OVERVIEW_WATCH_MAX` */
      watchTotal: number;
    };

export interface OverviewInput {
  data: ObservationsResponse | null;
  loading: boolean;
  error: ErrorMessage | null;
  /** เวลาบนเส้นเวลา — null = สด */
  atIso: string | null;
  nowMs: number;
}

type Freshness = "current" | "stale" | "undated";

/** อายุของค่า ณ เวลาอ้างอิง — ขอบ 6 ชม. พอดียังเป็น `current` (ตัดด้วย `>` เหมือนแผ่นน้ำจำลอง) */
export function readingFreshness(observedAt: string | null, refMs: number): Freshness {
  if (!observedAt) return "undated";
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return "undated";
  return refMs - t > OVERVIEW_MAX_READING_AGE_MS ? "stale" : "current";
}

/**
 * ระดับของสถานีระดับน้ำหนึ่งสถานี — มีระดับจาก ThaiWater ใช้ระดับนั้น (5 → severe, 4 → high)
 * ไม่มี ใช้ระยะต่ำกว่าตลิ่ง (≤ 0 → severe, ≤ `FREEBOARD_NEAR_M` → high) ตามกฎของหมุดบนแผนที่
 */
export function classifyWater(obs: WaterLevelObservation): { tone: OverviewTone; rule: WaterRule | null } {
  if (obs.situationLevel !== null) {
    if (obs.situationLevel >= 5) return { tone: "severe", rule: "situation" };
    if (obs.situationLevel >= OVERVIEW_SITUATION_MIN) return { tone: "high", rule: "situation" };
    return { tone: "none", rule: "situation" };
  }
  const fb = obs.freeboardM;
  if (fb === null || !Number.isFinite(fb)) return { tone: "none", rule: null };
  if (fb <= 0) return { tone: "severe", rule: "bank" };
  if (fb <= FREEBOARD_NEAR_M) return { tone: "high", rule: "bank" };
  return { tone: "none", rule: "bank" };
}

/** แถบฝนของกรมอุตุฯ → ระดับของการ์ด (`severe` > 90, `high` > 35 มม./24 ชม.; ต่ำกว่านั้นไม่นับ) */
export function classifyRain(obs: RainfallObservation): OverviewTone {
  const band = bandRain24h(obs.rain24h);
  if (band === "severe") return "severe";
  if (band === "high") return "high";
  return "none";
}

const TONE_RANK: Record<OverviewTone, number> = { severe: 2, high: 1, none: 0 };

/**
 * ลำดับของรายการ "ควรดูก่อน" (UI แสดงกฎนี้เป็นบรรทัดหมายเหตุ):
 *  1. สถานีระดับน้ำก่อน: ระดับ (severe ก่อน high) → ระยะถึงตลิ่งน้อยก่อน (ไม่มีค่าไว้ท้าย) → id น้อยก่อน
 *  2. แล้วสถานีฝน: ระดับ (severe ก่อน high) → ฝน 24 ชม. มากก่อน → id น้อยก่อน
 * ไม่ใช่คะแนนความเสี่ยง — เป็นการเรียงค่าที่วัดได้ตามเกณฑ์ที่ต้นทางประกาศ
 */
export function compareWatch(a: WatchRow, b: WatchRow): number {
  if (a.kind !== b.kind) return a.kind === "waterlevel" ? -1 : 1;
  const tone = TONE_RANK[b.tone] - TONE_RANK[a.tone];
  if (tone !== 0) return tone;
  if (a.kind === "waterlevel" && b.kind === "waterlevel") {
    const fa = a.obs.freeboardM ?? Infinity;
    const fb = b.obs.freeboardM ?? Infinity;
    if (fa !== fb) return fa - fb;
  } else if (a.kind === "rainfall" && b.kind === "rainfall") {
    const ra = a.obs.rain24h ?? -Infinity;
    const rb = b.obs.rain24h ?? -Infinity;
    if (ra !== rb) return rb - ra;
  }
  return a.obs.station.id - b.obs.station.id;
}

export function summarizeOverview(input: OverviewInput): OverviewSummary {
  const { data, atIso, nowMs } = input;
  if (data === null) {
    if (input.error) return { state: "error", error: input.error };
    return { state: "loading" };
  }
  const fetchedAt = data.summary.fetchedAt;
  if (fetchedAt === null) return { state: "never-fetched" };

  const atMs = atIso !== null ? Date.parse(atIso) : NaN;
  const historical = atIso !== null && Number.isFinite(atMs);
  if (data.waterlevel.length === 0 && data.rainfall.length === 0) {
    return historical ? { state: "no-values-at-time", atIso: atIso as string } : { state: "no-stations", fetchedAt };
  }
  const refMs = historical ? atMs : nowMs;

  const water: WaterCounts = {
    current: 0,
    level5: 0,
    level4: 0,
    atBank: 0,
    nearBank: 0,
    unclassified: 0,
    stale: 0,
    undated: 0,
  };
  const rain: RainCounts = { current: 0, severe: 0, high: 0, noValue: 0, stale: 0, undated: 0 };
  const rows: WatchRow[] = [];

  for (const obs of data.waterlevel) {
    const f = readingFreshness(obs.observedAt, refMs);
    if (f !== "current") {
      water[f] += 1;
      continue;
    }
    water.current += 1;
    const { tone, rule } = classifyWater(obs);
    if (rule === null) {
      water.unclassified += 1;
      continue;
    }
    if (tone === "none") continue;
    if (rule === "situation") water[tone === "severe" ? "level5" : "level4"] += 1;
    else water[tone === "severe" ? "atBank" : "nearBank"] += 1;
    rows.push({ kind: "waterlevel", obs, tone, rule });
  }

  for (const obs of data.rainfall) {
    const f = readingFreshness(obs.observedAt, refMs);
    if (f !== "current") {
      rain[f] += 1;
      continue;
    }
    rain.current += 1;
    if (obs.rain24h === null || !Number.isFinite(obs.rain24h)) {
      rain.noValue += 1;
      continue;
    }
    const tone = classifyRain(obs);
    if (tone === "none") continue;
    rain[tone] += 1;
    rows.push({ kind: "rainfall", obs, tone });
  }

  rows.sort(compareWatch);
  const tone: OverviewTone = rows.some((r) => r.tone === "severe") ? "severe" : rows.length > 0 ? "high" : "none";

  return {
    state: "ready",
    historical,
    describedAt: historical ? (atIso as string) : fetchedAt,
    tone,
    water,
    rain,
    rainMissing: data.rainfall.length === 0,
    watch: rows.slice(0, OVERVIEW_WATCH_MAX),
    watchTotal: rows.length,
  };
}
