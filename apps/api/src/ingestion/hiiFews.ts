import type { RiverForecastKind, RiverForecastThresholds } from "@siahra/shared-types";
import { UpstreamShapeError } from "./errors.js";

/**
 * ผลลัพธ์แบบจำลองพยากรณ์ของ FEWS (สสน. / HII) — ไฟล์ข้อความนิ่งบนเซิร์ฟเวอร์ lighttpd ไม่มี auth
 * ไม่มี API: หนึ่งไฟล์ต่อสถานี + metadata CSV สองไฟล์ (เกณฑ์เตือน/ชื่อ/จังหวัด)
 *
 * รูปแบบไฟล์พยากรณ์ (วัดจริง 2026-09-29):
 *   `station,date,time,value `            ← หัวคอลัมน์สุดท้ายมีช่องว่างต่อท้าย
 *   `C2,2026-09-22,06:00:00,1684`         ← รายชั่วโมง ~337 แถว หน้าต่างเลื่อน now−7d … now+7d
 *
 * **เขตเวลา = เวลาไทย (+07:00)** — หลักฐาน: ไฟล์ observe ของ C2 แถวสุดท้าย `2026-09-29,05:00:00`
 * ขณะที่ `Last-Modified` = 03:05:01 GMT; ถ้าเป็น UTC ค่าที่ "ตรวจวัดแล้ว" จะใหม่กว่าเวลาเขียนไฟล์ ~2 ชม.
 * ซึ่งเป็นไปไม่ได้ ส่วน +07:00 = 22:00Z ก่อนหน้า ห่างก่อนเขียนไฟล์ ~5 ชม. สอดคล้อง และแถว 05:00 ของ
 * ไฟล์พยากรณ์ (2030.99) ตรงกับ observe (2031) ที่นาฬิกาเดียวกัน — เหมือน ThaiWater (`thaiwater.ts`)
 *
 * ทุกไฟล์ต้องผ่านด่านรูปร่างก่อนถึงตัวแปลง: body ที่เป็น HTML / หัวคอลัมน์ผิด / ไม่มีแถวที่อ่านได้เลย
 * = `UpstreamShapeError` (ไม่ใช่ชุดค่าว่างที่จะไปทับชุดเดิม) แถวเดี่ยวที่อ่านไม่ออกถูกข้ามและนับ — ไม่เคยเขียน NaN
 */

export const HII_BASE = "https://fews2.hii.or.th/model-output/data_portal";
export const HII_SOURCE = "hii-fews";
/** ต่อไฟล์ — ทั้งรอบ (สองระลอก: พยากรณ์แล้ว metadata) จึงไม่เกิน 20 วิ */
export const HII_FETCH_TIMEOUT_MS = 10_000;
/** เวลาในไฟล์ต้นทางเป็นเวลาไทย */
const THAI_OFFSET_MS = 7 * 3_600_000;
/** เพดานความยาวของหนึ่งไฟล์ — ไฟล์จริง ~340 แถว; เกินนี้ = ต้นทางเปลี่ยนรูป (กัน body ใน DO บวม) */
export const HII_MAX_ROWS = 2_000;
const MAX_BODY_CHARS = 500_000;

/**
 * ตารางเดียวที่ผูกรหัส HII (ไม่มีจุด) กับรหัสสถานีบนเส้นทางน้ำเหนือ (`northRouteStations.json`, มีจุด)
 * สถานีระดับน้ำ CPY014 (นนทบุรี) ไม่อยู่ในเส้นทาง จึงใช้รหัส HII เป็น `code`
 */
export interface HiiStationDef {
  readonly code: string;
  readonly hiiCode: string;
  readonly kind: RiverForecastKind;
  readonly unit: "m3/s" | "m";
}

export const HII_STATIONS: readonly HiiStationDef[] = [
  { code: "C.2", hiiCode: "C2", kind: "discharge", unit: "m3/s" },
  { code: "C.13", hiiCode: "C13", kind: "discharge", unit: "m3/s" },
  { code: "C.3", hiiCode: "C3", kind: "discharge", unit: "m3/s" },
  { code: "C.7A", hiiCode: "C7A", kind: "discharge", unit: "m3/s" },
  { code: "C.35", hiiCode: "C35", kind: "discharge", unit: "m3/s" },
  { code: "CPY014", hiiCode: "CPY014", kind: "waterlevel", unit: "m" },
];

export type MetadataName = "rid_discharge" | "hii_waterlevel";

/** ไฟล์ metadata ของแต่ละชนิดสถานี */
export const METADATA_FILES: readonly MetadataName[] = ["rid_discharge", "hii_waterlevel"];

export const metadataNameFor = (kind: RiverForecastKind): MetadataName =>
  kind === "discharge" ? "rid_discharge" : "hii_waterlevel";

export function forecastUrl(s: HiiStationDef): string {
  const dir = s.kind === "discharge" ? "rid_discharge" : "hii_waterlevel";
  return `${HII_BASE}/${dir}/forecast/${s.hiiCode}.txt`;
}

export const metadataUrl = (name: MetadataName): string => `${HII_BASE}/metadata/${name}.csv`;

// ───────────────────────── conditional GET ─────────────────────────

/** ค่าที่ต้นทางส่งมาให้ถามซ้ำแบบมีเงื่อนไข — เก็บตามตัวอักษรที่ได้ */
export interface Validators {
  etag: string | null;
  lastModified: string | null;
}

export type ConditionalResult =
  | { status: "not-modified" }
  | {
      status: "ok";
      text: string;
      validators: Validators;
      /** `Last-Modified` เป็น ISO — null เมื่อต้นทางไม่ส่ง/อ่านไม่ออก (ไม่แทนด้วยเวลาที่เราดึง) */
      publishedAt: string | null;
    };

const shortPath = (url: string): string => new URL(url).pathname.replace("/model-output/data_portal", "");

/**
 * GET ไฟล์ข้อความหนึ่งไฟล์แบบมีเงื่อนไข (If-None-Match / If-Modified-Since จากค่าที่เก็บไว้)
 * - 304 = ไฟล์ไม่เปลี่ยน (ต้องเป็นคำตอบของคำขอที่เราแนบ validator เท่านั้น)
 * - HTTP ไม่ใช่ 2xx / body เป็น HTML คือความล้มเหลว — ไม่ส่งถึงตัวแปลง
 */
export async function fetchConditional(url: string, prev: Validators | null): Promise<ConditionalResult> {
  const headers: Record<string, string> = {
    "User-Agent": "siahra-api/0.0.0 (river forecast ingestion)",
    Accept: "text/plain, text/csv",
  };
  if (prev?.etag) headers["If-None-Match"] = prev.etag;
  if (prev?.lastModified) headers["If-Modified-Since"] = prev.lastModified;
  const sentValidator = "If-None-Match" in headers || "If-Modified-Since" in headers;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(HII_FETCH_TIMEOUT_MS) });
  if (res.status === 304) {
    void res.body?.cancel().catch(() => {});
    if (!sentValidator) throw new UpstreamShapeError(HII_SOURCE, shortPath(url), "304 without a conditional request");
    return { status: "not-modified" };
  }
  if (!res.ok) {
    // ปิด body ที่ไม่ได้อ่าน — และไม่ส่ง body ของ 5xx/HTML ให้ตัวแปลง
    void res.body?.cancel().catch(() => {});
    throw new Error(`hii-fews HTTP ${res.status} for ${shortPath(url)}`);
  }
  const type = res.headers.get("content-type") ?? "";
  if (/text\/html/i.test(type)) {
    void res.body?.cancel().catch(() => {});
    throw new UpstreamShapeError(HII_SOURCE, shortPath(url), `unexpected content-type ${type}`);
  }
  const text = await res.text();
  if (text.length > MAX_BODY_CHARS) {
    throw new UpstreamShapeError(HII_SOURCE, shortPath(url), `body too large (${text.length} chars)`);
  }
  const lm = res.headers.get("last-modified");
  const lmMs = lm ? Date.parse(lm) : NaN;
  return {
    status: "ok",
    text,
    validators: { etag: res.headers.get("etag"), lastModified: Number.isFinite(lmMs) ? lm : null },
    publishedAt: Number.isFinite(lmMs) ? new Date(lmMs).toISOString() : null,
  };
}

// ───────────────────────── forecast series ─────────────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2}):(\d{2})$/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** เวลาไทยในไฟล์ → epoch ms (UTC); NaN เมื่อไม่ใช่วันเวลาที่มีจริง (เช่น 02-30, 24:00) */
export function thaiLocalToMs(date: string, time: string): number {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) return NaN;
  const [y, mo, day, h, mi, s] = [d[1], d[2], d[3], t[1], t[2], t[3]].map(Number) as [
    number, number, number, number, number, number,
  ];
  const utc = Date.UTC(y, mo - 1, day, h, mi, s);
  const back = new Date(utc);
  // ปฏิเสธวันที่ที่ Date "ปัดให้" (02-30 → 03-02) และเวลานอกช่วง
  if (
    back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== day ||
    h > 23 || mi > 59 || s > 59
  ) {
    return NaN;
  }
  return utc - THAI_OFFSET_MS;
}

export interface ParsedSeries {
  series: [number, number][];
  /** แถวที่ถูกข้าม (อ่านไม่ออก / รหัสสถานีไม่ตรง / เวลาซ้ำ) — ไม่ใช่ความล้มเหลวของไฟล์ แต่ต้องบอก */
  skipped: number;
}

/**
 * ตัวแปลงไฟล์พยากรณ์ของสถานีเดียว — เข้มงวดที่หัวคอลัมน์ ผ่อนปรนรายแถว
 * (แถวเสียข้ามแล้วนับ; ไม่มีแถวใช้ได้เลย = `UpstreamShapeError` เพื่อไม่ให้ชุดว่างไปทับชุดเดิม)
 */
export function parseForecastCsv(text: string, hiiCode: string): ParsedSeries {
  const path = `${hiiCode}.txt`;
  const body = text.replace(/^﻿/, "");
  if (body.trimStart().startsWith("<")) throw new UpstreamShapeError(HII_SOURCE, path, "body looks like HTML");
  const lines = body.split(/\r?\n/);
  const headerAt = lines.findIndex((l) => l.trim() !== "");
  if (headerAt < 0) throw new UpstreamShapeError(HII_SOURCE, path, "empty body");
  const header = lines[headerAt]!.split(",").map((c) => c.trim().toLowerCase()).join(",");
  if (header !== "station,date,time,value") {
    throw new UpstreamShapeError(HII_SOURCE, path, `unexpected header "${header.slice(0, 60)}"`);
  }
  if (lines.length - headerAt - 1 > HII_MAX_ROWS + 10) {
    throw new UpstreamShapeError(HII_SOURCE, path, `more than ${HII_MAX_ROWS} rows`);
  }

  const points: [number, number][] = [];
  let skipped = 0;
  for (let i = headerAt + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    const cells = line.split(",");
    if (cells.length !== 4 || cells[0]!.trim() !== hiiCode) {
      skipped++;
      continue;
    }
    const valueText = cells[3]!.trim();
    const t = thaiLocalToMs(cells[1]!.trim(), cells[2]!.trim());
    const v = NUMBER_RE.test(valueText) ? Number(valueText) : NaN;
    if (!Number.isFinite(t) || !Number.isFinite(v)) {
      skipped++;
      continue;
    }
    points.push([t, v]);
  }
  if (points.length === 0) {
    throw new UpstreamShapeError(HII_SOURCE, path, `no readable rows (${skipped} skipped)`);
  }
  // เรียงตามเวลา (ต้นทางเรียงมาแล้ว) และทิ้งเวลาซ้ำ — คงแถวหลังสุดของเวลานั้น
  points.sort((a, b) => a[0] - b[0]);
  const series: [number, number][] = [];
  for (const p of points) {
    if (series.length > 0 && series[series.length - 1]![0] === p[0]) {
      series[series.length - 1] = p;
      skipped++;
    } else {
      series.push(p);
    }
  }
  return { series, skipped };
}

// ───────────────────────── metadata (thresholds) ─────────────────────────

export interface StationMeta {
  nameTh: string | null;
  province: string | null;
  thresholds: RiverForecastThresholds;
}

/** CSV แบบ RFC 4180 อย่างย่อ: เครื่องหมายคำพูดคู่ห่อช่องที่มีจุลภาค, `""` = เครื่องหมายคำพูดหนึ่งตัว */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/** เฉพาะตัวเลขจริง — ช่องว่าง `-` `NA` ข้อความ = null (ไม่ใช่ 0 และไม่ใช่ NaN) */
export function thresholdNumber(cell: string | undefined): number | null {
  const t = cell?.trim() ?? "";
  return NUMBER_RE.test(t) && Number.isFinite(Number(t)) ? Number(t) : null;
}

const textOrNull = (cell: string | undefined): string | null => {
  const t = cell?.trim() ?? "";
  return t === "" || t === "-" ? null : t;
};

const REQUIRED_META_COLUMNS = ["code", "station.name.TH", "province", "alarm", "warning", "critical"] as const;

/**
 * อ่าน metadata CSV ตามชื่อหัวคอลัมน์ (ไม่ใช่ตำแหน่ง) เก็บเฉพาะรหัสที่ขอ — แถวที่จำนวนช่องไม่เท่าหัวถูกข้าม
 * เกณฑ์ส่งต่อตามที่เผยแพร่ (ไม่ตรวจว่า alarm < warning < critical — เป็นของผู้เผยแพร่ ไม่ใช่ของเรา)
 */
export function parseMetadataCsv(text: string, wanted: readonly string[], name: MetadataName): Map<string, StationMeta> {
  const path = `metadata/${name}.csv`;
  if (text.trimStart().startsWith("<")) throw new UpstreamShapeError(HII_SOURCE, path, "body looks like HTML");
  const rows = parseCsvRows(text);
  if (rows.length === 0) throw new UpstreamShapeError(HII_SOURCE, path, "empty body");
  const header = rows[0]!.map((c) => c.trim());
  const at = new Map(header.map((h, i) => [h, i] as const));
  for (const col of REQUIRED_META_COLUMNS) {
    if (!at.has(col)) throw new UpstreamShapeError(HII_SOURCE, path, `missing column ${col}`);
  }
  const idx = (col: (typeof REQUIRED_META_COLUMNS)[number]) => at.get(col)!;
  const out = new Map<string, StationMeta>();
  for (const cells of rows.slice(1)) {
    if (cells.length !== header.length) continue;
    const code = cells[idx("code")]!.trim();
    if (!wanted.includes(code)) continue;
    out.set(code, {
      nameTh: textOrNull(cells[idx("station.name.TH")]),
      province: textOrNull(cells[idx("province")]),
      thresholds: {
        alarm: thresholdNumber(cells[idx("alarm")]),
        warning: thresholdNumber(cells[idx("warning")]),
        critical: thresholdNumber(cells[idx("critical")]),
      },
    });
  }
  return out;
}

// ───────────────────────── per-file fetch outcomes ─────────────────────────

export type StationFileResult =
  | { kind: "verified" }
  | { kind: "updated"; series: [number, number][]; skipped: number; publishedAt: string | null; validators: Validators };

/** ดึง + แปลงไฟล์พยากรณ์ของหนึ่งสถานี — โยนเมื่อพัง (ผู้เรียกเก็บชุดเดิมไว้) */
export async function fetchStationFile(s: HiiStationDef, prev: Validators | null): Promise<StationFileResult> {
  const r = await fetchConditional(forecastUrl(s), prev);
  if (r.status === "not-modified") return { kind: "verified" };
  const { series, skipped } = parseForecastCsv(r.text, s.hiiCode);
  return { kind: "updated", series, skipped, publishedAt: r.publishedAt, validators: r.validators };
}

export type MetadataResult =
  | { kind: "verified" }
  | { kind: "updated"; byCode: Map<string, StationMeta>; validators: Validators };

export async function fetchMetadataFile(name: MetadataName, prev: Validators | null): Promise<MetadataResult> {
  const r = await fetchConditional(metadataUrl(name), prev);
  if (r.status === "not-modified") return { kind: "verified" };
  const wanted = HII_STATIONS.filter((s) => metadataNameFor(s.kind) === name).map((s) => s.hiiCode);
  return { kind: "updated", byCode: parseMetadataCsv(r.text, wanted, name), validators: r.validators };
}
