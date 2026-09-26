/**
 * แผ่นน้ำจำลองจากระดับน้ำที่สถานี — ขั้นที่ 2: ละเอียดบนไทล์ภูมิประเทศ 30 ม. (E16 B-1 รอบ 3,
 * การตัดสินใจของผู้ใช้ข้อ 2) ตรรกะล้วน รันใน `workers/stationSheet.worker.ts` เท่านั้น
 * (ไฟล์นี้ **ห้าม import three** และห้ามถูก import จาก main thread — ต้องอยู่ในก้อน worker)
 *
 * ## ลำดับ
 *
 * 1. การเติมบนกริด overview (`fillStationSheet`) — ขั้นที่ 1 เดิม แสดงผลทันที
 * 2. วางแผนไทล์ 30 ม. จากรอยเท้าของขั้นที่ 1 (`stationLeafNeeds` + `planLeafFetches`)
 * 3. เมื่อไทล์ครบ: เติมใหม่บนกริด 30 ม. ต่อสถานีที่ได้ไทล์ครบ (`fillLeafWindows`) — ไทล์ละ
 *    หนึ่ง "หน้าต่าง" ที่แทนแผ่น overview ในพื้นที่ของมันพอดี
 * 4. เซลล์ที่ WorldCover บอกว่าเป็นอาคาร (50) / ต้นไม้ (10) = ท่วมแต่ **ไม่ได้ประมาณความลึก**
 *    (DSM วัดหลังคา/ยอดไม้ ไม่ใช่พื้น) — แบบเดียวกับ FLOODED_DEPTH_NOT_ESTIMATED ของ GFM FwDET
 * 5. เซลล์ที่ฉาก GFM ที่แสดงอยู่ *สังเกตแล้ว* (ท่วม / ท่วมแต่ไม่ได้ประมาณ / แห้ง) ถูกลบออกจากแผ่น
 *    (`applyObservedPrecedence`) — ดาวเทียมที่เห็นจริงมาก่อนแบบจำลองเสมอ
 *
 * ## ข้อจำกัดต้นทุน (devops, งานแผ่นน้ำ 30 ม. — คนละชุดกับ C1–C5 ของ `lib/pollSchedule.ts`)
 *
 * - C1 `SHEET_LEAF_MAX_REQUESTS` = 48 คำขอ (ภูมิประเทศ + สิ่งปกคลุมดินรวมกัน) ต่อจังหวัดตลอดอายุ
 *   ของชั้น นับทุกงาน (รีเฟรช 5 นาที/เลื่อนเส้นเวลา) — ตัวนับอยู่ใน worker
 * - C2 ขอเฉพาะไทล์ leaf ที่ตัดกับเซลล์ที่ขั้นที่ 1 เติม (ขยาย 1 เซลล์ overview) — ไม่มีรอยเท้า = 0 ไทล์
 * - C3 งบหมด = สถานีที่เหลืออยู่บนกริด overview และ legend/popup บอกความละเอียดต่อสถานี
 * - C4 ไทล์ที่บิต `present` เป็น 0 ไม่ถูกขอเลย
 * - C5 URL มาจาก `tileUrl()` ตัวเดียวกับตัววาด (`lib/tileCodec.ts`)
 *
 * ## พิกัด
 *
 * ทุกอย่างวัดเป็นเมตรจาก **มุมบนซ้ายของ raster overview** (x ไปตะวันออก, y ไปใต้) — เซลล์ overview
 * 83–102 ม. ไม่ใช่พหุคูณของ 30 ม. จึงห้ามแปลงด้วยอัตราส่วนดัชนี; pyramid ของไทล์มีจุดกำเนิดของ
 * ตัวเอง (`offsetXM/offsetYM` เทียบกับ raster overview — ปกติเป็น 0)
 */
import type { LandcoverTilePyramid, TerrainTilePyramid } from "@siahra/shared-types";
import {
  floodFromStation,
  floodScratch,
  SHEET_DEPTH_CAP_M,
  SHEET_FADE_SCALE,
  SHEET_MAX_RADIUS_M,
  SHEET_NONE,
  SHEET_SEED_SEARCH_M,
  type SheetStation,
} from "./stationSheet";
import { decodePresentBits, presentBit, terrainTileSpan, tileUrl } from "./tileCodec";

/** C1 — เพดานคำขอไทล์ (ภูมิประเทศ + สิ่งปกคลุมดิน) ต่อจังหวัดตลอดอายุของ `StationSheetLayer` */
export const SHEET_LEAF_MAX_REQUESTS = 48;
/** C6 — คำขอพร้อมกันไม่เกินนี้ (เท่ากับ `MAX_TERRAIN_LOADS` ของตัววาดภูมิประเทศ) */
export const SHEET_LEAF_MAX_CONCURRENT = 6;
/** WorldCover v200: ต้นไม้ปกคลุม — DSM วัดยอดไม้ */
export const WORLDCOVER_TREE = 10;
/** WorldCover v200: สิ่งปลูกสร้าง — DSM วัดหลังคา */
export const WORLDCOVER_BUILT = 50;

export interface LeafSpec {
  overview: { width: number; height: number; cellSizeM: number };
  terrain: {
    z: number;
    urlTemplate: string;
    tileSize: number;
    border: number;
    nodata: number;
    cellSizeM: number;
    tilesX: number;
    tilesY: number;
    present: Uint8Array;
  };
  /** มุมบนซ้ายของ pyramid เทียบกับมุมบนซ้ายของ raster overview (ม., x ตะวันออก / y ใต้) */
  offsetXM: number;
  offsetYM: number;
  /** มาสก์อาคาร/ต้นไม้ — null = manifest ไม่มี landcover (ไม่มีการทำเครื่องหมาย "ไม่ได้ประมาณ") */
  landcover: {
    z: number;
    urlTemplate: string;
    cellSizeM: number;
    tilesX: number;
    tilesY: number;
    present: Uint8Array;
    /** เซลล์ leaf ต่อเซลล์ landcover ตามแกน (1 = 30 ม., 2 = 60 ม.) */
    factor: number;
  } | null;
}

export interface LeafSpecInput {
  overview: { width: number; height: number; cellSizeM: number };
  originEasting: number;
  originNorthing: number;
  tiles: TerrainTilePyramid | undefined;
  landcover: LandcoverTilePyramid | undefined;
}

/**
 * ประกอบ `LeafSpec` จาก manifest — `null` เมื่อจังหวัดไม่มี pyramid 30 ม. (แผ่นอยู่บน overview ทั้งหมด)
 *
 * มาสก์อาคาร/ต้นไม้ใช้ landcover ระดับ **หยาบกว่า leaf หนึ่งขั้น** ถ้ามี (60 ม. ในชุดข้อมูลปัจจุบัน:
 * ไทล์เดียวครอบ 2×2 ไทล์ภูมิประเทศ ประหยัดงบคำขอ — ข้อเสนอของ devops) ไม่งั้นระดับ leaf
 * ขนาดเซลล์ของมาสก์มาจาก manifest และ legend แสดงตัวเลขนั้น
 */
export function buildLeafSpec(input: LeafSpecInput): LeafSpec | null {
  const tiles = input.tiles;
  if (!tiles || tiles.levels.length === 0) return null;
  const leafZ = tiles.levels.length - 1;
  const leaf = tiles.levels[leafZ];
  const { overview } = input;
  const rasterTop = input.originNorthing + overview.height * overview.cellSizeM;
  let landcover: LeafSpec["landcover"] = null;
  const lc = input.landcover;
  if (lc) {
    const pick = lc.levels.find((l) => l.z === leafZ - 1) ?? lc.levels.find((l) => l.z === leafZ);
    const cellSizeM = pick ? tiles.levels[pick.z]?.cellSizeM : undefined;
    const factor = cellSizeM !== undefined ? Math.round(cellSizeM / leaf.cellSizeM) : 0;
    if (pick && cellSizeM !== undefined && factor >= 1 && Math.abs(factor * leaf.cellSizeM - cellSizeM) < 1e-6) {
      landcover = {
        z: pick.z,
        urlTemplate: lc.urlTemplate,
        cellSizeM,
        tilesX: pick.tilesX,
        tilesY: pick.tilesY,
        present: decodePresentBits(pick.present),
        factor,
      };
    }
  }
  return {
    overview,
    terrain: {
      z: leaf.z,
      urlTemplate: tiles.urlTemplate,
      tileSize: tiles.tileSize,
      border: tiles.border,
      nodata: tiles.nodata,
      cellSizeM: leaf.cellSizeM,
      tilesX: leaf.tilesX,
      tilesY: leaf.tilesY,
      present: decodePresentBits(leaf.present),
    },
    offsetXM: tiles.originEasting - input.originEasting,
    offsetYM: rasterTop - tiles.originNorthing,
    landcover,
  };
}

/** คีย์ของไทล์ในเซตที่ขอแล้ว/ค้างอยู่ (C6) — แยกชนิดเพราะ z ของสองชุดซ้ำกันได้ */
export const terrainKey = (z: number, x: number, y: number) => `t/${z}/${x}/${y}`;
export const landcoverKey = (z: number, x: number, y: number) => `l/${z}/${x}/${y}`;

export interface LeafRequest {
  key: string;
  url: string;
}

/** URL ของคีย์ — `tileUrl()` ตัวเดียวกับตัววาด (C5) */
export function leafRequestFor(spec: LeafSpec, key: string): LeafRequest {
  const [kind, z, x, y] = key.split("/");
  const template = kind === "t" ? spec.terrain.urlTemplate : spec.landcover!.urlTemplate;
  return { key, url: tileUrl(template, Number(z), Number(x), Number(y)) };
}

export interface StationLeafNeeds {
  /** ดัชนีไทล์ภูมิประเทศ leaf (y·tilesX + x) ที่มีอยู่จริง (`present`) เรียงจากน้อยไปมาก */
  terrain: number[];
  /** คีย์ทั้งหมดที่ต้องมีครบก่อนละเอียดได้: ภูมิประเทศ + landcover ที่ครอบ (เฉพาะที่ `present`) */
  keys: string[];
}

/**
 * C2 + C4 — ไทล์ที่สถานีหนึ่งต้องใช้: ไทล์ leaf ทุกใบที่ตัดกับเซลล์ overview ที่สถานีเติม
 * **ขยายออกหนึ่งเซลล์** (รอยเท้า 3×3 เซลล์ต่อเซลล์) และบิต `present` เป็น 1 เท่านั้น
 * `cells` ว่าง = ไม่ขออะไรเลย
 */
export function stationLeafNeeds(spec: LeafSpec, cells: ArrayLike<number>): StationLeafNeeds {
  const { overview, terrain: t } = spec;
  if (cells.length === 0) return { terrain: [], keys: [] };
  const tileM = t.tileSize * t.cellSizeM;
  const marks = new Uint8Array(t.tilesX * t.tilesY);
  const cO = overview.cellSizeM;
  // ขอบบนที่ปิด: เซลล์ที่ขยายแล้วคือ [(c−1)·cO, (c+2)·cO) — ลบ epsilon ให้ขอบขวา/ล่างไม่ล้นไปไทล์ถัดไป
  const eps = 1e-6;
  for (let k = 0; k < cells.length; k++) {
    const i = cells[k];
    const c = i % overview.width;
    const r = (i - c) / overview.width;
    const x0 = Math.floor(((c - 1) * cO - spec.offsetXM) / tileM);
    const x1 = Math.floor(((c + 2) * cO - spec.offsetXM - eps) / tileM);
    const y0 = Math.floor(((r - 1) * cO - spec.offsetYM) / tileM);
    const y1 = Math.floor(((r + 2) * cO - spec.offsetYM - eps) / tileM);
    for (let ty = Math.max(0, y0); ty <= Math.min(t.tilesY - 1, y1); ty++) {
      for (let tx = Math.max(0, x0); tx <= Math.min(t.tilesX - 1, x1); tx++) marks[ty * t.tilesX + tx] = 1;
    }
  }
  const terrain: number[] = [];
  const keys: string[] = [];
  const lcSeen = new Set<string>();
  for (let idx = 0; idx < marks.length; idx++) {
    if (!marks[idx]) continue;
    const tx = idx % t.tilesX;
    const ty = (idx - tx) / t.tilesX;
    if (!presentBit(t.present, t.tilesX, t.tilesY, tx, ty)) continue; // C4
    terrain.push(idx);
    keys.push(terrainKey(t.z, tx, ty));
    const lc = spec.landcover;
    if (lc) {
      // ไทล์ landcover ที่ครอบไทล์ภูมิประเทศนี้ (factor 2 = พ่อของมันใน quadtree)
      const lx = Math.floor(tx / lc.factor);
      const ly = Math.floor(ty / lc.factor);
      const key = landcoverKey(lc.z, lx, ly);
      if (!lcSeen.has(key) && presentBit(lc.present, lc.tilesX, lc.tilesY, lx, ly)) {
        lcSeen.add(key);
        keys.push(key);
      }
    }
  }
  return { terrain, keys };
}

export type LeafPlanStatus = "planned" | "budget" | "none";

export interface LeafPlanStation {
  keys: readonly string[];
  /** สถานีที่สำคัญกว่าได้งบก่อน — ใช้ระยะที่น้ำเกินตลิ่ง (ม.) */
  priority: number;
}

export interface LeafPlan {
  /** คีย์ใหม่ที่ต้องขอ (ไม่อยู่ใน `known`) ตามลำดับความสำคัญ — ความยาว ≤ งบที่เหลือเสมอ */
  fetch: string[];
  /** ต่อสถานี: planned = ไทล์ครบหรือกำลังจะครบ, budget = งบไม่พอ (C3), none = ไม่มีไทล์ให้ขอ */
  status: LeafPlanStatus[];
}

/**
 * C1 + C6 — แบ่งงบคำขอแบบ "ทั้งหมดหรือไม่เลย" ต่อสถานี ตามลำดับความสำคัญ: ไทล์ที่ขอแล้ว/ค้างอยู่
 * (`known`) ไม่เสียงบ สถานีที่ไทล์ใหม่ของมันเกินงบที่เหลือถูกข้าม (ยังอยู่บน overview) แต่สถานีถัดไป
 * ที่เล็กกว่าอาจยังพอ — ผลรวม `issued + fetch.length` ไม่มีทางเกิน `max`
 */
export function planLeafFetches(
  stations: readonly LeafPlanStation[],
  known: ReadonlySet<string>,
  issued: number,
  max: number = SHEET_LEAF_MAX_REQUESTS,
): LeafPlan {
  const order = stations
    .map((s, k) => ({ s, k }))
    .sort((a, b) => b.s.priority - a.s.priority || a.k - b.k);
  const status: LeafPlanStatus[] = stations.map(() => "none");
  const planned = new Set<string>();
  const fetch: string[] = [];
  for (const { s, k } of order) {
    if (s.keys.length === 0) continue;
    const fresh = s.keys.filter((key) => !known.has(key) && !planned.has(key));
    if (issued + fetch.length + fresh.length > max) {
      status[k] = "budget";
      continue;
    }
    for (const key of fresh) {
      planned.add(key);
      fetch.push(key);
    }
    status[k] = "planned";
  }
  return { fetch, status };
}

/** ไทล์ที่ถอดแล้วใน worker: ดัชนีไทล์ (y·tilesX + x) → ข้อมูล */
export interface LeafTiles {
  terrain: ReadonlyMap<number, Int16Array>;
  /** ดัชนีไทล์ landcover (ly·lc.tilesX + lx) → คลาสต่อเซลล์ */
  landcover: ReadonlyMap<number, Uint8Array>;
}

/**
 * หน้าต่าง 30 ม. หนึ่งใบ = ไทล์ภูมิประเทศหนึ่งใบ: (tileSize + 1)² จุดยอด ที่ศูนย์กลางเซลล์ leaf
 * `tx·T … tx·T + T` — จุดยอดสุดท้ายคือจุดแรกของไทล์ถัดไป (ขอบร่วม) หน้าต่างที่ติดกันจึงต่อกัน
 * พอดีโดยไม่ซ้อนกัน แถว 0 = เหนือ
 */
export interface SheetWindow {
  tx: number;
  ty: number;
  size: number;
  /** ความสูงพื้น (ม., เมตรเต็มจากไทล์ Int16) — nodata = 0 */
  heights: Float32Array;
  depthCm: Uint16Array;
  station: Uint16Array;
  fadePct: Uint8Array;
  /** 1 = ท่วมแต่ไม่ได้ประมาณความลึก (อาคาร/ต้นไม้ตาม WorldCover) */
  notEst: Uint8Array;
  filledCells: number;
}

export interface LeafFillInput {
  spec: LeafSpec;
  tiles: LeafTiles;
  /** ไทล์ที่เป็นหน้าต่าง (ทุกใบต้องอยู่ใน `tiles.terrain`) */
  windowTiles: readonly number[];
  /** สถานีของงาน (ตำแหน่งบนกริด overview) — ดัชนีเดียวกับผลขั้นที่ 1 */
  stations: readonly SheetStation[];
  /** สถานีที่เติมบน 30 ม. */
  refined: readonly boolean[];
  /** ผลขั้นที่ 1 (ยังไม่ถูกมาสก์ด้วย GFM) — สถานีที่ไม่ละเอียดถูกสุ่มลงหน้าต่างจากตรงนี้ */
  overview: { station: Uint16Array; fadePct: Uint8Array };
  /** มาสก์จังหวัดบนกริด overview (null = ไม่มี) */
  insideMask: Uint8Array | null;
}

/** ตำแหน่งสถานีบนกริด overview → กริด leaf ทั้งจังหวัด (หน่วยเซลล์ leaf) */
export function overviewToLeaf(spec: LeafSpec, col: number, row: number): [number, number] {
  const cO = spec.overview.cellSizeM;
  const c30 = spec.terrain.cellSizeM;
  return [((col + 0.5) * cO - spec.offsetXM) / c30 - 0.5, ((row + 0.5) * cO - spec.offsetYM) / c30 - 0.5];
}

/** เซลล์ overview ที่ศูนย์กลางเซลล์ leaf `(gc, gr)` ตกอยู่ — −1 = นอก raster */
export function leafToOverviewCell(spec: LeafSpec, gc: number, gr: number): number {
  const { width, height, cellSizeM } = spec.overview;
  const c30 = spec.terrain.cellSizeM;
  const oc = Math.floor((spec.offsetXM + (gc + 0.5) * c30) / cellSizeM);
  const or = Math.floor((spec.offsetYM + (gr + 0.5) * c30) / cellSizeM);
  if (oc < 0 || or < 0 || oc >= width || or >= height) return -1;
  return or * width + oc;
}

/**
 * ขั้นที่ 3–4: เติมบนกริด 30 ม. ต่อสถานีที่ละเอียด (หน้าต่างรอบจุดตั้งต้นขนาด 2·(รัศมี+ระยะค้นหา))
 * ด้วย `floodFromStation` ตัวเดียวกับ overview, รวมแบบ max WSE, แล้วสุ่มผลของสถานีที่ **ไม่**
 * ละเอียด (C3) จากกริด overview ลงเซลล์ของหน้าต่างที่ยังว่าง/ต่ำกว่า — สถานีข้างเคียงที่งบไม่พอ
 * จึงไม่ถูกตัดหายตรงขอบหน้าต่าง; สุดท้ายทำเครื่องหมายอาคาร/ต้นไม้เป็น "ไม่ได้ประมาณความลึก"
 * เซลล์ในไทล์ที่ไม่ใช่หน้าต่าง / nodata / นอกจังหวัด = เติมไม่ได้
 */
export function fillLeafWindows(input: LeafFillInput): SheetWindow[] {
  const { spec, tiles, stations, refined, overview, insideMask } = input;
  const t = spec.terrain;
  const T = t.tileSize;
  const B = t.border;
  const span = terrainTileSpan(T, B);
  const c30 = t.cellSizeM;
  const windowSet = new Set(input.windowTiles);

  // ความสูงที่เซลล์ leaf ทั้งจังหวัด (gc, gr) — NaN = เติมไม่ได้
  const heightAt = (gc: number, gr: number): number => {
    if (gc < 0 || gr < 0) return NaN;
    const tx = Math.floor(gc / T);
    const ty = Math.floor(gr / T);
    if (tx >= t.tilesX || ty >= t.tilesY) return NaN;
    const idx = ty * t.tilesX + tx;
    if (!windowSet.has(idx)) return NaN;
    const h = tiles.terrain.get(idx);
    if (!h) return NaN;
    const v = h[(gr - ty * T + B) * span + (gc - tx * T + B)];
    if (v === t.nodata) return NaN;
    if (insideMask) {
      const o = leafToOverviewCell(spec, gc, gr);
      if (o < 0 || insideMask[o] === 0) return NaN;
    }
    return v;
  };

  // ตัวสะสมต่อไทล์ (T×T เซลล์ของมันเอง)
  interface Acc {
    wse: Float32Array;
    station: Uint16Array;
    fadePct: Uint8Array;
  }
  const accs = new Map<number, Acc>();
  for (const idx of windowSet) {
    accs.set(idx, {
      wse: new Float32Array(T * T).fill(-Infinity),
      station: new Uint16Array(T * T).fill(SHEET_NONE),
      fadePct: new Uint8Array(T * T),
    });
  }
  const accAt = (gc: number, gr: number): { acc: Acc; i: number } | null => {
    if (gc < 0 || gr < 0) return null;
    const tx = Math.floor(gc / T);
    const ty = Math.floor(gr / T);
    if (tx >= t.tilesX || ty >= t.tilesY) return null;
    const acc = accs.get(ty * t.tilesX + tx);
    return acc ? { acc, i: (gr - ty * T) * T + (gc - tx * T) } : null;
  };

  // 1) สถานีที่ละเอียด — หน้าต่างรอบจุดตั้งต้น
  const reach = Math.ceil((SHEET_MAX_RADIUS_M + SHEET_SEED_SEARCH_M) / c30) + 1;
  const wSize = 2 * reach + 1;
  const wHeights = new Float32Array(wSize * wSize);
  const scratch = floodScratch(wSize * wSize);
  const grid = { width: wSize, height: wSize, cellSizeM: c30 };
  const count = Math.min(stations.length, SHEET_NONE - 1);
  for (let k = 0; k < count; k++) {
    if (!refined[k]) continue;
    const s = stations[k];
    const [lc, lr] = overviewToLeaf(spec, s.col, s.row);
    const c0 = Math.round(lc) - reach;
    const r0 = Math.round(lr) - reach;
    for (let r = 0; r < wSize; r++) {
      for (let c = 0; c < wSize; c++) wHeights[r * wSize + c] = heightAt(c0 + c, r0 + r);
    }
    const local: SheetStation = { col: lc - c0, row: lr - r0, wseM: s.wseM, bankM: s.bankM };
    floodFromStation(grid, wHeights, null, local, k + 1, scratch, (i, fade) => {
      const c = i % wSize;
      const hit = accAt(c0 + c, r0 + (i - c) / wSize);
      if (!hit) return;
      const { acc, i: j } = hit;
      if (s.wseM > acc.wse[j]) {
        acc.wse[j] = s.wseM;
        acc.station[j] = k;
      }
      const f = Math.round(fade * SHEET_FADE_SCALE);
      if (f > acc.fadePct[j]) acc.fadePct[j] = f;
    });
  }

  // 2) สถานีที่ไม่ละเอียด (งบไม่พอ/ไทล์ล้ม) ที่เป็นผู้ชนะบน overview ตรงเซลล์นั้น — ใช้ขอบเขตของ
  //    overview ต่อ แต่ความลึกคิดจากพื้น 30 ม. (พื้นสูงกว่าผิวน้ำ = ไม่ท่วม)
  for (const [idx, acc] of accs) {
    const tx = idx % t.tilesX;
    const ty = (idx - tx) / t.tilesX;
    for (let r = 0; r < T; r++) {
      for (let c = 0; c < T; c++) {
        const gc = tx * T + c;
        const gr = ty * T + r;
        const o = leafToOverviewCell(spec, gc, gr);
        if (o < 0) continue;
        const k = overview.station[o];
        if (k === SHEET_NONE || refined[k]) continue;
        const s = stations[k];
        const j = r * T + c;
        if (!(s.wseM > acc.wse[j])) continue;
        const h = heightAt(gc, gr);
        if (!(h < s.wseM)) continue;
        acc.wse[j] = s.wseM;
        acc.station[j] = k;
        if (overview.fadePct[o] > acc.fadePct[j]) acc.fadePct[j] = overview.fadePct[o];
      }
    }
  }

  // 3) หน้าต่างผลลัพธ์ (T + 1)² พร้อมขอบร่วม + มาสก์อาคาร/ต้นไม้
  const lc = spec.landcover;
  const capCm = SHEET_DEPTH_CAP_M * 100;
  const out: SheetWindow[] = [];
  const size = T + 1;
  for (const idx of input.windowTiles) {
    const own = tiles.terrain.get(idx);
    if (!own) continue;
    const tx = idx % t.tilesX;
    const ty = (idx - tx) / t.tilesX;
    const n = size * size;
    const w: SheetWindow = {
      tx,
      ty,
      size,
      heights: new Float32Array(n),
      depthCm: new Uint16Array(n).fill(SHEET_NONE),
      station: new Uint16Array(n).fill(SHEET_NONE),
      fadePct: new Uint8Array(n),
      notEst: new Uint8Array(n),
      filledCells: 0,
    };
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const v = j * size + i;
        const raw = own[(j + B) * span + (i + B)];
        const h = raw === t.nodata ? NaN : raw;
        w.heights[v] = Number.isNaN(h) ? 0 : h;
        const gc = tx * T + i;
        const gr = ty * T + j;
        const hit = accAt(gc, gr);
        if (!hit || Number.isNaN(h)) continue;
        const k = hit.acc.station[hit.i];
        if (k === SHEET_NONE) continue;
        w.station[v] = k;
        w.fadePct[v] = hit.acc.fadePct[hit.i];
        w.depthCm[v] = Math.min(capCm, Math.max(0, Math.round((hit.acc.wse[hit.i] - h) * 100)));
        w.filledCells++;
        if (lc) {
          const lgc = Math.floor(gc / lc.factor);
          const lgr = Math.floor(gr / lc.factor);
          const ltx = Math.floor(lgc / T);
          const lty = Math.floor(lgr / T);
          const cls = tiles.landcover.get(lty * lc.tilesX + ltx)?.[(lgr - lty * T) * T + (lgc - ltx * T)];
          if (cls === WORLDCOVER_BUILT || cls === WORLDCOVER_TREE) w.notEst[v] = 1;
        }
      }
    }
    out.push(w);
  }
  return out;
}

export interface MaskableOverview {
  depthCm: Uint16Array;
  station: Uint16Array;
  fadePct: Uint8Array;
}

/**
 * ขั้นที่ 5 — ดาวเทียมที่เห็นจริงมาก่อน: สำเนาของผลที่เซลล์ซึ่ง GFM สังเกตแล้ว (`observed` บนกริด
 * overview จาก `observedMaskFromField` ใน `lib/stationSheetField.ts`) ถูกล้างเป็น "ไม่มีแผ่น" ทั้งบน overview และในหน้าต่าง 30 ม. (เซลล์ leaf ใช้เซลล์
 * overview ที่ศูนย์กลางของมันตกอยู่) — `observed` null = ไม่มีฉากที่แสดงอยู่: คืนสำเนาเดิม
 * ต้นฉบับไม่ถูกแตะ (worker เก็บไว้ใช้ซ้ำเมื่อฉาก/ชั้น GFM เปลี่ยน โดยไม่ต้องวางแผน/ขอไทล์ใหม่)
 */
export function applyObservedPrecedence<O extends MaskableOverview>(
  spec: LeafSpec | null,
  observed: Uint8Array | null,
  overview: O,
  windows: readonly SheetWindow[],
): { overview: O; windows: SheetWindow[]; filledCells: number } {
  const ov = {
    ...overview,
    depthCm: overview.depthCm.slice(),
    station: overview.station.slice(),
    fadePct: overview.fadePct.slice(),
  };
  let filledCells = 0;
  const n = ov.station.length;
  for (let i = 0; i < n; i++) {
    if (ov.station[i] === SHEET_NONE) continue;
    if (observed && observed[i]) {
      ov.station[i] = SHEET_NONE;
      ov.depthCm[i] = SHEET_NONE;
      ov.fadePct[i] = 0;
    } else filledCells++;
  }
  const wins = windows.map((w) => {
    const c: SheetWindow = {
      ...w,
      depthCm: w.depthCm.slice(),
      station: w.station.slice(),
      fadePct: w.fadePct.slice(),
      notEst: w.notEst.slice(),
      heights: w.heights.slice(),
      filledCells: 0,
    };
    const T = w.size - 1;
    for (let j = 0; j < w.size; j++) {
      for (let i = 0; i < w.size; i++) {
        const v = j * w.size + i;
        if (c.station[v] === SHEET_NONE) continue;
        const o = observed && spec ? leafToOverviewCell(spec, w.tx * T + i, w.ty * T + j) : -1;
        if (o >= 0 && observed![o]) {
          c.station[v] = SHEET_NONE;
          c.depthCm[v] = SHEET_NONE;
          c.fadePct[v] = 0;
          c.notEst[v] = 0;
        } else c.filledCells++;
      }
    }
    return c;
  });
  return { overview: ov, windows: wins, filledCells };
}
