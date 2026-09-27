/**
 * สร้าง `apps/web/public/cctv/doh-cctv.json` — บัญชีกล้องทางหลวงของกรมทางหลวง (E15.3 PR C) จากหน้า
 * `https://www.highwaytraffic.go.th/DOHWeb/home.aspx` ในรูปทั่วไป `CameraCatalogue`
 * (`packages/shared-types/src/cctv.ts`)
 *
 *   npm run build:cctv:doh -w apps/etl
 *   # หรือ (tsx ยังไม่อยู่ใน lockfile) จาก apps/etl:
 *   NODE_EXTRA_CA_CERTS=$PWD/certs/sectigo-public-server-authentication-ca-dv-r36.pem npx -y tsx@4 src/build-doh-cctv.ts
 *   ตัวเลือก: --no-probe (ทุกสตรีม `not-probed`), --vantage <ป้ายเครือข่ายที่รัน>
 *
 *   `NODE_EXTRA_CA_CERTS` จำเป็นตอน probe: `streaming{1,2}.highwaytraffic.go.th` ส่งแค่ leaf certificate
 *   ไม่ส่ง intermediate (Sectigo Public Server Authentication CA DV R36) — เบราว์เซอร์/curl หาเองผ่าน AIA
 *   แต่ `fetch` ของ Node ไม่ทำ จึงล้มด้วย `UNABLE_TO_VERIFY_LEAF_SIGNATURE` → `tls-chain` ทุกเส้น
 *   (run ที่ probe 2026-09-26T22:38Z ก่อนแก้: 270/270); ใบรับรองสาธารณะนั้นอยู่ที่ `certs/` (ที่มา/ลายนิ้วมือใน README)
 *
 * ขั้นตอน (ดึงครั้งเดียว ไม่ใช่งานประจำ; สำรวจ 2026-09-26):
 *   1. GET home.aspx (227 KB) — เก็บ cookie `ASP.NET_SessionId` จาก `set-cookie` (PageMethod ต้องมี
 *      session ไม่ต้อง login) แล้วอ่านรายการจุดจาก `onclick="MoveLocation(<id>);"` (190 จุด)
 *   2. ต่อจุด: POST `home.aspx/GetSiteInfo` `{siteID}` → `{d: [lat, lon, code, html]}` — ดึงชื่อจุด
 *      (หลัง `ชื่อจุดติดตั้ง`) และรายละเอียด (หลัง `รายละเอียด`) จาก html ด้วย regex ที่ทนรูป
 *      **ไม่เก็บ html**; POST `home.aspx/GetCameraInfo` → `{d: html}` ที่มี 1–2
 *      `site_code="https://streaming{1,2}.highwaytraffic.go.th/…/PER_3_003_IN.stream/playlist.m3u8"`
 *      (ขาเข้า/ขาออก หรือสตรีมเดียวไม่มี suffix) + ข้อความทิศทาง (`ทิศทางมุ่งหน้ากรุงเทพ`) → `stream.label`;
 *      สองแท็บที่ชี้ playlist เดียวกัน (103/137 จุดเมื่อ 2026-09-27) ยุบเป็นสตรีมเดียว ป้ายรวมทิศทาง
 *   3. url ที่ origin ไม่ใช่สองโฮสต์ใน `CAMERA_SOURCES["doh-cctv"].hosts` ถูกปฏิเสธและนับ — กลุ่ม IP ดิบ
 *      `http://183.89.205.98:9980/…` (4 สตรีม) ตกที่นี่; จุดที่ไม่เหลือสตรีมเลยไม่ถูก emit
 *   4. จังหวัดจาก point-in-polygon กับ `apps/web/public/aoi/{code}/boundary.geojson`
 *   5. **dedupe กับ iTIC** (`apps/web/public/cctv/itic-cctv.json` ที่ build แล้ว — ไม่มีไฟล์ = หยุด
 *      ไม่ใช่ข้าม): รหัส `PER-3-003` ≡ `PER_3_003` (รหัสของ iTIC อยู่ใน url HLS ของมัน, ขาเข้า/ขาออก
 *      เป็นคนละกล้องใน iTIC) ตรงกัน → ไม่ emit สำเนา DOH (iTIC ผ่าน camerai1 เล่นได้ทุกเครือข่าย);
 *      ไม่ตรงแต่มีกล้อง iTIC ที่ `owner` = กรมทางหลวง อยู่ห่าง ≤ 50 m → ตัดสำเนา DOH เช่นกัน; นับทั้งสองกรณี
 *   6. probe ทุกสตรีมจาก vantage ที่รัน (`cameraCatalogue.ts` `probeStreams`, 8 พร้อมกัน): hls ตาม
 *      master → chunklist แล้วตั้ง `captureTime = "program-date-time"` **เฉพาะ** เมื่อ chunklist มี
 *      `EXT-X-PROGRAM-DATE-TIME` จริง (วัด 2026-09-26: ไม่มีเลย) — `streaming2` ถามไม่ได้จากทั้งสอง
 *      vantage ที่วัด (`unreachable`) ≠ กล้องตาย: **ยัง ship** แบบหรี่พร้อมป้าย ให้ owner ยืนยันจาก
 *      เครือข่ายไทย
 *
 * ความปลอดภัย (แนวเดียวกับ build-itic-cctv.ts):
 *   - แปลงคำตอบทุกใบผ่าน schema `zod/mini` ที่ประกาศเฉพาะฟิลด์ที่ใช้ แล้วประกอบผลลัพธ์ทีละฟิลด์
 *   - url ทุกเส้นต้อง parse ได้ด้วย `URL`, `https:`, origin อยู่ในทะเบียน และไม่มี username/password
 *   - ไม่ log ระเบียนดิบ/cookie — log เฉพาะจำนวน; ข้อความผิดพลาดมีแค่สถานะ+โฮสต์
 *   - `writeCatalogue` ตรวจ origin ซ้ำกับทะเบียน และผลลัพธ์ที่ serialise แล้วด้วย `CREDENTIAL_PATTERN`
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/mini";
import { CAMERA_SOURCES, type Camera, type CameraCatalogue, type CameraStream } from "@siahra/shared-types";
import {
  formatProbeTable,
  NOT_PROBED,
  OUT_DIR,
  parseBuildArgs,
  PROBE_TABLE_LEGEND,
  probeStreams,
  probeVantageLabel,
  progressHeartbeat,
  runThrottled,
  writeCatalogue,
} from "./cameraCatalogue.js";
import { haversineKm } from "./localAuthorityExposureHelpers.js";
import { assignProvince, loadProvincePolygons, type ProvincePolygon } from "./provincePolygons.js";

export const SOURCE_ID = "doh-cctv" as const;

export const HOME_URL = "https://www.highwaytraffic.go.th/DOHWeb/home.aspx";
export const SITE_INFO_URL = `${HOME_URL}/GetSiteInfo`;
export const CAMERA_INFO_URL = `${HOME_URL}/GetCameraInfo`;
/** origin ของสตรีมที่รับ — ทะเบียนเดียวกับที่ web ตรวจ (`CAMERA_SOURCES["doh-cctv"].hosts`) จึงไม่มีทางเหลื่อม */
export const STREAM_ORIGINS: readonly string[] = CAMERA_SOURCES["doh-cctv"].hosts.connect!;
/** บัญชี iTIC ที่ build แล้ว — ใช้ dedupe; ไม่มี = หยุด */
export const ITIC_CATALOGUE_PATH = path.join(OUT_DIR, "itic-cctv.json");
/** ค่า `owner` ของกล้องกรมทางหลวงใน iTIC (ตามที่ feed ของ Longdo ระบุ) */
export const DOH_OWNER_IN_ITIC = "กรมทางหลวง";
/** รัศมี dedupe แบบระยะทาง (เมตร) — กล้อง iTIC ของกรมทางหลวงที่ไม่มีรหัสในลิงก์ */
export const DEDUPE_RADIUS_M = 50;

const AOI_ROOT = path.resolve(import.meta.dirname, "../../web/public/aoi");

// ─────────────────────────────────────────────────────────────────────────────
// parse (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** id ของจุดจาก `onclick="MoveLocation(2753);"` — ไม่ซ้ำ ตามลำดับในหน้า */
export function parseSiteIds(html: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const m of html.matchAll(/MoveLocation\((\d+)\)/g)) {
    const id = Number(m[1]);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** ข้อความล้วน: ถอด tag, entity ที่พบบ่อย, ยุบช่องว่าง — null เมื่อว่าง */
export function cleanText(s: string | null | undefined): string | null {
  const v = s
    ?.replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, " ")
    .trim();
  return v ? v : null;
}

/**
 * ข้อความของช่องถัดจากป้าย `<b>label</b>` ในตาราง `GetSiteInfo` — ทนรูป: ข้าม tag ปิด/เปิดกี่ชั้นก็ได้
 * (`</b></td><td nowrap>`) แล้วอ่านจนถึง `<` ตัวถัดไป — แต่ไม่ข้าม `<b>` ซึ่งเป็นป้ายถัดไป: ช่องว่างจึงเป็น
 * null ไม่ใช่ชื่อของป้ายถัดไป
 */
export function extractField(html: string, label: string): string | null {
  const m = new RegExp(`${label}(?:\\s*<(?!b\\b)[^>]*>\\s*)*([^<]*)`).exec(html);
  return cleanText(m?.[1]);
}

/** allowlist ของ `GetSiteInfo` — `d` = [lat, lon, code, html]; html ใช้ดึงข้อความเท่านั้น ไม่ถูกเก็บ */
const siteInfoSchema = z.object({ d: z.array(z.string()) });
/** allowlist ของ `GetCameraInfo` — `d` = html ที่มี `site_code="…"` */
const cameraInfoSchema = z.object({ d: z.string() });

export interface SiteInfo {
  lat: number;
  lon: number;
  code: string;
  name: string | null;
  description: string | null;
}

function toCoord(v: string | undefined): number | null {
  const n = Number(v?.trim());
  return v !== undefined && v.trim() !== "" && Number.isFinite(n) ? n : null;
}

/** null = ผิดรูป/พิกัดหรือรหัสใช้ไม่ได้ (ผู้เรียกนับ) — html ไม่ถูกส่งต่อ */
export function parseSiteInfo(raw: unknown): SiteInfo | null {
  const r = siteInfoSchema.safeParse(raw);
  if (!r.success || r.data.d.length < 4) return null;
  const [latS, lonS, codeS, html] = r.data.d;
  const lat = toCoord(latS);
  const lon = toCoord(lonS);
  const code = cleanText(codeS);
  if (lat === null || lon === null || code === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
  return {
    lat,
    lon,
    code,
    name: extractField(html!, "ชื่อจุดติดตั้ง"),
    description: extractField(html!, "รายละเอียด"),
  };
}

export type StreamVerdict = "ok" | "raw-ip" | "http" | "other-host" | "credential" | "not-playlist";

/**
 * ตัดสิน url จาก `site_code` — เหตุผลแยกกันเพื่อรายงานจำนวน: `raw-ip` = โฮสต์เป็น IP ดิบ
 * (`http://183.89.205.98:9980/…`, ตรวจก่อน scheme เพราะกลุ่มนี้เป็น http ด้วย), `http` = ไม่ใช่ https,
 * `other-host` = origin นอกทะเบียน/parse ไม่ได้, `credential` = มี userinfo, `not-playlist` = ไม่ใช่ .m3u8
 */
export function classifyStreamUrl(url: string): StreamVerdict {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "other-host";
  }
  if (u.username || u.password) return "credential";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname) || u.hostname.startsWith("[")) return "raw-ip";
  if (u.protocol !== "https:") return "http";
  if (!STREAM_ORIGINS.includes(u.origin)) return "other-host";
  if (!u.pathname.toLowerCase().endsWith(".m3u8")) return "not-playlist";
  return "ok";
}

const SUFFIX_LABEL: Record<string, string> = { IN: "ขาเข้า", OUT: "ขาออก" };

/**
 * ป้ายของสตรีม: ทิศทางจาก suffix `_IN`/`_OUT` ของชื่อสตรีม (ขาเข้า/ขาออก ตาม tab ของหน้า) + ข้อความ
 * ทิศทาง `ctl01_TxtDirect…` ที่ตามมาในส่วนเดียวกัน — ไม่มีทั้งคู่ = null (web ใช้ป้ายตามชนิดแทน)
 */
export function labelFor(segment: string, url: string): string | null {
  const suffix = /_(IN|OUT)\.stream\b/i.exec(url)?.[1]?.toUpperCase();
  const side = suffix ? SUFFIX_LABEL[suffix] : undefined;
  const direction = cleanText(/id="ctl01_TxtDirect\w*"[^>]*>([^<]*)</.exec(segment)?.[1]);
  if (side && direction) return `${side} — ${direction}`;
  return side ?? direction ?? null;
}

export type RefusedStreams = Record<Exclude<StreamVerdict, "ok">, number>;

export const emptyRefused = (): RefusedStreams => ({ "raw-ip": 0, http: 0, "other-host": 0, credential: 0, "not-playlist": 0 });

/**
 * สตรีมจาก `GetCameraInfo` — เฉพาะที่ `classifyStreamUrl` ให้ `ok`; ที่เหลือนับตามเหตุผล; null = ผิดรูป
 *
 * **url ซ้ำในจุดเดียวกัน** (วัด 2026-09-27: 103 จาก 137 จุด — หน้าเว็บมีสองแท็บ ขาเข้า/ขาออก แต่ชี้
 * playlist เดียวกัน `…/PER_10_014.stream/playlist.m3u8` ไม่มี suffix `_IN`/`_OUT`) = สตรีมเดียว
 * ไม่ใช่สองกล้อง — ยุบเป็นเส้นเดียว ป้ายรวมข้อความทิศทางที่ต่างกันด้วย " / " (ไม่เดาว่าฝั่งไหนคือฝั่งที่เห็น)
 * และนับใน `sameUrl` — ไม่นับเป็น refused เพราะไม่มีอะไรถูกปฏิเสธ
 */
export function parseCameraInfo(
  raw: unknown,
): { streams: { url: string; label: string | null }[]; refused: RefusedStreams; sameUrl: number } | null {
  const r = cameraInfoSchema.safeParse(raw);
  if (!r.success) return null;
  const html = r.data.d;
  const streams: { url: string; label: string | null }[] = [];
  const refused = emptyRefused();
  let sameUrl = 0;
  const hits = [...html.matchAll(/site_code="([^"]*)"/g)];
  hits.forEach((m, i) => {
    const url = m[1]!.trim();
    const verdict = classifyStreamUrl(url);
    if (verdict !== "ok") {
      refused[verdict]++;
      return;
    }
    const start = m.index! + m[0].length;
    const end = hits[i + 1]?.index ?? html.length;
    const normalised = new URL(url).toString();
    const label = labelFor(html.slice(start, end), url);
    const existing = streams.find((s) => s.url === normalised);
    if (existing) {
      sameUrl++;
      if (label && existing.label !== label) existing.label = existing.label ? `${existing.label} / ${label}` : label;
      return;
    }
    streams.push({ url: normalised, label });
  });
  return { streams, refused, sameUrl };
}

/**
 * ส่วนอำเภอ/จังหวัดของชื่อจุด — `"1 - อ.หนองแค จ.สระบุรี"` → `"อ.หนองแค จ.สระบุรี"`; แยกไม่ได้ถูก ๆ = null
 * (ไม่เดาจากรายละเอียด)
 */
export function placeFromName(name: string | null): string | null {
  if (!name) return null;
  const m = /((?:อ\.|เขต)\S+(?:\s+จ\.\S+)?|จ\.\S+)/.exec(name);
  return m?.[1] ?? null;
}

/**
 * รหัสจุดในรูปเทียบได้: `PER-3-003` / `PER_3_003` / `…/Phase3/PER_3_003_IN.stream/…` → `PER-3-3`
 * (ตัวคั่นและเลขศูนย์นำหน้าไม่นับ, suffix ทิศทางไม่นับ) — null เมื่อไม่มีรูปรหัสเลย
 */
export function normaliseCode(s: string | null | undefined): string | null {
  const m = s ? /\b([A-Z]{2,5})[_-](\d+)[_-](\d+)/.exec(s) : null;
  return m ? `${m[1]}-${Number(m[2])}-${Number(m[3])}` : null;
}

export interface IticIndex {
  /** รหัสที่ normalise แล้วของกล้อง iTIC ทุกตัว (ทุก owner — รหัส PER อยู่ที่กรมทางหลวงเท่านั้นอยู่แล้ว) */
  codes: Set<string>;
  /** กล้อง iTIC ที่ `owner` = กรมทางหลวง — สำหรับ dedupe แบบระยะทาง */
  dohPoints: { lat: number; lon: number }[];
}

/** รหัสของกล้อง iTIC — จาก url ของสตรีม (`PER_3_003_IN.stream`) ก่อน, ไม่มีจึงดูจาก id (`DOH-PER-3-003`) */
export function codeFromIticCamera(c: Pick<Camera, "id" | "streams">): string | null {
  for (const s of c.streams) {
    if ("url" in s) {
      const code = normaliseCode(s.url);
      if (code) return code;
    }
  }
  return normaliseCode(c.id);
}

export function buildIticIndex(cat: Pick<CameraCatalogue, "cameras">): IticIndex {
  const codes = new Set<string>();
  const dohPoints: { lat: number; lon: number }[] = [];
  for (const c of cat.cameras) {
    const code = codeFromIticCamera(c);
    if (code) codes.add(code);
    if (c.owner === DOH_OWNER_IN_ITIC) dohPoints.push({ lat: c.lat, lon: c.lon });
  }
  return { codes, dohPoints };
}

/** อ่านบัญชี iTIC ที่ build แล้ว — ไม่มีไฟล์/ผิดรูป = โยน (dedupe เป็นข้อบังคับ ไม่ใช่ตัวเลือก) */
export function loadIticIndex(file = ITIC_CATALOGUE_PATH): IticIndex {
  if (!existsSync(file)) {
    throw new Error("itic-cctv.json is missing — build it first (npm run build:cctv:itic); the DOH catalogue is deduplicated against it");
  }
  const parsed = z.object({ sourceId: z.literal("itic-cctv"), cameras: z.array(z.unknown()) }).safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) throw new Error("itic-cctv.json is not an itic-cctv CameraCatalogue");
  return buildIticIndex({ cameras: parsed.data.cameras as Camera[] });
}

/** ระยะ (เมตร) — `haversineKm` ของ helper ที่มีอยู่ (lon, lat) */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return haversineKm([a.lon, a.lat], [b.lon, b.lat]) * 1000;
}

/**
 * ตัดสำเนา DOH ของกล้องที่ iTIC มีแล้ว — รหัสตรง (`byCode`) หรือ ไม่ตรงแต่มีกล้องกรมทางหลวงใน iTIC
 * ห่าง ≤ `DEDUPE_RADIUS_M` (`byDistance`); ไม่เก็บทั้งคู่
 */
export function dedupeAgainstItic(cameras: readonly Camera[], index: IticIndex): { kept: Camera[]; byCode: number; byDistance: number } {
  const kept: Camera[] = [];
  let byCode = 0;
  let byDistance = 0;
  for (const c of cameras) {
    const code = normaliseCode(c.code);
    if (code && index.codes.has(code)) {
      byCode++;
      continue;
    }
    if (index.dohPoints.some((p) => distanceM(p, c) <= DEDUPE_RADIUS_M)) {
      byDistance++;
      continue;
    }
    kept.push(c);
  }
  return { kept, byCode, byDistance };
}

// ─────────────────────────────────────────────────────────────────────────────
// projection (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** คำตอบดิบสองใบของจุดหนึ่ง (ยังไม่ผ่าน schema) — null = ขอไม่สำเร็จ */
export interface SiteResponses {
  siteId: number;
  info: unknown;
  cameras: unknown;
}

export interface BuildStats {
  /** จุดจาก `MoveLocation` */
  sites: number;
  /** ขอ PageMethod ไม่สำเร็จ (HTTP/timeout/ไม่ใช่ JSON) */
  fetchFailed: number;
  /** `GetSiteInfo` ผิดรูป หรือพิกัด/รหัสใช้ไม่ได้ */
  malformed: number;
  /** `GetCameraInfo` ผิดรูป */
  malformedCameras: number;
  /** `site_code` ทั้งหมดที่เห็น (รวมที่ซ้ำ url และที่ถูกปฏิเสธ) */
  streamsSeen: number;
  refused: RefusedStreams;
  /** `site_code` ที่ชี้ playlist เดียวกับเส้นก่อนในจุดเดียวกัน — ยุบเป็นสตรีมเดียว (`parseCameraInfo`) */
  sameUrl: number;
  /** จุดที่ไม่เหลือสตรีมใช้ได้ */
  noStream: number;
  /** รหัสซ้ำระหว่างจุด (เก็บตัวแรก) */
  duplicateCode: number;
  noProvince: number;
  /** กล้องก่อน dedupe กับ iTIC */
  cameras: number;
}

export function buildCameras(sites: readonly SiteResponses[], provinces: readonly ProvincePolygon[]): { cameras: Camera[]; stats: BuildStats } {
  const stats: BuildStats = {
    sites: sites.length,
    fetchFailed: 0,
    malformed: 0,
    malformedCameras: 0,
    streamsSeen: 0,
    refused: emptyRefused(),
    sameUrl: 0,
    noStream: 0,
    duplicateCode: 0,
    noProvince: 0,
    cameras: 0,
  };
  const cameras: Camera[] = [];
  const seen = new Set<string>();
  for (const site of sites) {
    if (site.info === null || site.cameras === null) {
      stats.fetchFailed++;
      continue;
    }
    const info = parseSiteInfo(site.info);
    if (!info) {
      stats.malformed++;
      continue;
    }
    const cam = parseCameraInfo(site.cameras);
    if (!cam) {
      stats.malformedCameras++;
      continue;
    }
    for (const k of Object.keys(cam.refused) as (keyof RefusedStreams)[]) stats.refused[k] += cam.refused[k];
    stats.sameUrl += cam.sameUrl;
    stats.streamsSeen += cam.streams.length + cam.sameUrl + Object.values(cam.refused).reduce((a, b) => a + b, 0);
    if (cam.streams.length === 0) {
      stats.noStream++;
      continue;
    }
    if (seen.has(info.code)) {
      stats.duplicateCode++;
      continue;
    }
    seen.add(info.code);
    const provinceCode = assignProvince(info.lat, info.lon, provinces);
    if (provinceCode === null) stats.noProvince++;
    const streams: CameraStream[] = cam.streams.map((s) => ({
      kind: "hls",
      url: s.url,
      label: s.label,
      captureTime: "none",
      probe: { ...NOT_PROBED },
    }));
    stats.cameras++;
    cameras.push({
      // รหัสจุดของกรม (`PER-3-003`) เป็น id — ผู้ใช้อ้างถึงได้ และเป็นกุญแจ dedupe กับ iTIC
      id: info.code,
      sourceId: SOURCE_ID,
      nameTh: info.name,
      nameEn: null,
      lat: info.lat,
      lon: info.lon,
      coordSource: "upstream",
      provinceCode,
      // กล้องเป็นของหน่วยงานต้นทางเอง — เครดิตมาจาก SOURCES["doh-cctv"] ไม่ต้องซ้ำที่นี่
      owner: null,
      code: info.code,
      placeTh: placeFromName(info.name),
      streams,
    });
  }
  return { cameras, stats };
}

/** จำนวนสตรีมต่อ origin — สำหรับ log/README (streaming1 กับ streaming2 ให้ผล probe ต่างกัน) */
export function streamsByOrigin(cameras: readonly Camera[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cameras) {
    for (const s of c.streams) {
      if (!("url" in s)) continue;
      const o = new URL(s.url).origin;
      out[o] = (out[o] ?? 0) + 1;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// fetch (network)
// ─────────────────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;

/** GET หน้าแรก — คืน html + ค่า cookie session (ไม่เคย log, ไม่เข้าไฟล์) */
export async function fetchHome(fetchImpl: typeof fetch = fetch): Promise<{ html: string; sessionCookie: string }> {
  const res = await fetchImpl(HOME_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(HOME_URL).host}`);
  const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
  const sid = cookies.map((c) => /ASP\.NET_SessionId=([^;]+)/.exec(c)?.[1]).find((v) => v);
  if (!sid) throw new Error(`no ASP.NET_SessionId cookie from ${new URL(HOME_URL).host}`);
  return { html: await res.text(), sessionCookie: `ASP.NET_SessionId=${sid}` };
}

async function pageMethod(fetchImpl: typeof fetch, url: string, siteId: number, sessionCookie: string): Promise<unknown> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", cookie: sessionCookie },
      body: JSON.stringify({ siteID: siteId }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // timeout/เครือข่าย/ไม่ใช่ JSON — ผู้เรียกนับเป็น fetchFailed (ไม่โยนต่อ: ข้อความ SyntaxError มีชิ้นส่วน body)
    return null;
  }
}

/** ขอสองใบต่อจุด, 8 พร้อมกัน, เว้นช่วงบนโฮสต์ — ผลตามลำดับ `siteIds` */
export async function fetchSites(siteIds: readonly number[], sessionCookie: string, fetchImpl: typeof fetch = fetch): Promise<SiteResponses[]> {
  const host = new URL(HOME_URL).host;
  return runThrottled(
    siteIds.map((siteId) => ({
      host,
      run: async (): Promise<SiteResponses> => {
        const info = await pageMethod(fetchImpl, SITE_INFO_URL, siteId, sessionCookie);
        const cameras = info === null ? null : await pageMethod(fetchImpl, CAMERA_INFO_URL, siteId, sessionCookie);
        return { siteId, info, cameras };
      },
    })),
    { concurrency: 8, hostConcurrency: {}, perHostGapMs: 50, now: () => Date.now() },
  );
}

async function main() {
  const provinces = loadProvincePolygons(AOI_ROOT);
  console.log(`boundaries: ${new Set(provinces.map((p) => p.code)).size} provinces (${provinces.length} polygons)`);

  const args = parseBuildArgs(process.argv.slice(2));
  const itic = loadIticIndex();
  console.log(`itic-cctv.json: ${itic.codes.size} codes, ${itic.dohPoints.length} Department of Highways cameras for the distance check`);

  const { html, sessionCookie } = await fetchHome();
  const siteIds = parseSiteIds(html);
  if (siteIds.length === 0) throw new Error("home.aspx lists no MoveLocation(id) sites");
  const sites = await fetchSites(siteIds, sessionCookie);
  // เวลาที่ดึงรายการสำเร็จ (ตาม doc ของ CameraCatalogue.builtAt) — ไม่ใช่เวลาเริ่มสคริปต์
  const builtAt = new Date().toISOString();

  const { cameras, stats } = buildCameras(sites, provinces);
  const r = stats.refused;
  console.log(
    [
      `sites: ${stats.sites} listed`,
      `${stats.fetchFailed} not fetched`,
      `${stats.malformed} malformed site info`,
      `${stats.malformedCameras} malformed camera info`,
      `${stats.streamsSeen} streams seen`,
      `${r["raw-ip"] + r.http + r["other-host"] + r.credential + r["not-playlist"]} refused (${r["raw-ip"]} raw-IP host, ${r.http} http, ${r["other-host"]} other host, ${r.credential} userinfo, ${r["not-playlist"]} not a playlist)`,
      `${stats.sameUrl} repeated the same playlist within a site (collapsed to one stream)`,
      `${stats.noStream} sites without a usable stream`,
      `${stats.duplicateCode} duplicate code`,
    ].join(", "),
  );
  const deduped = dedupeAgainstItic(cameras, itic);
  console.log(
    `cameras: ${stats.cameras} projected, ${deduped.byCode} already in iTIC by code, ${deduped.byDistance} within ${DEDUPE_RADIUS_M} m of an iTIC Department of Highways camera → ${deduped.kept.length} kept, ${deduped.kept.filter((c) => c.provinceCode === null).length} outside every province boundary; streams by host: ${Object.entries(streamsByOrigin(deduped.kept))
      .map(([k, n]) => `${new URL(k).host}=${n}`)
      .join(", ")}`,
  );

  // probe จาก vantage ที่รัน — ผลเป็นของเวลานั้น/เครือข่ายนั้น ไม่ใช่สถานะปัจจุบัน
  const probeVantage = args.probe ? probeVantageLabel(args.vantage) : null;
  // heartbeat (จำนวนเท่านั้น) — streaming2 timeout ทั้งชุดทำให้ช่วงนี้เงียบได้หลายนาที
  const probed = await probeStreams(deduped.kept, { skip: !args.probe, concurrency: 8, onProgress: progressHeartbeat() });
  const probedAt = args.probe ? new Date().toISOString() : null;
  console.log(args.probe ? `probe (${probeVantage}, ${probedAt}):` : "probe skipped (--no-probe): every stream is not-probed");
  console.log(formatProbeTable(probed.stats, probed.cameras));
  if (args.probe) {
    const perHost = new Map<string, Record<string, number>>();
    for (const c of probed.cameras) {
      for (const s of c.streams) {
        if (!("url" in s)) continue;
        const host = new URL(s.url).host;
        const row = perHost.get(host) ?? {};
        row[s.probe.result] = (row[s.probe.result] ?? 0) + 1;
        perHost.set(host, row);
      }
    }
    for (const [host, row] of perHost) {
      console.log(
        `  ${host}: ${Object.entries(row)
          .map(([k, n]) => `${k}=${n}`)
          .join(", ")}`,
      );
    }
    console.log(PROBE_TABLE_LEGEND);
  }

  const { path: out, stats: written } = writeCatalogue(SOURCE_ID, probed.cameras, { builtAt, sourceUrl: HOME_URL, probedAt, probeVantage });
  console.log(
    `wrote ${path.relative(process.cwd(), out)}: ${written.cameras} cameras (${written.duplicates} duplicate id dropped), ${written.streams} streams, ${written.provinces} provinces`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "build-doh-cctv failed");
    process.exit(1);
  });
}
