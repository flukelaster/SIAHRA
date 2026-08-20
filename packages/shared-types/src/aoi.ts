/**
 * One level of the terrain tile pyramid. Level 0 is the coarsest; each level
 * halves the cell size, and tile (x, y) at level z covers exactly tiles
 * (2x..2x+1, 2y..2y+1) at level z+1 (all levels share the raster origin).
 */
export interface TerrainTileLevel {
  z: number;
  cellSizeM: number;
  /** Raster dimensions at this level, in cells. */
  width: number;
  height: number;
  tilesX: number;
  tilesY: number;
  /**
   * Base64 bitset, row-major (y * tilesX + x), 1 = tile file exists. Tiles
   * that are entirely nodata are not written, so the client never requests
   * them (a static host may answer a miss with the SPA shell, not a 404).
   */
  present: string;
}

/**
 * Native-resolution heightfield as a quadtree of raw Int16 tiles for
 * distance-based LOD streaming. Same encoding as terrain.bin (metres,
 * little-endian, -32768 = nodata) — one file per tile, containing
 * (tileSize + 1 + 2·border)² samples so neighbouring tiles share their edge
 * row/column and normals can be computed without seams.
 */
export interface TerrainTilePyramid {
  /** e.g. "/aoi/10/terrain/{z}/{x}_{y}.bin" */
  urlTemplate: string;
  /** Cells per tile edge (vertices per edge = tileSize + 1). */
  tileSize: number;
  /** Extra sample ring around each tile (for normals / skirts). */
  border: number;
  /** Cell size of the finest level, metres. */
  leafCellSizeM: number;
  /** Upper-left corner of the pyramid raster in UTM (matches manifest.utmZone). */
  originEasting: number;
  originNorthing: number;
  nodata: number;
  minZ: number;
  maxZ: number;
  levels: TerrainTileLevel[];
}

export interface BuildingTileLevel {
  z: number;
  tilesX: number;
  tilesY: number;
  /** Base64 bitset, row-major (y * tilesX + x), 1 = tile file exists. */
  present: string;
  /** Buildings in this level across all its tiles. */
  count: number;
  /** Importance filter applied at this level (for the legend / debugging). */
  minAreaM2: number;
  minHeightM: number;
}

/**
 * Whole-province building footprints as binary tiles on the terrain tile
 * grid (same origin, tile size and level numbering as TerrainTilePyramid).
 * Coarser levels keep only large/tall buildings so a distant city still shows
 * its skyline; the leaf level has everything.
 *
 * File format (little-endian): u32 magic 0x444C4253 ("SBLD"), u32 count,
 * then per building: u16 vertexCount k, u16 height (dm), i16 groundZ (m),
 * u16 flags, then k × (i16 dx, i16 dy) in `unitM` metres relative to the
 * tile CENTRE (dx east, dy south).
 */
export interface BuildingTilePyramid {
  /** e.g. "/aoi/10/buildings/{z}/{x}_{y}.bin" */
  urlTemplate: string;
  unitM: number;
  levels: BuildingTileLevel[];
  /** Total distinct buildings (leaf level). */
  count: number;
  heightSourceCounts: Record<string, number>;
}

export interface FeatureTileLevel {
  z: number;
  tilesX: number;
  tilesY: number;
  present: string;
  /** Records (clipped line pieces + area copies) across the level's tiles. */
  count: number;
}

/**
 * Waterways, water bodies and major roads from OSM as binary LOD tiles on the
 * terrain tile grid, pre-draped (every vertex carries its DEM ground height).
 *
 * File format (little-endian): u32 magic 0x4E494C53 ("SLIN"), u32 count, then
 * per record: u8 kind (0 = line, 1 = area), u8 class, u16 vertexCount k,
 * i16 levelZ (water surface height for areas), f32 unitM, then
 * k × (i16 dx, i16 dy, i16 z) — dx east / dy south from the tile CENTRE in
 * `unitM` metres, z in metres.
 *
 * Classes: 1 river, 2 canal, 3 stream, 5 water area, 10 motorway, 11 trunk,
 * 12 primary, 13 secondary, 14 motorway/trunk link.
 */
export interface FeatureTilePyramid {
  /** e.g. "/aoi/10/features/{z}/{x}_{y}.bin" */
  urlTemplate: string;
  levels: FeatureTileLevel[];
  lineCount: number;
  waterAreaCount: number;
}

export interface LandcoverTileLevel {
  z: number;
  tilesX: number;
  tilesY: number;
  present: string;
}

/**
 * ESA WorldCover 10 m (2021, v200) resampled onto the terrain grid as one
 * class byte per cell (0 = nodata), tiled like the terrain (tileSize×tileSize
 * cells, no border) at the leaf level and one coarser level. Used for
 * vegetation instancing; classes follow the WorldCover legend (10 tree cover,
 * 20 shrubland, 30 grassland, 40 cropland, 50 built-up, 60 bare, 70 snow,
 * 80 water, 90 wetland, 95 mangroves, 100 moss).
 */
export interface LandcoverTilePyramid {
  urlTemplate: string;
  levels: LandcoverTileLevel[];
  attribution: string;
  /** Fraction of in-bbox cells per class at the leaf level (for the legend). */
  classShare: Record<string, number>;
}

export interface AoiManifest {
  aoiId: string;
  /** 2-digit province code, matching the ThaiWater/DOPA registry. */
  provinceCode?: string;
  provinceNameTh?: string;
  bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  utmZone: "32647" | "32648";
  originEasting: number;
  originNorthing: number;
  terrain: {
    url: string;
    width: number;
    height: number;
    cellSizeM: number;
    minZ: number;
    maxZ: number;
    demType: "DSM" | "DTM";
    hillshadeUrl?: string;
    /** Optional native-resolution LOD pyramid; the fields above stay as the overview. */
    tiles?: TerrainTilePyramid;
  };
  /**
   * Building footprints. For large provinces these cover only a core urban
   * subset rather than the full province — `coverage` says which, so the UI
   * can state it instead of implying province-wide coverage.
   */
  buildings: {
    /**
     * Legacy urban-core GeoJSON, extruded on the client. Optional since E8.3:
     * provinces ship `tiles` instead and their `buildings.geojson` is no
     * longer published, so no province manifest carries a `url` any more —
     * only the small demo AOIs built by `buildAoi.ts` do. A consumer must
     * prefer `tiles` and use `url` only when `tiles` is absent.
     */
    url?: string;
    count?: number;
    coverage?: "full-aoi" | "urban-core";
    coverageBbox?: { minLon: number; maxLon: number; minLat: number; maxLat: number };
    /** Whole-province LOD tiles; `url` above is the fallback when this is absent. */
    tiles?: BuildingTilePyramid;
  } | null;
  /** Province outline polygon (GeoJSON, WGS84) for map framing. */
  boundary?: { url: string } | null;
  /** Optional waterway / water body / road LOD tiles. */
  features?: FeatureTilePyramid;
  /** Optional land-cover class tiles (vegetation). */
  landcover?: LandcoverTilePyramid;
  version: string;
}
