/**
 * สร้าง `apps/api/src/data/localAuthorities.json` — ทะเบียนองค์กรปกครองส่วนท้องถิ่น
 * (อปท.) ที่เป็นมาตรฐานเดียว (E11.1) จากตารางความครอบคลุมของ DLA จริง
 * (`apps/etl/data/sources/dla/re01_9112566tambon.csv` — อ่าน SOURCE.md ในโฟลเดอร์
 * เดียวกันก่อน มันบอก schema/license/quirk ทั้งหมดของไฟล์นี้)
 *
 *   npm run build:local-authorities -w apps/etl
 *
 * โมดูลนี้แยกฟังก์ชันล้วน (parse/dedupe/normalize) ออกจาก `main()` ที่แตะดิสก์จริง
 * โดยตั้งใจ — `buildLocalAuthorities.test.ts` import ฟังก์ชันล้วนพวกนี้ทดสอบกับ
 * fixture เล็ก ๆ เท่านั้น ไม่แตะไฟล์ 13 MB จริง และ `main()` รันเฉพาะตอนสั่งสคริปต์นี้
 * ตรง ๆ (ผ่าน `tsx`) ไม่ใช่ตอนถูก import
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  HazardLayerDescriptor,
  LocalAuthoritiesRegistry,
  LocalAuthorityRef,
  LocalAuthorityType,
} from "@siahra/shared-types";
import { sha256File } from "./provenance.js";
import { normalizeThaiName, readProvinceList, type ProvinceEntry } from "./provinceBoundaries.js";

export const CSV_PATH = path.resolve(
  import.meta.dirname,
  "../data/sources/dla/re01_9112566tambon.csv",
);
const OUT_PATH = path.resolve(import.meta.dirname, "../../api/src/data/localAuthorities.json");

// ดู apps/etl/data/sources/dla/SOURCE.md — ต้นทางไม่มี field เวลาที่ machine อ่านได้
// สองค่านี้จึงเป็นค่าคงที่ที่ปรับพร้อมกับ SOURCE.md เวลารีเฟรชข้อมูล (ดูหัวข้อ
// "Reproduction" ในไฟล์นั้น)
export const SOURCE_PUBLISHED_AT = "2026-06-10T00:00:00Z";
export const SOURCE_FETCHED_AT = "2026-08-23T00:00:00Z";

// ─────────────────────────────────────────────────────────────────────────────
// RFC 4180 CSV parsing — ไม่มี CSV library เป็น dependency ของ apps/etl อยู่แล้ว
// และไฟล์นี้มี field ที่มีจุลภาคอยู่ในเครื่องหมายคำพูด (เช่น "www,tlpm.go.th") กับ
// เครื่องหมายคำพูดที่ escape ("""-""") ทำให้ split(",") ธรรมดาใช้ไม่ได้
// ─────────────────────────────────────────────────────────────────────────────

/** ตัด UTF-8 BOM ที่ต้นไฟล์ CSV นี้มีจริง (verified ด้วย head -c) */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** state machine ตาม RFC 4180 — คืนแถวเป็น string[][], แถวว่างล้วนถูกกรองทิ้ง */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;
  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** เลขจาก field ว่าง/ไม่ใช่ตัวเลขคือ null เสมอ ไม่ใช่ 0 — LAT/LONG/ขนาดพื้นที่ */
export function parseNumberOrNull(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export const EXPECTED_HEADERS = [
  "จังหวัด",
  "อำเภอ",
  "ตำบล",
  "รหัส อปท.",
  "ประเภท อปท.",
  "อปท.",
  "ที่ตั้งสำนักงานเลขที่",
  "หมู่ที่",
  "รหัสไปรษณีย์",
  "ขนาดพื้นที่",
  "LAT",
  "LONG",
  "เว็ปไซต์ของอปท",
] as const;

/** แถวดิบหนึ่งแถว (หนึ่งคู่ province/district/tambon ที่ อปท. รหัสนี้ครอบคลุม) */
export interface RawDlaRow {
  provinceTh: string;
  districtTh: string;
  dlaCode: string;
  typeTh: string;
  nameTh: string;
  areaKm2Raw: string;
  latRaw: string;
  lonRaw: string;
}

/**
 * แปลง CSV ทั้งไฟล์เป็นแถวดิบ — validate หัวตารางกับ `EXPECTED_HEADERS` ตรง ๆ
 * ก่อน (ถ้า schema ต้นทางเปลี่ยน ต้องพังดัง ๆ ตรงนี้ ไม่ใช่เดาคอลัมน์ผิดเงียบ ๆ)
 */
export function parseDlaCsv(csvText: string): RawDlaRow[] {
  const rows = parseCsv(stripBom(csvText));
  if (rows.length === 0) throw new Error("[local-authorities] CSV is empty");
  const header = rows[0].map((h) => h.trim());
  const missing = EXPECTED_HEADERS.filter((h) => !header.includes(h));
  if (missing.length > 0) {
    throw new Error(`[local-authorities] CSV header drifted — missing columns: ${missing.join(", ")}`);
  }
  const idx = (name: string) => header.indexOf(name);
  const col = {
    province: idx("จังหวัด"),
    district: idx("อำเภอ"),
    dlaCode: idx("รหัส อปท."),
    type: idx("ประเภท อปท."),
    name: idx("อปท."),
    area: idx("ขนาดพื้นที่"),
    lat: idx("LAT"),
    lon: idx("LONG"),
  };
  const out: RawDlaRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    out.push({
      provinceTh: (row[col.province] ?? "").trim(),
      districtTh: (row[col.district] ?? "").trim(),
      dlaCode: (row[col.dlaCode] ?? "").trim(),
      typeTh: (row[col.type] ?? "").trim(),
      nameTh: (row[col.name] ?? "").trim(),
      areaKm2Raw: row[col.area] ?? "",
      latRaw: row[col.lat] ?? "",
      lonRaw: row[col.lon] ?? "",
    });
  }
  return out;
}

/** ตรงกับ 6 ค่าที่พบจริงเท่านั้น (verified ใน SOURCE.md) — ค่าอื่นต้องถูกปฏิเสธ */
const TYPE_MAP: Record<string, LocalAuthorityType> = {
  "อบจ.": "provincial_admin_org",
  เทศบาลนคร: "city_municipality",
  เทศบาลเมือง: "town_municipality",
  เทศบาลตำบล: "subdistrict_municipality",
  "อบต.": "subdistrict_admin_org",
  ท้องถิ่นรูปแบบพิเศษ: "special_admin_area",
};

/**
 * จัดกลุ่มแถวดิบตามรหัส อปท. — เก็บแถวแรกของแต่ละรหัสไว้เป็นค่ามาตรฐาน (verified
 * ใน SOURCE.md: อปท./ประเภท อปท./จังหวัด เหมือนกันทุกแถวของรหัสเดียวกัน 0 conflict)
 * แถวที่รหัสว่างถูกข้ามตั้งแต่ขั้นนี้ นับแยกเป็น `rejectedEmptyCode`
 */
export function groupByCode(rows: readonly RawDlaRow[]): {
  groups: Map<string, RawDlaRow>;
  rejectedEmptyCode: number;
} {
  const groups = new Map<string, RawDlaRow>();
  let rejectedEmptyCode = 0;
  for (const row of rows) {
    if (row.dlaCode === "") {
      rejectedEmptyCode++;
      continue;
    }
    if (!groups.has(row.dlaCode)) groups.set(row.dlaCode, row);
  }
  return { groups, rejectedEmptyCode };
}

export type RejectReason = "unknown-type" | "unmatched-province";

/**
 * แถวมาตรฐานหนึ่งแถว (ตัวแทนของรหัส อปท. หนึ่งรหัส) → `LocalAuthorityRef` หรือ
 * เหตุผลที่ถูกปฏิเสธ — ไม่มีการ default ค่าใด ๆ ที่แมปไม่ได้
 */
export function toLocalAuthorityRef(
  row: RawDlaRow,
  provinces: readonly ProvinceEntry[],
): { ok: true; ref: LocalAuthorityRef } | { ok: false; reason: RejectReason } {
  const type = TYPE_MAP[row.typeTh];
  if (!type) return { ok: false, reason: "unknown-type" };

  const targetName = normalizeThaiName(row.provinceTh);
  const province = provinces.find((p) => normalizeThaiName(p.nameTh) === targetName);
  if (!province) return { ok: false, reason: "unmatched-province" };

  const ref: LocalAuthorityRef = {
    id: `TH-LAO-${row.dlaCode}`,
    dlaCode: row.dlaCode,
    nameTh: row.nameTh,
    nameEn: null, // ต้นทางไม่มีชื่ออังกฤษ — ไม่แต่งขึ้นเอง
    type,
    provinceCode: province.code,
    districtNameTh: row.districtTh === "" ? null : row.districtTh,
    centerLat: parseNumberOrNull(row.latRaw),
    centerLon: parseNumberOrNull(row.lonRaw),
    areaKm2: parseNumberOrNull(row.areaKm2Raw),
  };
  return { ok: true, ref };
}

export interface CoverageReport {
  totalRows: number;
  uniqueCodes: number;
  written: number;
  rejectedEmptyCode: number;
  rejectedUnknownType: number;
  rejectedUnmatchedProvince: number;
}

/**
 * สร้าง `LocalAuthoritiesRegistry` ทั้งก้อนจากเนื้อ CSV (string) ล้วน ๆ — ไม่แตะ
 * ดิสก์ ทดสอบได้ตรง ๆ ด้วย fixture เล็ก
 */
export function buildRegistry(
  csvText: string,
  provinces: readonly ProvinceEntry[],
  meta: { sourceSha256: string; descriptor: HazardLayerDescriptor },
): { registry: LocalAuthoritiesRegistry; report: CoverageReport; rejectedSamples: string[] } {
  const rawRows = parseDlaCsv(csvText);
  const { groups, rejectedEmptyCode } = groupByCode(rawRows);

  const localAuthorities: LocalAuthorityRef[] = [];
  const rejectedSamples: string[] = [];
  let rejectedUnknownType = 0;
  let rejectedUnmatchedProvince = 0;

  for (const [code, row] of groups) {
    const result = toLocalAuthorityRef(row, provinces);
    if (result.ok) {
      localAuthorities.push(result.ref);
      continue;
    }
    if (result.reason === "unknown-type") {
      rejectedUnknownType++;
      if (rejectedSamples.length < 20) {
        rejectedSamples.push(`${code}: unknown type "${row.typeTh}"`);
      }
    } else {
      rejectedUnmatchedProvince++;
      if (rejectedSamples.length < 20) {
        rejectedSamples.push(`${code}: unmatched province "${row.provinceTh}"`);
      }
    }
  }

  const report: CoverageReport = {
    totalRows: rawRows.length,
    uniqueCodes: groups.size,
    written: localAuthorities.length,
    rejectedEmptyCode,
    rejectedUnknownType,
    rejectedUnmatchedProvince,
  };

  const registry: LocalAuthoritiesRegistry = {
    descriptor: meta.descriptor,
    sourceSha256: meta.sourceSha256,
    recordCount: localAuthorities.length,
    localAuthorities,
  };

  return { registry, report, rejectedSamples };
}

/** เขียน `apps/api/src/data/localAuthorities.json` จากไฟล์ CSV จริงบนดิสก์ */
export function writeLocalAuthorities(csvPath: string = CSV_PATH, outPath: string = OUT_PATH): {
  report: CoverageReport;
  bytes: number;
} {
  const csvText = readFileSync(csvPath, "utf-8");
  const sourceSha256 = sha256File(csvPath);
  const provinces = readProvinceList();

  const descriptor: HazardLayerDescriptor = {
    id: "local-authorities",
    epistemicClass: "static-reference",
    liveOrStatic: "static",
    publishedAt: SOURCE_PUBLISHED_AT,
    fetchedAt: SOURCE_FETCHED_AT,
    sourceIds: ["dla"],
  };

  const { registry, report, rejectedSamples } = buildRegistry(csvText, provinces, {
    sourceSha256,
    descriptor,
  });

  mkdirSync(path.dirname(outPath), { recursive: true });
  const json = JSON.stringify(registry);
  writeFileSync(outPath, json);
  const bytes = Buffer.byteLength(json, "utf-8");

  console.log(`[local-authorities] rows read: ${report.totalRows}`);
  console.log(`[local-authorities] unique รหัส อปท.: ${report.uniqueCodes}`);
  console.log(`[local-authorities] records written: ${report.written}`);
  console.log(
    `[local-authorities] rejected — empty code: ${report.rejectedEmptyCode}, ` +
      `unknown type: ${report.rejectedUnknownType}, unmatched province: ${report.rejectedUnmatchedProvince}`,
  );
  if (rejectedSamples.length > 0) {
    console.log(`[local-authorities] rejected samples (up to 20):\n  ${rejectedSamples.join("\n  ")}`);
  }
  console.log(`[local-authorities] wrote ${outPath} (${(bytes / 1024).toFixed(1)} KB)`);

  return { report, bytes };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  writeLocalAuthorities();
}
