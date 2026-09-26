/**
 * สร้าง `apps/web/public/cctv/itic-cameras.json` — บัญชีกล้องถนนที่เผยแพร่ผ่านมูลนิธิ iTIC
 * (E15.2) จากรายการกล้องของ Longdo `https://camera.longdo.com/feed/?command=json`
 *
 *   npm run build:itic-cctv -w apps/etl
 *
 * ขั้นตอน (ดึงครั้งเดียว ไม่ใช่งานประจำ):
 *   1. GET feed → array ของกล้อง (วัดจริง 2026-09-26: 294 รายการ, ACAO *)
 *   2. เก็บกล้องที่ `hls_url` ขึ้นต้นด้วย `https://camerai1.iticfoundation.org/` และไม่มี
 *      `tempsus` (playlist ป้าย "ระงับชั่วคราว" ของ iTIC) เป็น `stream.kind = "hls"` — playlist บน
 *      camerai1 ใช้ได้จริง (164/184 ตอบ 200, ACAO *, H.264 720p) ส่วน HLS/MJPEG บน
 *      `camera1.iticfoundation.org` timeout หมด และ `hls_url` ที่ว่าง/เป็น IP ดิบใช้ไม่ได้
 *   3. กล้องที่ไม่มี HLS ใช้ได้ เก็บเป็นภาพนิ่ง (`stream.kind = "jpeg"`) **เฉพาะ** เมื่อ `imgurl`
 *      ตรง `JPEG_PATTERN` ทุกตัวอักษร (`jpeg2.php?camid=10.8.0.{n}:{port}`) — กฎนี้มาจากการวัด
 *      2026-09-26 ไม่ได้ตั้งขึ้นลอย ๆ: กลุ่มนี้กลุ่มเดียวที่ตอบภาพถนนจริง (~50 KB, 480×384, เวลาพิมพ์
 *      บนภาพ) ส่วนกลุ่มอื่นของ `jpeg2.php` ตอบของที่ไม่ใช่ภาพจากกล้อง:
 *        camid `X.X.X.X:YYYY` (ค่าเติม)      — ไม่มีกล้องจริงให้ขอ
 *        camid `CAMPK…`                      — "Camera (jpeg) not found" (39 ไบต์)
 *        camid `61.91.182.114:111x`          — JPEG 320×240 ป้าย "No signal"
 *        `jpeg.cgi?camid=PER-3-008_2`        — 0 ไบต์
 *      กลุ่มใหม่ต้องวัดก่อนแล้วค่อยขยาย pattern — ไม่เดาจากรูปลิงก์
 *   4. จังหวัดจาก point-in-polygon กับ `apps/web/public/aoi/{code}/boundary.geojson`
 *
 * `lastupdate` ของต้นทางเป็นค่าเติม (2030/2099) ไม่ได้บอกความสด จึงไม่ถูกเก็บ
 *
 * ความปลอดภัย (แนวเดียวกับ build-cctv.ts):
 *   - แปลงทุกรายการผ่าน schema `zod/mini` ที่ประกาศเฉพาะฟิลด์ที่ใช้ แล้วประกอบผลลัพธ์ทีละฟิลด์
 *   - ลิงก์ทั้งสองแบบต้อง parse ได้ด้วย `URL`, origin ตรง และไม่มี username/password
 *   - ไม่ log รายการดิบ — log เฉพาะจำนวน
 *   - ตรวจผลลัพธ์ที่ serialise แล้วด้วย `CREDENTIAL_PATTERN` ก่อนเขียน เจอ = ยกเลิกทั้งหมด
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/mini";
import type { ItiCCamera, ItiCCatalogue, ItiCStream } from "@siahra/shared-types";
import { assignProvince, CREDENTIAL_PATTERN, loadProvincePolygons, type ProvincePolygon } from "./provincePolygons.js";

export const FEED_URL = "https://camera.longdo.com/feed/?command=json";
/** โฮสต์ HLS เดียวที่ใช้ได้จริง (วัด 2026-09-26) — web ตรวจ prefix เดียวกันซ้ำตอนเล่น */
export const HLS_PREFIX = "https://camerai1.iticfoundation.org/";
/** origin ของภาพนิ่ง — ใช้กับ `JPEG_PATTERN` เท่านั้น (ลิงก์อื่นบนโฮสต์นี้ไม่ถูกเก็บ) */
export const JPEG_ORIGIN = "https://camera1.iticfoundation.org";
/**
 * กลุ่มภาพนิ่งเดียวที่ตอบภาพจริงเมื่อวัด 2026-09-26 (ดูหัวไฟล์) — web ตรวจ pattern เดียวกันซ้ำ
 * (`apps/web/src/lib/itic.ts` `ITIC_JPEG_PATTERN`) ยึดหัว-ท้าย จึงไม่มีที่ให้ userinfo/พารามิเตอร์อื่น
 */
export const JPEG_PATTERN = /^https:\/\/camera1\.iticfoundation\.org\/jpeg2\.php\?camid=10\.8\.0\.\d+:\d+$/;

const AOI_ROOT = path.resolve(import.meta.dirname, "../../web/public/aoi");
const OUT_PATH = path.resolve(import.meta.dirname, "../../web/public/cctv/itic-cameras.json");

const text = z.optional(z.nullable(z.string()));

/**
 * allowlist — ไม่ประกาศ `link`/`vdourl`/`imgurl_specific`/`sponsertext`/`lastupdate`; `imgurl`
 * ถูกอ่านเพื่อตัดสินด้วย `classifyJpegUrl` เท่านั้น นอกกลุ่มที่วัดแล้วไม่ถูกเขียนลงไฟล์
 */
const feedItemSchema = z.object({
  camid: z.string(),
  title: text,
  latitude: z.union([z.string(), z.number()]),
  longitude: z.union([z.string(), z.number()]),
  organization: text,
  hls_url: text,
  imgurl: text,
});
export type FeedItem = z.infer<typeof feedItemSchema>;

export function parseFeed(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) throw new Error("feed: expected a JSON array");
  return raw;
}

/** null = ผิดรูป (ผู้เรียกนับจำนวน) */
export function parseFeedItem(raw: unknown): FeedItem | null {
  const r = feedItemSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export type HlsVerdict = "ok" | "empty" | "other-host" | "suspended" | "credential";

/** ตัดสิน `hls_url` — เหตุผลแยกกันเพื่อรายงานจำนวนที่ตกแต่ละแบบ */
export function classifyHlsUrl(url: string | null | undefined): HlsVerdict {
  const u = url?.trim();
  if (!u) return "empty";
  if (!u.startsWith(HLS_PREFIX)) return "other-host";
  if (u.includes("tempsus")) return "suspended";
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return "other-host";
  }
  if (parsed.username || parsed.password || parsed.origin + "/" !== HLS_PREFIX) return "credential";
  return "ok";
}

export type JpegVerdict = "ok" | "empty" | "placeholder" | "other" | "credential";

/**
 * ตัดสิน `imgurl` ของกล้องที่ไม่มี HLS ใช้ได้ — `ok` เฉพาะกลุ่มที่วัดแล้วว่าตอบภาพจริง
 * `placeholder` = camid `X.X.X.X:…` ของต้นทาง; `other` = กลุ่มอื่นทั้งหมด (ตอบ not found /
 * "No signal" / 0 ไบต์ เมื่อวัด หรือยังไม่เคยวัด)
 */
export function classifyJpegUrl(url: string | null | undefined): JpegVerdict {
  const u = url?.trim();
  if (!u) return "empty";
  if (!JPEG_PATTERN.test(u)) {
    return /[?&]camid=X\.X\.X\.X(:|$)/.test(u) ? "placeholder" : "other";
  }
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return "other";
  }
  // pattern ยึดหัวไว้แล้ว — ตรวจซ้ำด้วย URL parser ตามแนวเดียวกับ classifyHlsUrl
  if (parsed.username || parsed.password || parsed.origin !== JPEG_ORIGIN) return "credential";
  return "ok";
}

function toCoord(v: string | number): number | null {
  const n = typeof v === "number" ? v : Number(v.trim());
  return Number.isFinite(n) ? n : null;
}

/** พิกัดที่ใช้ได้ — null = ว่าง/ไม่ใช่ตัวเลข/(0,0)/นอกช่วง */
export function parseCoords(item: FeedItem): { lat: number; lon: number } | null {
  const lat = toCoord(item.latitude);
  const lon = toCoord(item.longitude);
  if (lat === null || lon === null) return null;
  if (lat === 0 && lon === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function cleanText(s: string | null | undefined): string | null {
  const v = s?.replace(/\s+/g, " ").trim();
  return v ? v : null;
}

export interface BuildStats {
  total: number;
  malformed: number;
  /** กล้องที่ HLS ใช้ได้ */
  hls: number;
  /** HLS ใช้ไม่ได้แต่ `imgurl` อยู่ในกลุ่มภาพนิ่งที่วัดแล้ว */
  jpeg: number;
  /** เหตุผลที่ HLS ใช้ไม่ได้ — นับทุกรายการที่ไม่ได้ HLS (รวมที่ได้เป็นภาพนิ่งภายหลัง) */
  empty: number;
  otherHost: number;
  suspended: number;
  credential: number;
  /** เหตุผลที่ภาพนิ่งใช้ไม่ได้ — นับเฉพาะรายการที่ไม่ได้ HLS */
  jpegEmpty: number;
  jpegPlaceholder: number;
  jpegOther: number;
  jpegCredential: number;
  duplicate: number;
  noCoords: number;
  noProvince: number;
}

/** ประกอบระเบียนทีละฟิลด์จาก allowlist — ไม่มีการ spread ของต้นทาง */
export function buildCatalogue(
  rawItems: readonly unknown[],
  provinces: readonly ProvincePolygon[],
  builtAt: string,
): { catalogue: ItiCCatalogue; stats: BuildStats } {
  const stats: BuildStats = {
    total: rawItems.length,
    malformed: 0,
    hls: 0,
    jpeg: 0,
    empty: 0,
    otherHost: 0,
    suspended: 0,
    credential: 0,
    jpegEmpty: 0,
    jpegPlaceholder: 0,
    jpegOther: 0,
    jpegCredential: 0,
    duplicate: 0,
    noCoords: 0,
    noProvince: 0,
  };
  const cameras: ItiCCamera[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const item = parseFeedItem(raw);
    if (!item) {
      stats.malformed++;
      continue;
    }
    let stream: ItiCStream;
    const verdict = classifyHlsUrl(item.hls_url);
    if (verdict === "ok") {
      stream = { kind: "hls", url: item.hls_url!.trim() };
    } else {
      if (verdict === "empty") stats.empty++;
      else if (verdict === "other-host") stats.otherHost++;
      else if (verdict === "suspended") stats.suspended++;
      else stats.credential++;
      const jpeg = classifyJpegUrl(item.imgurl);
      if (jpeg !== "ok") {
        if (jpeg === "empty") stats.jpegEmpty++;
        else if (jpeg === "placeholder") stats.jpegPlaceholder++;
        else if (jpeg === "other") stats.jpegOther++;
        else stats.jpegCredential++;
        continue;
      }
      stream = { kind: "jpeg", url: item.imgurl!.trim() };
    }
    const id = item.camid.trim();
    if (!id || seen.has(id)) {
      stats.duplicate++;
      continue;
    }
    const pt = parseCoords(item);
    if (!pt) {
      stats.noCoords++;
      continue;
    }
    seen.add(id);
    if (stream.kind === "hls") stats.hls++;
    else stats.jpeg++;
    const provinceCode = assignProvince(pt.lat, pt.lon, provinces);
    if (provinceCode === null) stats.noProvince++;
    cameras.push({
      id,
      name: cleanText(item.title),
      lat: pt.lat,
      lon: pt.lon,
      organization: cleanText(item.organization),
      stream,
      provinceCode,
    });
  }
  cameras.sort((a, b) => a.id.localeCompare(b.id));
  return { catalogue: { builtAt, sourceUrl: FEED_URL, cameras }, stats };
}

/** serialise แล้วตรวจ — เจอรูปแบบข้อมูลรับรองเมื่อไหร่ โยนทิ้งทั้งไฟล์ (ข้อความไม่อ้างค่าที่เจอ) */
export function serializeCatalogue(catalogue: ItiCCatalogue): string {
  const json = `${JSON.stringify(catalogue, null, 2)}\n`;
  if (CREDENTIAL_PATTERN.test(json)) {
    throw new Error("build-itic-cctv: output matches the credential pattern — refusing to write it");
  }
  return json;
}

async function fetchFeed(): Promise<unknown> {
  const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(FEED_URL).host}`);
  try {
    return await res.json();
  } catch {
    // SyntaxError ฝังชิ้นส่วนของ body ไว้ในข้อความ — ไม่ปล่อยให้ถูก log
    throw new Error("invalid JSON from the feed");
  }
}

async function main() {
  const provinces = loadProvincePolygons(AOI_ROOT);
  console.log(`boundaries: ${new Set(provinces.map((p) => p.code)).size} provinces (${provinces.length} polygons)`);

  const items = parseFeed(await fetchFeed());
  // เวลาที่ดึงรายการสำเร็จ (ตาม doc ของ ItiCCatalogue.builtAt) — ไม่ใช่เวลาเริ่มสคริปต์
  const builtAt = new Date().toISOString();

  const { catalogue, stats } = buildCatalogue(items, provinces, builtAt);
  console.log(
    [
      `feed: ${stats.total} entries`,
      `${stats.malformed} malformed`,
      `${stats.empty + stats.otherHost + stats.suspended + stats.credential} without a usable HLS (${stats.empty} without hls_url, ${stats.otherHost} on another host, ${stats.suspended} suspended (tempsus), ${stats.credential} refused (userinfo))`,
      `${stats.duplicate} duplicate id`,
      `${stats.noCoords} without coordinates`,
    ].join(", "),
  );
  console.log(
    [
      `without HLS → image: ${stats.jpeg} kept as JPEG snapshot (jpeg2.php camid 10.8.0.x:port)`,
      `${stats.jpegPlaceholder} placeholder camid X.X.X.X`,
      `${stats.jpegOther} other image link (not found / no signal / empty when probed, or never probed)`,
      `${stats.jpegEmpty} without imgurl`,
      `${stats.jpegCredential} refused (userinfo)`,
    ].join(", "),
  );
  const orgs = new Map<string, number>();
  for (const c of catalogue.cameras) orgs.set(c.organization ?? "(none)", (orgs.get(c.organization ?? "(none)") ?? 0) + 1);
  console.log(
    `cameras: ${catalogue.cameras.length} written (${stats.hls} HLS, ${stats.jpeg} JPEG), ${stats.noProvince} outside every province boundary; by organization: ${[...orgs].map(([k, n]) => `${k}=${n}`).join(", ")}`,
  );
  const json = serializeCatalogue(catalogue);
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, json);
  const provincesCovered = new Set(catalogue.cameras.map((c) => c.provinceCode).filter(Boolean)).size;
  console.log(`wrote ${path.relative(process.cwd(), OUT_PATH)} (${provincesCovered} provinces)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "build-itic-cctv failed");
    process.exit(1);
  });
}
