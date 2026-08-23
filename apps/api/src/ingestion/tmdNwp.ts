import { isProvinceCode, type ForecastStep } from "@siahra/shared-types";
import { UpstreamShapeError, readUpstreamJson } from "./errors.js";
import { assertNwpAvailability, assertNwpRegionDocument } from "./schemas/tmdNwp.js";

/**
 * TMD NWP (numerical weather prediction) — ผลพยากรณ์เชิงกำหนด (deterministic)
 * ของกรมอุตุนิยมวิทยา ผ่าน `data.tmd.go.th/nwpapi/v1`
 *
 * ข้อเท็จจริงที่วัดเองเมื่อ 2026-08-23 ด้วย token จริง และเป็นเหตุผลของรูปโค้ดนี้:
 *
 * 1. **`/region` ตอบทั้งภาคในคำขอเดียว** หกภาค `C,N,NE,E,S,W` รวมกันได้ครบ 77
 *    จังหวัดพอดี ไม่ซ้ำไม่ขาด และ `location.geocode` คือรหัสจังหวัดที่ตรงกับ
 *    `PROVINCE_CODES` ทุกตัว → หนึ่งรอบ = **12 คำขอ** (6 ภาค × hourly/daily)
 *    ไม่ใช่ 77 หรือ 154 และไม่ต้องจับคู่ชื่อภาษาไทยเลย
 * 2. **ไม่มีเวลารอบรันของแบบจำลอง** ทั้งในบอดี้และใน header — มีแต่ valid time
 *    ของแต่ละขั้น `forecast.issuedAt` ของแหล่งนี้จึงเป็น `null` เสมอ และห้าม
 *    เอา `fetchedAt` มาสวมแทน (กฎเดียวกับ `publishedAt` ใน hazard-layer.ts)
 * 3. **`rain: 0` คือค่าจริง** ไม่ใช่ค่าที่หายไป ตัวอย่างที่เก็บไว้มีฝนตั้งแต่ 0
 *    ถึง 68.7 มม. โดยไม่มี null เลย การแยก "ไม่มีค่า" จึงต้องดูที่ **คีย์หายไป**
 *    ไม่ใช่ดูว่าค่ามัน falsy
 * 4. **daily ไม่มี `tc` เดี่ยว** (มีแต่ `tc_max`/`tc_min`) `ForecastStep.tempC`
 *    ของทุกขั้นรายวันจึงเป็น `null` ตามความจริงของต้นทาง ไม่ใช่เพราะเราไม่ได้ขอ
 * 5. โควตา 100,000 datapoint/ชม. คิดจาก `locations × duration × fields` — รอบของเรา
 *    = 77×48×3 + 77×7×2 = 12,166 (12%) และ 12 คำขอ/รอบ จากเพดาน 60 คำขอ/นาที
 *    ยังบันทึก header ที่เหลือไว้ใน `meta` เพื่อให้เห็นทันทีถ้าโควตาถูกเปลี่ยน
 * 6. `access-control-allow-origin` ของต้นทางเป็น `https://wxmap.tmd.go.th`
 *    เบราว์เซอร์เรียกตรงไม่ได้ ทุกอย่างจึงผ่าน Worker (เหมือนฟีดเรดาร์ที่อยู่หลัง Imperva)
 */

const NWP_BASE = "https://data.tmd.go.th/nwpapi/v1/forecast/location";

/** หกภาคของ TMD — รวมกันได้ 77 จังหวัดพอดี (วัดจริง 2026-08-23) */
export const NWP_REGIONS = ["C", "N", "NE", "E", "S", "W"] as const;
export type NwpRegion = (typeof NWP_REGIONS)[number];

/** ระยะที่เราขอจริง — และเป็นตัวเลขเดียวกับที่ `forecast.horizonHours` ประกาศ */
export const HOURLY_DURATION_H = 48;
export const DAILY_DURATION_D = 7;

/**
 * ข้อความที่ใช้ทั้งเป็น error ที่โยน และเป็น `lastError` บน /health เมื่อยังไม่มีใคร
 * ตั้ง secret — วางถ้อยคำให้อยู่ตระกูลเดียวกับ `TMD_MISSING_CREDENTIALS` ของฟีด
 * แผ่นดินไหว (`TMD_UID`/`TMD_UKEY`) เพราะเป็นความล้มเหลวชนิดเดียวกันคนละกุญแจ
 */
export const TMD_NWP_MISSING_TOKEN = "TMD NWP token not configured";

/**
 * ต้นทางคิดโควตาเป็น "datapoint" = จำนวนจุด × จำนวนขั้นเวลา × จำนวน field
 * (วัดจริง 2026-08-23 ตรงกับที่เอกสารบอก) เพดานคือ 100,000 ต่อ **ชั่วโมง**
 * หนึ่งรอบของเราคือ 77 จังหวัด × 48 ขั้น × 3 field + 77 × 7 ขั้น × 2 field
 */
export const NWP_ROUND_DATAPOINTS = 77 * HOURLY_DURATION_H * 3 + 77 * DAILY_DURATION_D * 2;

/**
 * โยนเมื่อโควตา datapoint ของต้นทางใกล้หมดหรือหมดแล้ว — แยกจากความล้มเหลวอื่น
 * เพราะวิธีรับมือตรงข้ามกัน: ต้นทางล่มให้ **ลองใหม่เร็ว** (RETRY_MS) แต่โควตาหมด
 * ให้ **ถอยยาว** (REFRESH_MS) เพราะรอบถัดไปที่ยิงเร็วมีแต่จะกินโควตาที่ไม่มีให้กิน
 * และเสี่ยงโดนต้นทางปิดกุญแจ ดู `ForecastNwpDO.alarm()` ที่อ่านค่านี้
 */
export class NwpQuotaExhaustedError extends Error {}

/** อ่าน token จาก env — ไม่มี fallback โดยตั้งใจ (เหมือน `tmdCredentials`) */
export function nwpToken(env: { TMD_NWP_TOKEN?: string }): string | null {
  const token = env.TMD_NWP_TOKEN?.trim();
  return token ? token : null;
}

export interface NwpQuota {
  /** header `x-datapoint-remaining` — null = ต้นทางไม่ได้ส่งมาในรอบนี้ */
  datapointRemaining: number | null;
  /** header `x-ratelimit-remaining` — null = ต้นทางไม่ได้ส่งมาในรอบนี้ */
  rateLimitRemaining: number | null;
}

export interface NwpProvinceSeries {
  provinceCode: string;
  /** จุดกริดที่ TMD ใช้ตอบ ไม่ใช่จุดที่เราส่งไป */
  queryPoint: { lat: number; lon: number };
  steps: ForecastStep[];
}

export interface NwpRegionResult {
  byProvince: Map<string, NwpProvinceSeries>;
  /**
   * geocode ที่ไม่อยู่ในทะเบียน 77 จังหวัด — ข้ามไป **แต่ต้องมองเห็น**
   * ผู้เรียกเอาไปประกอบเป็น `lastError`/`detail` ห้ามกลืนเงียบ ๆ เพราะนั่นคือ
   * สัญญาณว่าต้นทางเปลี่ยนระบบรหัส ไม่ใช่ "จังหวัดนั้นไม่มีพยากรณ์"
   */
  unknownGeocodes: string[];
  quota: NwpQuota;
}

interface RawLocation {
  location: { geocode: string; lat: number; lon: number };
  forecasts: { time: string; data: Record<string, unknown> }[];
}

function headerInt(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * ค่าหนึ่งช่องจาก `data` — **"ไม่มีคีย์" กับ "ค่าเป็น 0" คนละเรื่อง** (ข้อ 3 ด้านบน)
 * คีย์มีแต่ค่าไม่ใช่ตัวเลขที่ใช้ได้ ก็ถือว่าไม่มีค่าเช่นกัน แต่เป็นคนละสาเหตุ —
 * ทั้งสองทางลงเอยที่ `null` ซึ่งอ่านได้ว่า "ต้นทางไม่ได้ให้ค่านี้" เหมือนกัน
 */
function fieldOrNull(data: Record<string, unknown>, key: string): number | null {
  if (!(key in data)) return null;
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * `validAt` เก็บสตริงของต้นทางไว้ทั้งดุ้น (มี offset `+07:00` ติดมา) ไม่แปลงเป็น UTC
 * เพราะขั้น "รายวัน" ของ TMD คือวันตามเวลาไทย การแปลงเป็น Z จะย้ายมันข้ามวัน
 * (`2026-08-23T00:00:00+07:00` → `2026-08-22T17:00:00Z`) แล้ว UI จะแสดงผิดวัน
 * รูปนี้ยังเป็น ISO-8601 ที่ `Date.parse` อ่านได้ตามสัญญาของ contract test
 */
function toStep(raw: { time: string; data: Record<string, unknown> }, index: number): ForecastStep {
  if (!Number.isFinite(Date.parse(raw.time))) {
    throw new UpstreamShapeError("tmd-nwp", `WeatherForecasts.forecasts.${index}.time`, `unparsable time "${raw.time}"`);
  }
  return {
    validAt: raw.time,
    rainMm: fieldOrNull(raw.data, "rain"),
    tempC: fieldOrNull(raw.data, "tc"),
    cond: fieldOrNull(raw.data, "cond"),
  };
}

/** แปลงเอกสารหนึ่งภาคที่ตรวจรูปแล้ว ให้เป็นแผนที่ "รหัสจังหวัด → ขั้นพยากรณ์" */
export function mapRegionDocument(body: unknown, quota: NwpQuota): NwpRegionResult {
  const doc = assertNwpRegionDocument(body) as { WeatherForecasts: RawLocation[] };
  const byProvince = new Map<string, NwpProvinceSeries>();
  const unknownGeocodes: string[] = [];
  for (const entry of doc.WeatherForecasts) {
    const code = entry.location.geocode;
    if (!isProvinceCode(code)) {
      unknownGeocodes.push(code);
      continue;
    }
    byProvince.set(code, {
      provinceCode: code,
      queryPoint: { lat: entry.location.lat, lon: entry.location.lon },
      steps: entry.forecasts.map(toStep),
    });
  }
  return { byProvince, unknownGeocodes, quota };
}

function nwpUrl(kind: "hourly" | "daily", region: NwpRegion): string {
  const fields = kind === "hourly" ? "tc,rain,cond" : "rain,cond";
  const duration = kind === "hourly" ? HOURLY_DURATION_H : DAILY_DURATION_D;
  return `${NWP_BASE}/${kind}/region?region=${region}&fields=${fields}&duration=${duration}`;
}

async function nwpFetch(url: string, token: string): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "siahra-api/0.0.0 (nwp ingestion)",
    },
    cf: { cacheTtl: 0 },
  } as RequestInit);
  if (res.status === 401 || res.status === 403) {
    // แยกจาก 5xx โดยตั้งใจ: "กุญแจถูกปฏิเสธ" ลองใหม่กี่ครั้งก็เหมือนเดิม และเป็น
    // ข้อความที่ผู้ดูแลต้องเห็นตรง ๆ ที่แถบสถานะ ไม่ใช่ "ต้นทางล่ม"
    throw new Error(`TMD NWP token rejected (${res.status})`);
  }
  /**
   * โควตาหมด/ใกล้หมด — อ่านจาก **คำตอบตรงหน้า** ไม่ใช่ค่าที่เก็บไว้ใน meta
   * โดยตั้งใจ: รอบที่พังทั้งรอบจะ return ก่อนเขียน `datapointRemaining` และ
   * region ที่ throw ก็ไม่เคยอัปเดตค่านั้น การถอยที่อิงค่าที่เก็บไว้จึงเป็น
   * โค้ดที่ไม่มีวันทำงานในสถานะที่ต้องใช้มันจริง ๆ
   *
   * เคสที่ทำให้เรื่องนี้สำคัญคือ **ต้นทางเปลี่ยนรูปข้อมูล**: ตอบ 200 (จ่าย
   * datapoint ไปแล้ว) แต่ schema ไม่ผ่าน ทุกภาคจึงพังพร้อมกัน ถ้าถอยแค่ 5 นาที
   * จะกลายเป็น 12 รอบ/ชม. × 12,166 ≈ 146k datapoint ต่อชั่วโมง ทะลุเพดาน 100k
   */
  const remaining = headerInt(res, "x-datapoint-remaining");
  if (res.status === 429 || (remaining !== null && remaining <= NWP_ROUND_DATAPOINTS)) {
    throw new NwpQuotaExhaustedError(
      res.status === 429
        ? "TMD NWP rate limited (429)"
        : `TMD NWP datapoint quota nearly exhausted (${remaining} left, a round costs ${NWP_ROUND_DATAPOINTS})`,
    );
  }
  if (!res.ok) throw new Error(`TMD NWP ${res.status}`);
  return res;
}

/** ดึงหนึ่งภาค หนึ่งชุด (hourly หรือ daily) */
export async function fetchRegionForecast(
  kind: "hourly" | "daily",
  region: NwpRegion,
  token: string,
): Promise<NwpRegionResult> {
  const res = await nwpFetch(nwpUrl(kind, region), token);
  const body = await readUpstreamJson("tmd-nwp", res);
  return mapRegionDocument(body, {
    datapointRemaining: headerInt(res, "x-datapoint-remaining"),
    rateLimitRemaining: headerInt(res, "x-ratelimit-remaining"),
  });
}

/** ช่วงวันที่ต้นทางประกาศว่ามีผลพยากรณ์รายวันให้ */
export async function fetchDailyAvailability(token: string): Promise<{ min: string; max: string }> {
  const res = await nwpFetch(`${NWP_BASE}/daily`, token);
  const body = assertNwpAvailability(await readUpstreamJson("tmd-nwp", res)) as {
    daily_data: { min: string; max: string };
  };
  return { min: body.daily_data.min, max: body.daily_data.max };
}
