import type { HazardLayerDescriptor } from "./hazard-layer.js";

/**
 * Satellite-derived flood extent from GISTDA (E16.PR0: the API-gateway feed
 * `api/2.0/resources/features/flood/{window}` — the old open WFS answers 401
 * since 2026-09-10). Epistemic class: observed — GISTDA's interpretation of
 * real SAR scenes, never a forecast.
 *
 * Each feature is **one H3 resolution-9 cell** (~0.1 km²) holding the part of
 * the cell GISTDA classified as flooded. Unlike the WFS scene, every cell now
 * names the satellite passes it was derived from (`file_name`), so a cell has a
 * real `observedAt`; `firstSeenAt` is still our own stamp (the first successful
 * pull that contained the cell) and is labelled as such in the UI.
 */

/** One satellite pass named in a cell's `file_name` (`sensor_YYYYMMDD_HHMM`). */
export interface FloodAcquisition {
  /**
   * Sensor code exactly as GISTDA publishes it — `S1C`/`S1D` (Sentinel-1C/1D),
   * `rd2` (RADARSAT-2), … Unknown codes are passed through, never guessed.
   */
  sensor: string;
  /**
   * Acquisition instant (ISO, UTC). The upstream stamp carries no zone; it is
   * read as Asia/Bangkok (+07:00) — see `GISTDA_FILE_NAME_TZ` in
   * `apps/api/src/ingestion/gistda.ts` for the evidence.
   */
  acquiredAt: string;
}

export interface FloodExtentFeatureProps {
  /** H3 res-9 cell id (`h3_address`); null only for legacy WFS scenes (tambon polygons). */
  h3: string | null;
  provinceCode: string | null;
  provinceTh: string | null;
  amphoeCode: string | null;
  amphoeTh: string | null;
  tambonCode: string | null;
  tambonTh: string | null;
  /** Flooded area inside this feature, m² (upstream `f_area`; legacy: rai × 1600). */
  floodAreaM2: number | null;
  /** Passes this cell was derived from, newest first; [] when upstream named none (legacy). */
  acquisitions: FloodAcquisition[];
  /** Newest of `acquisitions` — when the flooding was observed; null when unknown. */
  observedAt: string | null;
  /** GISTDA's record creation time (`_createdAt`) — when upstream published the cell; null when absent. */
  publishedAt: string | null;
  /**
   * The first successful pull by *our* backend that contained this cell —
   * carried forward refresh to refresh. Null for a legacy WFS scene, whose
   * archive never recorded it (inventing one from the scene time would be a
   * claim we cannot back).
   */
  firstSeenAt: string | null;
}

export interface FloodExtentFeature {
  type: "Feature";
  id: string;
  properties: FloodExtentFeatureProps;
  /**
   * WGS84 lon/lat rounded to `FLOOD_EXTENT_COORD_DECIMALS`. A cell whose only
   * sliver collapses under that rounding keeps an **empty** MultiPolygon
   * (`coordinates: []`) so cell counts and `floodAreaM2` still match upstream.
   */
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}

/**
 * Decimal places kept on every flood-extent coordinate (≈ 11 m at this
 * latitude; GISTDA's raster edge is ~25 m). Five decimals measured 5.17 MB
 * gzip for one nationwide refresh on 2026-09-26 (45,549 cells) — over the
 * 5 MB archive budget — four measured 4.30 MB.
 */
export const FLOOD_EXTENT_COORD_DECIMALS = 4;

/**
 * Which upstream shape answered: `h3-cell` = the GISTDA API (E16.PR0),
 * `tambon` = a legacy WFS scene archived before the cutover (`?at=` only).
 */
export type FloodExtentGranularity = "h3-cell" | "tambon";

export interface FloodExtentResponse {
  layer: HazardLayerDescriptor;
  /**
   * When our backend pulled the answer for this province. Live: the latest
   * successful pull of this province. With `?at=`: the pull whose content
   * covered `at` — null when nothing was archived for that instant (see `reason`)
   * or, live, when no pull has ever succeeded.
   */
  retrievedAt: string | null;
  provinceCode: string;
  granularity: FloodExtentGranularity;
  /**
   * Upstream `numberMatched` for this province in the pulled window; null when
   * unknown (legacy scene, or never fetched). `0` with a non-null `retrievedAt`
   * means GISTDA *was asked and answered with no flooded cell* — satellite
   * detection, not "no flooding" (SAR misses water in dense built-up areas).
   */
  matched: number | null;
  /** Union of every feature's `acquisitions`, newest first. */
  acquisitions: FloodAcquisition[];
  /** Newest acquisition among the features (= `layer.observedAt`); null when none. */
  observedAt: string | null;
  features: FloodExtentFeature[];
  /**
   * Set only on a historical request (`?at=`) that could not be answered: the
   * DO started recording scenes after `at`, so nothing was archived for that
   * instant. `features` is empty **because nothing was observed**, not because
   * nothing was flooded — the UI must never phrase this as "no flooding".
   */
  reason?: "no-archived-scene";
}

export interface FloodExtentProvinceSummary {
  provinceCode: string;
  provinceTh: string | null;
  /** Upstream `numberMatched` — H3 cells flagged flooded in this province. */
  cellCount: number;
  tambonCount: number;
  floodAreaM2: number;
  /** Newest acquisition among this province's cells; null with no cells. */
  observedAt: string | null;
  /** Last successful pull of this province — may lag the nationwide one when a province failed. */
  retrievedAt: string;
}

export interface FloodExtentSummaryResponse {
  layer: HazardLayerDescriptor;
  retrievedAt: string | null;
  /** Upstream window every province was pulled from (e.g. `"3days"`). */
  window: string;
  /** Sum of `cellCount` over `provinces`. */
  totalFeatures: number;
  /** Every province pulled at least once, largest flooded area first (0-cell provinces included). */
  provinces: FloodExtentProvinceSummary[];
  /** Provinces whose latest pull failed — their row (if any) is from an older pull. */
  failedProvinces: string[];
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
  /**
   * ขนาดไบต์ของ `field.bin` หลัง gzip ตามที่เขียนลง R2 — ตัวเลขจริงสำหรับคิดต้นทุน
   * storage ของการ backfill (E14.F6) แทนการประมาณ (devops constraint ของ F2)
   */
  fieldBytesGz: number;
  methodology: {
    name: "FwDET-2";
    /** median ของความสูงขอบน้ำตามแนวขอบ กว้าง 3 เซลล์ (ลด noise ของ DSM) */
    boundarySmoothingCells: 3;
    /** ความลึกถูกตัดที่ 10 ม. — ค่าที่เกินคือขอบที่ผิด ไม่ใช่น้ำที่ลึกจริง */
    depthCapCm: 1000;
    /** คลาส WorldCover ที่ไม่ประมาณความลึก: 50 สิ่งปลูกสร้าง, 10 ต้นไม้ */
    maskedClasses: [50, 10];
  };
  /**
   * `{ gfmItemId: [assetKey…] }` — item ของ GFM ในฉากนี้ที่ต้นทางไม่ให้ asset ตัวเลือกครบ
   * (`exclusion_mask` / `ensemble_likelihood`; วัดจริงบน STAC 2026-09-02: ใน 100 item ล่าสุด
   * เหนือไทย มี 2 ใบขาดอย่างละตัว) เฉพาะ item ที่ขาด — ไม่มีคีย์นี้ = ทุก item มีครบ
   *
   * สำหรับผู้อ่าน: item ที่ **ไม่มี `exclusion_mask`** แปลว่าพื้นที่ที่ SAR มองไม่เห็นในเฟรมนั้น
   * (เงาภูมิประเทศ เมืองหนาแน่น) **ไม่ได้ถูกทำเครื่องหมาย** `EXCLUDED` (ยกเว้นเซลล์ขอบที่ item
   * ข้างเคียงในฉากเดียวกันให้ค่าไว้) — เซลล์ `DRY` ในรอยเท้าของเฟรมนั้นจึงแน่นอนน้อยกว่าปกติ: อาจเป็น "มองไม่เห็น" ไม่ใช่ "ไม่มีน้ำ" ส่วน item ที่ไม่มี
   * `ensemble_likelihood` ให้ `likelihood = 255` (ไม่มีค่า) ในเซลล์ของมัน ไม่ใช่ตัวเลขที่แต่งขึ้น
   */
  missingAssets?: Record<string, string[]>;
}
