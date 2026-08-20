import type {
  ExposureFactors,
  ExposureLevel,
  FloodExposureRun,
  HazardLayerDescriptor,
  RainfallObservation,
  SituationLevel,
  StationExposure,
  WaterLevelHistoryPoint,
  WaterLevelObservation,
} from "@siahra/shared-types";

/**
 * คำนวณ "ระดับการเผชิญน้ำ (ภาพประกอบ)" หนึ่ง run — ฟังก์ชันบริสุทธิ์ล้วน ๆ (E10.2)
 *
 * สิ่งที่โมดูลนี้ทำมีอย่างเดียว: **จัดอันดับค่าที่สถานีรายงานมาแล้ว** ตามตารางเกณฑ์ที่
 * ประกาศไว้ใน `docs/methodology/flood-exposure.md` ไม่มีการพยากรณ์ ไม่มีค่าความน่าจะเป็น
 * ไม่มีคะแนนความเสี่ยง และ **ไม่มีการเติมค่าที่ต้นทางไม่ได้ส่งมา** — ปัจจัยที่ขาดคือ `null`
 * แล้วระดับก็มาจากปัจจัยที่มีจริงเท่านั้น (ไม่ใช่ถูกนับเป็นศูนย์ ไม่ใช่ interpolate
 * จากสถานีข้างเคียง)
 *
 * ข้อบังคับสามข้อที่โค้ดนี้ต้องรักษาไว้ตลอด:
 *
 * 1. **deterministic** — ไม่มีการอ่านนาฬิกา ไม่มีการสุ่ม ไม่พึ่งลำดับที่ต้นทางส่งมา
 *    (สถานีถูกเรียงตาม `stationId` ก่อนคิด `runId` เสมอ) อินพุตเดิม → ผลลัพธ์เดิมทุกไบต์
 * 2. **`provinceCode` คัดลอกมาตรง ๆ** จาก `StationRef.provinceCode` และคง `null` ไว้
 *    ห้ามเดาจากพิกัด ห้ามหาใหม่ตอนเรียก API ห้ามเติมย้อนหลังลง run ที่เผยแพร่ไปแล้ว
 * 3. **`fetchedAt` คง `null` ไว้** — ถ้ายังไม่เคยดึง ThaiWater สำเร็จ ทั้ง
 *    `inputs.thaiwaterFetchedAt` และ `layer.fetchedAt` เป็น `null` ห้ามแทนด้วย `now`
 *
 * ไม่มี zod ที่นี่โดยตั้งใจ: อินพุตเป็นชนิดที่ผ่านการ normalise/validate มาแล้วจาก
 * ชั้น ingestion (E4.3/E4.4) การ validate ซ้ำที่นี่คือการย้ายขอบเขตความรับผิดชอบ
 */

/** หน้าเอกสารวิธีคำนวณบนเว็บแอป (เรนเดอร์ `docs/methodology/flood-exposure.md`) */
export const FLOOD_EXPOSURE_METHODOLOGY_URL = "/methodology/flood-exposure";

/** ปัจจัยที่ "ค่ายิ่งมากยิ่งหนัก" — เข้าแถบเมื่อ `value > above` */
export interface RisingBand {
  readonly level: ExposureLevel;
  readonly above: number;
}

/** ปัจจัยที่ "ค่ายิ่งน้อยยิ่งหนัก" — เข้าแถบเมื่อ `value < below` */
export interface FallingBand {
  readonly level: ExposureLevel;
  readonly below: number;
}

/**
 * ตารางเกณฑ์ทั้งชุด = ข้อมูลล้วน ไม่มีตรรกะซ่อน จึงทดสอบทีละแถวได้ และเอกสาร
 * methodology กับไฟล์นี้เทียบกันได้ตรง ๆ
 */
export interface ExposureThresholds {
  /** ชั่วโมงย้อนหลังที่ใช้หาอัตราการเปลี่ยนของ freeboard */
  readonly historyWindowH: number;
  readonly rain1hMm: readonly RisingBand[];
  readonly rain24hMm: readonly RisingBand[];
  readonly freeboardM: readonly FallingBand[];
  readonly freeboardTrendMPerH: readonly FallingBand[];
  /** ระดับสถานการณ์ของ ThaiWater ส่งผ่านตรง ๆ ไม่คำนวณใหม่ (1 = น้ำน้อย … 5 = ล้นตลิ่ง) */
  readonly situationLevel: Readonly<Record<SituationLevel, ExposureLevel>>;
}

/**
 * ค่าตั้งต้น — ตรงกับตารางใน `docs/methodology/flood-exposure.md` แถวต่อแถว
 *
 * `rain24hMm` มาจากเกณฑ์ฝนที่กรมอุตุนิยมวิทยาประกาศ (ฝนปานกลาง/หนัก/หนักมาก)
 * ส่วน `rain1hMm` ไม่มีเกณฑ์ทางการรายชั่วโมงให้อ้าง จึงเป็นข้อตกลงของโปรเจกต์นี้เอง
 * และประกาศไว้เป็นตัวเลขทั้งในเอกสารและตรงนี้
 */
export const DEFAULT_EXPOSURE_THRESHOLDS: ExposureThresholds = {
  historyWindowH: 3,
  rain1hMm: [
    { level: "severe", above: 60 },
    { level: "high", above: 30 },
    { level: "elevated", above: 10 },
  ],
  rain24hMm: [
    { level: "severe", above: 90 },
    { level: "high", above: 35 },
    { level: "elevated", above: 10 },
  ],
  freeboardM: [
    { level: "severe", below: 0.3 },
    { level: "high", below: 1 },
    { level: "elevated", below: 3 },
  ],
  // ตั้งไว้สูงโดยตั้งใจ: แม่น้ำใหญ่ที่ยังห่างตลิ่งมากก็ขึ้นลงเร็วได้ตามปกติ
  freeboardTrendMPerH: [
    { level: "severe", below: -0.75 },
    { level: "high", below: -0.35 },
    { level: "elevated", below: -0.15 },
  ],
  situationLevel: { 1: "low", 2: "low", 3: "low", 4: "high", 5: "severe" },
};

/** ค่าตรวจวัดหนึ่งชุดที่ใช้คำนวณ run — `fetchedAt` คือเวลาที่ดึง ThaiWater สำเร็จล่าสุด */
export interface ExposureObservations {
  readonly rainfall: readonly RainfallObservation[];
  readonly waterlevel: readonly WaterLevelObservation[];
  /** null = ยังไม่เคยดึงสำเร็จ (ห้ามแทนด้วยเวลาปัจจุบัน) */
  readonly fetchedAt: string | null;
}

/**
 * ประวัติระดับน้ำของสถานีหนึ่ง ใช้หา `freeboardTrendMPerH` เท่านั้น
 *
 * ถ้ามีหลายรายการที่ `stationId` เดียวกัน จุดของทุกรายการถูกนำมารวมกัน ไม่มีรายการใด
 * ถูกทับหาย (ดูหมายเหตุใน `computeExposure`)
 */
export interface StationHourlyLevels {
  readonly stationId: number;
  /** ลำดับใด ๆ ก็ได้ — โมดูลนี้เรียงเองด้วย total order `(เวลา, ค่า)` */
  readonly points: readonly WaterLevelHistoryPoint[];
}

/** อันดับของระดับ ใช้หา "แถบที่สูงที่สุด" เท่านั้น ไม่ใช่คะแนน */
const RANK: Record<ExposureLevel, number> = { low: 0, elevated: 1, high: 2, severe: 3 };

function higher(a: ExposureLevel, b: ExposureLevel): ExposureLevel {
  return RANK[b] > RANK[a] ? b : a;
}

function bandOfRising(value: number | null, bands: readonly RisingBand[]): ExposureLevel | null {
  if (value === null || !Number.isFinite(value)) return null;
  for (const band of bands) if (value > band.above) return band.level;
  return "low";
}

function bandOfFalling(value: number | null, bands: readonly FallingBand[]): ExposureLevel | null {
  if (value === null || !Number.isFinite(value)) return null;
  for (const band of bands) if (value < band.below) return band.level;
  return "low";
}

/** เวลาที่ "ใหม่กว่า" ในสองค่า */
function newer(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** ผลของ `freeboardTrend` — พก `earliestMs` ของจุดเก่าสุดที่ใช้จริงติดมาด้วย เพื่อให้
 * ผู้เรียกคำนวณ `observedAt` ของสถานีได้ถูกต้อง (ดูหมายเหตุที่จุดเรียกใน `computeExposure`) */
interface FreeboardTrend {
  readonly trend: number;
  readonly earliestMs: number;
}

/**
 * อัตราการเปลี่ยนของ freeboard (ม./ชม.) จากจุดแรกกับจุดสุดท้ายในหน้าต่างย้อนหลัง
 *
 * ค่าเป็นลบ = น้ำกำลังขึ้นเข้าหาตลิ่ง (freeboard ลดลง) เป็น **อัตราที่เกิดไปแล้ว**
 * ไม่ใช่การต่อเส้นไปข้างหน้า จุดที่ใช้ได้น้อยกว่าสองจุด หรือจุดที่ใช้ได้ทั้งหมดตกอยู่ที่
 * เวลาเดียวกัน → `null`
 *
 * `points` มาในลำดับใดก็ได้ และต้นทางส่งสองค่าที่เวลาเดียวกันมาได้ การเรียงจึงต้องเป็น
 * **total order**: เรียงตามเวลาก่อน แล้วตัดสินเวลาที่เท่ากันด้วยค่าจากน้อยไปมาก
 * (ถ้าปล่อยให้ sort ที่เสถียรคงลำดับเดิมไว้ ระดับที่เผยแพร่จะพลิกตามลำดับของอาเรย์เพียว ๆ)
 * ผลของกฎนี้คือที่เวลาแรกเลือกค่าน้อยสุด ที่เวลาสุดท้ายเลือกค่ามากสุด — ประกาศไว้ใน
 * `docs/methodology/flood-exposure.md` §ขั้นตอนการคำนวณ ข้อ 2
 */
function freeboardTrend(
  points: readonly WaterLevelHistoryPoint[] | undefined,
  windowH: number,
  nowMs: number,
): FreeboardTrend | null {
  if (!points || points.length < 2) return null;
  const fromMs = nowMs - windowH * 3_600_000;
  const usable = points
    .map((p) => ({ ms: Date.parse(p.t), value: p.value }))
    .filter(
      (p): p is { ms: number; value: number } =>
        Number.isFinite(p.ms) && p.value !== null && Number.isFinite(p.value) &&
        p.ms >= fromMs && p.ms <= nowMs,
    )
    .sort((a, b) => a.ms - b.ms || a.value - b.value);
  if (usable.length < 2) return null;
  const first = usable[0];
  const last = usable[usable.length - 1];
  const hours = (last.ms - first.ms) / 3_600_000;
  if (hours <= 0) return null;
  // freeboard = ตลิ่ง − ระดับน้ำ ดังนั้นระดับน้ำขึ้น 1 ม./ชม. = freeboard −1 ม./ชม.
  return { trend: round3(-(last.value - first.value) / hours), earliestMs: first.ms };
}

/** ปัดเป็นมิลลิเมตรต่อชั่วโมง เพื่อไม่ให้เศษทศนิยมลอยทำให้ runId เปลี่ยนโดยไม่มีเหตุ */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** เวลาวัดในรูปตัวเลข — ไม่มีเวลา/อ่านไม่ออก = `-Infinity` เพื่อให้เทียบกันได้เสมอ */
function observedMs(t: string | null): number {
  if (t === null) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * เวลาวัดที่ "เก่าที่สุด" ในบรรดาปัจจัยที่ "มีจริง" ของสถานีหนึ่ง — ใช้คำนวณ
 * `StationExposure.observedAt` ตามสัญญาใน `packages/shared-types/src/exposure.ts`:
 * ค่านี้ต้องเก่าไม่น้อยกว่าปัจจัยใดปัจจัยหนึ่งที่ประกอบขึ้นเป็นระดับ (ไม่ใช่แค่ค่า
 * ล่าสุดตัวเดียว) `freeboardTrendMPerH` มาจากจุดประวัติที่อาจเก่ากว่าค่าล่าสุดของ
 * ระดับน้ำ (`w.observedAt`) จึงต้องถูกนับรวมด้วยถ้ามันมีอยู่จริง
 *
 * ใช้ `observedMs()` แปลงแต่ละค่าแล้ว**กรองเอาเฉพาะค่าที่จำกัด (finite) ออกก่อน**
 * ถึงจะหาค่าน้อยสุด — ห้าม `Math.min` ตรง ๆ บนค่าที่ยังไม่กรอง เพราะ `observedMs(null)`
 * คืน `-Infinity` ซึ่งจะ "ชนะ" ทุกครั้งทั้งที่ไม่มีเวลาจริงอยู่เลย (ปัจจัยที่ไม่มีเวลา
 * ต้องถูกข้าม ไม่ใช่ถูกนับเป็น "เก่าที่สุดเท่าที่จะเป็นไปได้")
 */
function oldestObservedIso(candidates: readonly (string | null)[]): string | null {
  const finiteMs = candidates.map(observedMs).filter((ms) => Number.isFinite(ms));
  if (finiteMs.length === 0) return null;
  return new Date(Math.min(...finiteMs)).toISOString();
}

/**
 * ต้นทางส่งสถานีเดิมมาซ้ำในชุดเดียวกันได้ (ไม่ควรเกิด แต่เคยเกิด) — ต้องเลือกระเบียน
 * ด้วยกฎที่ **ไม่ขึ้นกับลำดับที่ส่งมา** ไม่งั้น run ที่เนื้อหาเท่ากันจะได้ `runId` ต่างกัน
 * เพียงเพราะอาเรย์สลับที่
 *
 * กุญแจเปรียบเทียบคือ `(เวลาวัด มาก→น้อย, สตริงของระเบียน น้อย→มาก)` ซึ่งเป็น
 * **total order** เต็มรูป: ระเบียนที่มีเวลาวัดจริงชนะระเบียนที่ไม่มีเวลา (หรือเวลาที่
 * อ่านไม่ออก) เสมอ เพราะฝั่งหลังถูกแทนด้วย `-Infinity` แล้วจึงถอยไปเทียบสตริงเฉพาะเมื่อ
 * เวลาเท่ากันจริง ๆ เท่านั้น เสมอกันทั้งสองชั้น = เนื้อหาเหมือนกันทุกไบต์ จะเลือกตัวไหน
 * ก็ให้ผลเดียวกัน การพับ (fold) ด้วยกฎนี้จึงเป็น "หาค่ามากสุด" ที่ลำดับไม่มีผล
 *
 * (เดิมมีเงื่อนไข `Number.isFinite(ta - tb)` คร่อมอยู่ ซึ่งกลายเป็นเท็จพอดีตอนที่ฝั่งหนึ่ง
 * เป็น `-Infinity` — คือกรณีที่กฎนี้มีไว้ใช้ — ระเบียนที่มีเวลาวัดจริงจึงเคยแพ้ระเบียน
 * ที่ไม่มีเวลา และ `observedAt` ของสถานีกลายเป็น null ทั้งที่มีค่าที่วัดจริงอยู่)
 */
function preferRecord<T extends { observedAt: string | null }>(a: T, b: T): T {
  const ta = observedMs(a.observedAt);
  const tb = observedMs(b.observedAt);
  if (ta !== tb) return ta > tb ? a : b;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa <= sb ? a : b;
}

/** ยุบระเบียนซ้ำของสถานีเดียวกันให้เหลือหนึ่ง ก่อนนำไปรวมข้ามชนิด */
function dedupe<T extends { station: { id: number }; observedAt: string | null }>(
  rows: readonly T[],
): T[] {
  const byId = new Map<number, T>();
  for (const row of rows) {
    const existing = byId.get(row.station.id);
    byId.set(row.station.id, existing ? preferRecord(existing, row) : row);
  }
  return [...byId.values()];
}

/** ระเบียนที่รวมแล้วของสถานีหนึ่ง ก่อนถูกจัดแถบ */
interface Merged {
  stationId: number;
  stationKind: "rainfall" | "waterlevel";
  provinceCode: string | null;
  lat: number;
  lon: number;
  factors: ExposureFactors;
  observedAt: string | null;
}

/**
 * FNV-1a 64 บิต บนสตริง UTF-8 — ใช้ตรวจว่า "เนื้อหาเปลี่ยนหรือไม่" เท่านั้น
 * ไม่ใช่ hash เชิงรหัสลับ (เลือก 64 บิตเพราะ 32 บิตชนกันบ่อยเกินไปเมื่อมี run
 * ระดับแสนรายการต่อปี ซึ่งจะทำให้ E10.3 คิดว่า "ไม่มีอะไรเปลี่ยน" ทั้งที่เปลี่ยน)
 */
export function fnv1a64Hex(input: string): string {
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash = ((hash ^ BigInt(byte)) * PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/** `2026-08-19T09:30:00.000Z` → `20260819T093000Z` */
function compactUtc(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/**
 * คำนวณ run หนึ่งชุด
 *
 * @param observations ค่าตรวจวัดล่าสุดจาก ThaiWater (ฝน + ระดับน้ำ) พร้อม `fetchedAt`
 * @param hourlyLevels ประวัติระดับน้ำรายสถานี ใช้เฉพาะหา `freeboardTrendMPerH`
 * @param thresholds ตารางเกณฑ์ (ปกติคือ `DEFAULT_EXPOSURE_THRESHOLDS`)
 * @param now เวลาปัจจุบันที่ผู้เรียกส่งเข้ามา — ฟังก์ชันนี้ไม่อ่านนาฬิกาเอง
 *
 * สถานีศูนย์ตัวเป็น run ที่ถูกต้อง ไม่ใช่ข้อผิดพลาด
 */
export function computeExposure(
  observations: ExposureObservations,
  hourlyLevels: readonly StationHourlyLevels[],
  thresholds: ExposureThresholds,
  now: Date,
): FloodExposureRun {
  const nowMs = now.getTime();
  // ต้นทางส่งประวัติของสถานีเดียวกันมาหลายก้อนได้ ถ้าเขียนทับกันตรง ๆ ก้อนที่มาทีหลัง
  // ในอาเรย์จะชนะ = ผลลัพธ์ขึ้นกับลำดับอีกจุดหนึ่ง จึง **ต่อจุดทุกก้อนเข้าด้วยกัน**
  // ไม่ทิ้งค่าที่วัดจริงทิ้งไป แล้วปล่อยให้ `freeboardTrend` เรียงด้วย total order
  // `(เวลา, ค่า)` เอง — ผลจึงขึ้นกับเนื้อหาอย่างเดียว ไม่ขึ้นกับลำดับที่ต่อกัน
  const history = new Map<number, WaterLevelHistoryPoint[]>();
  for (const h of hourlyLevels) {
    const existing = history.get(h.stationId);
    if (existing) existing.push(...h.points);
    else history.set(h.stationId, [...h.points]);
  }

  const merged = new Map<string, Merged>();
  // เวลาที่วัดจริง**ล่าสุด**ในบรรดาสถานี (ไม่ถูกถอยหลังตาม `freeboardTrendMPerH`) —
  // นี่คือค่าที่ใช้เป็น `layer.observedAt` (นิยามเดียวกับ `ObservationSummary.latestObservedAt`)
  // ต้องคิดจากเวลาดิบที่ต้นทางส่งมาตรง ๆ ระหว่างประกอบสถานี **ไม่ใช่** จาก
  // `StationExposure.observedAt` หลังถูกถอยหลังแล้ว มิฉะนั้น layer ทั้งชั้นจะแก่ตัว
  // ไปตาม `historyWindowH` ของสถานีที่แก่ที่สุดโดยไม่มีเหตุผล (นี่คือคนละสัญญากับ
  // `StationExposure.observedAt` ซึ่งต้อง "ไม่ใหม่กว่า" ปัจจัยที่ใช้จริงของสถานีนั้น)
  let latestObservedAt: string | null = null;

  // รหัสสถานีฝนและระดับน้ำอยู่คนละ namespace ของ ThaiWater — เลขที่ตรงกันจึงไม่ใช่
  // หลักฐานว่าเป็นสถานีเดียวกัน และห้ามนำปัจจัยของคนละสถานีมารวมเป็นหมุดเดียว
  // ระเบียนซ้ำ *ภายในชนิดเดียวกัน* ถูกยุบด้วย `dedupe` ก่อน เพื่อให้ลำดับจากต้นทาง
  // ไม่มีผลต่อค่าและต่อ `runId`
  for (const r of dedupe(observations.rainfall)) {
    merged.set(`rainfall:${r.station.id}`, {
      stationId: r.station.id,
      stationKind: "rainfall",
      // คัดลอกมาตรง ๆ คง null ไว้ตามที่ต้นทางส่งมา — ห้ามเดาจากพิกัด
      provinceCode: r.station.provinceCode,
      lat: r.station.lat,
      lon: r.station.lon,
      factors: {
        rain1hMm: r.rain1h,
        rain24hMm: r.rain24h,
        freeboardM: null,
        freeboardTrendMPerH: null,
        situationLevel: null,
      },
      observedAt: r.observedAt,
    });
    latestObservedAt = newer(latestObservedAt, r.observedAt);
  }

  for (const w of dedupe(observations.waterlevel)) {
    const trendResult = freeboardTrend(history.get(w.station.id), thresholds.historyWindowH, nowMs);
    const factors: ExposureFactors = {
      rain1hMm: null,
      rain24hMm: null,
      freeboardM: w.freeboardM,
      freeboardTrendMPerH: trendResult?.trend ?? null,
      situationLevel: w.situationLevel,
    };
    // `observedAt` ของสถานีต้อง "ไม่ใหม่กว่า" ปัจจัยใดปัจจัยหนึ่งที่ใช้จริง — ถ้ามี
    // trend ต้องเทียบกับเวลาของจุดประวัติที่เก่าที่สุดที่ trend ใช้ด้วย ไม่ใช่แค่เวลา
    // ของค่าระดับน้ำล่าสุดตัวเดียว (ดู `oldestObservedIso`) — แต่ `latestObservedAt`
    // ของทั้งชั้นต้องยึดเวลาดิบ `w.observedAt` เท่านั้น ไม่ใช่ผลถอยหลังนี้ (ดูหมายเหตุ
    // ที่ประกาศตัวแปรข้างบน)
    const observedAt = oldestObservedIso([
      w.observedAt,
      trendResult === null ? null : new Date(trendResult.earliestMs).toISOString(),
    ]);
    merged.set(`waterlevel:${w.station.id}`, {
      stationId: w.station.id,
      stationKind: "waterlevel",
      provinceCode: w.station.provinceCode,
      lat: w.station.lat,
      lon: w.station.lon,
      factors,
      observedAt,
    });
    latestObservedAt = newer(latestObservedAt, w.observedAt);
  }

  const stations: StationExposure[] = [...merged.values()]
    .sort((a, b) =>
      a.stationKind === b.stationKind
        ? a.stationId - b.stationId
        : a.stationKind === "rainfall"
          ? -1
          : 1,
    )
    .map((m) => ({
      stationId: m.stationId,
      stationKind: m.stationKind,
      provinceCode: m.provinceCode,
      lat: m.lat,
      lon: m.lon,
      level: levelOf(m.factors, thresholds),
      factors: m.factors,
      observedAt: m.observedAt,
    }));

  // `latestObservedAt` คำนวณไว้แล้วระหว่างประกอบ `merged` ข้างบน (จากเวลาดิบ ไม่ใช่
  // `stations[].observedAt` ที่อาจถูกถอยหลังแล้ว) — ไม่ใช่ `now` และไม่ใช่ `fetchedAt`

  const computedAt = new Date(nowMs).toISOString();
  const inputs = {
    // คง null ไว้เสมอ — ยังไม่เคยดึงสำเร็จ ก็ต้องอ่านออกว่ายังไม่เคย
    thaiwaterFetchedAt: observations.fetchedAt,
    historyWindowH: thresholds.historyWindowH,
  };
  const layer: HazardLayerDescriptor = {
    id: "flood-exposure",
    // ห้ามเป็น "probabilistic" — ไม่มีแบบจำลองที่อ้างอิงได้อยู่เบื้องหลังค่าเหล่านี้
    epistemicClass: "illustrative",
    liveOrStatic: "live",
    ...(latestObservedAt === null ? {} : { observedAt: latestObservedAt }),
    // ต้นทางไม่ได้ประกาศเวลาเผยแพร่ของชุดค่าตรวจวัด
    publishedAt: null,
    fetchedAt: observations.fetchedAt,
    staleAfterSeconds: 1800,
    methodologyUrl: FLOOD_EXPOSURE_METHODOLOGY_URL,
    sourceIds: ["thaiwater"],
  };

  const runId = `${compactUtc(computedAt)}-${fnv1a64Hex(JSON.stringify({ inputs, layer, stations }))}`;
  return { runId, computedAt, inputs, layer, stations };
}

/**
 * ระดับของสถานี = แถบที่สูงที่สุดที่ปัจจัยใดปัจจัยหนึ่งไปถึง ไม่ใช่คะแนนรวม
 * ปัจจัยที่เป็น `null` ไม่ถูกนับเลย (ไม่ใช่ถูกนับเป็นศูนย์) และสถานีที่ไม่มีปัจจัย
 * ใช้ได้เลยได้ `low` ซึ่งอ่านว่า "ไม่มีข้อมูลจะจัดอันดับ" — legend มีหน้าที่บอกต่อ
 */
export function levelOf(factors: ExposureFactors, thresholds: ExposureThresholds): ExposureLevel {
  const candidates: (ExposureLevel | null)[] = [
    bandOfRising(factors.rain1hMm, thresholds.rain1hMm),
    bandOfRising(factors.rain24hMm, thresholds.rain24hMm),
    bandOfFalling(factors.freeboardM, thresholds.freeboardM),
    bandOfFalling(factors.freeboardTrendMPerH, thresholds.freeboardTrendMPerH),
    factors.situationLevel === null ? null : thresholds.situationLevel[factors.situationLevel],
  ];
  let level: ExposureLevel = "low";
  for (const c of candidates) if (c !== null) level = higher(level, c);
  return level;
}
