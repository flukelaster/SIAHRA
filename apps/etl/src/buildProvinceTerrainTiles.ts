import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as turf from "@turf/turf";
import { execa } from "execa";
import type { Feature, FeatureCollection, GeoJSON, MultiPolygon, Polygon } from "geojson";
import type { TerrainTileLevel, TerrainTilePyramid } from "@siahra/shared-types";
import type { AoiDefinition } from "./aoi.js";
import { utmToWgs84, utmZoneNumber } from "./projection.js";
import { MIN_CELL_SIZE_M } from "./provinceAoi.js";

const WORK_DIR = path.resolve(import.meta.dirname, "../data/work");

/** Cells per tile edge. 128 keeps LOD steps fine and leaf tiles ~34 KB. */
export const TILE_SIZE = 128;
export const TILE_BORDER = 1;
const NODATA = -32768;
/**
 * Tiles farther than this from the province polygon are not written. The map
 * dims and dissolves neighbouring terrain within ~14 km of the border, so
 * anything beyond is never visible — and a province bbox is typically 40–60 %
 * neighbouring territory.
 */
const KEEP_MARGIN_KM = 16;

interface GdalInfoJson {
  size: [number, number];
  cornerCoordinates: { upperLeft: [number, number] };
  bands: { minimum?: number; maximum?: number }[];
}

export interface TerrainTilesResult {
  pyramid: TerrainTilePyramid;
  fileCount: number;
  bytes: number;
}

interface Level {
  z: number;
  cellSizeM: number;
  width: number;
  height: number;
  data: Int16Array;
}

/**
 * Halves a level (2×2 mean of valid samples; nodata only where all four are).
 * Odd edges are handled by clamping the second sample onto the last row/col.
 */
function downsample(src: Level): Level {
  const width = Math.ceil(src.width / 2);
  const height = Math.ceil(src.height / 2);
  const data = new Int16Array(width * height);
  for (let r = 0; r < height; r++) {
    const r0 = r * 2;
    const r1 = Math.min(src.height - 1, r0 + 1);
    for (let c = 0; c < width; c++) {
      const c0 = c * 2;
      const c1 = Math.min(src.width - 1, c0 + 1);
      let sum = 0;
      let n = 0;
      for (const v of [
        src.data[r0 * src.width + c0],
        src.data[r0 * src.width + c1],
        src.data[r1 * src.width + c0],
        src.data[r1 * src.width + c1],
      ]) {
        if (v !== NODATA) {
          sum += v;
          n++;
        }
      }
      data[r * width + c] = n === 0 ? NODATA : Math.round(sum / n);
    }
  }
  return { z: src.z - 1, cellSizeM: src.cellSizeM * 2, width, height, data };
}

function bitsetBase64(bits: Uint8Array): string {
  return Buffer.from(bits).toString("base64");
}

/**
 * Builds the native-resolution (30 m) heightfield for a province and slices it
 * into a quadtree of raw Int16 tiles — see TerrainTilePyramid in shared-types
 * for the on-disk contract. One gdalwarp per province, everything else in
 * memory (Chiang Mai, the largest province, is ~55 M cells / 110 MB).
 */
/** Province polygon buffered by the keep margin, or null when no boundary exists. */
type Area = Feature<Polygon | MultiPolygon>;

function loadKeepArea(outDir: string): Area | null {
  const boundaryPath = path.join(outDir, "boundary.geojson");
  if (!existsSync(boundaryPath)) return null;
  const geo = JSON.parse(readFileSync(boundaryPath, "utf8")) as GeoJSON;
  const collection: FeatureCollection =
    geo.type === "FeatureCollection"
      ? geo
      : geo.type === "Feature"
        ? turf.featureCollection([geo])
        : turf.featureCollection([turf.feature(geo)]);
  const polygons = collection.features.filter(
    (f): f is Area => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
  );
  if (polygons.length === 0) return null;
  let keep: Area | null = null;
  for (const f of polygons) {
    const buffered = turf.buffer(f, KEEP_MARGIN_KM, { units: "kilometers" }) as Area | undefined;
    if (!buffered) continue;
    keep = keep ? ((turf.union(turf.featureCollection([keep, buffered])) as Area | null) ?? keep) : buffered;
  }
  return keep;
}

/**
 * Tile pyramids live outside apps/web/public: they are GBs and ~100k files,
 * far beyond what belongs in git or a Worker asset bundle. Vite serves this
 * directory under /aoi/{code}/terrain/ in dev (see apps/web/vite.config.ts);
 * production should put it in R2 behind the same URL prefix.
 */
export const TILES_ROOT = path.resolve(import.meta.dirname, "../data/tiles");

export async function buildProvinceTerrainTiles(
  aoi: AoiDefinition,
  vrtPath: string,
  outDir: string,
  urlPrefix: string,
): Promise<TerrainTilesResult> {
  mkdirSync(WORK_DIR, { recursive: true });
  const keepArea = loadKeepArea(outDir);
  const zone = utmZoneNumber(aoi.utmZone);
  const tilesDir = path.join(TILES_ROOT, aoi.aoiId, "terrain");
  rmSync(tilesDir, { recursive: true, force: true });
  mkdirSync(tilesDir, { recursive: true });

  const clippedTif = path.join(WORK_DIR, `p${aoi.aoiId}-clipped30.tif`);
  const rawBin = path.join(WORK_DIR, `p${aoi.aoiId}-clipped30.bin`);
  const targetSrs = `EPSG:${aoi.utmZone}`;
  const cell = MIN_CELL_SIZE_M;

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
      String(cell),
      String(cell),
      "-r",
      "bilinear",
      "-dstnodata",
      String(NODATA),
      "-ot",
      "Int16",
      "-multi",
      "-co",
      "TILED=YES",
      vrtPath,
      clippedTif,
    ],
    { stdio: "ignore" },
  );

  const { stdout } = await execa("gdalinfo", ["-stats", "-json", clippedTif]);
  const info = JSON.parse(stdout) as GdalInfoJson;
  const [width, height] = info.size;
  const [originEasting, originNorthing] = info.cornerCoordinates.upperLeft;
  const band = info.bands[0];

  await execa(
    "gdal_translate",
    ["-of", "EHdr", "-ot", "Int16", "-a_nodata", String(NODATA), clippedTif, rawBin],
    { stdio: "ignore" },
  );
  const buf = readFileSync(rawBin);
  const leaf = new Int16Array(buf.buffer, buf.byteOffset, width * height);
  if (leaf.length !== width * height) {
    throw new Error(`30 m raster size mismatch for ${aoi.aoiId}`);
  }

  // Levels: leaf is the deepest; keep halving until one tile covers the raster.
  const levelCount = Math.max(1, Math.ceil(Math.log2(Math.max(width, height) / TILE_SIZE)) + 1);
  const levels: Level[] = [];
  let current: Level = { z: levelCount - 1, cellSizeM: cell, width, height, data: leaf };
  levels.unshift(current);
  while (current.z > 0) {
    current = downsample(current);
    levels.unshift(current);
  }

  const span = TILE_SIZE + 1 + TILE_BORDER * 2;
  let fileCount = 0;
  let bytes = 0;
  const levelMeta: TerrainTileLevel[] = [];
  const tileBuf = new Int16Array(span * span);

  for (const level of levels) {
    const tilesX = Math.ceil(level.width / TILE_SIZE);
    const tilesY = Math.ceil(level.height / TILE_SIZE);
    const present = new Uint8Array(Math.ceil((tilesX * tilesY) / 8));
    const levelDir = path.join(tilesDir, String(level.z));
    mkdirSync(levelDir, { recursive: true });

    const tileM = TILE_SIZE * level.cellSizeM;
    const nearProvince = (tx: number, ty: number): boolean => {
      if (!keepArea) return true;
      // Centre + corners in lon/lat: a tile is kept if any of them is inside
      // the buffered polygon (buffer ≫ tile size at fine levels; at coarse
      // levels the tile is huge and always kept by its centre/corners test).
      const e0 = originEasting + tx * tileM;
      const n0 = originNorthing - ty * tileM;
      const pts: [number, number][] = [
        [e0 + tileM / 2, n0 - tileM / 2],
        [e0, n0],
        [e0 + tileM, n0],
        [e0, n0 - tileM],
        [e0 + tileM, n0 - tileM],
      ];
      for (const [e, n] of pts) {
        const [lon, lat] = utmToWgs84(e, n, zone);
        if (turf.booleanPointInPolygon(turf.point([lon, lat]), keepArea)) return true;
      }
      // Coarse tiles can contain the whole province without any corner inside it.
      if (tileM > KEEP_MARGIN_KM * 1000 * 2) {
        const [lonA, latA] = utmToWgs84(e0, n0, zone);
        const [lonB, latB] = utmToWgs84(e0 + tileM, n0 - tileM, zone);
        const tilePoly = turf.bboxPolygon([
          Math.min(lonA, lonB),
          Math.min(latA, latB),
          Math.max(lonA, lonB),
          Math.max(latA, latB),
        ]);
        return turf.booleanIntersects(tilePoly, keepArea);
      }
      return false;
    };

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        if (!nearProvince(tx, ty)) continue;
        let anyValid = false;
        for (let j = 0; j < span; j++) {
          const r = ty * TILE_SIZE - TILE_BORDER + j;
          const rowOk = r >= 0 && r < level.height;
          for (let i = 0; i < span; i++) {
            const c = tx * TILE_SIZE - TILE_BORDER + i;
            let v = NODATA;
            if (rowOk && c >= 0 && c < level.width) v = level.data[r * level.width + c];
            tileBuf[j * span + i] = v;
            // Only samples inside the tile proper decide emptiness; the border
            // ring is a convenience copy of the neighbours.
            if (
              v !== NODATA &&
              i >= TILE_BORDER &&
              i <= TILE_SIZE + TILE_BORDER &&
              j >= TILE_BORDER &&
              j <= TILE_SIZE + TILE_BORDER
            ) {
              anyValid = true;
            }
          }
        }
        if (!anyValid) continue;
        const idx = ty * tilesX + tx;
        present[idx >> 3] |= 1 << (idx & 7);
        const out = Buffer.from(tileBuf.buffer, tileBuf.byteOffset, tileBuf.byteLength);
        writeFileSync(path.join(levelDir, `${tx}_${ty}.bin`), out);
        fileCount++;
        bytes += out.byteLength;
      }
    }

    levelMeta.push({
      z: level.z,
      cellSizeM: level.cellSizeM,
      width: level.width,
      height: level.height,
      tilesX,
      tilesY,
      present: bitsetBase64(present),
    });
  }

  rmSync(rawBin, { force: true });
  rmSync(`${rawBin}.aux.xml`, { force: true });
  rmSync(rawBin.replace(/\.bin$/, ".hdr"), { force: true });
  rmSync(rawBin.replace(/\.bin$/, ".prj"), { force: true });

  return {
    pyramid: {
      urlTemplate: `${urlPrefix}/terrain/{z}/{x}_{y}.bin`,
      tileSize: TILE_SIZE,
      border: TILE_BORDER,
      leafCellSizeM: cell,
      originEasting,
      originNorthing,
      nodata: NODATA,
      minZ: Number(band.minimum ?? 0),
      maxZ: Number(band.maximum ?? 0),
      levels: levelMeta,
    },
    fileCount,
    bytes,
  };
}
