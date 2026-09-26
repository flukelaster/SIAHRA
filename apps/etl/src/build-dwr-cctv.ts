/**
 * สร้าง `apps/web/public/cctv/dwr-cctv.json` — บัญชีกล้อง CCTV ของสถานีโทรมาตร
 * กรมทรัพยากรน้ำ (DWR, E15) จาก API สาธารณะ `https://telemetry.dwr.go.th/api` ในรูปทั่วไป
 * `CameraCatalogue` (`packages/shared-types/src/cctv.ts`)
 *
 *   npm run build:cctv:dwr -w apps/etl        # หรือ npx -y tsx@4 src/build-dwr-cctv.ts
 *   ตัวเลือก: --no-probe (ทุกสตรีม `not-probed`), --vantage <ป้ายเครือข่ายที่รัน>
 *
 * ขั้นตอน (ดึงครั้งเดียว ไม่ใช่งานประจำ):
 *   1. POST `public/reportCctv/listPaginate` ทีละหน้า (pageSize 200) จนครบ `totalCount`
 *      — ต้องมี `paginate.orders: []` ไม่งั้น DWR ตอบ 400 "Error parsing HTTP request."
 *      (วัดจริง 2026-09-26; ตัวเว็บของ DWR เองก็ส่ง `orders` ทุกครั้ง)
 *   2. GET `public/station/getByCode/{stationCode}` ทีละสถานี ห่างกัน ~200 ms
 *      → พิกัดอยู่ที่ `value.fullCon.entity.point.{lat,lon}`
 *   3. จังหวัดจาก point-in-polygon กับ `apps/web/public/aoi/{code}/boundary.geojson`
 *   4. กล้องหนึ่งตัว = สองสตรีม: `dwr-snapshot` (ภาพล่าสุด, เวลาถ่ายจาก path) และ `dwr-mjpeg`
 *      (ภาพสด, ไม่มีเวลากำกับ) — ทั้งคู่ derive url จาก `id`/`stationCode` ตอนเปิด ไม่เก็บ url
 *   5. probe ทุกสตรีมจาก vantage ที่รัน (`cameraCatalogue.ts` `probeStreams`) — DWR ตอบ MJPEG
 *      ช้า 4–6 วิถึงเฟรมแรก จึงจำกัด 4 คำขอพร้อมกันบนโฮสต์นี้
 *
 * **ความปลอดภัย — ห้ามแก้ข้อนี้**: payload ของทั้งสอง endpoint มีลิงก์กล้องที่ฝังชื่อผู้ใช้/
 * รหัสผ่านจริง (`cctvSnapshotLink`/`cctvVideoLink` แบบ `http://user:pass@….dyndns…`)
 * ไฟล์นี้จึง:
 *   - แปลงทุก response ผ่าน schema `zod/mini` ที่ **ไม่ประกาศ** ฟิลด์ลิงก์ (`z.object`
 *     ตัดคีย์ที่ไม่รู้จักทิ้ง) แล้วประกอบผลลัพธ์ทีละฟิลด์ ไม่ spread ของต้นทาง
 *   - ไม่ log/print response ดิบ ไม่เขียนมันลงไฟล์ใด — log เฉพาะจำนวน, รหัสสถานี, HTTP status
 *   - ข้อผิดพลาดของ schema รายงานแค่ path/code ของ issue ไม่รายงานค่าที่รับเข้ามา
 *   - `writeCatalogue` ตรวจผลลัพธ์ที่ serialise แล้วด้วย `CREDENTIAL_PATTERN` ก่อนเขียน เจอ = ยกเลิกทั้งหมด
 *
 * ฟังก์ชันล้วนถูก export ให้ `build-dwr-cctv.test.ts` ทดสอบกับ fixture ปลอม ส่วน `main()`
 * รันเฉพาะตอนสั่งสคริปต์นี้ตรง ๆ (ผ่าน `tsx`) ไม่ใช่ตอนถูก import
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/mini";
import type { Camera } from "@siahra/shared-types";
import {
  DWR_API,
  formatProbeTable,
  NOT_PROBED,
  parseBuildArgs,
  probeStreams,
  probeVantageLabel,
  writeCatalogue,
} from "./cameraCatalogue.js";
import { assignProvince, loadProvincePolygons, type ProvincePolygon } from "./provincePolygons.js";

export const SOURCE_ID = "dwr-cctv" as const;
export const LIST_URL = `${DWR_API}/public/reportCctv/listPaginate`;
const STATION_URL = (code: string) => `${DWR_API}/public/station/getByCode/${encodeURIComponent(code)}`;
const PAGE_SIZE = 200;
/** เพดานกันวนไม่รู้จบถ้า `totalCount` ของต้นทางเพี้ยน — 126 กล้องวันนี้ = 1 หน้า */
const MAX_PAGES = 20;
const STATION_GAP_MS = 200;

const AOI_ROOT = path.resolve(import.meta.dirname, "../../web/public/aoi");

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
// Projection
// ─────────────────────────────────────────────────────────────────────────────

function cleanText(s: string | null | undefined): string | null {
  const v = s?.trim();
  return v ? v : null;
}

/**
 * ประกอบระเบียนกล้องทีละฟิลด์จาก allowlist — ไม่มีการ spread ของต้นทาง; สตรีมทั้งสองเริ่มที่
 * `not-probed` (ห้ามเริ่มที่ `ok`) แล้ว `probeStreams` เติมผลจริงให้
 */
export function projectCamera(
  item: DwrListItem,
  pt: { lat: number; lon: number },
  provinceCode: string | null,
): Camera {
  const stationCode = item.entity.stationCode;
  return {
    id: item.entity.id,
    sourceId: SOURCE_ID,
    nameTh: cleanText(item.entity.stnNameTh),
    nameEn: cleanText(item.entity.stnNameEn),
    lat: pt.lat,
    lon: pt.lon,
    coordSource: "upstream",
    provinceCode,
    // DWR ไม่ระบุเจ้าของแยกจากตัวแหล่ง (กล้องของสถานีโทรมาตร DWR เอง) — เครดิตมาจาก SOURCES["dwr-cctv"]
    owner: null,
    code: stationCode,
    placeTh: cleanText(item.districtNameTh),
    streams: [
      { kind: "dwr-snapshot", label: null, captureTime: "path", probe: { ...NOT_PROBED } },
      { kind: "dwr-mjpeg", stationCode, label: null, captureTime: "none", probe: { ...NOT_PROBED } },
    ],
  };
}

export function buildCameras(
  items: readonly DwrListItem[],
  points: ReadonlyMap<string, { lat: number; lon: number } | null>,
  provinces: readonly ProvincePolygon[],
): { cameras: Camera[]; noCoords: number; noProvince: number } {
  const cameras: Camera[] = [];
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
  return { cameras, noCoords, noProvince };
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
  const args = parseBuildArgs(process.argv.slice(2));
  const provinces = loadProvincePolygons(AOI_ROOT);
  const provinceCodes = new Set(provinces.map((p) => p.code));
  console.log(`boundaries: ${provinceCodes.size} provinces (${provinces.length} polygons)`);

  const { items, malformed, totalCount } = await fetchAllListItems();
  // เวลาที่ดึงรายการจาก DWR สำเร็จ (ตาม doc ของ CameraCatalogue.builtAt) — ไม่ใช่เวลาเริ่มสคริปต์
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

  const built = buildCameras(items, points, provinces);
  console.log(
    `cameras: ${built.cameras.length} projected, ${built.noCoords} dropped (no coordinates), ${built.noProvince} outside every province boundary`,
  );

  // probe จาก vantage ที่รัน — ผลเป็นของเวลานั้น/เครือข่ายนั้น ไม่ใช่สถานะปัจจุบัน
  const probeVantage = args.probe ? probeVantageLabel(args.vantage) : null;
  const probed = await probeStreams(built.cameras, { skip: !args.probe });
  const probedAt = args.probe ? new Date().toISOString() : null;
  console.log(args.probe ? `probe (${probeVantage}, ${probedAt}):` : "probe skipped (--no-probe): every stream is not-probed");
  console.log(formatProbeTable(probed.stats, probed.cameras));

  const { path: out, stats } = writeCatalogue(SOURCE_ID, probed.cameras, { builtAt, sourceUrl: LIST_URL, probedAt, probeVantage });
  console.log(
    `wrote ${path.relative(process.cwd(), out)}: ${stats.cameras} cameras (${stats.duplicates} duplicate id dropped), ${stats.streams} streams, ${stats.provinces} provinces`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "build-dwr-cctv failed");
    process.exit(1);
  });
}
