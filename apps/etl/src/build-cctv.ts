/**
 * สร้าง `apps/web/public/cctv/dwr-cameras.json` — บัญชีกล้อง CCTV ของสถานีโทรมาตร
 * กรมทรัพยากรน้ำ (DWR, E15) จาก API สาธารณะ `https://telemetry.dwr.go.th/api`
 *
 *   npm run build:cctv -w apps/etl
 *
 * ขั้นตอน (ดึงครั้งเดียว ไม่ใช่งานประจำ):
 *   1. POST `public/reportCctv/listPaginate` ทีละหน้า (pageSize 200) จนครบ `totalCount`
 *      — ต้องมี `paginate.orders: []` ไม่งั้น DWR ตอบ 400 "Error parsing HTTP request."
 *      (วัดจริง 2026-09-26; ตัวเว็บของ DWR เองก็ส่ง `orders` ทุกครั้ง)
 *   2. GET `public/station/getByCode/{stationCode}` ทีละสถานี ห่างกัน ~200 ms
 *      → พิกัดอยู่ที่ `value.fullCon.entity.point.{lat,lon}`
 *   3. จังหวัดจาก point-in-polygon กับ `apps/web/public/aoi/{code}/boundary.geojson`
 *
 * **ความปลอดภัย — ห้ามแก้ข้อนี้**: payload ของทั้งสอง endpoint มีลิงก์กล้องที่ฝังชื่อผู้ใช้/
 * รหัสผ่านจริง (`cctvSnapshotLink`/`cctvVideoLink` แบบ `http://user:pass@….dyndns…`)
 * ไฟล์นี้จึง:
 *   - แปลงทุก response ผ่าน schema `zod/mini` ที่ **ไม่ประกาศ** ฟิลด์ลิงก์ (`z.object`
 *     ตัดคีย์ที่ไม่รู้จักทิ้ง) แล้วประกอบผลลัพธ์ทีละฟิลด์ ไม่ spread ของต้นทาง
 *   - ไม่ log/print response ดิบ ไม่เขียนมันลงไฟล์ใด — log เฉพาะจำนวน, รหัสสถานี, HTTP status
 *   - ข้อผิดพลาดของ schema รายงานแค่ path/code ของ issue ไม่รายงานค่าที่รับเข้ามา
 *   - ตรวจผลลัพธ์ที่ serialise แล้วด้วย `CREDENTIAL_PATTERN` ก่อนเขียน เจอ = ยกเลิกทั้งหมด
 *
 * ฟังก์ชันล้วนถูก export ให้ `build-cctv.test.ts` ทดสอบกับ fixture ปลอม ส่วน `main()`
 * รันเฉพาะตอนสั่งสคริปต์นี้ตรง ๆ (ผ่าน `tsx`) ไม่ใช่ตอนถูก import
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/mini";
import type { CctvCamera, CctvCatalogue } from "@siahra/shared-types";
import { assignProvince, CREDENTIAL_PATTERN, loadProvincePolygons, type ProvincePolygon } from "./provincePolygons.js";

// ย้ายไปอยู่ใน `provincePolygons.ts` (ใช้ร่วมกับ build-itic-cctv) — export ต่อให้ผู้เรียกเดิม
export { assignProvince, CREDENTIAL_PATTERN, loadProvincePolygons, type ProvincePolygon };

export const DWR_API = "https://telemetry.dwr.go.th/api";
export const LIST_URL = `${DWR_API}/public/reportCctv/listPaginate`;
const STATION_URL = (code: string) => `${DWR_API}/public/station/getByCode/${encodeURIComponent(code)}`;
const PAGE_SIZE = 200;
/** เพดานกันวนไม่รู้จบถ้า `totalCount` ของต้นทางเพี้ยน — 126 กล้องวันนี้ = 1 หน้า */
const MAX_PAGES = 20;
const STATION_GAP_MS = 200;

const AOI_ROOT = path.resolve(import.meta.dirname, "../../web/public/aoi");
const OUT_PATH = path.resolve(import.meta.dirname, "../../web/public/cctv/dwr-cameras.json");

// ─────────────────────────────────────────────────────────────────────────────
// Schemas — allowlist เท่านั้น: ไม่มีฟิลด์ลิงก์กล้องใดถูกประกาศไว้ที่นี่
// ─────────────────────────────────────────────────────────────────────────────

const text = z.optional(z.nullable(z.string()));

const listItemSchema = z.object({
  entity: z.object({
    id: z.string(),
    stationCode: z.string(),
    stnNameTh: text,
    stnNameEn: text,
  }),
  districtNameTh: text,
});
export type DwrListItem = z.infer<typeof listItemSchema>;

const listPageSchema = z.object({
  value: z.object({
    totalCount: z.number(),
    // แต่ละแถวตรวจแยกทีหลัง — แถวเดียวที่ผิดรูปไม่ควรทำให้ทั้งหน้าหาย
    results: z.array(z.unknown()),
  }),
});

const stationSchema = z.object({
  value: z.object({
    fullCon: z.object({
      entity: z.object({
        point: z.optional(z.nullable(z.object({ lat: z.number(), lon: z.number() }))),
      }),
    }),
  }),
});

/** ข้อความ issue ของ zod ที่ไม่มีค่าที่รับเข้ามาปน — path + code เท่านั้น */
function issueSummary(error: z.core.$ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "(root)"}:${i.code}`)
    .join(", ");
}

/** แปลงแถวของ listPaginate — null = ผิดรูป (ผู้เรียกนับและ log จำนวน) */
export function parseListItem(raw: unknown): DwrListItem | null {
  const r = listItemSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function parseListPage(raw: unknown): { totalCount: number; results: unknown[] } {
  const r = listPageSchema.safeParse(raw);
  if (!r.success) throw new Error(`listPaginate: unexpected shape (${issueSummary(r.error)})`);
  return r.data.value;
}

/** พิกัดจาก getByCode — null = สถานีไม่มีพิกัด/พิกัดใช้ไม่ได้ */
export function parseStationPoint(raw: unknown): { lat: number; lon: number } | null {
  const r = stationSchema.safeParse(raw);
  if (!r.success) return null;
  const p = r.data.value.fullCon.entity.point;
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  // (0,0) คือค่าว่างที่ฐานข้อมูลบางแห่งเติมไว้ ไม่ใช่พิกัดในประเทศไทย
  if (p.lat === 0 && p.lon === 0) return null;
  return { lat: p.lat, lon: p.lon };
}

// ─────────────────────────────────────────────────────────────────────────────
// Projection + guard
// ─────────────────────────────────────────────────────────────────────────────

function cleanText(s: string | null | undefined): string | null {
  const v = s?.trim();
  return v ? v : null;
}

/** ประกอบระเบียนกล้องทีละฟิลด์จาก allowlist — ไม่มีการ spread ของต้นทาง */
export function projectCamera(
  item: DwrListItem,
  pt: { lat: number; lon: number },
  provinceCode: string | null,
): CctvCamera {
  return {
    id: item.entity.id,
    stationCode: item.entity.stationCode,
    nameTh: cleanText(item.entity.stnNameTh),
    nameEn: cleanText(item.entity.stnNameEn),
    lat: pt.lat,
    lon: pt.lon,
    provinceCode,
    amphoeTh: cleanText(item.districtNameTh),
  };
}

export function buildCatalogue(
  items: readonly DwrListItem[],
  points: ReadonlyMap<string, { lat: number; lon: number } | null>,
  provinces: readonly ProvincePolygon[],
  builtAt: string,
): { catalogue: CctvCatalogue; noCoords: number; noProvince: number } {
  const cameras: CctvCamera[] = [];
  let noCoords = 0;
  let noProvince = 0;
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.entity.id)) continue;
    seen.add(item.entity.id);
    const pt = points.get(item.entity.stationCode) ?? null;
    if (!pt) {
      noCoords++;
      continue;
    }
    const provinceCode = assignProvince(pt.lat, pt.lon, provinces);
    if (provinceCode === null) noProvince++;
    cameras.push(projectCamera(item, pt, provinceCode));
  }
  cameras.sort((a, b) => a.stationCode.localeCompare(b.stationCode) || a.id.localeCompare(b.id));
  return { catalogue: { builtAt, sourceUrl: LIST_URL, cameras }, noCoords, noProvince };
}

/** serialise แล้วตรวจ — เจอรูปแบบข้อมูลรับรองเมื่อไหร่ โยนทิ้งทั้งไฟล์ (ข้อความไม่อ้างค่าที่เจอ) */
export function serializeCatalogue(catalogue: CctvCatalogue): string {
  const json = `${JSON.stringify(catalogue, null, 2)}\n`;
  if (CREDENTIAL_PATTERN.test(json)) {
    throw new Error("build-cctv: output matches the credential pattern — refusing to write it");
  }
  return json;
}

// ─────────────────────────────────────────────────────────────────────────────
// Network (main only)
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ข้อผิดพลาดบอกแค่ endpoint + status — ห้ามแนบ body (มีรหัสผ่านกล้อง) */
async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).pathname}`);
  // SyntaxError ของ JSON.parse ฝังชิ้นส่วนของ body ไว้ในข้อความ — ห้ามปล่อยให้ถูก log
  try {
    return await res.json();
  } catch {
    throw new Error(`invalid JSON from ${new URL(url).pathname}`);
  }
}

async function fetchAllListItems(): Promise<{ items: DwrListItem[]; malformed: number; totalCount: number }> {
  const items: DwrListItem[] = [];
  let malformed = 0;
  let totalCount = 0;
  let seenRows = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const raw = await getJson(LIST_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paginate: { page, pageSize: PAGE_SIZE, orders: [] }, search: {} }),
    });
    const { totalCount: total, results } = parseListPage(raw);
    totalCount = total;
    seenRows += results.length;
    for (const r of results) {
      const item = parseListItem(r);
      if (item) items.push(item);
      else malformed++;
    }
    if (results.length === 0 || seenRows >= totalCount) break;
  }
  return { items, malformed, totalCount };
}

async function main() {
  const provinces = loadProvincePolygons(AOI_ROOT);
  const provinceCodes = new Set(provinces.map((p) => p.code));
  console.log(`boundaries: ${provinceCodes.size} provinces (${provinces.length} polygons)`);

  const { items, malformed, totalCount } = await fetchAllListItems();
  // เวลาที่ดึงรายการจาก DWR สำเร็จ (ตาม doc ของ CctvCatalogue.builtAt) — ไม่ใช่เวลาเริ่มสคริปต์
  const builtAt = new Date().toISOString();
  console.log(`listPaginate: totalCount=${totalCount}, parsed=${items.length}, malformed=${malformed}`);

  const codes = [...new Set(items.map((i) => i.entity.stationCode))];
  const points = new Map<string, { lat: number; lon: number } | null>();
  let failed = 0;
  for (const [i, code] of codes.entries()) {
    if (i > 0) await sleep(STATION_GAP_MS);
    try {
      points.set(code, parseStationPoint(await getJson(STATION_URL(code))));
    } catch (err) {
      // ข้อความของเราเอง (endpoint + status) หรือข้อผิดพลาดเครือข่าย — ไม่มี body ต้นทาง
      failed++;
      points.set(code, null);
      console.warn(`getByCode ${code}: ${err instanceof Error ? err.message : "request failed"}`);
    }
  }
  console.log(`getByCode: ${codes.length} stations, ${failed} failed`);

  const { catalogue, noCoords, noProvince } = buildCatalogue(items, points, provinces, builtAt);
  console.log(
    `cameras: ${catalogue.cameras.length} written, ${noCoords} dropped (no coordinates), ${noProvince} outside every province boundary`,
  );
  const json = serializeCatalogue(catalogue);
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, json);
  const provincesCovered = new Set(catalogue.cameras.map((c) => c.provinceCode).filter(Boolean)).size;
  console.log(`wrote ${path.relative(process.cwd(), OUT_PATH)} (${provincesCovered} provinces)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "build-cctv failed");
    process.exit(1);
  });
}
