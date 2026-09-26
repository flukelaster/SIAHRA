import type { StormForecastPosition, StormPastPosition, StormTrack } from "@siahra/shared-types";
import { UpstreamShapeError, readUpstreamJson, shortReason } from "./errors.js";
import { assertJmaForecast, assertJmaSpecifications, assertJmaTargetList } from "./schemas/storm.js";

/**
 * JMA (RSMC Tokyo) — พายุหมุนเขตร้อนในแปซิฟิกตะวันตกเฉียงเหนือและทะเลจีนใต้
 *
 * หนึ่งรอบ = `targetTc.json` หนึ่งคำขอ แล้ว `specifications.json` + `forecast.json`
 * ต่อพายุหนึ่งลูก (สองคำขอขนานกัน) — `JMA_MAX_TCS` ตรึงเพดานไว้ให้ทั้งรอบของ
 * StormTrackDO ไม่เกิน 20 subrequests (1 + 2×6 = 13 ฝั่ง JMA)
 *
 * ต้นทางไม่มีเอกสาร schema (bosai คือ backend ของหน้าแผนที่ไต้ฝุ่นของ JMA เอง)
 * ทุกก้อนจึงผ่านด่าน zod ใน `schemas/storm.ts` ก่อนถึง mapper
 */

export const JMA_BASE = "https://www.jma.go.jp/bosai/typhoon/data";
/** เพดานพายุต่อรอบ — เกินนี้ถูกข้ามและบอกไว้ใน lastError (ไม่ใช่ตัดทิ้งเงียบ ๆ) */
export const JMA_MAX_TCS = 6;
/** เพดานเวลาต่อคำขอ — ทั้งรอบต้องจบก่อนงบ 25 วิของ scheduledTick */
export const STORM_FETCH_TIMEOUT_MS = 10_000;

/** พายุหนึ่งลูกก่อนเติมส่วนที่ DO เป็นคนคิด (ระยะถึงจังหวัด, เวลาที่ดึงสำเร็จ) */
export type StormCore = Omit<StormTrack, "nearestKmByProvince" | "fetchedAt">;

export interface JmaRound {
  storms: StormCore[];
  /** id ของพายุที่อยู่ในรายการแต่ดึงรายละเอียดไม่สำเร็จ — DO คงสำเนาเดิมของมันไว้ */
  failedIds: string[];
  /** ความล้มเหลวรายลูก/เพดานที่ถูกชน — ต่อกันเป็น lastError เดียวของต้นทาง */
  failures: string[];
}

/** GET JSON หนึ่งก้อนพร้อม timeout — HTTP ที่ไม่ใช่ 2xx คือ error ที่บอก path */
export async function fetchStormJson(source: string, url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "siahra-api/0.0.0 (storm track ingestion)", Accept: "application/json" },
    signal: AbortSignal.timeout(STORM_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    // ปิด body ที่ไม่ได้อ่าน ไม่ให้ค้างจน GC
    void res.body?.cancel().catch(() => {});
    throw new Error(`${source} HTTP ${res.status} for ${new URL(url).pathname}`);
  }
  return readUpstreamJson(source, res);
}

/** ตัวเลขที่ JMA ส่งเป็นสตริง — `"-"`/ว่าง/หาย = null (ไม่ใช่ 0) */
export function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "" || v.trim() === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** เวลา ISO ที่ parse ได้เท่านั้น — อย่างอื่นคือ null */
export function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
}

interface JmaTarget {
  tcId: string;
  category: string | null;
}

interface SpecPart {
  part?: unknown;
  issue?: { UTC?: string | null } | null;
  name?: { en?: string | null } | null;
  category?: { en?: string | null } | null;
  advancedHours?: number;
  position?: { deg: [number, number] } | null;
  validtime?: { UTC?: string | null } | null;
  pressure?: unknown;
  probabilityCircleRadius?: { km?: unknown } | null;
  maximumWind?: { sustained?: { kt?: unknown } | null } | null;
}

interface ForecastPart {
  advancedHours?: number;
  track?: { preTyphoon?: [number, number][] | null; typhoon?: [number, number][] | null } | null;
}

const windOf = (p: SpecPart) => numOrNull(p.maximumWind?.sustained?.kt);
const categoryOf = (p: SpecPart | undefined) => {
  const c = p?.category?.en;
  return typeof c === "string" && c.trim() !== "" && c.trim() !== "-" ? c.trim() : null;
};

/**
 * แปลงสองก้อนของพายุหนึ่งลูกเป็น `StormCore` — pure เพื่อให้เทสกับ fixture จริงได้ตรง ๆ
 *
 * - `advisoryIssuedAt` = `issue.UTC` ของหัวเรื่อง (เวลาที่ JMA ออกประกาศ) เท่านั้น
 * - เส้นทางที่ผ่านมาของ JMA เป็นคู่ `[lat, lon]` ไม่มีเวลา → `observedAt: null` ทุกจุด
 *   ยกเว้นจุดวิเคราะห์ล่าสุด ซึ่ง JMA ให้ `validtime` มา (ไม่ประมาณเวลาย้อนหลังให้จุดอื่น)
 * - ตำแหน่งพยากรณ์ = ทุกส่วนที่ `advancedHours > 0` พร้อมรัศมีวงกลมความน่าจะเป็น 70 %
 */
export function mapJmaStorm(tcId: string, specsRaw: unknown, forecastRaw: unknown, targetCategory: string | null = null): StormCore {
  const specs = assertJmaSpecifications(specsRaw) as SpecPart[];
  const fc = assertJmaForecast(forecastRaw) as ForecastPart[];

  const title = specs.find((p) => p.part === "title");
  if (!title) throw new UpstreamShapeError("jma-typhoon specifications", "<title>", "no part === \"title\"");
  const analysis = specs.find((p) => p.advancedHours === 0 && p.position && p.validtime?.UTC);
  if (!analysis?.position) {
    throw new UpstreamShapeError("jma-typhoon specifications", "<analysis>", "no advancedHours === 0 part with position/validtime");
  }
  const analysisAt = isoOrNull(analysis.validtime?.UTC);
  if (!analysisAt) throw new UpstreamShapeError("jma-typhoon specifications", "<analysis>.validtime.UTC", "not a time");

  const [aLat, aLon] = analysis.position.deg;
  const current: StormPastPosition = {
    observedAt: analysisAt,
    lat: aLat,
    lon: aLon,
    windKt: windOf(analysis),
    pressureHpa: numOrNull(analysis.pressure),
  };

  // เส้นทางเดิม: preTyphoon (ช่วงดีเปรสชัน) ต่อด้วย typhoon — จุดรอยต่อซ้ำกันจึงตัดจุดซ้ำติดกัน
  const trackPart = fc.find((p) => p.advancedHours === 0 && p.track) ?? fc.find((p) => p.track);
  const raw = [...(trackPart?.track?.preTyphoon ?? []), ...(trackPart?.track?.typhoon ?? [])];
  const past: StormPastPosition[] = [];
  for (const [lat, lon] of raw) {
    const prev = past[past.length - 1];
    if (prev && prev.lat === lat && prev.lon === lon) continue;
    past.push({ observedAt: null, lat, lon, windKt: null, pressureHpa: null });
  }
  const last = past[past.length - 1];
  if (last && last.lat === current.lat && last.lon === current.lon) past[past.length - 1] = current;
  else past.push(current);

  const forecast: StormForecastPosition[] = [];
  for (const p of specs) {
    if (typeof p.advancedHours !== "number" || p.advancedHours <= 0 || !p.position) continue;
    const validAt = isoOrNull(p.validtime?.UTC);
    if (!validAt) continue;
    const radius = numOrNull(p.probabilityCircleRadius?.km);
    forecast.push({
      validAt,
      lat: p.position.deg[0],
      lon: p.position.deg[1],
      windKt: windOf(p),
      pressureHpa: numOrNull(p.pressure),
      category: categoryOf(p),
      circleRadiusKm: radius !== null && radius > 0 ? radius : null,
    });
  }
  forecast.sort((a, b) => Date.parse(a.validAt) - Date.parse(b.validAt));

  const name = title.name?.en?.trim();
  const anyWind = current.windKt !== null || forecast.some((f) => f.windKt !== null);
  return {
    id: `jma:${tcId}`,
    source: "jma-typhoon",
    name: name ? name : null,
    basin: "WNP",
    category: categoryOf(analysis) ?? categoryOf(title) ?? targetCategory,
    advisoryIssuedAt: isoOrNull(title.issue?.UTC),
    windAveraging: anyWind ? "10-min" : null,
    past,
    forecast,
  };
}

/**
 * หนึ่งรอบของ JMA — รายการพายุพัง = ทั้งต้นทางพัง (throw, DO คงสำเนาเดิมทั้งหมด)
 * ส่วนพายุรายลูกที่พังถูกรายงานใน `failures` และ `failedIds` โดยไม่ล้มทั้งรอบ
 *
 * ไม่มี log ในลูปนี้โดยตั้งใจ (Workers Logs คิดเงินต่อบรรทัด) — ความล้มเหลวรายลูก
 * ถูกต่อเป็น lastError ก้อนเดียวที่ DO
 */
export async function fetchJmaRound(): Promise<JmaRound> {
  const list = assertJmaTargetList(await fetchStormJson("jma-typhoon", `${JMA_BASE}/targetTc.json`)) as {
    tropicalCyclone: string;
    category?: string | null;
  }[];
  const failures: string[] = [];
  const seen = new Set<string>();
  const targets: JmaTarget[] = [];
  for (const t of list) {
    if (seen.has(t.tropicalCyclone)) continue;
    seen.add(t.tropicalCyclone);
    targets.push({ tcId: t.tropicalCyclone, category: typeof t.category === "string" && t.category !== "" ? t.category : null });
  }
  if (targets.length > JMA_MAX_TCS) {
    failures.push(`${targets.length} TCs listed, only the first ${JMA_MAX_TCS} fetched (subrequest cap): skipped ${targets.slice(JMA_MAX_TCS).map((t) => t.tcId).join(",")}`);
  }
  const picked = targets.slice(0, JMA_MAX_TCS);
  const settled = await Promise.allSettled(
    picked.map(async (t) => {
      const [specs, fc] = await Promise.all([
        fetchStormJson("jma-typhoon", `${JMA_BASE}/${t.tcId}/specifications.json`),
        fetchStormJson("jma-typhoon", `${JMA_BASE}/${t.tcId}/forecast.json`),
      ]);
      return mapJmaStorm(t.tcId, specs, fc, t.category);
    }),
  );
  const storms: StormCore[] = [];
  const failedIds: string[] = [];
  settled.forEach((s, i) => {
    const tc = picked[i]!;
    if (s.status === "fulfilled") storms.push(s.value);
    else {
      failedIds.push(`jma:${tc.tcId}`);
      failures.push(`${tc.tcId}: ${shortReason(s.reason)}`);
    }
  });
  return { storms, failedIds, failures };
}
