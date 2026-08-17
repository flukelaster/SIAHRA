import { mkdirSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { AoiDefinition } from "./aoi.js";

const WORK_DIR = path.resolve(import.meta.dirname, "../data/work");

export interface TerrainResult {
  binPath: string;
  hillshadePath: string;
  width: number;
  height: number;
  cellSizeM: number;
  minZ: number;
  maxZ: number;
  /** Lower-left corner of the clipped grid, in the AOI's UTM CRS — the terrain's local-origin anchor. */
  originEasting: number;
  originNorthing: number;
}

interface GdalInfoJson {
  size: [number, number];
  cornerCoordinates: { lowerLeft: [number, number] };
  bands: { minimum?: number; maximum?: number }[];
}

export async function buildTerrain(
  aoi: AoiDefinition,
  demTilePaths: string[],
  outDir: string,
): Promise<TerrainResult> {
  mkdirSync(WORK_DIR, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const clippedTif = path.join(WORK_DIR, `${aoi.aoiId}-clipped.tif`);
  const targetSrs = `EPSG:${aoi.utmZone}`;

  console.log(`[buildTerrain] warping+clipping to ${targetSrs}...`);
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
      ...demTilePaths,
      clippedTif,
    ],
    { stdio: "inherit" },
  );

  console.log("[buildTerrain] computing stats + extent via gdalinfo...");
  const { stdout: infoStdout } = await execa("gdalinfo", ["-stats", "-json", clippedTif]);
  const info = JSON.parse(infoStdout) as GdalInfoJson;
  const [width, height] = info.size;
  const [originEasting, originNorthing] = info.cornerCoordinates.lowerLeft;
  const band = info.bands[0];
  const minZ = Number(band.minimum ?? 0);
  const maxZ = Number(band.maximum ?? 0);

  const binPath = path.join(outDir, "terrain.bin");
  console.log(`[buildTerrain] converting to Int16 EHdr binary: ${binPath}`);
  await execa(
    "gdal_translate",
    ["-of", "EHdr", "-ot", "Int16", "-a_nodata", "-32768", clippedTif, binPath],
    { stdio: "inherit" },
  );

  const hillshadePath = path.join(outDir, "hillshade.png");
  console.log(`[buildTerrain] generating hillshade: ${hillshadePath}`);
  await execa("gdaldem", ["hillshade", "-of", "PNG", clippedTif, hillshadePath], {
    stdio: "inherit",
  });

  return {
    binPath,
    hillshadePath,
    width,
    height,
    cellSizeM: aoi.cellSizeM,
    minZ,
    maxZ,
    originEasting,
    originNorthing,
  };
}
