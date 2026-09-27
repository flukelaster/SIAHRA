/**
 * สร้าง `apps/web/public/cctv/bma-cctv.json` — **ตำแหน่ง** กล้อง CCTV จราจรของกรุงเทพมหานคร (E15.3 PR D)
 * จากชุดข้อมูลเปิด `bma-cctv` บน data.bangkok.go.th ในรูปทั่วไป `CameraCatalogue`
 * (`packages/shared-types/src/cctv.ts`)
 *
 *   npm run build:cctv:bma -w apps/etl
 *   # หรือ (tsx ยังไม่อยู่ใน lockfile) จาก apps/etl:
 *   npx -y tsx@4 src/build-bma-cctv.ts
 *
 * **SIAHRA ไม่แสดงภาพของกล้องเหล่านี้** — ภาพอยู่ที่ BMA Traffic (`cpudapp.bangkok.go.th/bmatraffic/`)
 * ซึ่งเสิร์ฟเฉพาะ origin ของตัวเอง; owner ตัดสินใจ (2026-09-27) ไม่ proxy และไม่ปลอม header — ทุกกล้องจึงมี
 * สตรีมเดียวชนิด `external-link` ที่ชี้หน้าแรกของ BMA Traffic (ไม่ใช่หน้าของกล้องตัวนั้น: ชุดข้อมูลไม่มีลิงก์
 * ต่อกล้อง และเราไม่เดา) — ไม่มีการ probe: `probedAt`/`probeVantage` = null, ทุกสตรีม `not-probed`
 *
 * ขั้นตอน (ดึงครั้งเดียว ไม่ใช่งานประจำ; สำรวจ 2026-09-27):
 *   1. CKAN `package_show?id=bma-cctv` → เลือก resource ที่ `format` เป็น CSV — **ต้องมีหนึ่งเดียว**
 *      (0 หรือ ≥ 2 = หยุด ไม่เดาว่าไฟล์ไหน)
 *   2. ดาวน์โหลด CSV (UTF-8 มี BOM) แล้ว parse แบบ RFC 4180 (ฟิลด์ในเครื่องหมายคำพูด, `""`, CRLF) —
 *      หัวคอลัมน์ `ID,District,location,Code DVR, ID Camera,project,lat,long` (` ID Camera` มีช่องว่างนำ)
 *      ถูก trim ก่อนเทียบ
 *   3. allowlist ผ่าน `zod/mini`: `ID`, ` ID Camera`, `District`, `location`, `lat`, `long` เท่านั้น —
 *      **`Code DVR` และ `project` ถูก allowlist ตัดทิ้งก่อน projection** (รหัสโครงสร้างพื้นฐานภายใน / ชื่อสัญญาจ้าง)
 *      — ไม่มีทางถึงผลลัพธ์ (เทสต์ตรวจ JSON ที่ serialise แล้ว)
 *   4. พิกัดที่ไม่ใช่ตัวเลขทศนิยมล้วน (`" 100.468.312"` — 4 แถวเมื่อ 2026-09-27) ถูกตัดทิ้งและนับ — **ไม่ซ่อม**
 *      (การเดาว่าจุดทศนิยมไหนถูกคือการสร้างพิกัดขึ้นเอง)
 *   5. `id` = คอลัมน์ `ID` ของชุดข้อมูล (ไม่ซ้ำ), `code` = ` ID Camera` — **ไม่ใช้ ` ID Camera` เป็น id**
 *      เพราะมีรหัสเดียวกันที่สองทางแยกต่างกัน (2 รหัสเมื่อ 2026-09-27): dedupe ด้วยรหัสนั้นจะทิ้งตำแหน่งจริง
 *      ไปเงียบ ๆ และเราบอกไม่ได้ว่าแถวไหนผิด — นับไว้ใน `codeCollisions`
 *   6. จังหวัดจาก point-in-polygon กับ `apps/web/public/aoi/{code}/boundary.geojson` (ควรเป็น `10` ทุกตัว —
 *      นับตัวที่ไม่ใช่)
 *
 * ความปลอดภัย: log เฉพาะจำนวน; ข้อความผิดพลาดมีแค่สถานะ+โฮสต์; `writeCatalogue` ตรวจ origin ของลิงก์กับ
 * `CAMERA_SOURCES["bma-cctv"].hosts.link` และผลลัพธ์ที่ serialise แล้วด้วย `CREDENTIAL_PATTERN`
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/mini";
import { CAMERA_SOURCES, type Camera, type CameraStream } from "@siahra/shared-types";
import { NOT_PROBED, writeCatalogue } from "./cameraCatalogue.js";
import { assignProvince, loadProvincePolygons, type ProvincePolygon } from "./provincePolygons.js";

export const SOURCE_ID = "bma-cctv" as const;

export const PACKAGE_URL = "https://data.bangkok.go.th/api/3/action/package_show?id=bma-cctv";
/** หน้าแรกของ BMA Traffic — ลิงก์ออกเดียวของทุกกล้อง (ชุดข้อมูลไม่มีลิงก์ต่อกล้อง) */
export const BMA_TRAFFIC_URL = "https://cpudapp.bangkok.go.th/bmatraffic/";
/** จังหวัดที่คาด (กรุงเทพมหานคร) — ตัวที่ตกที่อื่นถูกนับ ไม่ถูกตัด */
export const EXPECTED_PROVINCE = "10";

const AOI_ROOT = path.resolve(import.meta.dirname, "../../web/public/aoi");

// ─────────────────────────────────────────────────────────────────────────────
// CKAN (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** allowlist ของ `package_show` — เฉพาะฟิลด์ที่ใช้เลือก resource และบันทึกใน README */
const packageSchema = z.object({
  success: z.boolean(),
  result: z.object({
    metadata_modified: z.optional(z.string()),
    resources: z.array(
      z.object({
        format: z.optional(z.nullable(z.string())),
        url: z.string(),
        created: z.optional(z.nullable(z.string())),
        last_modified: z.optional(z.nullable(z.string())),
      }),
    ),
  }),
});

export interface CsvResource {
  url: string;
  created: string | null;
  lastModified: string | null;
  /** `metadata_modified` ของชุดข้อมูล */
  datasetModified: string | null;
}

/** resource CSV หนึ่งเดียวของชุดข้อมูล — 0 หรือ ≥ 2 = โยน (บอกจำนวน ไม่เดาว่าไฟล์ไหน) */
export function pickCsvResource(raw: unknown): CsvResource {
  const r = packageSchema.safeParse(raw);
  if (!r.success || !r.data.success) throw new Error("package_show did not return a CKAN package");
  const csv = r.data.result.resources.filter((res) => res.format?.trim().toUpperCase() === "CSV");
  if (csv.length !== 1) throw new Error(`expected exactly one CSV resource in bma-cctv, found ${csv.length}`);
  const res = csv[0]!;
  let u: URL;
  try {
    u = new URL(res.url);
  } catch {
    throw new Error("the CSV resource has an unparsable url");
  }
  if (u.protocol !== "https:" || u.username || u.password) throw new Error("the CSV resource url is not a plain https url");
  return {
    url: u.toString(),
    created: res.created ?? null,
    lastModified: res.last_modified ?? null,
    datasetModified: r.data.result.metadata_modified ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV (pure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RFC 4180: ฟิลด์ในเครื่องหมายคำพูดมี `,` / ขึ้นบรรทัดใหม่ได้, `""` = `"` หนึ่งตัว, CRLF หรือ LF, ตัด BOM นำ
 * — แถวว่างล้วนถูกข้าม
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

/** แถว CSV → object ตามหัวคอลัมน์ที่ trim แล้ว (` ID Camera` → `ID Camera`) */
export function csvRecords(rows: readonly string[][]): Record<string, string>[] {
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => {
    const o: Record<string, string> = {};
    keys.forEach((k, i) => {
      if (k) o[k] = r[i] ?? "";
    });
    return o;
  });
}

/**
 * allowlist ของแถว — **ไม่มี `Code DVR` และ `project`** (zod/mini ตัดคีย์ที่ไม่ประกาศทิ้ง) จึงไม่มีทาง
 * หลุดไปถึงผลลัพธ์
 */
const rowSchema = z.object({
  ID: z.string(),
  "ID Camera": z.optional(z.string()),
  District: z.optional(z.string()),
  location: z.optional(z.string()),
  lat: z.string(),
  long: z.string(),
});

const DECIMAL = /^-?\d+(?:\.\d+)?$/;

/** ตัวเลขทศนิยมล้วนเท่านั้น — `"100.468.312"`, ว่าง, NaN = null (ไม่ซ่อม) */
export function parseCoord(v: string | undefined): number | null {
  const s = v?.trim() ?? "";
  if (!DECIMAL.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const clean = (v: string | undefined): string | null => {
  const s = v?.replace(/\s+/g, " ").trim();
  return s ? s : null;
};

/** `"บางพลัด"` → `"เขตบางพลัด"`; ค่าที่ขึ้นต้นด้วย `เขต` แล้วคงไว้ตามที่ให้มา (ไม่แก้คำสะกด) */
export function placeFromDistrict(district: string | undefined): string | null {
  const d = clean(district);
  if (!d) return null;
  return d.startsWith("เขต") ? d : `เขต${d}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// projection (pure)
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildStats {
  rows: number;
  /** แถวที่ไม่ผ่าน allowlist (ไม่มี `ID`/`lat`/`long`) */
  malformed: number;
  /** พิกัดใช้ไม่ได้ (ไม่ใช่ทศนิยมล้วน, นอกช่วง, 0,0) — ตัดทิ้ง ไม่ซ่อม */
  badCoordinates: number;
  /** `ID` ว่างหรือซ้ำ — ตัดทิ้ง */
  badId: number;
  /** รหัส ` ID Camera` ที่ปรากฏมากกว่าหนึ่งแถว (นับรหัส ไม่ใช่แถว) — ทุกแถวยังถูกเก็บ */
  codeCollisions: number;
  /** ไม่ตกในขอบเขตจังหวัดใด */
  noProvince: number;
  /** ตกในจังหวัดอื่นที่ไม่ใช่ `EXPECTED_PROVINCE` */
  otherProvince: number;
  cameras: number;
}

function linkStream(): CameraStream {
  return { kind: "external-link", url: BMA_TRAFFIC_URL, label: null, captureTime: "none", probe: { ...NOT_PROBED } };
}

export function buildCameras(records: readonly Record<string, string>[], provinces: readonly ProvincePolygon[]): { cameras: Camera[]; stats: BuildStats } {
  const stats: BuildStats = { rows: records.length, malformed: 0, badCoordinates: 0, badId: 0, codeCollisions: 0, noProvince: 0, otherProvince: 0, cameras: 0 };
  const cameras: Camera[] = [];
  const ids = new Set<string>();
  const codeCount = new Map<string, number>();
  for (const rec of records) {
    const r = rowSchema.safeParse(rec);
    if (!r.success) {
      stats.malformed++;
      continue;
    }
    const row = r.data;
    const lat = parseCoord(row.lat);
    const lon = parseCoord(row.long);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) {
      stats.badCoordinates++;
      continue;
    }
    const id = clean(row.ID);
    if (!id || ids.has(id)) {
      stats.badId++;
      continue;
    }
    ids.add(id);
    const code = clean(row["ID Camera"]);
    if (code) codeCount.set(code, (codeCount.get(code) ?? 0) + 1);
    const provinceCode = assignProvince(lat, lon, provinces);
    if (provinceCode === null) stats.noProvince++;
    else if (provinceCode !== EXPECTED_PROVINCE) stats.otherProvince++;
    stats.cameras++;
    cameras.push({
      id,
      sourceId: SOURCE_ID,
      nameTh: clean(row.location),
      nameEn: null,
      lat,
      lon,
      coordSource: "upstream",
      provinceCode,
      // ชุดข้อมูลไม่ระบุหน่วยงานเจ้าของรายกล้อง — เครดิตมาจาก SOURCES["bma-cctv"] (การระบุว่าเป็นของ สจส.
      // เป็นการอนุมาน จึงไม่ใส่ที่นี่)
      owner: null,
      code,
      placeTh: placeFromDistrict(row.District),
      streams: [linkStream()],
    });
  }
  stats.codeCollisions = [...codeCount.values()].filter((n) => n > 1).length;
  return { cameras, stats };
}

// ─────────────────────────────────────────────────────────────────────────────
// fetch (network)
// ─────────────────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;

async function get(url: string, fetchImpl: typeof fetch): Promise<Response> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res;
}

export async function fetchPackage(fetchImpl: typeof fetch = fetch): Promise<CsvResource> {
  return pickCsvResource(await (await get(PACKAGE_URL, fetchImpl)).json());
}

export async function fetchCsv(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  // ถอด UTF-8 เอง (ไม่พึ่ง charset ของ header) — BOM ถูกตัดใน parseCsv
  return new TextDecoder("utf-8").decode(await (await get(url, fetchImpl)).arrayBuffer());
}

async function main() {
  const provinces = loadProvincePolygons(AOI_ROOT);
  console.log(`boundaries: ${new Set(provinces.map((p) => p.code)).size} provinces (${provinces.length} polygons)`);

  const resource = await fetchPackage();
  console.log(
    `package bma-cctv: metadata_modified ${resource.datasetModified ?? "—"}; CSV resource created ${resource.created ?? "—"}, last_modified ${resource.lastModified ?? "—"}`,
  );
  const records = csvRecords(parseCsv(await fetchCsv(resource.url)));
  // เวลาที่ดึงรายการสำเร็จ (ตาม doc ของ CameraCatalogue.builtAt) — ไม่ใช่เวลาเริ่มสคริปต์
  const builtAt = new Date().toISOString();

  const { cameras, stats } = buildCameras(records, provinces);
  console.log(
    [
      `rows: ${stats.rows}`,
      `${stats.malformed} malformed`,
      `${stats.badCoordinates} unusable coordinates (dropped, not repaired)`,
      `${stats.badId} empty/duplicate ID`,
      `${stats.codeCollisions} camera codes shared by more than one row (all rows kept)`,
      `→ ${stats.cameras} cameras, ${stats.noProvince} outside every province boundary, ${stats.otherProvince} in a province other than ${EXPECTED_PROVINCE}`,
    ].join(", "),
  );

  // ไม่มีการ probe — ลิงก์ออกไปเว็บของเจ้าของ ไม่ใช่ภาพ/สตรีมที่เราดึง
  const { path: out, stats: written } = writeCatalogue(SOURCE_ID, cameras, { builtAt, sourceUrl: PACKAGE_URL, probedAt: null, probeVantage: null });
  console.log(
    `wrote ${path.relative(process.cwd(), out)}: ${written.cameras} cameras (${written.duplicates} duplicate id dropped), ${written.streams} external-link streams to ${CAMERA_SOURCES[SOURCE_ID].hosts.link?.join(", ")}, ${written.provinces} provinces`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "build-bma-cctv failed");
    process.exit(1);
  });
}
