import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { isProvinceCode } from "@siahra/shared-types";

const WORK_DIR = path.resolve(import.meta.dirname, "../data/work");
const PROVINCES_TS = path.resolve(
  import.meta.dirname,
  "../../web/src/data/provinces.ts",
);

export interface ProvinceEntry {
  code: string;
  nameTh: string;
  nameEn: string;
}

export interface ProvinceBoundary {
  code: string;
  nameTh: string;
  nameEn: string;
  bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  /** GeoJSON geometry (WGS84), already simplified. */
  geometry: unknown;
  boundarySource: "osm" | "station-fallback";
}

/** Reads the authoritative 77-province list from the web app's data file. */
export function readProvinceList(): ProvinceEntry[] {
  const src = readFileSync(PROVINCES_TS, "utf-8");
  const re = /code:\s*"(\d+)",\s*nameTh:\s*"([^"]+)",\s*nameEn:\s*"([^"]*)"/g;
  const out: ProvinceEntry[] = [];
  for (const m of src.matchAll(re)) {
    out.push({ code: m[1], nameTh: m[2], nameEn: m[3] });
  }
  if (out.length === 0) throw new Error("Failed to parse provinces.ts");
  return out;
}

/** OSM names province relations as either "เชียงใหม่" or "จังหวัดเชียงใหม่". */
export function normalizeThaiName(s: string | undefined | null): string {
  if (!s) return "";
  let v = s.trim();
  if (v.startsWith("จังหวัด")) v = v.slice("จังหวัด".length);
  return v.trim();
}

function bboxOf(geometry: any): { minLon: number; maxLon: number; minLat: number; maxLat: number } {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const visit = (coords: any) => {
    if (typeof coords[0] === "number") {
      const [lon, lat] = coords as [number, number];
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const c of coords) visit(c);
  };
  visit(geometry.coordinates);
  return { minLon, maxLon, minLat, maxLat };
}

/**
 * Extracts admin_level=4 (province) boundaries from the national OSM extract
 * and matches them to the authoritative province-code list by Thai name.
 *
 * Verified: all 77 provinces match exactly, so no fallback path is exercised
 * in practice — it is kept only so a future OSM rename degrades gracefully.
 */
export async function buildProvinceBoundaries(
  thailandOsmPbfPath: string,
): Promise<ProvinceBoundary[]> {
  mkdirSync(WORK_DIR, { recursive: true });
  const adminPbf = path.join(WORK_DIR, "admin4.osm.pbf");
  const adminGeojson = path.join(WORK_DIR, "admin4.geojson");
  const simplified = path.join(WORK_DIR, "admin4-simplified.geojson");

  if (!existsSync(adminGeojson)) {
    console.log("[boundaries] osmium tags-filter r/admin_level=4");
    await execa(
      "osmium",
      ["tags-filter", thailandOsmPbfPath, "r/admin_level=4", "-o", adminPbf, "--overwrite"],
      { stdio: "inherit" },
    );
    console.log("[boundaries] ogr2ogr -> GeoJSON");
    await execa("ogr2ogr", ["-f", "GeoJSON", adminGeojson, adminPbf, "multipolygons"], {
      stdio: "inherit",
    });
  } else {
    console.log("[boundaries] cached admin4.geojson");
  }

  // Simplify in WGS84 degrees. ~0.001 deg ~= 100 m, plenty for an outline and
  // it takes the layer from ~53 MB to a few MB.
  if (!existsSync(simplified)) {
    if (existsSync(simplified)) rmSync(simplified);
    console.log("[boundaries] simplifying geometry");
    await execa(
      "ogr2ogr",
      [
        "-f",
        "GeoJSON",
        "-simplify",
        "0.001",
        "-where",
        "admin_level='4'",
        simplified,
        adminGeojson,
      ],
      { stdio: "inherit" },
    );
  }

  const fc = JSON.parse(readFileSync(simplified, "utf-8")) as {
    features: { properties: Record<string, string>; geometry: any }[];
  };

  const byName = new Map<string, { properties: Record<string, string>; geometry: any }>();
  for (const f of fc.features) {
    if (f.properties.admin_level !== "4") continue;
    byName.set(normalizeThaiName(f.properties.name), f);
  }

  const provinces = readProvinceList();
  const out: ProvinceBoundary[] = [];
  const unmatched: string[] = [];

  for (const p of provinces) {
    const feat = byName.get(normalizeThaiName(p.nameTh));
    if (!feat) {
      unmatched.push(`${p.code} ${p.nameTh}`);
      continue;
    }
    out.push({
      code: p.code,
      nameTh: p.nameTh,
      nameEn: p.nameEn,
      bbox: bboxOf(feat.geometry),
      geometry: feat.geometry,
      boundarySource: "osm",
    });
  }

  console.log(`[boundaries] matched ${out.length}/${provinces.length} provinces from OSM`);
  if (unmatched.length > 0) {
    console.warn(`[boundaries] UNMATCHED (need fallback): ${unmatched.join(", ")}`);
  }
  return out;
}

export function writeBoundaryGeojson(boundary: ProvinceBoundary, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  const fc = {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {
          provinceCode: boundary.code,
          nameTh: boundary.nameTh,
          nameEn: boundary.nameEn,
        },
        geometry: boundary.geometry,
      },
    ],
  };
  writeFileSync(path.join(outDir, "boundary.geojson"), JSON.stringify(fc));
}

// ─────────────────────────────────────────────────────────────────────────────
// Ring artefact for the API Worker (E10.6)
//
// A Worker cannot read `apps/web/public/aoi/*/boundary.geojson` at runtime, so
// the boundary rings have to be baked into the api bundle. This reads the
// boundary files this module already emits (`writeBoundaryGeojson`), simplifies
// and quantises them, and writes one JSON artefact under `apps/api/src/data`.
// ─────────────────────────────────────────────────────────────────────────────

const AOI_DIR = path.resolve(import.meta.dirname, "../../web/public/aoi");
const RINGS_OUT = path.resolve(import.meta.dirname, "../../api/src/data/provinceRings.json");

/**
 * ~0.003 องศา ≈ 330 ม. บนละติจูดของไทย — เพี้ยนน้อยกว่าหน่วยที่ UI แสดง ("≈ N กม.")
 * อยู่หนึ่งอันดับ และได้ไฟล์ 338 KB อยู่ใต้เพดาน 400 KB (0.002 องศาได้ 491 KB = เกิน)
 */
export const RING_SIMPLIFY_TOLERANCE_DEG = 0.003;
/** 4 ตำแหน่งทศนิยม ≈ 11 ม. — ละเอียดกว่า tolerance ข้างบนมาก จึงไม่ใช่ตัวจำกัดความแม่น */
export const RING_QUANTISE_DECIMALS = 4;

export interface ProvinceRingSet {
  code: string;
  nameTh: string;
  nameEn: string;
  /** [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number];
  /** วงปิดทุกวง (ทั้งวงนอก วงใน และเกาะ) เรียงแบน ๆ เป็น [lon,lat,lon,lat,...] */
  rings: number[][];
}

export interface ProvinceRingsArtefact {
  generatedAt: string;
  /** หน่วยองศา (ระยะตั้งฉากสูงสุดที่ยอมให้เพี้ยนตอนลดจุด) */
  toleranceDeg: number;
  quantiseDecimals: number;
  source: string;
  provinces: ProvinceRingSet[];
}

/**
 * Douglas–Peucker บนระนาบ (lon·cosφ, lat) — คูณ cosφ เพื่อให้ tolerance หนึ่งค่า
 * หมายถึงระยะจริงเท่ากันทั้งสองแกน ไม่ใช่ "องศา" ที่แกน lon สั้นกว่าราว 3–4%
 */
function simplifyRingDeg(pts: [number, number][], tolDeg: number, cosLat: number): [number, number][] {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const tol2 = tolDeg * tolDeg;
  const px = (i: number) => pts[i][0] * cosLat;
  const py = (i: number) => pts[i][1];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const ax = px(a);
    const ay = py(a);
    const dx = px(b) - ax;
    const dy = py(b) - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let worst = -1;
    let worstD = tol2;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((px(i) - ax) * dx + (py(i) - ay) * dy) / len2));
      const ex = ax + t * dx - px(i);
      const ey = ay + t * dy - py(i);
      const d = ex * ex + ey * ey;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([a, worst], [worst, b]);
  }
  return pts.filter((_, i) => keep[i] === 1);
}

function collectRings(geometry: any, out: [number, number][][]): void {
  if (!geometry) return;
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) out.push(ring as [number, number][]);
    return;
  }
  if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates) {
      for (const ring of poly) out.push(ring as [number, number][]);
    }
    return;
  }
  if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries) collectRings(g, out);
  }
}

/**
 * อ่าน `apps/web/public/aoi/{code}/boundary.geojson` ทั้ง 77 จังหวัด แล้วย่อเป็นชุดวง
 *
 * **ห้ามทิ้งวงไหนเลย** แม้เกาะเล็ก ๆ: การตัดเกาะทิ้งเปลี่ยนคำตอบระยะทางของเหตุการณ์
 * ในทะเลอันดามัน/อ่าวไทยแบบเงียบ ๆ วงที่ย่อแล้วเหลือน้อยกว่า 4 จุดจึงถูกเก็บแบบเดิม
 *
 * ไดเรกทอรี `chiangmai-old-city` อยู่ใน aoi ด้วยแต่ไม่ใช่จังหวัด — กรองด้วย
 * `isProvinceCode()` จาก shared-types แล้วยืนยันว่าได้ครบ 77 ไม่ใช่ 78
 */
export function buildProvinceRings(
  toleranceDeg = RING_SIMPLIFY_TOLERANCE_DEG,
  decimals = RING_QUANTISE_DECIMALS,
): ProvinceRingsArtefact {
  const q = 10 ** decimals;
  const provinces: ProvinceRingSet[] = [];
  const missing: string[] = [];

  for (const p of readProvinceList()) {
    if (!isProvinceCode(p.code)) {
      throw new Error(`provinces.ts carries a code that is not a province: ${p.code}`);
    }
    const file = path.join(AOI_DIR, p.code, "boundary.geojson");
    if (!existsSync(file)) {
      missing.push(`${p.code} ${p.nameTh}`);
      continue;
    }
    const fc = JSON.parse(readFileSync(file, "utf-8")) as {
      features: { geometry: any }[];
    };
    const raw: [number, number][][] = [];
    for (const f of fc.features) collectRings(f.geometry, raw);

    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const ring of raw) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    const cosLat = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);

    const rings: number[][] = [];
    for (const ring of raw) {
      const simplified = simplifyRingDeg(ring, toleranceDeg, cosLat);
      // ย่อแล้วเหลือน้อยกว่าสามเหลี่ยมปิด = เกาะเล็กเกินไป ให้คงรูปเดิมไว้ ไม่ทิ้ง
      const use = simplified.length >= 4 ? simplified : ring;
      const flat: number[] = [];
      for (const [lon, lat] of use) {
        flat.push(Math.round(lon * q) / q, Math.round(lat * q) / q);
      }
      rings.push(flat);
    }

    provinces.push({
      code: p.code,
      nameTh: p.nameTh,
      nameEn: p.nameEn,
      bbox: [minLon, minLat, maxLon, maxLat],
      rings,
    });
  }

  if (missing.length > 0) {
    throw new Error(`boundary.geojson missing for: ${missing.join(", ")}`);
  }
  if (provinces.length !== 77) {
    throw new Error(`expected 77 provinces, built ${provinces.length}`);
  }

  return {
    generatedAt: new Date().toISOString(),
    toleranceDeg,
    quantiseDecimals: decimals,
    source: "OSM admin_level=4 via apps/web/public/aoi/{code}/boundary.geojson",
    provinces,
  };
}

/** Writes the artefact the api Worker imports; returns its raw byte size. */
export function writeProvinceRings(
  outPath = RINGS_OUT,
  toleranceDeg = RING_SIMPLIFY_TOLERANCE_DEG,
  decimals = RING_QUANTISE_DECIMALS,
): number {
  const artefact = buildProvinceRings(toleranceDeg, decimals);
  mkdirSync(path.dirname(outPath), { recursive: true });
  const json = JSON.stringify(artefact);
  writeFileSync(outPath, json);
  const bytes = Buffer.byteLength(json, "utf-8");
  const points = artefact.provinces.reduce(
    (n, p) => n + p.rings.reduce((m, r) => m + r.length / 2, 0),
    0,
  );
  console.log(
    `[rings] ${artefact.provinces.length} provinces, ${points} points, ${(bytes / 1024).toFixed(1)} KB raw (tolerance ${toleranceDeg} deg)`,
  );
  return bytes;
}
