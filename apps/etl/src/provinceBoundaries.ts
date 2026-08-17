import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";

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
function normalizeThaiName(s: string | undefined | null): string {
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
