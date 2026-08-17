import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { AoiDefinition } from "./aoi.js";

const WORK_DIR = path.resolve(import.meta.dirname, "../data/work");

/** Urban-core box edge length. Roughly one city's worth of footprints. */
export const CORE_BOX_KM = 12;
/** Hard cap on features shipped to the browser (client-side extrusion cost). */
export const MAX_BUILDINGS = 30_000;
/** Density-binning grid, in degrees (~2.2 km) — coarse on purpose, it only
 *  has to find which part of the province is built up. */
const DENSITY_BIN_DEG = 0.02;

interface RawFeature {
  type: "Feature";
  properties: Record<string, unknown> & { other_tags?: string; building?: string };
  geometry: { type: string; coordinates: unknown };
}

function parseOtherTags(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  const re = /"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"/g;
  const unescape = (s: string) => s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  for (const m of raw.matchAll(re)) out[unescape(m[1])] = unescape(m[2]);
  return out;
}

function computeHeight(tags: Record<string, string>): {
  height: number;
  heightSource: "tag" | "inferred" | "default";
} {
  const heightTag = tags.height ?? tags["building:height"];
  if (heightTag) {
    const parsed = Number.parseFloat(heightTag);
    if (Number.isFinite(parsed) && parsed > 0) return { height: parsed, heightSource: "tag" };
  }
  const levelsTag = tags["building:levels"];
  if (levelsTag) {
    const levels = Number.parseFloat(levelsTag);
    if (Number.isFinite(levels) && levels > 0) {
      return { height: levels * 3.2, heightSource: "inferred" };
    }
  }
  return { height: 6, heightSource: "default" };
}

/** Ring area via the shoelace formula, in squared degrees — only ever used to
 *  rank footprints against each other, never as a real-world area. */
function ringArea(coords: number[][]): number {
  let a = 0;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    a += (coords[j][0] + coords[i][0]) * (coords[j][1] - coords[i][1]);
  }
  return Math.abs(a / 2);
}

function firstRing(geom: RawFeature["geometry"]): number[][] | null {
  const c = geom.coordinates as any;
  if (geom.type === "Polygon") return c?.[0] ?? null;
  if (geom.type === "MultiPolygon") return c?.[0]?.[0] ?? null;
  return null;
}

function centroidOf(ring: number[][]): [number, number] {
  let x = 0;
  let y = 0;
  for (const [lon, lat] of ring) {
    x += lon;
    y += lat;
  }
  return [x / ring.length, y / ring.length];
}

export interface ProvinceBuildingsResult {
  buildingCount: number;
  coverage: "full-aoi" | "urban-core";
  coverageBbox: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  heightSourceCounts: Record<string, number>;
}

/**
 * Extracts building footprints for a province, then narrows to a single
 * ~12 km urban core. A whole province is far too many footprints to extrude
 * in the browser (Chiang Mai's 8x6 km old-city box alone had 24k), so the
 * core box is centred on the densest cluster of buildings — in practice the
 * provincial capital — and capped by footprint size.
 */
export async function buildProvinceBuildings(
  aoi: AoiDefinition,
  thailandOsmPbfPath: string,
  outDir: string,
): Promise<ProvinceBuildingsResult> {
  mkdirSync(WORK_DIR, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const id = aoi.aoiId;
  const bboxArg = `${aoi.bbox.minLon},${aoi.bbox.minLat},${aoi.bbox.maxLon},${aoi.bbox.maxLat}`;
  const extractPbf = path.join(WORK_DIR, `p${id}-extract.osm.pbf`);
  const buildingsPbf = path.join(WORK_DIR, `p${id}-buildings.osm.pbf`);
  const rawGeojson = path.join(WORK_DIR, `p${id}-buildings-raw.geojson`);

  await execa(
    "osmium",
    ["extract", "-b", bboxArg, "-o", extractPbf, "--overwrite", thailandOsmPbfPath],
    { stdio: "ignore" },
  );
  await execa(
    "osmium",
    ["tags-filter", "-o", buildingsPbf, "--overwrite", extractPbf, "w/building", "n/building"],
    { stdio: "ignore" },
  );

  if (existsSync(rawGeojson)) rmSync(rawGeojson);
  // Keep this pass in WGS84: the density binning and core-box cut are done in
  // degrees, and reprojection happens once at the end on the surviving subset.
  await execa(
    "ogr2ogr",
    ["-f", "GeoJSON", rawGeojson, buildingsPbf, "multipolygons"],
    { stdio: "ignore" },
  );

  const raw = JSON.parse(readFileSync(rawGeojson, "utf-8")) as { features: RawFeature[] };
  const all = raw.features.filter((f) => f.properties.building && f.geometry);

  // Find the densest ~2 km bin and grow the core box around it.
  const bins = new Map<string, { n: number; lon: number; lat: number }>();
  const withCentroid: { f: RawFeature; lon: number; lat: number; area: number }[] = [];
  for (const f of all) {
    const ring = firstRing(f.geometry);
    if (!ring || ring.length < 3) continue;
    const [lon, lat] = centroidOf(ring);
    withCentroid.push({ f, lon, lat, area: ringArea(ring) });
    const key = `${Math.floor(lon / DENSITY_BIN_DEG)}:${Math.floor(lat / DENSITY_BIN_DEG)}`;
    const cur = bins.get(key);
    if (cur) {
      cur.n++;
      cur.lon += lon;
      cur.lat += lat;
    } else {
      bins.set(key, { n: 1, lon, lat });
    }
  }

  let best: { n: number; lon: number; lat: number } | null = null;
  for (const b of bins.values()) if (!best || b.n > best.n) best = b;

  const midLat = (aoi.bbox.minLat + aoi.bbox.maxLat) / 2;
  const halfLatDeg = CORE_BOX_KM / 2 / 110.54;
  const halfLonDeg = CORE_BOX_KM / 2 / (111.32 * Math.cos((midLat * Math.PI) / 180));

  const cLon = best ? best.lon / best.n : (aoi.bbox.minLon + aoi.bbox.maxLon) / 2;
  const cLat = best ? best.lat / best.n : midLat;

  // Clamp the core box inside the province bbox.
  const coverageBbox = {
    minLon: Math.max(aoi.bbox.minLon, cLon - halfLonDeg),
    maxLon: Math.min(aoi.bbox.maxLon, cLon + halfLonDeg),
    minLat: Math.max(aoi.bbox.minLat, cLat - halfLatDeg),
    maxLat: Math.min(aoi.bbox.maxLat, cLat + halfLatDeg),
  };

  const coversWholeProvince =
    coverageBbox.minLon <= aoi.bbox.minLon &&
    coverageBbox.maxLon >= aoi.bbox.maxLon &&
    coverageBbox.minLat <= aoi.bbox.minLat &&
    coverageBbox.maxLat >= aoi.bbox.maxLat;

  let selected = withCentroid.filter(
    (c) =>
      c.lon >= coverageBbox.minLon &&
      c.lon <= coverageBbox.maxLon &&
      c.lat >= coverageBbox.minLat &&
      c.lat <= coverageBbox.maxLat,
  );

  if (selected.length > MAX_BUILDINGS) {
    selected = selected.sort((a, b) => b.area - a.area).slice(0, MAX_BUILDINGS);
  }

  // Reproject only the surviving subset, via a temp file ogr2ogr can read.
  const subsetPath = path.join(WORK_DIR, `p${id}-subset.geojson`);
  const projectedPath = path.join(WORK_DIR, `p${id}-projected.geojson`);
  const heightSourceCounts: Record<string, number> = { tag: 0, inferred: 0, default: 0 };

  const subsetFeatures = selected.map(({ f }) => {
    const tags = parseOtherTags(f.properties.other_tags);
    const { height, heightSource } = computeHeight(tags);
    heightSourceCounts[heightSource]++;
    return {
      type: "Feature" as const,
      geometry: f.geometry,
      properties: { building: f.properties.building, height, heightSource },
    };
  });

  writeFileSync(
    subsetPath,
    JSON.stringify({ type: "FeatureCollection", features: subsetFeatures }),
  );

  if (existsSync(projectedPath)) rmSync(projectedPath);
  const finalPath = path.join(outDir, "buildings.geojson");

  if (subsetFeatures.length === 0) {
    writeFileSync(finalPath, JSON.stringify({ type: "FeatureCollection", features: [] }));
  } else {
    await execa(
      "ogr2ogr",
      [
        "-f",
        "GeoJSON",
        "-t_srs",
        `EPSG:${aoi.utmZone}`,
        "-s_srs",
        "EPSG:4326",
        // Coordinates are UTM metres; 2 dp is 1 cm, far finer than the source
        // footprints warrant. GDAL's default (~9 dp) roughly doubles file size
        // for nanometre precision nobody can use.
        "-lco",
        "COORDINATE_PRECISION=2",
        projectedPath,
        subsetPath,
      ],
      { stdio: "ignore" },
    );
    // Copy through so the shipped file has no ogr metadata surprises.
    const projected = JSON.parse(readFileSync(projectedPath, "utf-8"));
    writeFileSync(finalPath, JSON.stringify(projected));
  }

  return {
    buildingCount: subsetFeatures.length,
    coverage: coversWholeProvince ? "full-aoi" : "urban-core",
    coverageBbox,
    heightSourceCounts,
  };
}
