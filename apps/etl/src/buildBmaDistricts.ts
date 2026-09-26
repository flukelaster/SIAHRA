/**
 * สร้าง `apps/etl/data/sources/osm-admin/bma-districts.json` — 50 เขตของ
 * กรุงเทพมหานคร (เขต, OSM `boundary=administrative` + `admin_level=6`) พร้อม
 * ขอบเขตจริง เป็นไฟล์ตั้งต้น (tracked) ที่ขั้นถัดไปอ่านต่อ
 *
 *   npx -y tsx@4 src/buildBmaDistricts.ts        (หรือ npm run build:bma-districts -w apps/etl)
 *
 * ## ทำไมต้องมีหน่วยนี้แยกจาก อปท.
 * กรุงเทพมหานครปกครองตาม พ.ร.บ. ระเบียบบริหารราชการกรุงเทพมหานคร ไม่ใช่กฎหมาย
 * ที่ตั้ง อปท. ทะเบียนของ DLA จึงไม่มีแถวของกรุงเทพฯ เลย (อ่าน
 * `apps/etl/data/sources/dla/SOURCE.md`) — การตัดสินใจของเจ้าของโครงการ
 * 2026-09-26: เพิ่ม 50 เขตเป็น **หน่วยใหม่แยกชัดเจน** (`LocalAuthorityType`
 * `"bma_district"`, id `TH-BMA-osm{relationId}`) ห้ามประดิษฐ์แถว อปท. ของ DLA
 * ให้กรุงเทพฯ และห้ามแต่งรหัส DLA ให้เขต
 *
 * ## ทำไม id ผูกกับ relation id ของ OSM
 * relation ทั้ง 50 ไม่มีแท็ก `ref` (รหัสเขตทางการ) เลย — ตรวจจริงกับ
 * `thailand-latest.osm.pbf` ชุดเดียวกับ E11.2 (แท็กที่พบ: name, name:en, name:th,
 * short_name, postal_code, population, wikidata ...) จึงไม่มีรหัสทางการให้ใช้
 * และห้ามแต่งขึ้นเอง
 *
 * ## ลำดับการรัน (ทุกขั้นรันบนเครื่องเท่านั้น ไม่มีขั้นไหนเขียน R2/เรียก Cloudflare)
 * 1. `buildBmaDistricts.ts` (ไฟล์นี้) → `data/sources/osm-admin/bma-districts.json`
 * 2. `buildLocalAuthorities.ts` → ต่อท้าย 50 เขตเข้าทะเบียน `localAuthorities.json`
 * 3. `buildLocalAuthorityBoundaries.ts` → `public/aoi/10/local-authorities.geojson`
 *    + `manifest.json` ของจังหวัด 10 + COVERAGE.md/coverage.json
 * 4. `buildLocalAuthorityBoundariesBundle.ts` → `localAuthorityBoundaries.json`
 * 5. `buildLocalAuthorityExposure.ts --only=10 --merge` → `localAuthorityExposure.json`
 * 6. `buildAlertRules.ts` → `alertRules.json`
 *
 * ## ความละเอียดของรูป
 * `-simplify` ด้วย `SIMPLIFY_TOLERANCE_DEG` ตัวเดียวกับขอบเขต อปท. ของ E11.2
 * (`buildLocalAuthorityBoundaries.ts`) — ไม่มีค่าความละเอียดชุดที่สอง
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import type {
  BmaDistrictRef,
  BmaDistrictsProvenance,
  LocalAuthorityBoundaryGeometry,
} from "@siahra/shared-types";
import {
  hasCoordinates,
  representativePoint,
  resolveProvince,
  SIMPLIFY_TOLERANCE_DEG,
  type ProvinceRingSet,
} from "./buildLocalAuthorityBoundaries.js";
import { parseOtherTags } from "./buildProvinceBuildings.js";
import { fetchThailandOsm } from "./fetchOsm.js";
import { isoUtc, readOsmPublishedAt, sha256File } from "./provenance.js";

const WORK_DIR = path.resolve(import.meta.dirname, "../data/work");
const PROVINCE_RINGS_JSON = path.resolve(import.meta.dirname, "../../api/src/data/provinceRings.json");
// ไม่ประกอบจาก `COVERAGE_DIR` ของ buildLocalAuthorityBoundaries.ts โดยตั้งใจ — ไฟล์
// นั้นอ่านไฟล์นี้กลับ (import type เท่านั้น) ค่าคงที่ระดับโมดูลจึงต้องไม่พึ่งกันและกัน
export const BMA_DISTRICTS_JSON = path.resolve(
  import.meta.dirname,
  "../data/sources/osm-admin/bma-districts.json",
);

export const BMA_PROVINCE_CODE = "10";
/** กรุงเทพมหานครมี 50 เขตตามกฎหมาย — จำนวนอื่นแปลว่าข้อมูล OSM หรือการกรองผิด
 *  สคริปต์ต้องหยุด ไม่ใช่เขียนชุดที่ขาด/เกินออกไปเงียบ ๆ */
export const EXPECTED_BMA_DISTRICT_COUNT = 50;
export const BMA_DISTRICT_NAME_PREFIX = "เขต";

/** id ของเขต — ผูกกับ relation id ของ OSM ไม่ใช่รหัส DLA (ไม่มี) หรือรหัสที่แต่งขึ้น */
export function bmaDistrictId(osmRelationId: string): string {
  return `TH-BMA-osm${osmRelationId}`;
}

/** relation หนึ่งตัวของ `admin_level=6` หลังผ่าน ogr2ogr (makevalid + simplify) */
export interface OsmAdmin6Feature {
  /** `osm_id` ของเลเยอร์ multipolygons = relation id; null เมื่อเป็น closed way */
  osmRelationId: string | null;
  name: string;
  nameEn: string | null;
  geometry: unknown;
}

export interface BmaDistrictRecord {
  ref: BmaDistrictRef;
  /** relation id ของ OSM — อยู่ในไฟล์ตั้งต้นนี้เพื่อ provenance เท่านั้น ไม่ถูกคัดลอกเข้า
   *  ทะเบียนใน bundle (ซ้ำกับท้าย id อยู่แล้ว และ bundle ของ api แทบไม่เหลือที่) */
  osmRelationId: string;
  geometry: LocalAuthorityBoundaryGeometry;
}

export type BmaRejectReason =
  | "not-a-relation"
  | "degenerate-geometry"
  | "outside-bangkok"
  | "ambiguous-province";

export interface BmaSelection {
  districts: BmaDistrictRecord[];
  /** เฉพาะ feature ที่ชื่อขึ้นต้นด้วย "เขต" แต่ใช้ไม่ได้ — อำเภอทั่วประเทศที่เหลือ
   *  ไม่ใช่ "ถูกปฏิเสธ" แค่ไม่ใช่หน่วยนี้ */
  rejected: { osmRelationId: string | null; name: string; reason: BmaRejectReason }[];
}

/**
 * คัด 50 เขตจาก `admin_level=6` ทั้งประเทศ — ฟังก์ชันล้วน ทดสอบได้ด้วย fixture
 *
 * ต้องผ่านทั้งสองเงื่อนไข: ชื่อขึ้นต้นด้วย "เขต" **และ** จุดตัวแทนของรูปตกใน
 * กรุงเทพฯ จังหวัดเดียวเป๊ะ (point-in-polygon กับ `provinceRings.json` จริง —
 * กฎเดียวกับ E11.2 ที่ห้ามอนุมานจังหวัดจากชื่อ)
 */
export function selectBmaDistricts(
  features: readonly OsmAdmin6Feature[],
  provinces: readonly ProvinceRingSet[],
): BmaSelection {
  const districts: BmaDistrictRecord[] = [];
  const rejected: BmaSelection["rejected"] = [];
  for (const f of features) {
    if (!f.name.startsWith(BMA_DISTRICT_NAME_PREFIX)) continue;
    if (f.osmRelationId === null || !/^\d+$/.test(f.osmRelationId)) {
      rejected.push({ osmRelationId: f.osmRelationId, name: f.name, reason: "not-a-relation" });
      continue;
    }
    if (!hasCoordinates(f.geometry)) {
      rejected.push({ osmRelationId: f.osmRelationId, name: f.name, reason: "degenerate-geometry" });
      continue;
    }
    const point = representativePoint(f.geometry);
    if (!point) {
      rejected.push({ osmRelationId: f.osmRelationId, name: f.name, reason: "degenerate-geometry" });
      continue;
    }
    const resolution = resolveProvince(point[0], point[1], provinces);
    if (resolution.code === null) {
      rejected.push({
        osmRelationId: f.osmRelationId,
        name: f.name,
        reason: resolution.reason === "ambiguous" ? "ambiguous-province" : "outside-bangkok",
      });
      continue;
    }
    if (resolution.code !== BMA_PROVINCE_CODE) {
      rejected.push({ osmRelationId: f.osmRelationId, name: f.name, reason: "outside-bangkok" });
      continue;
    }
    districts.push({
      ref: {
        id: bmaDistrictId(f.osmRelationId),
        dlaCode: null,
        nameTh: f.name,
        nameEn: f.nameEn,
        type: "bma_district",
        provinceCode: BMA_PROVINCE_CODE,
        districtNameTh: null,
        centerLat: null,
        centerLon: null,
        areaKm2: null,
      },
      osmRelationId: f.osmRelationId,
      geometry: f.geometry as LocalAuthorityBoundaryGeometry,
    });
  }
  // ลำดับนิ่งตาม relation id เพื่อให้ diff ของไฟล์ที่ commit อ่านออก
  districts.sort((a, b) => Number(a.osmRelationId) - Number(b.osmRelationId));
  return { districts, rejected };
}

/**
 * ด่านสุดท้ายก่อนเขียนไฟล์: ต้องได้ 50 เขตพอดี ไม่มี id หรือชื่อซ้ำ — ไม่ผ่าน = โยน
 * error ไม่เขียนชุดที่ผิดออกไป
 */
export function assertBmaDistrictSet(
  districts: readonly BmaDistrictRecord[],
  expected: number = EXPECTED_BMA_DISTRICT_COUNT,
): void {
  const ids = new Set(districts.map((d) => d.ref.id));
  const names = new Set(districts.map((d) => d.ref.nameTh));
  const problems: string[] = [];
  if (districts.length !== expected) problems.push(`expected ${expected} districts, got ${districts.length}`);
  if (ids.size !== districts.length) problems.push(`${districts.length - ids.size} duplicate ids`);
  if (names.size !== districts.length) problems.push(`${districts.length - names.size} duplicate names`);
  if (problems.length > 0) {
    throw new Error(`[bma-districts] refusing to write: ${problems.join("; ")}`);
  }
}

/** ไฟล์ตั้งต้นที่ commit ไว้ — `buildLocalAuthorities.ts` อ่าน `ref`,
 *  `buildLocalAuthorityBoundaries.ts` อ่าน `geometry` */
export interface BmaDistrictsArtefact {
  generatedAt: string;
  provenance: BmaDistrictsProvenance;
  districts: BmaDistrictRecord[];
}

export function readBmaDistrictsArtefact(file: string = BMA_DISTRICTS_JSON): BmaDistrictsArtefact {
  if (!existsSync(file)) {
    throw new Error(
      `[bma-districts] ${file} is missing — run \`npx -y tsx@4 src/buildBmaDistricts.ts\` first`,
    );
  }
  const artefact = JSON.parse(readFileSync(file, "utf-8")) as BmaDistrictsArtefact;
  assertBmaDistrictSet(artefact.districts);
  return artefact;
}

// ─────────────────────────────────────────────────────────────────────────────
// ขั้นแตะดิสก์จริง — osmium/ogr2ogr (cache ใน WORK_DIR ชื่อ admin6-* ไม่ชนกับ admin7-*)
// ─────────────────────────────────────────────────────────────────────────────

interface RawOgrFeature {
  properties: Record<string, string | number | null>;
  geometry: unknown;
}

async function extractAdminLevel6(pbfPath: string): Promise<OsmAdmin6Feature[]> {
  mkdirSync(WORK_DIR, { recursive: true });
  const admin6Pbf = path.join(WORK_DIR, "admin6.osm.pbf");
  const rawGeojson = path.join(WORK_DIR, "admin6-raw.geojson");
  const simplifiedGeojson = path.join(WORK_DIR, "admin6-simplified.geojson");

  if (!existsSync(admin6Pbf)) {
    console.log("[bma-districts] osmium tags-filter r/admin_level=6");
    await execa("osmium", ["tags-filter", pbfPath, "r/admin_level=6", "-o", admin6Pbf, "--overwrite"], {
      stdio: "inherit",
    });
  }
  if (!existsSync(rawGeojson)) {
    console.log("[bma-districts] ogr2ogr -> GeoJSON");
    await execa("ogr2ogr", ["-f", "GeoJSON", rawGeojson, admin6Pbf, "multipolygons"], { stdio: "inherit" });
  }
  if (!existsSync(simplifiedGeojson)) {
    console.log("[bma-districts] -makevalid -simplify");
    await execa(
      "ogr2ogr",
      [
        "-f",
        "GeoJSON",
        "-makevalid",
        "-simplify",
        String(SIMPLIFY_TOLERANCE_DEG),
        "-where",
        "admin_level='6' AND boundary='administrative'",
        simplifiedGeojson,
        rawGeojson,
      ],
      { stdio: "inherit" },
    );
  }

  const fc = JSON.parse(readFileSync(simplifiedGeojson, "utf-8")) as { features: RawOgrFeature[] };
  const out: OsmAdmin6Feature[] = [];
  for (const f of fc.features) {
    const name = f.properties.name;
    if (typeof name !== "string" || name.trim() === "") continue;
    const other = parseOtherTags(
      typeof f.properties.other_tags === "string" ? f.properties.other_tags : undefined,
    );
    const osmId = f.properties.osm_id;
    out.push({
      osmRelationId: osmId === null || osmId === undefined ? null : String(osmId),
      name,
      nameEn: other["name:en"] ?? null,
      geometry: f.geometry,
    });
  }
  return out;
}

export async function run(): Promise<void> {
  const pbfPath = await fetchThailandOsm();
  const features = await extractAdminLevel6(pbfPath);
  console.log(`[bma-districts] admin_level=6 relations with a name: ${features.length}`);

  const rings = JSON.parse(readFileSync(PROVINCE_RINGS_JSON, "utf-8")) as {
    provinces: { code: string; rings: number[][] }[];
  };
  const provinces: ProvinceRingSet[] = rings.provinces.map((p) => ({ code: p.code, rings: p.rings }));

  const { districts, rejected } = selectBmaDistricts(features, provinces);
  for (const r of rejected) {
    console.log(`[bma-districts] rejected ${r.osmRelationId ?? "(way)"} ${r.name}: ${r.reason}`);
  }
  assertBmaDistrictSet(districts);

  const artefact: BmaDistrictsArtefact = {
    generatedAt: isoUtc(Date.now()),
    provenance: {
      sourceIds: ["osm-admin"],
      publishedAt: await readOsmPublishedAt(pbfPath),
      pbfSha256: sha256File(pbfPath),
      recordCount: districts.length,
    },
    districts,
  };
  mkdirSync(path.dirname(BMA_DISTRICTS_JSON), { recursive: true });
  const json = JSON.stringify(artefact);
  writeFileSync(BMA_DISTRICTS_JSON, json);
  console.log(
    `[bma-districts] wrote ${BMA_DISTRICTS_JSON} — ${districts.length} districts, ${rejected.length} rejected (${(Buffer.byteLength(json) / 1024).toFixed(1)} KB)`,
  );
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
