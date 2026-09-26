/**
 * แผ่นน้ำจำลองจากระดับน้ำที่สถานี (E16 B-1, ชั้น `stationSheet`) — ตรรกะล้วนของการเติมน้ำ
 * รันใน `workers/stationSheet.worker.ts` (ไฟล์นี้ **ห้าม import three** และห้ามถูก import จาก
 * main thread: มันต้องอยู่ในก้อน worker ไม่ใช่ entry)
 *
 * ## วิธี (ภาพประกอบ ไม่ใช่แบบจำลองชลศาสตร์)
 *
 * ต่อสถานีที่ **ระดับน้ำที่วัดได้สูงกว่าตลิ่งต่ำสุด** (ทั้งคู่ ม.รทก. จาก ThaiWater):
 * 1. จุดตั้งต้น = เซลล์ที่ **ต่ำที่สุด** ภายใน `SHEET_SEED_SEARCH_M` (300 ม.) จากพิกัดสถานี และอยู่
 *    ในจังหวัด — ให้ตกลงบนร่องน้ำแทนตลิ่ง/หลังคา (DEM ของเราเป็น DSM ที่รวมอาคาร)
 *    ถ้าพื้นที่จุดตั้งต้นสูงกว่าระดับน้ำอยู่แล้ว → สถานีนั้นไม่สร้างแผ่น
 * 2. เติมแบบ **4 ทิศ** (ไม่ใช่ 8 — แนวสันทแยงบาง ๆ บนกริดหยาบจะไม่ถูกน้ำลอดผ่าน) ผ่านเซลล์ที่
 *    `พื้น < ระดับน้ำ` อยู่ในจังหวัด และห่างจากจุดตั้งต้นไม่เกิน `SHEET_MAX_RADIUS_M` (5 กม.) —
 *    แอ่งต่ำที่มีสันกั้นจึงแห้ง แม้จะต่ำกว่าระดับน้ำ
 * 3. ความลึก = ระดับน้ำ − พื้น ตัดเข้าช่วง [0, `SHEET_DEPTH_CAP_M`] (10 ม. = เพดานของ texture เดียวกับ GFM)
 * 4. เซลล์ที่ถูกเติมจากหลายสถานีใช้ **ผิวน้ำที่สูงที่สุด** (max WSE) และจำว่ามาจากสถานีไหน —
 *    popup บอกชื่อ/ระดับ/เวลาของสถานีนั้น
 * 5. ความจาง (`sheetFade`) ตามระยะจากจุดตั้งต้น: ทึบถึง 60 % ของรัศมีแล้วจางเป็น 0 ที่รัศมี —
 *    ความมั่นใจลดลงเมื่อห่างจากสิ่งที่วัดจริง (ค่าสูงสุดของทุกสถานีที่เติมเซลล์นั้น)
 *
 * ความสูงพื้น (ทั้ง terrain.bin และไทล์ 30 ม.) เป็น Int16 **เมตรเต็ม** — ความลึกจึงหยาบระดับเมตร
 * แม้จะถูกเก็บเป็นซม.
 *
 * กริด = overview ของ `manifest.terrain` เรียง **แถว 0 = ขอบเหนือ** (ลำดับของ `terrain.heights`)
 * ตัวแปลงเป็น `FloodField` (แถวล่างขึ้นบน) อยู่ที่ `lib/stationSheetField.ts`
 */

/** รัศมีสูงสุดของแผ่นจากจุดตั้งต้นของแต่ละสถานี (ม.) — legend อ้างตัวเลขนี้ */
export const SHEET_MAX_RADIUS_M = 5000;
/** ระยะค้นหาเซลล์ต่ำสุดรอบพิกัดสถานีเพื่อให้ลงร่องน้ำ (ม.) */
export const SHEET_SEED_SEARCH_M = 300;
/** เพดานความลึก (ม.) — ตรงกับเต็มสเกล G ของ texture (`FLOOD_TEX_DEPTH_FULL_SCALE_CM`) */
export const SHEET_DEPTH_CAP_M = 10;
/**
 * ทึบเต็มจนถึงสัดส่วนนี้ของ `SHEET_MAX_RADIUS_M` จากจุดตั้งต้น แล้วค่อย ๆ จางเป็น 0 ที่รัศมี
 * (`sheetFade`) — legend อ้างตัวเลขนี้
 */
export const SHEET_FADE_START_FRAC = 0.6;
/** "ไม่มีค่า" ของ `depthCm` และ `station` */
export const SHEET_NONE = 0xffff;

export interface SheetGrid {
  width: number;
  height: number;
  cellSizeM: number;
}

export interface SheetStation {
  /** ตำแหน่งบนกริด (หน่วยเซลล์, ทศนิยมได้): คอลัมน์ 0 = ตะวันตก, แถว 0 = เหนือ */
  col: number;
  row: number;
  /** ระดับน้ำที่วัดได้ (ม.รทก.) = ระดับผิวน้ำของแผ่น */
  wseM: number;
  /** ตลิ่งต่ำสุด (ม.รทก.) — ไม่เกินตลิ่ง = ไม่มีแผ่น (น้ำยังอยู่ในลำน้ำ) */
  bankM: number;
}

export interface SheetFill {
  width: number;
  height: number;
  /** ความลึก (ซม., 0..1000) ต่อเซลล์ — `SHEET_NONE` = ไม่ถูกเติม */
  depthCm: Uint16Array;
  /** ดัชนีสถานี (ในอาร์เรย์ที่ส่งเข้ามา) ที่ให้ผิวน้ำของเซลล์นั้น — `SHEET_NONE` = ไม่ถูกเติม */
  station: Uint16Array;
  /**
   * ความจางตามระยะ 0..`SHEET_FADE_SCALE` ต่อเซลล์ (`sheetFade`) — ค่าสูงสุดของทุกสถานีที่เติมเซลล์นั้น
   * (สถานีที่ใกล้ที่สุดเป็นตัวกำหนดความมั่นใจ) 0 = ไม่ถูกเติม
   */
  fadePct: Uint8Array;
  filledCells: number;
  /** จำนวนเซลล์ที่แต่ละสถานีเติม (ก่อนรวม max WSE) — 0 = ใต้ตลิ่ง/จุดตั้งต้นสูงกว่าระดับน้ำ/ไม่มีจุดตั้งต้น */
  cellsPerStation: number[];
  /** ดัชนีเซลล์ที่แต่ละสถานีเติม (ก่อนรวม max WSE) — รอยเท้าที่ตัววางแผนไทล์ 30 ม. ใช้ (ข้อจำกัด C2) */
  stationCells: Int32Array[];
}

/**
 * เซลล์ต่ำสุดในรัศมีค้นหารอบสถานีที่อยู่ในจังหวัด — `-1` = ไม่มี (สถานีอยู่นอกกริด/นอกจังหวัดทั้งวง)
 */
export function seedCell(
  grid: SheetGrid,
  heights: Float32Array,
  mask: Uint8Array | null,
  col: number,
  row: number,
): number {
  const { width, height, cellSizeM } = grid;
  const c0 = Math.round(col);
  const r0 = Math.round(row);
  const reach = Math.max(0, Math.floor(SHEET_SEED_SEARCH_M / cellSizeM));
  const reach2 = (SHEET_SEED_SEARCH_M / cellSizeM) ** 2;
  let best = -1;
  let bestH = Infinity;
  for (let dr = -reach; dr <= reach; dr++) {
    const r = r0 + dr;
    if (r < 0 || r >= height) continue;
    for (let dc = -reach; dc <= reach; dc++) {
      const c = c0 + dc;
      if (c < 0 || c >= width) continue;
      if (dc * dc + dr * dr > reach2) continue;
      const i = r * width + c;
      if (mask && mask[i] === 0) continue;
      if (heights[i] < bestH) {
        bestH = heights[i];
        best = i;
      }
    }
  }
  return best;
}

/**
 * ความจางของแผ่นตามระยะจากจุดตั้งต้นของสถานี (E16 B-1 รอบ 3, การตัดสินใจของผู้ใช้ข้อ 1):
 * ทึบเต็มถึง `SHEET_FADE_START_FRAC` ของรัศมี แล้ว smoothstep ลงเป็น 0 ที่ `SHEET_MAX_RADIUS_M`
 * — บอกว่าความมั่นใจลดลงตามระยะห่างจากสิ่งที่วัดจริง แทนขอบตัดแข็งเป็นวงโค้ง/เส้นตรง
 * (การเติมยังหยุดที่รัศมีเดิม แต่ตรงนั้นความจางเป็น 0 แล้ว ขอบจึงไม่เห็น)
 */
export function sheetFade(distM: number, radiusM: number = SHEET_MAX_RADIUS_M): number {
  const start = SHEET_FADE_START_FRAC * radiusM;
  if (!(distM > start)) return 1;
  if (distM >= radiusM) return 0;
  const x = (distM - start) / (radiusM - start);
  return 1 - x * x * (3 - 2 * x);
}

/** ความจางเก็บเป็นจำนวนเต็ม 0..100 ต่อเซลล์ (ช่อง B ของ texture เดียวกับ likelihood ของ GFM) */
export const SHEET_FADE_SCALE = 100;

/** บัฟเฟอร์ทำงานของ `floodFromStation` — จัดสรรครั้งเดียวต่อกริด ใช้ซ้ำได้ทุกสถานี */
export interface FloodScratch {
  visited: Uint16Array;
  queue: Int32Array;
}

export function floodScratch(n: number): FloodScratch {
  return { visited: new Uint16Array(n), queue: new Int32Array(n) };
}

/**
 * เติมน้ำจากสถานีเดียว (ขั้นที่ 1–2 ในหัวไฟล์) บนกริดใดก็ได้ — ใช้ทั้งกริด overview และหน้าต่าง 30 ม.
 * (`lib/stationSheetLeaf.ts`) เรียก `visit(i, fade)` ต่อเซลล์ที่ถูกเติม คืนจำนวนเซลล์
 * ความสูง `NaN` = ไม่มีข้อมูล (ไม่ถูกเติม, ไม่เป็นจุดตั้งต้น); `stamp` ต้องไม่ซ้ำกันภายใน scratch เดียว
 */
export function floodFromStation(
  grid: SheetGrid,
  heights: Float32Array,
  mask: Uint8Array | null,
  s: SheetStation,
  stamp: number,
  scratch: FloodScratch,
  visit: (i: number, fade: number) => void,
): number {
  const { width, height, cellSizeM } = grid;
  if (!Number.isFinite(s.wseM) || !Number.isFinite(s.bankM) || !(s.wseM > s.bankM)) return 0;
  const seed = seedCell(grid, heights, mask, s.col, s.row);
  if (seed < 0 || !(heights[seed] < s.wseM)) return 0;
  const { visited, queue } = scratch;
  const radiusCells2 = (SHEET_MAX_RADIUS_M / cellSizeM) ** 2;
  const sc = seed % width;
  const sr = (seed - sc) / width;
  let head = 0;
  let tail = 0;
  queue[tail++] = seed;
  visited[seed] = stamp;
  while (head < tail) {
    const i = queue[head++];
    const c = i % width;
    const r = (i - c) / width;
    visit(i, sheetFade(Math.hypot(c - sc, r - sr) * cellSizeM));
    // เพื่อนบ้าน 4 ทิศ
    for (let d = 0; d < 4; d++) {
      const nc = d === 0 ? c - 1 : d === 1 ? c + 1 : c;
      const nr = d === 2 ? r - 1 : d === 3 ? r + 1 : r;
      if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue;
      const j = nr * width + nc;
      if (visited[j] === stamp) continue;
      if (mask && mask[j] === 0) continue;
      if (!(heights[j] < s.wseM)) continue;
      const dc = nc - sc;
      const dr = nr - sr;
      if (dc * dc + dr * dr > radiusCells2) continue;
      visited[j] = stamp;
      queue[tail++] = j;
    }
  }
  return tail;
}

export function fillStationSheet(
  grid: SheetGrid,
  heights: Float32Array,
  mask: Uint8Array | null,
  stations: readonly SheetStation[],
): SheetFill {
  const { width, height } = grid;
  const n = width * height;
  const wse = new Float32Array(n).fill(-Infinity);
  const station = new Uint16Array(n).fill(SHEET_NONE);
  const fadePct = new Uint8Array(n);
  // ตราประทับต่อสถานี (k + 1) แทนการล้างอาร์เรย์ visited ทุกรอบ
  const scratch = floodScratch(n);
  const cellsPerStation: number[] = [];
  const stationCells: Int32Array[] = [];

  const count = Math.min(stations.length, SHEET_NONE - 1);
  for (let k = 0; k < count; k++) {
    const s = stations[k];
    const filled = floodFromStation(grid, heights, mask, s, k + 1, scratch, (i, fade) => {
      if (s.wseM > wse[i]) {
        wse[i] = s.wseM;
        station[i] = k;
      }
      const f = Math.round(fade * SHEET_FADE_SCALE);
      if (f > fadePct[i]) fadePct[i] = f;
    });
    cellsPerStation.push(filled);
    // คิวของ scratch คือรายการเซลล์ที่สถานีนี้เติม (ตามลำดับ BFS) — ตัววางแผนไทล์ 30 ม. ใช้เป็นรอยเท้า
    stationCells.push(scratch.queue.slice(0, filled));
  }

  const depthCm = new Uint16Array(n).fill(SHEET_NONE);
  let filledCells = 0;
  const capCm = SHEET_DEPTH_CAP_M * 100;
  for (let i = 0; i < n; i++) {
    if (station[i] === SHEET_NONE) continue;
    const d = Math.round((wse[i] - heights[i]) * 100);
    depthCm[i] = Math.min(capCm, Math.max(0, d));
    filledCells++;
  }
  return { width, height, depthCm, station, fadePct, filledCells, cellsPerStation, stationCells };
}
