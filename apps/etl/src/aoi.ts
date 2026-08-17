export interface AoiDefinition {
  aoiId: string;
  bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  utmZone: "32647" | "32648";
  /** Copernicus GLO-30 COG tile(s) covering this AOI's bbox. */
  demTileUrls: string[];
  /** Target grid cell size in metres for the exported terrain.bin. */
  cellSizeM: number;
}

export const AOIS: Record<string, AoiDefinition> = {
  "chiangmai-old-city": {
    aoiId: "chiangmai-old-city",
    // Chiang Mai Old City (moat) extended west to the Doi Suthep flank.
    bbox: { minLon: 98.94, maxLon: 99.02, minLat: 18.76, maxLat: 18.82 },
    utmZone: "32647",
    // The AOI's eastern edge (99.00-99.02°E) crosses the E098/E099 tile
    // boundary, so both tiles are needed — verified empirically: clipping
    // against only the E098 tile left ~25% of the grid as nodata.
    demTileUrls: [
      "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N18_00_E098_00_DEM/Copernicus_DSM_COG_10_N18_00_E098_00_DEM.tif",
      "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N18_00_E099_00_DEM/Copernicus_DSM_COG_10_N18_00_E099_00_DEM.tif",
    ],
    cellSizeM: 30,
  },
};

export function getAoi(aoiId: string): AoiDefinition {
  const aoi = AOIS[aoiId];
  if (!aoi) {
    throw new Error(`Unknown AOI "${aoiId}". Known AOIs: ${Object.keys(AOIS).join(", ")}`);
  }
  return aoi;
}
