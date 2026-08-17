import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { AoiDefinition } from "./aoi.js";

const WORK_DIR = path.resolve(import.meta.dirname, "../data/work");

interface RawFeature {
  type: "Feature";
  properties: Record<string, unknown> & { other_tags?: string; building?: string };
  geometry: unknown;
}
interface RawFeatureCollection {
  type: "FeatureCollection";
  features: RawFeature[];
}

/** Parses GDAL OSM driver's hstore-style `other_tags` column: "key"=>"value","key2"=>"value2" */
function parseOtherTags(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  const re = /"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"/g;
  const unescape = (s: string) => s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  for (const m of raw.matchAll(re)) {
    out[unescape(m[1])] = unescape(m[2]);
  }
  return out;
}

function computeHeight(tags: Record<string, string>): { height: number; heightSource: "tag" | "inferred" | "default" } {
  const heightTag = tags.height ?? tags["building:height"];
  if (heightTag) {
    const parsed = Number.parseFloat(heightTag);
    if (Number.isFinite(parsed) && parsed > 0) {
      return { height: parsed, heightSource: "tag" };
    }
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

export interface BuildingsResult {
  geojsonPath: string;
  buildingCount: number;
  heightSourceCounts: Record<string, number>;
  sampleFeatures: RawFeature[];
}

export async function buildBuildings(
  aoi: AoiDefinition,
  thailandOsmPbfPath: string,
  outDir: string,
): Promise<BuildingsResult> {
  mkdirSync(WORK_DIR, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const bboxArg = `${aoi.bbox.minLon},${aoi.bbox.minLat},${aoi.bbox.maxLon},${aoi.bbox.maxLat}`;
  const extractPbf = path.join(WORK_DIR, `${aoi.aoiId}-extract.osm.pbf`);
  const buildingsPbf = path.join(WORK_DIR, `${aoi.aoiId}-buildings.osm.pbf`);
  const rawGeojson = path.join(WORK_DIR, `${aoi.aoiId}-buildings-raw.geojson`);

  console.log(`[buildBuildings] osmium extract -b ${bboxArg}`);
  await execa(
    "osmium",
    ["extract", "-b", bboxArg, "-o", extractPbf, "--overwrite", thailandOsmPbfPath],
    { stdio: "inherit" },
  );

  console.log("[buildBuildings] osmium tags-filter (building=*)");
  await execa(
    "osmium",
    ["tags-filter", "-o", buildingsPbf, "--overwrite", extractPbf, "w/building", "n/building"],
    { stdio: "inherit" },
  );

  // The GeoJSON driver doesn't support ogr2ogr's -overwrite (no DeleteLayer
  // support), so remove any stale output from a prior run explicitly.
  if (existsSync(rawGeojson)) rmSync(rawGeojson);

  console.log(`[buildBuildings] ogr2ogr -> GeoJSON, reproject to EPSG:${aoi.utmZone}`);
  await execa(
    "ogr2ogr",
    ["-f", "GeoJSON", "-t_srs", `EPSG:${aoi.utmZone}`, rawGeojson, buildingsPbf, "multipolygons"],
    { stdio: "inherit" },
  );

  const raw = JSON.parse(readFileSync(rawGeojson, "utf-8")) as RawFeatureCollection;

  const heightSourceCounts: Record<string, number> = { tag: 0, inferred: 0, default: 0 };
  const features = raw.features
    .filter((f) => f.properties.building)
    .map((f) => {
      const tags = parseOtherTags(f.properties.other_tags);
      const { height, heightSource } = computeHeight(tags);
      heightSourceCounts[heightSource]++;
      return {
        type: "Feature" as const,
        geometry: f.geometry,
        properties: {
          building: f.properties.building,
          height,
          heightSource,
        },
      };
    });

  const cleanGeojson = { type: "FeatureCollection" as const, features };
  const finalPath = path.join(outDir, "buildings.geojson");
  writeFileSync(finalPath, JSON.stringify(cleanGeojson));

  return {
    geojsonPath: finalPath,
    buildingCount: features.length,
    heightSourceCounts,
    sampleFeatures: features.slice(0, 3) as unknown as RawFeature[],
  };
}
