import type { StormConeGeometry, StormForecastPosition, StormPastPosition } from "@siahra/shared-types";
import { UpstreamShapeError, shortReason } from "./errors.js";
import { fetchStormJson, type StormCore } from "./jmaTyphoon.js";
import { assertGdacsEventList, assertGdacsGeometry } from "./schemas/storm.js";

/**
 * GDACS (EC-JRC / UN-OCHA, ข้อมูล JTWC) — **เฉพาะมหาสมุทรอินเดียเหนือ (NIO)**
 *
 * v1 ไม่เอา GDACS มาแทน JMA ในแปซิฟิกตะวันตกเด็ดขาด: ถ้า JMA ล่ม /health ต้องบอกว่า
 * JMA ล่ม ไม่ใช่เงียบ ๆ สลับไปแสดงพายุลูกเดียวกันจากอีกต้นทาง (ซึ่งคนละคาบเฉลี่ยลม
 * คนละหน่วยงานพยากรณ์) — SURIGAE-26 ใน fixture คือพายุลูกเดียวกับ TC2632 ของ JMA
 *
 * หนึ่งรอบ = `geteventlist` หนึ่งคำขอ แล้ว `getgeometry` **เฉพาะเหตุการณ์ที่ผ่านตัวกรอง
 * NIO แล้ว** (กรองจากพิกัดในรายการเหตุการณ์ ก่อนยิง getgeometry ใด ๆ) ไม่เกิน
 * `GDACS_MAX_EVENTS` = 5 → ฝั่ง GDACS ≤ 6 subrequests
 */

const GDACS_BASE = "https://www.gdacs.org/gdacsapi/api";
export const GDACS_MAX_EVENTS = 5;
/** หน้าต่างของรายการเหตุการณ์ — `iscurrent=true` ที่ส่งเป็น query ถูกต้นทางเมินเฉย (วัดจริง) จึงจำกัดด้วยวันที่แทน */
const LIST_WINDOW_DAYS = 10;
/** เกินนี้ไม่เก็บกรวย (กัน body ใน DO บวมถ้าต้นทางส่งรูปละเอียดผิดปกติ) — วัดจริง 192 จุด */
const MAX_CONE_VERTICES = 5_000;

/**
 * กล่องมหาสมุทรอินเดียเหนือ (อ่าวเบงกอล ทะเลอันดามัน ทะเลอาหรับ) — ใช้กับพิกัดใน
 * `geteventlist` ซึ่งเป็น **centroid** ของเหตุการณ์ (`Class: "Point_Centroid"`) ไม่ใช่
 * ตำแหน่งล่าสุด จึงเป็นตัวกรองหยาบระดับแอ่งมหาสมุทร ไม่ใช่การอ้างตำแหน่งพายุ
 *
 * ต้องเป็นกล่อง ไม่ใช่แค่ `lon < 100`: วันที่ probe มี FAY (−43.7), ODALYS (−123.7),
 * NOLO (−155.3) ซึ่ง "< 100" ทั้งหมด
 */
export const NIO_BOX = { minLon: 40, maxLon: 100, minLat: 0, maxLat: 35 } as const;

export function inNio(lon: number, lat: number): boolean {
  return lon >= NIO_BOX.minLon && lon <= NIO_BOX.maxLon && lat >= NIO_BOX.minLat && lat <= NIO_BOX.maxLat;
}

export interface GdacsEvent {
  eventId: number;
  episodeId: number;
  name: string | null;
  alertLevel: string | null;
  severityText: string | null;
  reportUrl: string | null;
}

export interface GdacsRound {
  storms: StormCore[];
  failedIds: string[];
  failures: string[];
}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function gdacsListUrl(nowMs: number): string {
  const from = ymd(nowMs - LIST_WINDOW_DAYS * 86_400_000);
  const to = ymd(nowMs);
  // `alertlevel` ต้องมีครบสามระดับ — ไม่ใส่ = ต้นทางตัดพายุระดับ Green ทิ้ง (วัดจริง)
  return `${GDACS_BASE}/events/geteventlist/SEARCH?eventlist=TC&alertlevel=green;orange;red&fromdate=${from}&todate=${to}`;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** เลือกเฉพาะเหตุการณ์ TC ที่ยัง current และ centroid อยู่ใน NIO — pure */
export function selectNioEvents(listRaw: unknown): GdacsEvent[] {
  const list = assertGdacsEventList(listRaw) as {
    features: {
      geometry: { type: string; coordinates: number[] };
      properties: {
        eventtype: string;
        eventid: number;
        episodeid: number;
        eventname?: string | null;
        iscurrent?: string | boolean | null;
        alertlevel?: string | null;
        severitydata?: { severitytext?: string | null } | null;
        url?: { report?: string | null } | null;
      };
    }[];
  };
  const out: GdacsEvent[] = [];
  const seen = new Set<number>();
  for (const f of list.features) {
    const p = f.properties;
    if (p.eventtype !== "TC") continue;
    if (!(p.iscurrent === "true" || p.iscurrent === true)) continue;
    if (f.geometry.type !== "Point" || f.geometry.coordinates.length < 2) continue;
    const [lon, lat] = f.geometry.coordinates as [number, number];
    if (!inNio(lon, lat)) continue;
    if (seen.has(p.eventid)) continue;
    seen.add(p.eventid);
    out.push({
      eventId: p.eventid,
      episodeId: p.episodeid,
      name: str(p.eventname),
      alertLevel: str(p.alertlevel),
      severityText: str(p.severitydata?.severitytext),
      reportUrl: str(p.url?.report),
    });
  }
  return out;
}

/** เวลาของ GDACS ไม่มี offset แต่เป็น UTC (ป้ายของตำแหน่งเขียน "UTC" กำกับ) */
function gdacsUtc(v: string | null | undefined): number {
  if (!v) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
}

/**
 * `key` ของตำแหน่งคือ `MMDDHHMM` **ไม่มีปี** — เอาปีจาก `polygondate` (เวลาของ fix
 * ล่าสุด) แล้วแก้กรณีข้ามปี (ธ.ค. → ม.ค.) ด้วยการเลือกปีที่ทำให้ห่างจากฐานไม่เกินครึ่งปี
 */
export function keyToMs(key: string, baseMs: number): number {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(key);
  if (!m) return NaN;
  const [, mo, d, h, mi] = m;
  const baseYear = new Date(baseMs).getUTCFullYear();
  const at = (y: number) => Date.UTC(y, Number(mo) - 1, Number(d), Number(h), Number(mi));
  const half = 183 * 86_400_000;
  let t = at(baseYear);
  if (t - baseMs > half) t = at(baseYear - 1);
  else if (baseMs - t > half) t = at(baseYear + 1);
  return t;
}

/** กึ่งกลางกรอบของวงกลมเล็กที่ GDACS ใช้แทนจุด — ปัด 2 ตำแหน่ง (~1 กม.) */
function ringCenter(coords: unknown): { lat: number; lon: number } | null {
  const ring = Array.isArray(coords) ? (coords[0] as unknown) : null;
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of ring) {
    if (!Array.isArray(pt) || typeof pt[0] !== "number" || typeof pt[1] !== "number") return null;
    minX = Math.min(minX, pt[0]);
    maxX = Math.max(maxX, pt[0]);
    minY = Math.min(minY, pt[1]);
    maxY = Math.max(maxY, pt[1]);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { lon: r2((minX + maxX) / 2), lat: r2((minY + maxY) / 2) };
}

function countVertices(v: unknown): number {
  if (!Array.isArray(v)) return 0;
  if (typeof v[0] === "number") return 1;
  return v.reduce<number>((n, c) => n + countVertices(c), 0);
}

function coneOf(geometry: { type: string; coordinates: unknown } | null | undefined): StormConeGeometry | null {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  if (countVertices(geometry.coordinates) > MAX_CONE_VERTICES) return null;
  if (geometry.type === "Polygon") return { type: "Polygon", coordinates: geometry.coordinates as number[][][] };
  if (geometry.type === "MultiPolygon") return { type: "MultiPolygon", coordinates: geometry.coordinates as number[][][][] };
  return null;
}

/**
 * แปลง `getgeometry` ของหนึ่งเหตุการณ์ — pure
 *
 * - ตำแหน่ง = `Point_Polygon_Point_N` (เวลาใน `key`), แยกอดีต/พยากรณ์ด้วย `polygondate`
 *   (เวลา fix ล่าสุด): ≤ ฐาน = ตำแหน่งวิเคราะห์แล้ว, > ฐาน = ตำแหน่งพยากรณ์
 * - `advisoryIssuedAt: null` เสมอ — ไม่มีอะไรในรายการหรือเรขาคณิตที่เป็น "เวลาออกประกาศ"
 *   (`datemodified` คือเวลาประมวลผลของ GDACS, `polygondate` คือเวลา fix) ห้ามเอามาสวม
 * - ลม/ความกด/หมวดรายจุด: GDACS ไม่ได้ส่งมาในเรขาคณิต → null (ไม่เดาจากป้ายของเส้น)
 */
export function mapGdacsStorm(event: GdacsEvent, geometryRaw: unknown): StormCore {
  const geo = assertGdacsGeometry(geometryRaw) as {
    features: {
      geometry?: { type: string; coordinates: unknown } | null;
      properties: { Class?: string | null; polygondate?: string | null; key?: string | null };
    }[];
  };
  const pointFeatures = geo.features.filter((f) => f.properties.Class?.startsWith("Point_Polygon_Point_"));
  const baseMs = gdacsUtc(pointFeatures.find((f) => f.properties.polygondate)?.properties.polygondate);
  if (!Number.isFinite(baseMs)) {
    throw new UpstreamShapeError("gdacs-tc geometry", "features.Point_Polygon_Point_*.polygondate", "missing or not a time");
  }
  const byTime = new Map<number, { lat: number; lon: number }>();
  for (const f of pointFeatures) {
    const t = keyToMs(f.properties.key ?? "", baseMs);
    const c = f.geometry?.type === "Polygon" ? ringCenter(f.geometry.coordinates) : null;
    if (!Number.isFinite(t) || !c) continue;
    byTime.set(t, c);
  }
  if (byTime.size === 0) {
    throw new UpstreamShapeError("gdacs-tc geometry", "features.Point_Polygon_Point_*", "no readable positions");
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);
  const past: StormPastPosition[] = [];
  const forecast: StormForecastPosition[] = [];
  for (const t of times) {
    const { lat, lon } = byTime.get(t)!;
    const iso = new Date(t).toISOString();
    if (t <= baseMs) past.push({ observedAt: iso, lat, lon, windKt: null, pressureHpa: null });
    else forecast.push({ validAt: iso, lat, lon, windKt: null, pressureHpa: null, category: null, circleRadiusKm: null });
  }
  const cone = geo.features.find((f) => f.properties.Class === "Poly_Cones");
  return {
    id: `gdacs:${event.eventId}`,
    source: "gdacs-tc",
    name: event.name,
    basin: "NIO",
    category: null,
    advisoryIssuedAt: null,
    windAveraging: null,
    past,
    forecast,
    gdacsCone: coneOf(cone?.geometry),
    gdacs: {
      eventId: event.eventId,
      episodeId: event.episodeId,
      alertLevel: event.alertLevel,
      severityText: event.severityText,
      reportUrl: event.reportUrl,
    },
  };
}

/** หนึ่งรอบของ GDACS — รายการพัง = ทั้งต้นทางพัง; เหตุการณ์รายตัวพังถูกรายงานโดยไม่ล้มทั้งรอบ */
export async function fetchGdacsRound(nowMs: number): Promise<GdacsRound> {
  const events = selectNioEvents(await fetchStormJson("gdacs-tc", gdacsListUrl(nowMs)));
  const failures: string[] = [];
  if (events.length > GDACS_MAX_EVENTS) {
    failures.push(`${events.length} NIO events listed, only the first ${GDACS_MAX_EVENTS} fetched (subrequest cap): skipped ${events.slice(GDACS_MAX_EVENTS).map((e) => e.eventId).join(",")}`);
  }
  const picked = events.slice(0, GDACS_MAX_EVENTS);
  const settled = await Promise.allSettled(
    picked.map(async (e) =>
      mapGdacsStorm(
        e,
        await fetchStormJson(
          "gdacs-tc",
          `${GDACS_BASE}/polygons/getgeometry?eventtype=TC&eventid=${e.eventId}&episodeid=${e.episodeId}`,
        ),
      ),
    ),
  );
  const storms: StormCore[] = [];
  const failedIds: string[] = [];
  settled.forEach((s, i) => {
    const e = picked[i]!;
    if (s.status === "fulfilled") storms.push(s.value);
    else {
      failedIds.push(`gdacs:${e.eventId}`);
      failures.push(`${e.eventId}: ${shortReason(s.reason)}`);
    }
  });
  return { storms, failedIds, failures };
}
