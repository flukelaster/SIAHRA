import { mkdirSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { AoiDefinition } from "./aoi.js";
import type { TerrainResult } from "./buildTerrain.js";

const WORK_DIR = path.resolve(import.meta.dirname, "../data/work");

interface GdalInfoJson {
  size: [number, number];
  cornerCoordinates: { lowerLeft: [number, number] };
  bands: { minimum?: number; maximum?: number }[];
}

/**
 * Same output contract as buildTerrain (EHdr Int16, LAYOUT BIL, upper-left
 * origin, row 0 = north — the frontend depends on this exactly), but clips
 * from a prebuilt VRT mosaic instead of a per-AOI tile list, so 77 provinces
 * share one virtual raster.
 */
export async function buildProvinceTerrain(
  aoi: AoiDefinition,
  vrtPath: string,
  outDir: string,
): Promise<TerrainResult> {
  mkdirSync(WORK_DIR, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const clippedTif = path.join(WORK_DIR, `p${aoi.aoiId}-clipped.tif`);
  const targetSrs = `EPSG:${aoi.utmZone}`;

  await execa(
    "gdalwarp",
    [
      "-overwrite",
      "-t_srs",
      targetSrs,
      "-te",
      String(aoi.bbox.minLon),
      String(aoi.bbox.minLat),
      String(aoi.bbox.maxLon),
      String(aoi.bbox.maxLat),
      "-te_srs",
      "EPSG:4326",
      "-tr",
      String(aoi.cellSizeM),
      String(aoi.cellSizeM),
      "-r",
      "bilinear",
      "-dstnodata",
      "-32768",
      "-multi",
      vrtPath,
      clippedTif,
    ],
    { stdio: "ignore" },
  );

  const { stdout } = await execa("gdalinfo", ["-stats", "-json", clippedTif]);
  const info = JSON.parse(stdout) as GdalInfoJson;
  const [width, height] = info.size;
  const [originEasting, originNorthing] = info.cornerCoordinates.lowerLeft;
  const band = info.bands[0];

  const binPath = path.join(outDir, "terrain.bin");
  await execa(
    "gdal_translate",
    ["-of", "EHdr", "-ot", "Int16", "-a_nodata", "-32768", clippedTif, binPath],
    { stdio: "ignore" },
  );

  const hillshadePath = path.join(outDir, "hillshade.png");
  await execa("gdaldem", ["hillshade", "-of", "PNG", clippedTif, hillshadePath], {
    stdio: "ignore",
  });

  return {
    binPath,
    hillshadePath,
    width,
    height,
    cellSizeM: aoi.cellSizeM,
    minZ: Number(band.minimum ?? 0),
    maxZ: Number(band.maximum ?? 0),
    originEasting,
    originNorthing,
  };
}
