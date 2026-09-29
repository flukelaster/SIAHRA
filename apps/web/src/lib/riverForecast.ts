/**
 * ตรรกะล้วนของส่วน "ผลลัพธ์แบบจำลองพยากรณ์ของ HII" บนแผงน้ำเหนือ (`NorthWaterCard`, `RiverForecastSection`)
 * — แยกจากคอมโพเนนต์ให้เทสได้โดยไม่ต้องมี DOM
 *
 * กฎความซื่อสัตย์ (AGENTS.md):
 * - ค่าทั้งหมดเป็นผลลัพธ์ **เชิงกำหนด** ของแบบจำลองบุคคลที่สาม (สสน. / HII) ที่ผู้เผยแพร่ไม่ได้ระบุชื่อ — ไม่มีความ
 *   น่าจะเป็น ไม่มีเวลาที่น้ำจะมาถึง และไม่มีตัวเลขที่เราคำนวณเอง: สิ่งที่ไฟล์นี้ทำมีแค่ค่าสูงสุด / จุดแรกที่ค่าเกินเกณฑ์
 *   ที่ HII เผยแพร่ / เลขคณิตของเวลา
 * - `series` ของ API เริ่มก่อน `publishedAt` ราว 7 วัน: จุดก่อนหน้านั้นคือค่าที่แบบจำลองให้ไว้สำหรับชั่วโมงที่ผ่านไปแล้ว
 *   **ไม่ใช่การพยากรณ์** — `forecastPart` ตัดทิ้ง และ `publishedAt` เป็น null = แยกไม่ได้ จึงไม่มีส่วนพยากรณ์เลย (ไม่เดา)
 * - ห้ามแทนค่าที่ไม่มีด้วย 0: เกณฑ์ที่เป็น null = ไม่มีการเทียบเกณฑ์นั้น
 */
import type {
  NorthRouteHistoryPoint,
  RiverForecastKind,
  RiverForecastStation,
  RiverForecastThresholds,
} from "@siahra/shared-types";

const HOUR_MS = 3_600_000;

/**
 * ไฟล์ที่ `publishedAt` เก่ากว่านี้ = "ไฟล์ไม่ได้อัปเดตตั้งแต่ …" (หรี่ + บอกตรง ๆ) — **เป็นข้อตกลงแสดงผลของ SIAHRA เอง**:
 * ต้นทางไม่เผยแพร่รอบการอัปเดตของไฟล์ (วัดได้ว่าไฟล์ขยับเป็นรอบ ๆ แต่ไม่มีที่ไหนประกาศ) จึงเลือก 48 ชม. ให้เกินรอบปกติ
 * เพียงพอที่ไฟล์ที่เก่ากว่านี้ควรถูกสงสัย — รอเจ้าของโครงการยืนยัน/ปรับ (แก้ที่นี่ที่เดียว ข้อความในแผงอ่านค่านี้)
 */
export const FORECAST_STALE_MS = 48 * HOUR_MS;

/** ระดับเกณฑ์ตามชื่อคอลัมน์ที่ HII เผยแพร่ (metadata CSV) — เรียงจากสูงไปต่ำเพื่อรายงานระดับสูงสุดที่ถึง */
export const THRESHOLD_LEVELS_DESC = ["critical", "warning", "alarm"] as const;
export type ThresholdLevel = (typeof THRESHOLD_LEVELS_DESC)[number];

export type ForecastPoint = readonly [number, number];

export function publishedMs(station: Pick<RiverForecastStation, "publishedAt">): number | null {
  if (station.publishedAt === null) return null;
  const ms = Date.parse(station.publishedAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * ส่วนพยากรณ์ของสถานี = จุดที่เวลา **มากกว่า** `publishedAt` ของสถานีนั้น (เท่ากันพอดียังไม่ใช่พยากรณ์) เรียงตามเวลา
 * `publishedAt` เป็น null/อ่านไม่ออก → `[]` (แยกไม่ออกว่าจุดไหนคือชั่วโมงที่ผ่านไปแล้ว — ไม่เดา)
 */
export function forecastPart(station: Pick<RiverForecastStation, "series" | "publishedAt">): ForecastPoint[] {
  const pub = publishedMs(station);
  if (pub === null) return [];
  return station.series
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v) && t > pub)
    .sort((a, b) => a[0] - b[0]);
}

export interface ForecastPeak {
  t: number;
  value: number;
}

/**
 * รูปร่างของส่วนพยากรณ์เทียบกับจุดสูงสุด:
 * - `peak-at-start` = ค่าสูงสุดคือจุดแรกหลัง `publishedAt` → แบบจำลองให้ค่าลดลงจากจุดนั้น (ยอดผ่านไปแล้ว)
 * - `peak-at-end` = ค่าสูงสุดคือจุดสุดท้าย → ยังสูงขึ้นอยู่เมื่อหน้าต่างจบ (ยอดจริงอาจอยู่เลยหน้าต่าง)
 * - `flat` = ทุกจุดเท่ากัน (ไม่ใช่ "ลดลง")   - `interior` = ยอดอยู่ตรงกลาง
 * - null = มีจุดไม่ถึงสองจุด ตัดสินรูปร่างไม่ได้
 */
export type ForecastShape = "peak-at-start" | "peak-at-end" | "interior" | "flat";

/** จุดแรกที่ค่า **มากกว่า** เกณฑ์ (เกณฑ์เท่ากับค่าพอดีไม่นับ — คำในแผงคือ "เกิน") ต่อระดับ; เกณฑ์ null = null */
export type Crossings = Record<ThresholdLevel, number | null>;

export type ForecastStatus =
  /** API ยังไม่เคยยืนยันไฟล์นี้กับต้นทางเลย (`fetchedAt` null) */
  | "never-fetched"
  /** ต้นทางไม่ส่ง `Last-Modified` — แยกส่วนพยากรณ์ไม่ได้ */
  | "no-publish-time"
  /** มีไฟล์และเวลาอัปเดต แต่ไม่มีจุดหลังเวลานั้น */
  | "empty"
  | "ok";

export interface ForecastSummary {
  status: ForecastStatus;
  points: ForecastPoint[];
  /** จุดสูงสุดของส่วนพยากรณ์ — ค่าเท่ากันหลายจุดใช้จุดแรก */
  peak: ForecastPeak | null;
  shape: ForecastShape | null;
  crossings: Crossings;
  /** ระดับเกณฑ์สูงสุดที่ค่าเกิน (critical > warning > alarm) กับเวลาแรกที่เกิน — เรียงตามชื่อระดับ ไม่อนุมานลำดับจากตัวเลข */
  highest: { level: ThresholdLevel; t: number; threshold: number } | null;
  /** มีเกณฑ์อย่างน้อยหนึ่งค่าให้เทียบ (ไม่งั้นบอกว่าไม่มีเกณฑ์ ไม่ใช่ "ไม่เกินเกณฑ์") */
  hasThresholds: boolean;
}

const isNum = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

export function peakOf(points: readonly ForecastPoint[]): { peak: ForecastPeak; index: number } | null {
  if (points.length === 0) return null;
  let index = 0;
  for (let i = 1; i < points.length; i += 1) if (points[i][1] > points[index][1]) index = i;
  return { peak: { t: points[index][0], value: points[index][1] }, index };
}

export function shapeOf(points: readonly ForecastPoint[], peakIndex: number): ForecastShape | null {
  if (points.length < 2) return null;
  const values = points.map((p) => p[1]);
  if (Math.min(...values) === Math.max(...values)) return "flat";
  if (peakIndex === 0) return "peak-at-start";
  if (peakIndex === points.length - 1) return "peak-at-end";
  return "interior";
}

export function firstCrossings(points: readonly ForecastPoint[], thresholds: RiverForecastThresholds | null): Crossings {
  const out: Crossings = { alarm: null, warning: null, critical: null };
  if (!thresholds) return out;
  for (const level of THRESHOLD_LEVELS_DESC) {
    const limit = thresholds[level];
    if (!isNum(limit)) continue;
    const hit = points.find((p) => p[1] > limit);
    out[level] = hit ? hit[0] : null;
  }
  return out;
}

export function summarizeStation(
  station: Pick<RiverForecastStation, "series" | "publishedAt" | "fetchedAt" | "thresholds">,
): ForecastSummary {
  const points = forecastPart(station);
  const crossings = firstCrossings(points, station.thresholds);
  const highestLevel = THRESHOLD_LEVELS_DESC.find((l) => crossings[l] !== null);
  const found = peakOf(points);
  const status: ForecastStatus =
    station.fetchedAt === null
      ? "never-fetched"
      : publishedMs(station) === null
        ? "no-publish-time"
        : points.length === 0
          ? "empty"
          : "ok";
  return {
    status,
    points,
    peak: found?.peak ?? null,
    shape: found ? shapeOf(points, found.index) : null,
    crossings,
    highest:
      highestLevel && station.thresholds
        ? { level: highestLevel, t: crossings[highestLevel]!, threshold: station.thresholds[highestLevel] as number }
        : null,
    hasThresholds: station.thresholds !== null && THRESHOLD_LEVELS_DESC.some((l) => isNum(station.thresholds![l])),
  };
}

/**
 * ไฟล์ของสถานีถูกต้นทางอัปเดตล่าสุดเมื่อไร เทียบกับ `FORECAST_STALE_MS` — คนละเรื่องกับ `copyIsOld` (ต้นทางไม่อัปเดตไฟล์
 * เทียบกับ API ของเราไม่ได้ยืนยันไฟล์กับต้นทาง)
 */
export type PublishedState = { kind: "unknown" } | { kind: "fresh" | "stale"; ageMs: number };

export function publishedState(station: Pick<RiverForecastStation, "publishedAt">, nowMs: number): PublishedState {
  const pub = publishedMs(station);
  if (pub === null) return { kind: "unknown" };
  const ageMs = nowMs - pub;
  return { kind: ageMs > FORECAST_STALE_MS ? "stale" : "fresh", ageMs };
}

/**
 * สำเนาที่ API ถืออยู่ยืนยันกับต้นทางครั้งล่าสุด (`fetchedAt`) เก่ากว่า `staleAfterSeconds` ของ descriptor หรือไม่
 * — `fetchedAt` null = ไม่เคย (จัดการเป็นสถานะ `never-fetched` ไม่ใช่ "เก่า")
 */
export function copyIsOld(station: Pick<RiverForecastStation, "fetchedAt">, nowMs: number, staleAfterSeconds: number): boolean {
  if (station.fetchedAt === null) return false;
  const ms = Date.parse(station.fetchedAt);
  return Number.isFinite(ms) && nowMs - ms > staleAfterSeconds * 1000;
}

/** อายุจากเวลาของแบบจำลองถึงเวลาอ้างอิง — เลขคณิตล้วน (ไม่ใช่การคาดการณ์) ใช้เฉพาะโหมดสด */
export type RelativeTime =
  | { dir: "now" }
  | { dir: "future" | "past"; unit: "h" | "d"; n: number };

/** < 1 ชม. (ปัด) = now; ต่ำกว่า 48 ชม. นับเป็นชั่วโมง ไม่งั้นเป็นวัน — เวลาที่ผ่านไปแล้วยังบอกว่า "ผ่านไปแล้ว" ไม่พิมพ์ค่าลบ */
export function relativeTime(targetMs: number, nowMs: number): RelativeTime {
  const diff = targetMs - nowMs;
  const hours = Math.round(Math.abs(diff) / HOUR_MS);
  if (hours < 1) return { dir: "now" };
  const dir = diff > 0 ? "future" : "past";
  return hours < 48 ? { dir, unit: "h", n: hours } : { dir, unit: "d", n: Math.round(hours / 24) };
}

/** สถานีหนึ่งในผลลัพธ์ พร้อมสรุปและสถานะความสดที่คำนวณแล้ว — หน่วยที่แผงนำไปเรนเดอร์ */
export interface ForecastEntry {
  station: RiverForecastStation;
  summary: ForecastSummary;
  published: PublishedState;
  /** สำเนาของ API เก่ากว่า `staleAfterSeconds` (ไม่ใช่ไฟล์ของ HII เก่า — สองแกนแยกกัน) */
  copyOld: boolean;
  /** หรี่: ไฟล์ของ HII เก่ากว่า `FORECAST_STALE_MS`, สำเนาของ API เก่า หรือคำขอของเว็บพลาดในรอบล่าสุด */
  dim: boolean;
}

export function buildForecastIndex(
  stations: readonly RiverForecastStation[],
  /** `layer.staleAfterSeconds` — null/undefined = descriptor ไม่ประกาศ จึงไม่ตัดสินว่าสำเนาเก่า */
  opts: { staleAfterSeconds: number | null | undefined; nowMs: number; requestFailed: boolean },
): Map<string, ForecastEntry> {
  return new Map(
    stations.map((station) => {
      const published = publishedState(station, opts.nowMs);
      const copyOld = opts.staleAfterSeconds != null && copyIsOld(station, opts.nowMs, opts.staleAfterSeconds);
      return [
        station.code,
        {
          station,
          summary: summarizeStation(station),
          published,
          copyOld,
          dim: published.kind === "stale" || copyOld || opts.requestFailed,
        },
      ];
    }),
  );
}

// ─── กราฟ ─────────────────────────────────────────────────────────────

export interface ObservedPoint {
  t: number;
  v: number;
}

/**
 * ค่าตรวจวัดที่วาดคู่กับส่วนพยากรณ์ — เฉพาะสถานีลำน้ำที่มี `history48h` (อัตราการไหล ลบ.ม./วินาที หน่วยเดียวกับ
 * ส่วนพยากรณ์ชนิด `discharge`) สถานีระดับน้ำที่ไม่อยู่บนเส้นทางไม่มีค่าตรวจวัดชุดนี้ = `[]` ไม่ใช่เส้นแบน;
 * ชนิด `waterlevel` ไม่ผสมกับ `discharge` ที่นี่เด็ดขาด
 */
export function observedForChart(
  kind: RiverForecastKind,
  history: readonly NorthRouteHistoryPoint[] | null | undefined,
  nowMs: number,
): ObservedPoint[] {
  if (kind !== "discharge" || !history) return [];
  const from = nowMs - 48 * HOUR_MS;
  return history
    .map((p) => ({ t: Date.parse(p.t), v: p.discharge }))
    .filter((p): p is ObservedPoint => Number.isFinite(p.t) && isNum(p.v) && p.t >= from && p.t <= nowMs)
    .sort((a, b) => a.t - b.t);
}

export interface ChartModel {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  observedPath: string | null;
  forecastPath: string | null;
  /** ตำแหน่ง x ของ "ตอนนี้" — null เมื่ออยู่นอกช่วงที่วาด */
  nowX: number | null;
  peak: { x: number; y: number } | null;
  /** เกณฑ์ที่ตกอยู่ในช่วง y ที่วาดเท่านั้น (เกณฑ์ที่อยู่ไกลไม่ดึงแกนให้ยืด) */
  thresholdLines: { level: ThresholdLevel; y: number; value: number }[];
}

const linePath = (pts: readonly (readonly [number, number])[]) =>
  pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

/**
 * เรขาคณิตของกราฟ SVG หนึ่งสถานี: ช่วง y มาจากค่าที่วาดจริง (ค่าตรวจวัด + ส่วนพยากรณ์) บวกขอบ 8 % (ชนิด `discharge`
 * ไม่ลงต่ำกว่า 0); ส่วนพยากรณ์ก่อน `publishedAt` ไม่ถูกส่งเข้ามาที่นี่เลย (ดู `forecastPart`) — คืน null เมื่อไม่มีจุดพยากรณ์
 */
export function chartModel(input: {
  kind: RiverForecastKind;
  observed: readonly ObservedPoint[];
  forecast: readonly ForecastPoint[];
  thresholds: RiverForecastThresholds | null;
  peak: ForecastPeak | null;
  nowMs: number;
  width: number;
  height: number;
  pad: number;
}): ChartModel | null {
  const { observed, forecast, width, height, pad } = input;
  if (forecast.length === 0) return null;
  const xMin = Math.min(observed.length ? observed[0].t : Infinity, forecast[0][0]);
  const xMax = forecast[forecast.length - 1][0];
  const values = [...observed.map((p) => p.v), ...forecast.map((p) => p[1])];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const span = hi - lo;
  const margin = span > 0 ? span * 0.08 : Math.max(1, Math.abs(hi) * 0.05);
  lo -= margin;
  hi += margin;
  if (input.kind === "discharge" && lo < 0) lo = 0;
  const x = (ms: number) => pad + ((ms - xMin) / Math.max(1, xMax - xMin)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - lo) / (hi - lo)) * (height - pad * 2);
  const thresholdLines: ChartModel["thresholdLines"] = [];
  for (const level of THRESHOLD_LEVELS_DESC) {
    const value = input.thresholds?.[level];
    if (isNum(value) && value >= lo && value <= hi) thresholdLines.push({ level, y: y(value), value });
  }
  return {
    xMin,
    xMax,
    yMin: lo,
    yMax: hi,
    observedPath: observed.length >= 2 ? linePath(observed.map((p) => [x(p.t), y(p.v)])) : null,
    forecastPath: forecast.length >= 2 ? linePath(forecast.map((p) => [x(p[0]), y(p[1])])) : null,
    nowX: input.nowMs >= xMin && input.nowMs <= xMax ? x(input.nowMs) : null,
    peak: input.peak ? { x: x(input.peak.t), y: y(input.peak.value) } : null,
    thresholdLines,
  };
}

/**
 * ตำแหน่ง y ของป้ายเกณฑ์ที่เรียงจากบนลงล่าง: ป้ายอยู่เหนือเส้นของมัน 2 หน่วย และถูกดันลงให้ห่างป้ายก่อนหน้าอย่างน้อย
 * `gap` (เกณฑ์ที่ค่าใกล้กันจึงไม่ทับกัน) — ฟังก์ชันล้วน ไม่แก้ค่าที่รับเข้ามา
 */
export function stackLabelYs(lineYs: readonly number[], gap: number): number[] {
  return [...lineYs]
    .sort((a, b) => a - b)
    .reduce<number[]>((out, y) => [...out, Math.max(y - 2, out.length ? out[out.length - 1] + gap : -Infinity)], []);
}

// ─── จังหวัด ──────────────────────────────────────────────────────────

/**
 * ชื่อจังหวัดตามข้อความที่ HII เผยแพร่ ("จ.นนทบุรี") → รหัสจังหวัดของแอป — ตัดคำนำหน้า "จ."/"จังหวัด" แล้วเทียบชื่อเต็ม
 * ตรงตัวเท่านั้น; ไม่ตรง/ไม่มีข้อความ = null (ไม่เดา)
 */
export function provinceCodeFromThai(
  text: string | null,
  provinces: readonly { code: string; nameTh: string }[],
): string | null {
  if (!text) return null;
  const name = text.trim().replace(/^(จังหวัด|จ\.)\s*/, "");
  return provinces.find((p) => p.nameTh === name)?.code ?? null;
}

/**
 * แถว "ไม่มีสถานีตรวจวัดของเส้นทางในจังหวัด" — **การตัดสินใจของเจ้าของโครงการ 2026-09-29** ไม่ใช่ค่าที่เราคำนวณ:
 * - นนทบุรี (12) ไม่มีสถานีบนเส้นทาง แต่มีสถานีระดับน้ำ CPY014 ในผลลัพธ์ของ HII (แสดงเฉพาะค่าของแบบจำลอง ไม่มีค่าตรวจวัด)
 * - ปทุมธานี (13) ไม่มีสถานีใดเลย → แสดงสถานีข้างเคียงเป็น "อ้างอิง" (C.35 อยุธยา ต้นน้ำ / CPY014 นนทบุรี ท้ายน้ำ)
 *   ไม่มีเวลาที่ประมาณให้ปทุมธานีเอง ไม่มีระดับความรุนแรง
 * เทสยืนยันว่าผังคงที่ (`north-route.json`) ไม่มีสถานีในสองจังหวัดนี้จริง
 */
export const NO_STATION_PROVINCES: readonly { provinceCode: string; referenceCodes: readonly string[] }[] = [
  { provinceCode: "12", referenceCodes: [] },
  { provinceCode: "13", referenceCodes: ["C.35", "CPY014"] },
];

/**
 * สถานีพยากรณ์ของแต่ละจังหวัด: สถานีที่รหัสตรงกับสถานีบนเส้นทางใช้จังหวัดจากผังคงที่ (point-in-polygon) ส่วนสถานีที่ไม่อยู่บน
 * เส้นทาง (CPY014) ใช้ชื่อจังหวัดที่ HII เผยแพร่ ถ้าชื่อไม่ตรงจังหวัดใดก็ไม่ผูกกับจังหวัดใด
 */
export function forecastStationsByProvince<S extends Pick<RiverForecastStation, "code" | "province">>(
  routeStations: readonly { ridCode: string; provinceCode: string | null }[],
  stations: readonly S[],
  provinces: readonly { code: string; nameTh: string }[],
): Map<string, S[]> {
  const routeProvince = new Map(routeStations.map((r) => [r.ridCode, r.provinceCode]));
  const out = new Map<string, S[]>();
  for (const s of stations) {
    const code = routeProvince.has(s.code) ? routeProvince.get(s.code)! : provinceCodeFromThai(s.province, provinces);
    if (code === null) continue;
    const list = out.get(code) ?? [];
    list.push(s);
    out.set(code, list);
  }
  return out;
}
