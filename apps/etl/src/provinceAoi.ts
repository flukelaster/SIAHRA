import type { AoiDefinition } from "./aoi.js";
import type { ProvinceBoundary } from "./provinceBoundaries.js";
import { tilesForBbox, tileUrl } from "./demTiles.js";

/** Max terrain grid dimension; keeps each terrain.bin around or under ~1.3 MB. */
export const MAX_GRID_DIM = 800;
/** Native Copernicus GLO-30 resolution — never resample finer than the source. */
export const MIN_CELL_SIZE_M = 30;

const METRES_PER_DEG_LAT = 110_540;
const METRES_PER_DEG_LON_EQ = 111_320;

export function bboxExtentMetres(bbox: ProvinceBoundary["bbox"]): {
  widthM: number;
  heightM: number;
} {
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  return {
    widthM: (bbox.maxLon - bbox.minLon) * METRES_PER_DEG_LON_EQ * Math.cos((midLat * Math.PI) / 180),
    heightM: (bbox.maxLat - bbox.minLat) * METRES_PER_DEG_LAT,
  };
}

/**
 * Province extents vary from ~40 km (Nonthaburi) to ~320 km (Chiang Mai), so
 * a fixed cell size would either bloat large provinces or waste detail on
 * small ones. Cap the grid instead and let resolution follow.
 */
export function cellSizeForBbox(bbox: ProvinceBoundary["bbox"]): number {
  const { widthM, heightM } = bboxExtentMetres(bbox);
  const extent = Math.max(widthM, heightM);
  return Math.max(MIN_CELL_SIZE_M, Math.ceil(extent / MAX_GRID_DIM));
}

/** Thailand straddles UTM 47N/48N at 102°E; pick by bbox centre. */
export function utmZoneForBbox(bbox: ProvinceBoundary["bbox"]): "32647" | "32648" {
  const midLon = (bbox.minLon + bbox.maxLon) / 2;
  return midLon < 102 ? "32647" : "32648";
}

export function provinceToAoi(p: ProvinceBoundary): AoiDefinition {
  return {
    aoiId: p.code,
    bbox: p.bbox,
    utmZone: utmZoneForBbox(p.bbox),
    demTileUrls: tilesForBbox(p.bbox).map(tileUrl),
    cellSizeM: cellSizeForBbox(p.bbox),
  };
}
