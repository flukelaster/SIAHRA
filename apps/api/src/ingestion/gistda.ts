import {
  FLOOD_EXTENT_COORD_DECIMALS,
  type FloodAcquisition,
  type FloodExtentFeature,
  type FloodExtentFeatureProps,
} from "@siahra/shared-types";
import { UpstreamShapeError } from "./errors.js";
import { assertGistdaEnvelope, assertGistdaFeature } from "./schemas/gistda.js";

/**
 * GISTDA flood extent ผ่าน API gateway (E16.PR0) — WFS เปิดเดิม
 * (`flood-innotech.gistda.or.th/flooding_vis_public`) ตอบ 401 ตั้งแต่ 2026-09-10
 *
 * วัดจริง 2026-09-26 ด้วยกุญแจจริง:
 *   GET {GISTDA_API_BASE}/{1day|3days|7days|30days}?pv_idn=NN&limit=1000&offset=M
 *   header `API-Key: <key>` (ส่งเป็น `X-API-Key` ได้ 407)
 *   ซอง {type, features[], links[], numberMatched, numberReturned, timeStamp}
 *   หนึ่ง feature = หนึ่งเซลล์ H3 res-9 (MultiPolygon ของส่วนที่ท่วมในเซลล์นั้น)
 *
 * **`links[].href` สะท้อนกุญแจกลับมาเป็น `?api_key=`** — โมดูลนี้ไม่อ่าน `links`
 * เลย URL ของหน้าถัดไปประกอบจาก offset เองเสมอ และไม่มีอะไรจากซองถูกเก็บต่อ
 * กุญแจไปทาง header เท่านั้น ไม่เคยอยู่ใน URL, log, lastError, R2 หรือคำตอบใด ๆ
 */
export const GISTDA_API_BASE = "https://api-gateway.gistda.or.th/api/2.0/resources/features/flood";

/**
 * หน้าต่างเวลาของต้นทางที่ดึง — ตัวเดียวต่อรอบ (devops constraint 2)
 *
 * เลือก `3days`: ครอบช่องว่างระหว่างรอบโคจร (Sentinel-1/RADARSAT-2 ผ่านซ้ำไม่ทุกวัน)
 * โดยยังเป็น "ภาพชุดล่าสุด" ไม่ใช่ผลสะสมเป็นสัปดาห์ และทุกเซลล์บอกเวลาบันทึกภาพของ
 * ตัวเอง (`observedAt`) อยู่แล้ว ผู้ใช้จึงเห็นเสมอว่าภาพเก่าแค่ไหน
 * หมายเหตุที่วัดได้: ตอน probe (2026-09-26 ~08:20Z) ทั้ง 1day/3days/7days ให้จำนวนเซลล์
 * และชุดภาพเท่ากันทุกจังหวัดที่ลอง — การเลือกนี้จึงยังไม่ได้ถูกพิสูจน์ด้วยข้อมูลว่าต่างกัน
 */
export const GISTDA_FLOOD_WINDOW = "3days";

/** ขนาดหน้าที่ขอ (สูงสุดที่ต้นทางรับ) — จังหวัดที่ท่วมมากสุดวันที่วัด ~6.8k เซลล์ = 7 หน้า */
export const GISTDA_PAGE_LIMIT = 1000;

/** กันลูปไม่รู้จบถ้าต้นทางรายงาน numberMatched ผิด — 100 หน้า = 100k เซลล์ในจังหวัดเดียว */
const MAX_PAGES_PER_PROVINCE = 100;

/**
 * `file_name` = `sensor_YYYYMMDD_HHMM` คั่นด้วยจุลภาค ไม่มีเขตเวลา — อ่านเป็นเวลาไทย
 *
 * หลักฐาน (2026-09-26): `S1D_20260920_0607` ตรงกับฉาก Copernicus GFM
 * `20260919T230750-AS020M` ของจังหวัด 10 (23:07:50Z = 06:07 +07:00) พอดี และทุกโทเค็นที่
 * เห็นอยู่ในช่วง ~06:00/~18:00 ซึ่งคือเวลาท้องถิ่นของวงโคจร dawn-dusk ของ Sentinel-1
 * กับ RADARSAT-2 — ถ้าอ่านเป็น UTC จะกลายเป็น 13:00/01:00 น. ซึ่งไม่มีดาวเทียมสองดวงนี้ผ่าน
 * (การเทียบกับ `_createdAt` แยกสองสมมติฐานนี้ไม่ได้: อ่านแบบไหนก็ไม่มีภาพที่ใหม่กว่า
 * `_createdAt` เลย จึงไม่ได้ใช้เป็นหลักฐาน)
 */
export const GISTDA_FILE_NAME_TZ = "+07:00";

/** ต้นทางค้างได้ — กันไม่ให้ alarm ถูกแขวนรอ response ที่ไม่มีวันมา */
const FETCH_TIMEOUT_MS = 25_000;
/** ดีเลย์ก่อน retry ในหน้าเดียวกัน (หน่วง + jitter) — กลบอาการล่มแป๊บเดียวของต้นทาง */
const RETRY_DELAYS_MS = [800, 2_500];

/** อ่านกุญแจจาก env — ไม่มี fallback โดยตั้งใจ (เหมือน `nwpToken`) */
export function gistdaApiKey(env: { GISTDA_API_KEY?: string }): string | null {
  const key = env.GISTDA_API_KEY?.trim();
  return key ? key : null;
}

/** URL ของหนึ่งหน้า — ประกอบจาก offset เสมอ ห้ามใช้ `links[].href` (มีกุญแจติดมา) */
export function gistdaPageUrl(provinceCode: string, offset: number): string {
  const qs = new URLSearchParams({ pv_idn: String(Number(provinceCode)), limit: String(GISTDA_PAGE_LIMIT), offset: String(offset) });
  return `${GISTDA_API_BASE}/${GISTDA_FLOOD_WINDOW}?${qs.toString()}`;
}

/** ลบกุญแจออกจากข้อความใด ๆ ก่อนเก็บ/log — กันไว้อีกชั้นแม้กุญแจจะไปทาง header เท่านั้น */
export function redactKey(text: string, key: string | null): string {
  return key ? text.split(key).join("[redacted]") : text;
}

const FILE_NAME_TOKEN_RE = /^([A-Za-z0-9]+)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$/;

/**
 * `"rd2_20260926_0613, S1C_20260921_0558"` → ภาพแต่ละภาพ ใหม่สุดก่อน ไม่ซ้ำ
 * โทเค็นที่อ่านไม่ออก (รูปผิด/วันที่ไม่มีจริง) ถูกข้าม — ไม่เดาเวลาให้
 */
export function parseGistdaFileName(value: unknown): FloodAcquisition[] {
  if (typeof value !== "string") return [];
  const seen = new Map<string, FloodAcquisition>();
  for (const raw of value.split(",")) {
    const m = FILE_NAME_TOKEN_RE.exec(raw.trim());
    if (!m) continue;
    const [, sensor, y, mo, d, hh, mm] = m;
    const ms = Date.parse(`${y}-${mo}-${d}T${hh}:${mm}:00${GISTDA_FILE_NAME_TZ}`);
    if (!Number.isFinite(ms)) continue;
    // Date.parse ยอม "2026-02-30" บางเอนจิน — ยืนยันว่าวันที่ไปกลับได้ตรงตัว
    const local = new Date(ms + 7 * 3_600_000).toISOString();
    if (local.slice(0, 16) !== `${y}-${mo}-${d}T${hh}:${mm}`) continue;
    const acquiredAt = new Date(ms).toISOString();
    seen.set(`${sensor}|${acquiredAt}`, { sensor: sensor!, acquiredAt });
  }
  return [...seen.values()].sort((a, b) => (a.acquiredAt < b.acquiredAt ? 1 : a.acquiredAt > b.acquiredAt ? -1 : 0));
}

const SCALE = 10 ** FLOOD_EXTENT_COORD_DECIMALS;
const quantise = (v: number): number => Math.round(v * SCALE) / SCALE;

/** ปัดพิกัด ตัดจุดซ้ำติดกัน ปิดวง — วงที่เหลือจุดต่างกันไม่ถึงสามจุดถูกทิ้ง (null) */
function projectRing(ring: unknown): number[][] | null {
  if (!Array.isArray(ring)) return null;
  const out: number[][] = [];
  let px = NaN;
  let py = NaN;
  for (const pt of ring) {
    if (!Array.isArray(pt)) continue;
    const x = pt[0];
    const y = pt[1];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const qx = quantise(x);
    const qy = quantise(y);
    if (qx === px && qy === py) continue;
    out.push([qx, qy]);
    px = qx;
    py = qy;
  }
  if (out.length > 1 && out[0]![0] === px && out[0]![1] === py) out.pop();
  if (out.length < 3) return null;
  out.push([out[0]![0]!, out[0]![1]!]);
  return out;
}

function projectPolygon(poly: unknown): number[][][] | null {
  if (!Array.isArray(poly) || poly.length === 0) return null;
  const outer = projectRing(poly[0]);
  if (!outer) return null;
  const rings = [outer];
  for (let i = 1; i < poly.length; i++) {
    const hole = projectRing(poly[i]);
    if (hole) rings.push(hole);
  }
  return rings;
}

/**
 * รูปทรงที่ปัดพิกัดแล้ว — เป็น MultiPolygon เสมอ (ต้นทางส่ง MultiPolygon ทั้งหมดที่วัด)
 * เซลล์ที่ทุกชิ้นยุบหายตอนปัดได้ `coordinates: []` แทนการถูกทิ้ง เพื่อให้จำนวนเซลล์และ
 * พื้นที่รวมยังตรงกับต้นทาง; null = ไม่ใช่รูปทรงพื้นที่ (จุด/เส้น) ข้ามทั้ง feature
 */
export function projectGeometry(geometry: unknown): FloodExtentFeature["geometry"] | null {
  if (!geometry || typeof geometry !== "object") return null;
  const g = geometry as { type?: unknown; coordinates?: unknown };
  if (g.type === "Polygon") {
    const p = projectPolygon(g.coordinates);
    return { type: "MultiPolygon", coordinates: p ? [p] : [] };
  }
  if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
    const polys: number[][][][] = [];
    for (const poly of g.coordinates) {
      const p = projectPolygon(poly);
      if (p) polys.push(p);
    }
    return { type: "MultiPolygon", coordinates: polys };
  }
  return null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function code(v: unknown, width: number): string | null {
  const n = num(v);
  return n === null ? null : String(Math.trunc(n)).padStart(width, "0");
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** feature ที่ projection แล้ว — ยังไม่มี `firstSeenAt` (DO เป็นคนประทับจากรอบก่อน) */
export interface ProjectedFloodFeature {
  type: "Feature";
  id: string;
  properties: Omit<FloodExtentFeatureProps, "firstSeenAt">;
  geometry: FloodExtentFeature["geometry"];
}

/**
 * allowlist ของ property ที่เก็บ (devops constraint 6): h3, รหัส/ชื่อ จังหวัด-อำเภอ-ตำบล,
 * `f_area`, ภาพจาก `file_name`, `_createdAt` — อย่างอื่นในต้นทาง (population, building,
 * hospital, rice_area, `_id`, `mongo_id`, …) ไม่ถูกอ่านเลย
 * `fileNameCache` กัน parse สตริงเดิมซ้ำหลายพันครั้ง (ทั้งจังหวัดมักใช้ชุดภาพเดียวกัน)
 */
export function projectGistdaFeature(
  raw: unknown,
  index: number,
  fileNameCache: Map<string, FloodAcquisition[]> = new Map(),
): ProjectedFloodFeature | null {
  assertGistdaFeature(raw, index);
  const f = raw as { properties?: Record<string, unknown> | null; geometry?: unknown };
  const geometry = projectGeometry(f.geometry);
  if (!geometry) return null;
  const p = f.properties ?? {};
  const h3 = str(p.h3_address);
  if (!h3) return null;
  const fileName = typeof p.file_name === "string" ? p.file_name : "";
  let acquisitions = fileNameCache.get(fileName);
  if (!acquisitions) {
    acquisitions = parseGistdaFileName(fileName);
    fileNameCache.set(fileName, acquisitions);
  }
  const area = num(p.f_area) ?? num(p._area);
  return {
    type: "Feature",
    id: h3,
    properties: {
      h3,
      provinceCode: code(p.pv_idn, 2),
      provinceTh: str(p.pv_tn),
      amphoeCode: code(p.ap_idn, 4),
      amphoeTh: str(p.ap_tn),
      tambonCode: code(p.tb_idn, 6),
      tambonTh: str(p.tb_tn),
      floodAreaM2: area === null ? null : Math.round(area * 10) / 10,
      acquisitions,
      observedAt: acquisitions[0]?.acquiredAt ?? null,
      publishedAt: isoOrNull(p._createdAt),
    },
    geometry,
  };
}

/** ต้นทางปฏิเสธกุญแจ — ยิงจังหวัดถัดไปก็ได้ผลเดิม ผู้เรียกต้องหยุดทั้งรอบ */
export class GistdaAuthError extends Error {
  constructor(readonly status: number) {
    super(`GISTDA API key rejected (HTTP ${status})`);
    this.name = "GistdaAuthError";
  }
}

/**
 * หมดงบเวลาของรอบ (`FetchOptions.deadlineMs`) ก่อนยิงหน้าถัดไป/ครั้งถัดไป — ไม่ใช่ความผิด
 * ของต้นทาง: ผู้เรียกนับจังหวัดนี้และที่เหลือเป็น "ข้าม" ให้คงคำตอบเดิม แล้วจบรอบตามปกติ
 */
export class GistdaBudgetError extends Error {
  constructor() {
    super("GISTDA API: refresh time budget exhausted");
    this.name = "GistdaBudgetError";
  }
}

class UpstreamError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/** 5xx/429 คือ "ลองใหม่แล้วอาจได้", 4xx อื่นคือขอผิด */
function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const jitter = (ms: number) => Math.round(ms * (0.75 + Math.random() * 0.5));

export interface FetchOptions {
  /** จำนวนครั้งที่ยอมยิงต่อหน้า (รวมครั้งแรก) */
  attempts?: number;
  timeoutMs?: number;
  /**
   * epoch ms ที่รอบนี้ต้องหยุดยิง — ตรวจก่อนทุกหน้าและก่อนทุก attempt (รวม retry หลัง sleep)
   * เกินแล้วโยน `GistdaBudgetError`; timeout ต่อคำขอถูกตัดให้ไม่เลยเส้นนี้ด้วย
   */
  deadlineMs?: number;
}

/** เวลาที่ยังเหลือก่อน deadline — ≤ 0 = หมดงบ โยนก่อนยิง */
function remainingMs(options?: FetchOptions): number {
  return options?.deadlineMs === undefined ? Number.POSITIVE_INFINITY : options.deadlineMs - Date.now();
}

interface GistdaPage {
  features: unknown[];
  numberMatched: number | null;
  numberReturned: number;
}

/**
 * หนึ่งหน้า — ข้อความ error ไม่มี body ของต้นทางเลย (มีแค่ HTTP status) เพราะ body
 * ของ API นี้สะท้อนกุญแจกลับมาได้ (`links`) และ lastError โผล่ใน /api/v1/health
 */
async function fetchPage(url: string, key: string, options?: FetchOptions): Promise<GistdaPage> {
  const attempts = Math.max(1, options?.attempts ?? RETRY_DELAYS_MS.length + 1);
  const timeoutMs = options?.timeoutMs ?? FETCH_TIMEOUT_MS;
  let lastError: Error = new Error("GISTDA API: no attempt made");
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(jitter(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length) - 1]!));
    const left = remainingMs(options);
    if (left <= 0) throw new GistdaBudgetError();
    try {
      const res = await fetch(url, {
        headers: {
          "API-Key": key,
          "User-Agent": "siahra-api/0.0.0 (flood extent ingestion)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(Math.min(timeoutMs, left)),
      });
      if (res.status === 401 || res.status === 403 || res.status === 407) {
        void res.body?.cancel();
        throw new GistdaAuthError(res.status);
      }
      if (!res.ok) {
        void res.body?.cancel();
        throw new UpstreamError(`GISTDA API HTTP ${res.status}`, retryableStatus(res.status));
      }
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        // ห้ามใส่ข้อความของ SyntaxError: V8 แนบเศษของ body มาด้วย ซึ่งอาจเป็น `links` ที่มีกุญแจ
        throw new UpstreamShapeError("gistda", "<body>", `invalid JSON (${text.length} bytes)`);
      }
      assertGistdaEnvelope(body);
      const b = body as { features: unknown[]; numberMatched?: unknown; numberReturned?: unknown };
      return {
        features: b.features,
        numberMatched: num(b.numberMatched),
        numberReturned: num(b.numberReturned) ?? b.features.length,
      };
    } catch (err) {
      if (err instanceof GistdaAuthError || err instanceof UpstreamShapeError) throw err;
      if (err instanceof UpstreamError && !err.retryable) throw err;
      // ข้อความของ fetch() เองอาจมี URL — URL ไม่มีกุญแจ แต่ตัดเหลือชื่อชนิด error ให้สั้นไว้
      lastError =
        err instanceof UpstreamError
          ? err
          : new Error(`GISTDA API request failed (${err instanceof Error ? err.name : "error"})`);
    }
  }
  throw lastError;
}

export interface GistdaProvincePull {
  provinceCode: string;
  /** `numberMatched` ของต้นทาง (หน้าแรก) — null ถ้าต้นทางไม่ส่งมา แล้วใช้จำนวนที่นับได้แทน */
  matched: number;
  /** เรียงตาม id (h3) เพื่อให้ serialisation — และ hash — คงที่ข้ามรอบ */
  features: ProjectedFloodFeature[];
}

/**
 * ดึงหนึ่งจังหวัดครบทุกหน้า ทีละหน้า: parse + project แล้วทิ้งหน้าดิบทันที เหลือแค่
 * feature ที่ projection แล้ว (devops constraint 7) — หยุดเมื่อ numberReturned < limit,
 * หน้าว่าง หรือ offset ≥ numberMatched; เซลล์ซ้ำ (ต้นทางกำลังสร้างชุดใหม่ระหว่างที่เรา
 * เลื่อน offset) นับครั้งเดียว
 */
export async function fetchGistdaProvince(
  provinceCode: string,
  key: string,
  options?: FetchOptions,
): Promise<GistdaProvincePull> {
  const byId = new Map<string, ProjectedFloodFeature>();
  const fileNameCache = new Map<string, FloodAcquisition[]>();
  let matched: number | null = null;
  let offset = 0;
  for (let page = 0; page < MAX_PAGES_PER_PROVINCE; page++) {
    // fetchPage ตรวจ deadline ก่อนทุก attempt อยู่แล้ว — ตรงนี้ย้ำก่อนทุกหน้าให้อ่านง่าย
    if (remainingMs(options) <= 0) throw new GistdaBudgetError();
    const res = await fetchPage(gistdaPageUrl(provinceCode, offset), key, options);
    if (page === 0) matched = res.numberMatched;
    for (let i = 0; i < res.features.length; i++) {
      const f = projectGistdaFeature(res.features[i], offset + i, fileNameCache);
      if (f && !byId.has(f.id)) byId.set(f.id, f);
    }
    offset += GISTDA_PAGE_LIMIT;
    if (res.features.length === 0 || res.numberReturned < GISTDA_PAGE_LIMIT) break;
    if (matched !== null && offset >= matched) break;
    if (page === MAX_PAGES_PER_PROVINCE - 1) {
      throw new UpstreamShapeError("gistda", "numberMatched", `more than ${MAX_PAGES_PER_PROVINCE} pages for one province`);
    }
  }
  const features = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { provinceCode, matched: matched ?? features.length, features };
}
