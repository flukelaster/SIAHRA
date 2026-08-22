import type { SourceId } from "./sources.js";

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

/**
 * ชั้นข้อมูลใน AOI ที่มี "artefact ของตัวเอง" ให้บันทึกที่มาได้ (E9.1)
 *
 * `imagery` ไม่อยู่ในรายการนี้โดยตั้งใจ: ภาพดาวเทียม (Esri / EOX) เป็น tile
 * service ที่ client ดึงสดรายไทล์ ไม่มี artefact ในชุดข้อมูลให้จดเวลา — การใส่
 * เวลาให้มันจึงเป็นการอ้างเวลาที่ไม่มีอยู่จริง (ดู docs/dataset.md)
 */
export type AoiProvenanceLayer = "terrain" | "roads" | "water" | "buildings" | "trees";

/**
 * ที่มาของ artefact หนึ่งชั้น
 *
 * `builtAt` กับ `publishedAt` เป็นคนละเวลา และห้ามใช้แทนกัน:
 * - builtAt      = ไปป์ไลน์นี้ผลิต artefact ของชั้นนั้นเสร็จเมื่อไหร่
 * - publishedAt  = ต้นทางประกาศว่าข้อมูลชุดนั้นเผยแพร่เมื่อไหร่ มีเฉพาะแหล่งที่
 *                  บอกเวลาไว้จริง (เช่น `osmosis_replication_timestamp` ในหัวไฟล์
 *                  OSM pbf) — แหล่งที่บอกแค่ "ยุค" ของผลิตภัณฑ์ เช่น
 *                  "WorldCover 2021" หรือ Copernicus DEM ไม่มีฟิลด์นี้ เพราะการ
 *                  ขยายปีเป็น `2021-01-01T00:00:00Z` คือการสร้างความละเอียดที่
 *                  ต้นทางไม่เคยบอก
 *
 * ทั้งคู่หายไปได้ และ "หายไป" ดีกว่า "เดา" เสมอ — ไม่รู้เวลาก็ไม่ต้องมี entry
 */
export interface AoiLayerProvenance {
  /** ISO 8601 UTC — ไม่มีเมื่อไม่รู้จริง ๆ (ไม่มี entry เลย ไม่ใช่ค่าเดา) */
  builtAt: string;
  /** ISO 8601 UTC เฉพาะแหล่งที่ประกาศเวลาเผยแพร่ไว้เอง */
  publishedAt?: string;
  sourceIds: SourceId[];
}

/**
 * ที่มาของชุดข้อมูลทั้ง AOI (E9.1) — ทั้งก้อนเป็น optional บน `AoiManifest`
 * เพื่อให้ manifest รุ่นก่อนหน้ายังใช้ได้ตลอดไป
 *
 * `generatedAt` ไม่ใช่ `builtAt`: manifest อาจถูกเขียนใหม่วันนี้ทับ artefact ที่
 * สร้างไว้เมื่อสามวันก่อน ความต่างนี้คือเหตุผลทั้งหมดที่ต้องมี provenance รายชั้น
 */
export interface AoiProvenance {
  /**
   * รหัสรุ่นของชุดข้อมูล และเป็น segment `v/{ver}` ใน `urlTemplate` ของ tile ทุก
   * pyramid ตั้งแต่ E9.2 — รูปแบบ `YYYY-MM-DD` (หรือ `YYYY-MM-DD.N`) ที่คนตั้งเอง
   * ตอนปล่อยรุ่น ห้าม derive จาก `version` ด้านล่าง
   *
   * กฎเดียวที่ต้องถือ: **ไบต์ใต้ `aoi/{code}/v/{ver}/` เปลี่ยนเมื่อไหร่ ค่านี้ต้อง
   * เปลี่ยนด้วย** เพราะ tile ถูกส่งด้วย `immutable, max-age=1y` การชี้ชุดข้อมูลใหม่
   * ไปที่รุ่นเดิมคือการล็อกคำตอบที่ผิดไว้หนึ่งปี — `apps/etl/src/datasetVersion.ts`
   * เป็นคนบังคับ (`refresh:manifests` หยุดถ้า `builtAt`/`checksums` เปลี่ยนแต่รุ่น
   * ยังชื่อเดิม) และ `apps/web/worker/tilePath.ts` เป็นคนเสิร์ฟ
   */
  datasetVersion: string;
  /** เวลาที่ไฟล์ manifest นี้ถูกเขียน — ช้ากว่า builtAt ทุกตัวได้เป็นเรื่องปกติ */
  generatedAt: string;
  /** ชั้นที่ไม่มี artefact ให้จดเวลา จะ **ไม่มีคีย์** ไม่ใช่มีคีย์ค่าว่าง */
  sources: Partial<Record<AoiProvenanceLayer, AoiLayerProvenance>>;
  /** sha256 (hex) ต่อไฟล์ คีย์เป็น path เทียบกับโฟลเดอร์ AOI เช่น "terrain.bin" */
  checksums: Record<string, string>;
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
  /**
   * Local-authority (อปท.) boundary polygons OSM has actually mapped for this
   * province (E11.2) — same shape as `boundary`, a small static GeoJSON, not a
   * tile pyramid. Absent (not `null`) means this province had zero matched
   * OSM `admin_level=7` relations; "no artefact = no entry", same rule
   * `apps/etl/src/provenance.ts` states for other layers. Coverage is
   * genuinely partial — see `apps/etl/data/sources/osm-admin/COVERAGE.md`.
   */
  localAuthorities?: { url: string } | null;
  /** Optional waterway / water body / road LOD tiles. */
  features?: FeatureTilePyramid;
  /** Optional land-cover class tiles (vegetation). */
  landcover?: LandcoverTilePyramid;
  version: string;
  /**
   * ที่มาของชุดข้อมูล (E9.1) — optional ตลอดไป: manifest ที่สร้างก่อนงานนี้ไม่มี
   * ฟิลด์นี้ และฝั่ง client ต้องทำงานได้เหมือนเดิมทุกประการเมื่อมันหายไป
   */
  provenance?: AoiProvenance;
}
