import type { HazardLayerDescriptor } from "./hazard-layer.js";

/**
 * Satellite-derived flood extent (GISTDA "flooding_vis" scene, tambon-level
 * polygons). Epistemic class: observed — it is an interpretation of a real
 * satellite image, not a forecast. The upstream features carry no timestamp,
 * so the backend stamps when it retrieved them and when each polygon was
 * first/last seen; the UI must show those, never imply "now".
 */
export interface FloodExtentFeatureProps {
  tambonTh: string | null;
  amphoeTh: string | null;
  provinceTh: string | null;
  provinceCode: string | null;
  /** Flooded area in rai (upstream unit). */
  floodAreaRai: number | null;
  houses: number | null;
  /** Upstream centroid. */
  lat: number | null;
  lon: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface FloodExtentFeature {
  type: "Feature";
  id: string;
  properties: FloodExtentFeatureProps;
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}

export interface FloodExtentResponse {
  layer: HazardLayerDescriptor;
  /** When our backend last pulled the scene successfully. */
  retrievedAt: string | null;
  provinceCode: string;
  features: FloodExtentFeature[];
}

export interface FloodExtentProvinceSummary {
  provinceCode: string;
  provinceTh: string | null;
  tambonCount: number;
  floodAreaRai: number;
  houses: number;
}

export interface FloodExtentSummaryResponse {
  layer: HazardLayerDescriptor;
  retrievedAt: string | null;
  totalFeatures: number;
  provinces: FloodExtentProvinceSummary[];
}

/* ------------------------------------------------------------------------ */
/* E14 — พื้นที่น้ำท่วมที่สังเกตได้จาก Copernicus GFM + ความลึกภาพประกอบ (FwDET) */
/* ------------------------------------------------------------------------ */

/**
 * Magic ของ `field.bin` — u32 little-endian อ่านเป็นตัวอักษร "SFLD".
 * ตัวอ่านที่เห็นค่าอื่นต้องปฏิเสธไฟล์ทันที ไม่ใช่เดาต่อ
 */
export const FLOOD_FIELD_MAGIC = 0x444c4653;

/** รุ่นของ layout ปัจจุบัน — เพิ่มเมื่อ layout ของ cell เปลี่ยน (ตัวอ่านเก่าต้องปฏิเสธรุ่นที่ไม่รู้จัก) */
export const FLOOD_FIELD_VERSION = 1;

/**
 * รหัสคลาสต่อเซลล์ใน `field.bin` (`u8 class`) — web และ etl ต้องใช้ตัวเลขชุดนี้
 * ร่วมกัน ห้ามพิมพ์เลขซ้ำในโค้ดฝั่งใดฝั่งหนึ่ง
 *
 * - `NO_OBSERVATION` (0) — ไม่มีภาพ / nodata ตรงเซลล์นี้ในฉากนั้น (นอกรอยเท้าภาพ):
 *   "ไม่รู้" ไม่ใช่ "แห้ง"
 * - `DRY` (1) — GFM สังเกตแล้วว่าไม่มีน้ำท่วม
 * - `FLOODED` (2) — GFM จำแนกว่าท่วม และมีค่าความลึกภาพประกอบใน `depthCm`
 * - `REFERENCE_WATER` (3) — แหล่งน้ำถาวรตาม `reference_water_mask` (แม่น้ำ อ่างเก็บน้ำ):
 *   ไม่ใช่น้ำท่วม
 * - `EXCLUDED` (4) — GFM ตัดออกเอง (`exclusion_mask`: SAR มองไม่เห็น เช่น เงาภูมิประเทศ
 *   เมืองหนาแน่น): ไม่มีการจำแนก
 * - `FLOODED_DEPTH_NOT_ESTIMATED` (5) — GFM จำแนกว่าท่วม แต่เราไม่ประมาณความลึก
 *   (WorldCover 50 สิ่งปลูกสร้าง / 10 ต้นไม้ — DSM วัดถึงยอดสิ่งปกคลุม): **ไม่ใช่ 0 ม.**
 */
export const FloodFieldClass = {
  NO_OBSERVATION: 0,
  DRY: 1,
  FLOODED: 2,
  REFERENCE_WATER: 3,
  EXCLUDED: 4,
  FLOODED_DEPTH_NOT_ESTIMATED: 5,
} as const;
export type FloodFieldClass = (typeof FloodFieldClass)[keyof typeof FloodFieldClass];

/** ค่า `u16 depthCm` ที่แปลว่า "ไม่มีค่าความลึก" (ทุกคลาสที่ไม่ใช่ `FLOODED`) */
export const FLOOD_FIELD_NO_DEPTH = 0xffff;
/** ค่า `u8 likelihood` ที่แปลว่า "GFM ไม่ได้ให้ค่า" (เซลล์ที่ไม่ได้จำแนก) */
export const FLOOD_FIELD_NO_LIKELIHOOD = 255;

/**
 * Layout ของ `aoi/{code}/flood/{sceneId}/field.bin` (รุ่น 1) — ทุกค่า little-endian:
 *
 * ```
 * offset  size  field
 * 0       u32   magic = 0x444C4653 ("SFLD")          → FLOOD_FIELD_MAGIC
 * 4       u16   version = 1                          → FLOOD_FIELD_VERSION
 * 6       u16   width   (เซลล์ต่อแถว)
 * 8       u16   height  (จำนวนแถว)
 * 10      —     width × height เซลล์ ต่อเซลล์ 4 ไบต์:
 *               u8  class       → FloodFieldClass
 *               u16 depthCm     0..1000 เมื่อ class = FLOODED, ไม่งั้น 0xFFFF (ไม่มีค่า)
 *               u8  likelihood  0..100 = GFM `ensemble_likelihood` ของเซลล์นั้น,
 *                               255 = ไม่มีค่า
 * ```
 *
 * ตารางคือ overview grid ของ `manifest.terrain` ของจังหวัดนั้น (ตัวเดียวกับที่
 * `apps/web/src/scene/floodMask.ts` / `uFloodMask` sample อยู่แล้ว) เรียงแถว
 * **จากล่างขึ้นบน** ตามลำดับของ `THREE.DataTexture` — แถวแรกในไฟล์คือขอบใต้
 * ของจังหวัด ไฟล์ถูก gzip ไว้ที่ R2 และส่งด้วย `Content-Encoding: gzip`
 *
 * `likelihood` คือ **ความเชื่อมั่นของการจำแนกภาพ** ของ ensemble ของ GFM (สาม
 * อัลกอริทึมเห็นตรงกันแค่ไหน) ไม่ใช่ความน่าจะเป็นที่น้ำจะท่วม — UI ต้องเรียกมัน
 * ตามนั้น และห้ามแปลงเป็น "%" ของอะไรที่ยังไม่เกิด
 */
export const FLOOD_FIELD_HEADER_BYTES = 10;
/** ไบต์ต่อเซลล์ (u8 class + u16 depthCm + u8 likelihood) */
export const FLOOD_FIELD_CELL_BYTES = 4;

/** หนึ่งฉาก = หนึ่งรอบโคจรของ Sentinel-1 เหนือจังหวัดนั้น — ฉากที่แห้งก็เป็นข้อมูล */
export interface FloodSceneIndexEntry {
  /**
   * `"20260824T232439-AS020M"` — เวลาบันทึกภาพของ S1 (UTC) + กลุ่มไทล์ Equi7
   * ที่มา: ไบต์ของฉากไม่มีวันเปลี่ยน (ทั้ง sceneId จึงเป็น URL แบบ immutable ได้)
   */
  sceneId: string;
  /** เวลาบันทึกภาพของ Sentinel-1 (ISO) — คือ `observedAt` ของชั้น observed */
  observedAt: string;
  /** STAC item `created` — เวลาที่ GFM เผยแพร่ผล; null เมื่อ item ไม่มีฟิลด์นี้ */
  publishedAt: string | null;
  orbit: "ascending" | "descending" | null;
  /** นับบน overview grid ของจังหวัด (ไม่ใช่บน 20 ม. ของ GFM) */
  floodedCells: number;
  excludedCells: number;
  /** เซลล์ที่อยู่ในรอยเท้าภาพและได้รับการจำแนก (class ≠ NO_OBSERVATION) */
  observedCells: number;
  floodedAreaKm2: number;
  /** null เมื่อไม่มีเซลล์ใดได้ค่าความลึก (ฉากแห้ง หรือท่วมเฉพาะบริเวณที่ไม่ประมาณ) */
  maxDepthCm: number | null;
  medianDepthCm: number | null;
  /** สัดส่วนเซลล์ท่วมที่มีค่าความลึก (0–1) — ที่เหลือคือ FLOODED_DEPTH_NOT_ESTIMATED */
  depthEstimatedFraction: number;
  /** STAC item id ทุกใบที่ประกอบเป็นฉากนี้ — ที่มาย้อนกลับไปถึงต้นทาง */
  gfmItemIds: string[];
}

/**
 * `aoi/{code}/flood/index.json` — รายการฉากทั้งหมดของจังหวัด (ใหม่สุดก่อน) คือ
 * "ตัวลิสต์" ตัวเดียว: ไม่มีใครเรียก R2 `list()` เพื่อหาฉาก
 */
export interface FloodSceneIndex {
  provinceCode: string;
  grid: {
    width: number;
    height: number;
    cellSizeM: number;
    originEasting: number;
    originNorthing: number;
    utmZone: "32647" | "32648";
  };
  /**
   * สองชั้น สองชนิด: `extent` = observed (GFM), `depth` = illustrative (FwDET) —
   * ความลึกไม่ถูกแสดงโดยไม่มีฉาก extent ที่มันคำนวณมาจาก
   */
  layers: { extent: HazardLayerDescriptor; depth: HazardLayerDescriptor };
  /** เวลาที่ index นี้ถูกเขียนโดย job ของ GitHub Actions (F3) */
  generatedAt: string;
  /** ใหม่สุดก่อน; จำกัดราว 1,500 รายการ (≈ 12 ปี × 2 วงโคจร × ~30 รอบ/ปี) */
  scenes: FloodSceneIndexEntry[];
}

/** `aoi/{code}/flood/{sceneId}/meta.json` — รายการเดียวกับใน index + วิธีคำนวณที่ใช้จริง */
export interface FloodSceneMeta extends FloodSceneIndexEntry {
  methodology: {
    name: "FwDET-2";
    /** median ของความสูงขอบน้ำตามแนวขอบ กว้าง 3 เซลล์ (ลด noise ของ DSM) */
    boundarySmoothingCells: 3;
    /** ความลึกถูกตัดที่ 10 ม. — ค่าที่เกินคือขอบที่ผิด ไม่ใช่น้ำที่ลึกจริง */
    depthCapCm: 1000;
    /** คลาส WorldCover ที่ไม่ประมาณความลึก: 50 สิ่งปลูกสร้าง, 10 ต้นไม้ */
    maskedClasses: [50, 10];
  };
}
