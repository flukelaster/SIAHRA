/**
 * สร้าง `apps/web/public/aoi/{code}/local-authorities.geojson` — ขอบเขต อปท.
 * (องค์กรปกครองส่วนท้องถิ่น) รายจังหวัดจาก relation `admin_level=7` ของ OSM
 * (E11.2) จับคู่กับทะเบียน DLA จริงใน `apps/api/src/data/localAuthorities.json`
 * (E11.1) แล้วเติม `manifest.json` ของจังหวัดที่มีอย่างน้อยหนึ่งขอบเขต
 *
 *   npm run build:local-authority-boundaries -w apps/etl
 *
 * ## ทำไมใช้ admin_level=7 อย่างเดียว
 * ตรวจจริงด้วย `osmium tags-filter thailand-latest.osm.pbf
 * r/admin_level=6,7,8 r/boundary=administrative` แล้วอ่านผลลัพธ์: `6` ในข้อมูล
 * OSM ของไทยใช้ไม่สม่ำเสมอ (เช่น เขตของกรุงเทพฯ ไม่ใช่จังหวัด) และ `8` คือตำบล —
 * คนละหน่วยกับ อปท. มีแค่ `7` เท่านั้นที่ตั้งชื่อแบบ "ประเภท+ชื่อ" เดียวกับที่
 * ทะเบียน DLA ใช้ (เช่น "เทศบาลเมืองอโยธยา")
 *
 * ## ความครอบคลุมไม่ครบ 7,849 อปท. โดยตั้งใจ
 * วาดเฉพาะที่ OSM มีขอบเขตจริงเท่านั้น ไม่ประดิษฐ์รูปหลายเหลี่ยมให้ที่เหลือ ตัวเลข
 * จริงจากการรันครั้งนี้อยู่ที่ `apps/etl/data/sources/osm-admin/COVERAGE.md`
 *
 * ## อบจ. (`provincial_admin_org`) ถูกตัดออกทั้งขั้นจับคู่โดยตั้งใจ
 * เขตอำนาจของ อบจ. คือทั้งจังหวัด ซึ่งชั้น province boundary (`boundary.geojson`)
 * วาดอยู่แล้ว — วาดซ้ำใต้ชื่อ "ขอบเขต อปท." คือบั๊กเดิมที่งานนี้มีไว้แก้ (อ่าน task
 * ของ E11.2: เวอร์ชันก่อนหน้าที่ถูก revert สลับไปวาดขอบเขตจังหวัดซ้ำสองรอบภายใต้
 * ชื่อ "ขอบเขต อปท." โดยไม่มีเรขาคณิตจริงเป็นของตัวเอง)
 *
 * ## การจับคู่: (จังหวัด, ประเภท+ชื่อ) ไม่ใช่แค่ชื่อ
 * 658 คีย์ "ประเภท+ชื่อ" ในทะเบียนจริงมีมากกว่าหนึ่งระเบียนภายใต้คีย์เดียวกัน
 * — 624 ในจำนวนนี้กระจายข้ามมากกว่าหนึ่งจังหวัด (เช่น
 * "องค์การบริหารส่วนตำบลบ้านกลาง" มีอยู่ใน 6 จังหวัด) จับคู่ด้วยชื่ออย่างเดียวจะ
 * แปะขอบเขตผิดจังหวัดแบบเงียบ ๆ จังหวัดของ feature ฝั่ง OSM จึงต้องมาจาก
 * point-in-polygon กับ `apps/api/src/data/provinceRings.json` จริง ไม่ใช่เดาจากชื่อ
 *
 * คีย์จับคู่ทั้งสองฝั่งประกอบเป็น "ชื่อเต็มแบบที่ OSM ใช้จริง" คนละทาง — ฝั่ง OSM
 * มีชื่อเต็มอยู่แล้ว (`properties.name`) ฝั่งทะเบียนต้องประกอบเอง (`prefix + nameTh`
 * เพราะ `buildLocalAuthorities.ts` ตัด prefix ย่อ เช่น "เทศบาลเมือง" ออกจาก
 * `nameTh` ไปแล้ว) จึงไม่ต้องแยกวิเคราะห์ prefix จากชื่อ OSM เลย
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { pointOnFeature } from "@turf/turf";
import type {
  LocalAuthoritiesRegistry,
  LocalAuthorityRef,
  LocalAuthorityType,
} from "@siahra/shared-types";
import { fetchThailandOsm } from "./fetchOsm.js";
import { readOsmPublishedAt, sha256File } from "./provenance.js";

const WORK_DIR = path.resolve(import.meta.dirname, "../data/work");
const AOI_DIR = path.resolve(import.meta.dirname, "../../web/public/aoi");
const LOCAL_AUTHORITIES_JSON = path.resolve(
  import.meta.dirname,
  "../../api/src/data/localAuthorities.json",
);
const PROVINCE_RINGS_JSON = path.resolve(
  import.meta.dirname,
  "../../api/src/data/provinceRings.json",
);
export const COVERAGE_DIR = path.resolve(
  import.meta.dirname,
  "../data/sources/osm-admin",
);

/** ~30 ม. บนละติจูดของไทย — ละเอียดกว่าที่จำเป็นสำหรับ อปท. ขนาดเล็กสุด (ตำบล) */
export const SIMPLIFY_TOLERANCE_DEG = 0.0002;

// ─────────────────────────────────────────────────────────────────────────────
// ตารางจับคู่ prefix — ล้วน, ทดสอบได้ตรง ๆ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * prefix เต็มที่ OSM ใช้ต่อหน้า `nameTh` ของทะเบียน (ซึ่งตัด prefix ย่อออกแล้ว)
 * — verified กับผลรันจริง (ดู COVERAGE.md) ไม่มี entry ของ `provincial_admin_org`
 * โดยตั้งใจ: ประเภทนี้ไม่ถูกจับคู่เลย (ดูเหตุผลที่หัวไฟล์)
 */
export const OSM_NAME_PREFIX: Partial<Record<LocalAuthorityType, string>> = {
  city_municipality: "เทศบาลนคร",
  town_municipality: "เทศบาลเมือง",
  subdistrict_municipality: "เทศบาลตำบล",
  subdistrict_admin_org: "องค์การบริหารส่วนตำบล",
  // ท้องถิ่นรูปแบบพิเศษ (เมืองพัทยาเจ้าเดียว): `nameTh` ในทะเบียนคือ "เมืองพัทยา"
  // เต็มคำอยู่แล้ว (ไม่ถูกตัด prefix เหมือนประเภทอื่น) จึงไม่มี prefix เพิ่ม
  special_admin_area: "",
};

/** คีย์จับคู่จากฝั่งทะเบียน — null เมื่อประเภทนี้ไม่ถูกจับคู่ (อบจ.) */
export function registryMatchKey(ref: {
  provinceCode: string;
  type: LocalAuthorityType;
  nameTh: string;
}): string | null {
  const prefix = OSM_NAME_PREFIX[ref.type];
  if (prefix === undefined) return null;
  return `${ref.provinceCode}::${prefix}${ref.nameTh}`;
}

/** คีย์จับคู่จากฝั่ง OSM — ชื่อเต็มอยู่แล้ว ไม่ต้องแยก prefix */
export function osmMatchKey(provinceCode: string, osmName: string): string {
  return `${provinceCode}::${osmName}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// จังหวัดจากเรขาคณิตจริง — even–odd rule เดียวกับ
// `apps/api/src/geo/pointInProvince.ts` (คัดลอกมาเพราะ etl กับ api เป็นคนละ
// workspace ไม่ import ข้าม app กัน — ดูรูปแบบเดิมที่ provinceBoundaries.ts เขียน
// ไฟล์ข้าม app ด้วย fs path ตรง ๆ อยู่แล้ว) วงจาก provinceRings.json เป็นวงแบน ๆ
// ไม่แยกวงนอก/วงใน (รูเกาะ) จึงใช้ even–odd นับรวมทุกวงได้ถูกต้องในตัวเอง — การ
// ประกอบ turf Polygon ที่มี hole จากอาเรย์แบนนี้ต้องวิเคราะห์การซ้อนทับเพิ่ม
// ซึ่ง provinceRings.json ไม่ได้ให้ข้อมูลนั้นมา (ดูคอมเมนต์ที่ pointInProvince.ts)
export interface ProvinceRingSet {
  code: string;
  rings: number[][];
}

export function pointInRings(lon: number, lat: number, rings: number[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length / 2;
    if (n < 3) continue;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i * 2];
      const yi = ring[i * 2 + 1];
      const xj = ring[j * 2];
      const yj = ring[j * 2 + 1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export type ProvinceResolution =
  | { code: string }
  | { code: null; reason: "no-match" | "ambiguous"; matches: string[] };

/**
 * จังหวัดที่จุดหนึ่งตกอยู่ — ต้องตกใน "จังหวัดเดียวเป๊ะ" ไม่งั้นถือว่าไม่ผ่าน
 * (log เหตุผล ไม่เดา) ดู task ของ E11.2: ห้ามอนุมานจังหวัดจากชื่อหรือบริบท
 */
export function resolveProvince(
  lon: number,
  lat: number,
  provinces: readonly ProvinceRingSet[],
): ProvinceResolution {
  const matches = provinces.filter((p) => pointInRings(lon, lat, p.rings)).map((p) => p.code);
  if (matches.length === 1) return { code: matches[0] };
  if (matches.length === 0) return { code: null, reason: "no-match", matches };
  return { code: null, reason: "ambiguous", matches };
}

// ─────────────────────────────────────────────────────────────────────────────
// จุดตัวแทนของรูปหลายเหลี่ยม — รับประกันว่าอยู่ *ใน* รูปเสมอ (centroid ของรูปเว้า/
// หลายชิ้นอาจหลุดออกนอกรูปได้ ซึ่งจะพารูป admin ไปตกที่จังหวัดข้างเคียงแบบเงียบ ๆ)
// ─────────────────────────────────────────────────────────────────────────────

export function representativePoint(geometry: unknown): [number, number] | null {
  if (!geometry || typeof geometry !== "object") return null;
  try {
    const pt = pointOnFeature(geometry as GeoJSON.Geometry);
    const [lon, lat] = pt.geometry.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return [lon, lat];
  } catch {
    return null;
  }
}

/** true เมื่อรูปหลายเหลี่ยมมีอย่างน้อยหนึ่งวงจริง (ไม่ใช่ผล -simplify ที่ยุบหมด) */
export function hasCoordinates(geometry: unknown): boolean {
  if (!geometry || typeof geometry !== "object") return false;
  const g = geometry as { type?: string; coordinates?: unknown };
  if (g.type === "Polygon") {
    const rings = g.coordinates as unknown[] | undefined;
    return Array.isArray(rings) && rings.length > 0 && (rings[0] as unknown[]).length >= 4;
  }
  if (g.type === "MultiPolygon") {
    const polys = g.coordinates as unknown[][] | undefined;
    return (
      Array.isArray(polys) &&
      polys.some((poly) => Array.isArray(poly) && poly.length > 0 && (poly[0] as unknown[]).length >= 4)
    );
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// การรวมผล — จับคู่ osm feature หนึ่งรายการเข้ากับ registry ref หนึ่งรายการ
// ─────────────────────────────────────────────────────────────────────────────

export interface OsmAdminFeature {
  osmId: string;
  name: string;
  geometry: unknown;
}

export type RejectReason =
  | "degenerate-geometry"
  | "no-province"
  | "ambiguous-province"
  | "no-registry-match"
  | "ambiguous-registry-key"
  | "duplicate-osm-match";

export interface MatchResult {
  matched: { feature: OsmAdminFeature; ref: LocalAuthorityRef; provinceCode: string }[];
  rejected: { feature: OsmAdminFeature; reason: RejectReason }[];
  /** คีย์ทะเบียนที่มีมากกว่าหนึ่ง ref ชน — ไม่มีทางเลือกที่ถูกต้อง จึงไม่จับคู่เลย */
  registryKeyCollisions: number;
}

/**
 * จับคู่ feature ของ OSM (admin_level=7 ที่ผ่านการกรอง/ทำ valid/ย่อแล้ว) เข้ากับ
 * ทะเบียน DLA — ฟังก์ชันล้วน ไม่แตะดิสก์ ทดสอบได้ด้วย fixture เล็ก
 */
export function matchOsmToRegistry(
  osmFeatures: readonly OsmAdminFeature[],
  registry: readonly LocalAuthorityRef[],
  provinces: readonly ProvinceRingSet[],
): MatchResult {
  const registryByKey = new Map<string, LocalAuthorityRef[]>();
  for (const ref of registry) {
    const key = registryMatchKey(ref);
    if (key === null) continue;
    const list = registryByKey.get(key);
    if (list) list.push(ref);
    else registryByKey.set(key, [ref]);
  }
  let registryKeyCollisions = 0;
  for (const [, list] of registryByKey) {
    if (list.length > 1) registryKeyCollisions++;
  }

  const rejected: MatchResult["rejected"] = [];
  // provisional: ref.id -> ผู้ท้าชิงทั้งหมดที่จับคู่ได้ (ก่อนกันรูปซ้ำ)
  const byRefId = new Map<string, { feature: OsmAdminFeature; ref: LocalAuthorityRef; provinceCode: string }[]>();

  for (const feature of osmFeatures) {
    if (!hasCoordinates(feature.geometry)) {
      rejected.push({ feature, reason: "degenerate-geometry" });
      continue;
    }
    const point = representativePoint(feature.geometry);
    if (!point) {
      rejected.push({ feature, reason: "degenerate-geometry" });
      continue;
    }
    const resolution = resolveProvince(point[0], point[1], provinces);
    if (resolution.code === null) {
      rejected.push({
        feature,
        reason: resolution.reason === "ambiguous" ? "ambiguous-province" : "no-province",
      });
      continue;
    }
    const key = osmMatchKey(resolution.code, feature.name);
    const candidates = registryByKey.get(key);
    if (!candidates || candidates.length === 0) {
      rejected.push({ feature, reason: "no-registry-match" });
      continue;
    }
    if (candidates.length > 1) {
      rejected.push({ feature, reason: "ambiguous-registry-key" });
      continue;
    }
    const ref = candidates[0];
    const list = byRefId.get(ref.id);
    const entry = { feature, ref, provinceCode: resolution.code };
    if (list) list.push(entry);
    else byRefId.set(ref.id, [entry]);
  }

  const matched: MatchResult["matched"] = [];
  for (const [, candidates] of byRefId) {
    if (candidates.length === 1) {
      matched.push(candidates[0]);
    } else {
      // อปท. เดียวมี OSM relation มากกว่าหนึ่งชิ้นจับคู่ได้ — ไม่มีทางเลือกที่
      // ถูกต้องเป็นพิเศษ ปฏิเสธทั้งหมด ไม่ใช่เดาเอาอันแรก
      for (const c of candidates) rejected.push({ feature: c.feature, reason: "duplicate-osm-match" });
    }
  }

  return { matched, rejected, registryKeyCollisions };
}

// ─────────────────────────────────────────────────────────────────────────────
// ขั้นแตะดิสก์จริง — osmium/ogr2ogr, อ่านทะเบียน, เขียน geojson + manifest
// ─────────────────────────────────────────────────────────────────────────────

interface RawOgrFeature {
  properties: Record<string, string | number | null>;
  geometry: unknown;
}

async function extractAdminLevel7(pbfPath: string): Promise<RawOgrFeature[]> {
  mkdirSync(WORK_DIR, { recursive: true });
  const admin7Pbf = path.join(WORK_DIR, "admin7.osm.pbf");
  const rawGeojson = path.join(WORK_DIR, "admin7-raw.geojson");
  const simplifiedGeojson = path.join(WORK_DIR, "admin7-simplified.geojson");

  if (!existsSync(admin7Pbf)) {
    console.log("[lao-boundaries] osmium tags-filter r/admin_level=7");
    await execa(
      "osmium",
      ["tags-filter", pbfPath, "r/admin_level=7", "-o", admin7Pbf, "--overwrite"],
      { stdio: "inherit" },
    );
  } else {
    console.log("[lao-boundaries] cached admin7.osm.pbf");
  }

  if (!existsSync(rawGeojson)) {
    console.log("[lao-boundaries] ogr2ogr -> GeoJSON");
    await execa("ogr2ogr", ["-f", "GeoJSON", rawGeojson, admin7Pbf, "multipolygons"], {
      stdio: "inherit",
    });
  } else {
    console.log("[lao-boundaries] cached admin7-raw.geojson");
  }

  if (!existsSync(simplifiedGeojson)) {
    console.log("[lao-boundaries] -makevalid -simplify, filtering to real admin boundaries");
    await execa(
      "ogr2ogr",
      [
        "-f",
        "GeoJSON",
        "-makevalid",
        "-simplify",
        String(SIMPLIFY_TOLERANCE_DEG),
        "-where",
        "admin_level='7' AND boundary='administrative'",
        simplifiedGeojson,
        rawGeojson,
      ],
      { stdio: "inherit" },
    );
  } else {
    console.log("[lao-boundaries] cached admin7-simplified.geojson");
  }

  const fc = JSON.parse(readFileSync(simplifiedGeojson, "utf-8")) as { features: RawOgrFeature[] };
  return fc.features;
}

function toOsmAdminFeatures(raw: RawOgrFeature[]): OsmAdminFeature[] {
  const out: OsmAdminFeature[] = [];
  for (const f of raw) {
    const name = f.properties.name;
    if (typeof name !== "string" || name.trim() === "") continue;
    const osmId = String(f.properties.osm_id ?? f.properties.osm_way_id ?? "");
    out.push({ osmId, name, geometry: f.geometry });
  }
  return out;
}

interface CoverageByType {
  matched: number;
  total: number;
}

function buildCoverageMarkdown(input: {
  generatedAt: string;
  publishedAt: string | null;
  osmFeatureCount: number;
  result: MatchResult;
  registry: readonly LocalAuthorityRef[];
  byType: Record<LocalAuthorityType, CoverageByType>;
}): string {
  const { generatedAt, publishedAt, osmFeatureCount, result, byType } = input;
  const rejectCounts = new Map<RejectReason, number>();
  for (const r of result.rejected) rejectCounts.set(r.reason, (rejectCounts.get(r.reason) ?? 0) + 1);
  const reasonRow = (reason: RejectReason, label: string) =>
    `- ${label}: ${rejectCounts.get(reason) ?? 0}`;

  const typeRows = (Object.keys(byType) as LocalAuthorityType[])
    .map((t) => `| ${t} | ${byType[t].matched} | ${byType[t].total} |`)
    .join("\n");

  return `# OSM \`admin_level=7\` local-authority boundary coverage (E11.2)

Generated by \`apps/etl/src/buildLocalAuthorityBoundaries.ts\` — real numbers from
the run against \`apps/etl/data/raw/thailand-latest.osm.pbf\`, not estimates.

- Extraction run: ${generatedAt}
- OSM replication timestamp (\`osmosis_replication_timestamp\`): ${publishedAt ?? "unavailable — osmium fileinfo could not read it"}
- \`admin_level=7 AND boundary=administrative\` relations extracted: ${osmFeatureCount}
- Matched to a real DLA registry record: ${result.matched.length}

## Rejected (why)

${reasonRow("degenerate-geometry", "degenerate geometry (empty after -makevalid/-simplify)")}
${reasonRow("no-province", "centroid resolves to no province")}
${reasonRow("ambiguous-province", "centroid resolves to more than one province")}
${reasonRow("no-registry-match", "no registry record with this (province, type-prefix+name) key — includes every Bangkok admin_level=7 relation, since DLA's own registry has no Bangkok rows (see apps/etl/data/sources/dla/SOURCE.md)")}
${reasonRow("ambiguous-registry-key", "registry itself has >1 record under this key (collision) — declined rather than guessed")}
${reasonRow("duplicate-osm-match", "more than one OSM relation matched the same registry record — declined rather than guessed")}

Registry-side key collisions (a single (province, type-prefix+name) key naming more
than one DLA record): ${result.registryKeyCollisions}

## By \`LocalAuthorityType\` (matched / registry total)

| type | matched | total |
| --- | --- | --- |
${typeRows}

\`provincial_admin_org\` (อบจ.) is intentionally excluded from matching: an อบจ.'s
jurisdiction is the whole province, already drawn by the existing province-outline
layer (\`boundary.geojson\`) — drawing it again here would reproduce the exact bug
this task exists to fix.

## Reproduction

\`\`\`
npm run build:local-authority-boundaries -w apps/etl
\`\`\`

Re-run after refreshing \`apps/etl/data/raw/thailand-latest.osm.pbf\` or
\`apps/api/src/data/localAuthorities.json\`; this file and
\`apps/etl/data/sources/osm-admin/coverage.json\` are regenerated together.
`;
}

export async function run(): Promise<void> {
  const pbfPath = await fetchThailandOsm();
  const rawFeatures = await extractAdminLevel7(pbfPath);
  const osmFeatures = toOsmAdminFeatures(rawFeatures);
  console.log(`[lao-boundaries] admin_level=7 relations with a name: ${osmFeatures.length}`);

  const registryArtefact = JSON.parse(
    readFileSync(LOCAL_AUTHORITIES_JSON, "utf-8"),
  ) as LocalAuthoritiesRegistry;
  const provinceRingsArtefact = JSON.parse(readFileSync(PROVINCE_RINGS_JSON, "utf-8")) as {
    provinces: { code: string; rings: number[][] }[];
  };
  const provinces: ProvinceRingSet[] = provinceRingsArtefact.provinces.map((p) => ({
    code: p.code,
    rings: p.rings,
  }));

  const result = matchOsmToRegistry(osmFeatures, registryArtefact.localAuthorities, provinces);
  console.log(
    `[lao-boundaries] matched ${result.matched.length}/${osmFeatures.length} OSM relations, ` +
      `rejected ${result.rejected.length} (registry key collisions: ${result.registryKeyCollisions})`,
  );

  // เขียน geojson รายจังหวัด — เฉพาะจังหวัดที่มีอย่างน้อยหนึ่งขอบเขต
  const byProvince = new Map<string, typeof result.matched>();
  for (const m of result.matched) {
    const list = byProvince.get(m.provinceCode);
    if (list) list.push(m);
    else byProvince.set(m.provinceCode, [m]);
  }

  const generatedAt = new Date().toISOString();
  const writtenProvinces: string[] = [];
  for (const [provinceCode, matches] of byProvince) {
    const provinceDir = path.join(AOI_DIR, provinceCode);
    if (!existsSync(provinceDir)) {
      console.warn(`[lao-boundaries] จังหวัด ${provinceCode} ไม่มีโฟลเดอร์ AOI — ข้าม`);
      continue;
    }
    const fc = {
      type: "FeatureCollection" as const,
      features: matches.map((m) => ({
        type: "Feature" as const,
        properties: {
          id: m.ref.id,
          nameTh: m.ref.nameTh,
          type: m.ref.type,
        },
        geometry: m.feature.geometry,
      })),
    };
    writeFileSync(path.join(provinceDir, "local-authorities.geojson"), JSON.stringify(fc));

    const manifestPath = path.join(provinceDir, "manifest.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
      manifest.localAuthorities = { url: `/aoi/${provinceCode}/local-authorities.geojson` };
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    } else {
      console.warn(`[lao-boundaries] จังหวัด ${provinceCode} ไม่มี manifest.json — เขียนแต่ geojson`);
    }
    writtenProvinces.push(provinceCode);
  }
  console.log(
    `[lao-boundaries] เขียน local-authorities.geojson ให้ ${writtenProvinces.length} จังหวัด`,
  );

  // สรุปความครอบคลุมตาม LocalAuthorityType จริง
  const ALL_TYPES: LocalAuthorityType[] = [
    "provincial_admin_org",
    "city_municipality",
    "town_municipality",
    "subdistrict_municipality",
    "subdistrict_admin_org",
    "special_admin_area",
  ];
  const matchedIds = new Set(result.matched.map((m) => m.ref.id));
  const byType = Object.fromEntries(
    ALL_TYPES.map((t) => {
      const totalOfType = registryArtefact.localAuthorities.filter((r) => r.type === t);
      const matchedOfType = totalOfType.filter((r) => matchedIds.has(r.id));
      return [t, { matched: matchedOfType.length, total: totalOfType.length }];
    }),
  ) as Record<LocalAuthorityType, CoverageByType>;

  const publishedAt = await readOsmPublishedAt(pbfPath);
  mkdirSync(COVERAGE_DIR, { recursive: true });
  writeFileSync(
    path.join(COVERAGE_DIR, "coverage.json"),
    JSON.stringify(
      {
        generatedAt,
        publishedAt,
        pbfSha256: sha256File(pbfPath),
        osmFeatureCount: osmFeatures.length,
        matchedCount: result.matched.length,
        rejected: Object.fromEntries(
          (
            [
              "degenerate-geometry",
              "no-province",
              "ambiguous-province",
              "no-registry-match",
              "ambiguous-registry-key",
              "duplicate-osm-match",
            ] as RejectReason[]
          ).map((reason) => [reason, result.rejected.filter((r) => r.reason === reason).length]),
        ),
        registryKeyCollisions: result.registryKeyCollisions,
        byType,
        writtenProvinces,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(COVERAGE_DIR, "COVERAGE.md"),
    buildCoverageMarkdown({
      generatedAt,
      publishedAt,
      osmFeatureCount: osmFeatures.length,
      result,
      registry: registryArtefact.localAuthorities,
      byType,
    }),
  );
  console.log(`[lao-boundaries] wrote ${path.join(COVERAGE_DIR, "COVERAGE.md")}`);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
