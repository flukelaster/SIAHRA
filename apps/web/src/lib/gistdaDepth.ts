/**
 * ความลึกภาพประกอบ (FwDET) จากขอบเขตน้ำท่วม GISTDA (E16 B-2, ชั้น `gistdaDepth`) — พอร์ตของ
 * `apps/etl/gfm/gfm/fwdet.py` (Cohen et al. 2018; FwDET v2.0, 2019) มาไว้ฝั่งเว็บ รันใน
 * `workers/gistdaDepth.worker.ts` บนกริด overview ของจังหวัด
 *
 * ไฟล์นี้ **ห้าม import three** (เทสรันใน node) และ **ห้ามถูก import เป็นค่าจาก main thread** —
 * ฟังก์ชันคำนวณต้องอยู่ในก้อน worker เท่านั้น (main thread import ได้เฉพาะชนิด/ค่าคงที่ผ่าน
 * `lib/gistdaDepthField.ts`) ไม่งั้น entry โตขึ้นทั้งที่ไม่ได้ใช้
 *
 * ## ขั้นตอน (ตรงกับ fwdet.py ขั้น 3–6)
 *
 * 1. ท่วม = เซลล์ **ในจังหวัด** ที่ GISTDA ระบุว่าท่วม (rasterise แบบ **ไม่เบลอ** จาก `scene/floodMask.ts`)
 * 2. "แห้ง" = เซลล์ **ในจังหวัด** ที่ไม่ท่วม — ข้อสมมติของเรา: GISTDA ส่งเฉพาะเซลล์ที่ท่วม ไม่มี
 *    รอยภาพ (footprint) ให้รู้ว่าตรงไหนดาวเทียมเห็นแล้วว่าแห้ง (GFM มี) legend บอกข้อสมมตินี้เสมอ
 *    เซลล์นอกจังหวัดไม่ใช่ทั้ง "ท่วม" และ "แห้ง" แม้ polygon ของ GISTDA จะคร่อมเข้าไป (= "ไม่ได้สังเกต"
 *    แบบ `observed=False` ของ fwdet.py: `flooded = observed ∧ extent==1`) — cls = NONE ไม่มีความลึก
 * 3. ขอบ = เซลล์ท่วมที่มีเพื่อนบ้าน 4 ทิศเป็น "แห้ง"
 * 4. ระดับผิวน้ำ (WSE) ที่ขอบ = median ของความสูงพื้นในหน้าต่าง 3×3 **เฉพาะเซลล์ขอบ** (จำนวนคู่ =
 *    เฉลี่ยสองค่ากลาง แบบ `np.nanmedian`)
 * 5. ทุกเซลล์ท่วมรับ WSE ของเซลล์ขอบที่ **ใกล้ที่สุด** (ระยะยุคลิด — EDT แบบแม่นยำพร้อมดัชนี
 *    Felzenszwalb–Huttenlocher; เมื่อระยะเท่ากัน อาจเลือกคนละเซลล์กับ scipy ได้)
 * 6. ความลึก = clip(WSE − พื้น, 0, 10 ม.) แล้วเฉลี่ย 3×3 เฉพาะเซลล์ที่มีค่า (`_smooth_depth`)
 *
 * ต่างจาก fwdet.py: ไม่มีมาสก์อาคาร/ต้นไม้ (WorldCover) — ข้อมูลสิ่งปกคลุมดินมีเฉพาะเป็นไทล์ 30 ม.
 * ไม่มีบนกริด overview และชั้นนี้ไม่ขอไทล์เพิ่ม; ความสูงพื้นเป็น DSM (รวมหลังคา/ยอดไม้) และเป็น
 * **เมตรเต็ม** ความลึกจึงหยาบระดับเมตร ทั้งสองข้ออยู่ใน legend
 * ไม่มีเซลล์ขอบเลย (ทั้งจังหวัดท่วม) = ทุกเซลล์ท่วม "ไม่ได้ประมาณความลึก" ไม่ใช่ 0 ม.
 *
 * อาร์เรย์ทุกตัวเรียง **แถว 0 = ขอบเหนือ** (ลำดับของ `terrain.heights`)
 */

/** เพดานความลึก (ซม.) — เท่ากับ `DEPTH_CAP_CM` ของ contract.py และเต็มสเกล G ของ texture */
export const GISTDA_DEPTH_CAP_CM = 1000;
/** "ไม่มีค่าความลึก" — เท่ากับ `FLOOD_FIELD_NO_DEPTH` (0xFFFF) ของสัญญา field.bin */
export const GISTDA_NO_DEPTH = 0xffff;

/** คลาสต่อเซลล์ของผล (กริด overview) */
export const GISTDA_CELL_NONE = 0;
/** ท่วม (GISTDA) และมีค่าความลึกภาพประกอบ */
export const GISTDA_CELL_DEPTH = 1;
/** ท่วม (GISTDA) แต่ไม่ได้ประมาณความลึก (ไม่มีเซลล์ขอบให้อ้าง) */
export const GISTDA_CELL_NOT_EST = 2;

export interface GistdaDepthGrid {
  width: number;
  height: number;
}

export interface GistdaDepthResult {
  width: number;
  height: number;
  /** `GISTDA_CELL_*` ต่อเซลล์ */
  cls: Uint8Array;
  /** ซม. เฉพาะ `GISTDA_CELL_DEPTH`, ที่เหลือ `GISTDA_NO_DEPTH` */
  depthCm: Uint16Array;
  /** เซลล์ท่วมทั้งหมดที่เข้าคำนวณ */
  floodedCells: number;
  /** เซลล์ขอบที่ใช้จริง — 0 = ประมาณความลึกไม่ได้เลย */
  boundaryCells: number;
  /** null = ไม่มีเซลล์ใดมีค่าความลึก (ห้ามรายงานเป็น 0) */
  maxDepthCm: number | null;
}

/** True เมื่อเพื่อนบ้าน 4 ทิศอย่างน้อยหนึ่งเซลล์เป็น 1 (นอกกริด = 0) — `_neighbours4_any` */
function hasDryNeighbour(dry: Uint8Array, w: number, h: number, r: number, c: number): boolean {
  const i = r * w + c;
  return (
    (r > 0 && dry[i - w] === 1) ||
    (r < h - 1 && dry[i + w] === 1) ||
    (c > 0 && dry[i - 1] === 1) ||
    (c < w - 1 && dry[i + 1] === 1)
  );
}

/** median แบบ `np.nanmedian` — จำนวนคู่ = เฉลี่ยสองค่ากลาง (แก้ `vals` ในที่) */
export function median(vals: number[]): number {
  vals.sort((a, b) => a - b);
  const n = vals.length;
  const m = n >> 1;
  return n % 2 === 1 ? vals[m]! : (vals[m - 1]! + vals[m]!) / 2;
}

/**
 * EDT 1 มิติแบบแม่นยำ (Felzenszwalb–Huttenlocher) บนฟังก์ชัน `f` ความยาว `n` (Infinity = ไม่ใช่
 * จุดตั้งต้น) — เขียนระยะกำลังสองลง `d` และตำแหน่งจุดตั้งต้นที่ใกล้ที่สุดลง `arg` (−1 = ไม่มี)
 * `v`/`z` เป็นพื้นที่ทดของผู้เรียก (ยาว ≥ n และ n + 1)
 */
function edt1d(f: Float64Array, n: number, d: Float64Array, arg: Int32Array, v: Int32Array, z: Float64Array): void {
  let k = -1;
  for (let q = 0; q < n; q++) {
    if (f[q] === Infinity) continue;
    if (k < 0) {
      k = 0;
      v[0] = q;
      z[0] = -Infinity;
      z[1] = Infinity;
      continue;
    }
    // z[0] = −∞ จึงหยุดที่ k = 0 เสมอ
    let p = v[k]!;
    let s = (f[q]! + q * q - (f[p]! + p * p)) / (2 * q - 2 * p);
    while (s <= z[k]!) {
      k--;
      p = v[k]!;
      s = (f[q]! + q * q - (f[p]! + p * p)) / (2 * q - 2 * p);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  if (k < 0) {
    for (let q = 0; q < n; q++) {
      d[q] = Infinity;
      arg[q] = -1;
    }
    return;
  }
  let j = 0;
  for (let q = 0; q < n; q++) {
    while (z[j + 1]! < q) j++;
    const p = v[j]!;
    d[q] = (q - p) * (q - p) + f[p]!;
    arg[q] = p;
  }
}

/**
 * ดัชนี (แถว·w + คอลัมน์) ของเซลล์ `site` ที่ใกล้ที่สุดตามระยะยุคลิด สำหรับทุกเซลล์ของกริด w×h —
 * เทียบเท่า `distance_transform_edt(~site, return_indices=True)` (−1 เมื่อไม่มี site เลย)
 */
export function nearestSiteIndex(site: Uint8Array, w: number, h: number): Int32Array {
  const n = w * h;
  const out = new Int32Array(n).fill(-1);
  const colD = new Float64Array(n);
  const colArg = new Int32Array(n);
  const len = Math.max(w, h);
  const f = new Float64Array(len);
  const d = new Float64Array(len);
  const arg = new Int32Array(len);
  const v = new Int32Array(len);
  const z = new Float64Array(len + 1);
  // ผ่านที่ 1: ต่อคอลัมน์ — ระยะกำลังสองแนวตั้งถึง site ที่ใกล้ที่สุดในคอลัมน์เดียวกัน + แถวของมัน
  for (let c = 0; c < w; c++) {
    for (let r = 0; r < h; r++) f[r] = site[r * w + c] ? 0 : Infinity;
    edt1d(f, h, d, arg, v, z);
    for (let r = 0; r < h; r++) {
      colD[r * w + c] = d[r]!;
      colArg[r * w + c] = arg[r]!;
    }
  }
  // ผ่านที่ 2: ต่อแถว บนผลของผ่านที่ 1 — คอลัมน์ที่ชนะ + แถวที่คอลัมน์นั้นจำไว้
  for (let r = 0; r < h; r++) {
    const off = r * w;
    for (let c = 0; c < w; c++) f[c] = colD[off + c]!;
    edt1d(f, w, d, arg, v, z);
    for (let c = 0; c < w; c++) {
      const cc = arg[c]!;
      if (cc < 0) continue;
      out[off + c] = colArg[off + cc]! * w + cc;
    }
  }
  return out;
}

/**
 * FwDET บนกริดหนึ่ง — `heights` เมตร (แถว 0 = เหนือ), `flooded` 1 = GISTDA ระบุว่าท่วม,
 * `inside` 1 = ในจังหวัด (null = ทั้งกริด) `smooth` = ขั้นเฉลี่ย 3×3 ของ fwdet.py (ค่าเริ่มต้นเปิด)
 */
export function estimateGistdaDepth(
  grid: GistdaDepthGrid,
  heights: ArrayLike<number>,
  flooded: Uint8Array,
  inside: Uint8Array | null,
  opts: { smooth?: boolean } = {},
): GistdaDepthResult {
  const { width: W, height: H } = grid;
  const n = W * H;
  if (heights.length !== n || flooded.length !== n || (inside && inside.length !== n)) {
    throw new Error("gistda depth: input arrays are not on the same grid");
  }
  const smooth = opts.smooth ?? true;
  const cls = new Uint8Array(n);
  const depthCm = new Uint16Array(n).fill(GISTDA_NO_DEPTH);

  // กรอบของเซลล์ท่วม + ขอบ 1 เซลล์ (fwdet.py `_bbox_of`) — ขอบทุกเซลล์อยู่ในกรอบนี้
  let r0 = H;
  let r1 = -1;
  let c0 = W;
  let c1 = -1;
  let floodedCells = 0;
  // ท่วม "ที่สังเกตได้" = GISTDA ท่วม ∧ ในจังหวัด (fwdet.py `flooded_mask`: observed ∧ extent==1)
  const isFl = (g: number): boolean => flooded[g] !== 0 && (!inside || inside[g] !== 0);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (!isFl(r * W + c)) continue;
      floodedCells++;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
    }
  }
  if (floodedCells === 0) {
    return { width: W, height: H, cls, depthCm, floodedCells: 0, boundaryCells: 0, maxDepthCm: null };
  }
  r0 = Math.max(r0 - 1, 0);
  c0 = Math.max(c0 - 1, 0);
  r1 = Math.min(r1 + 1, H - 1);
  c1 = Math.min(c1 + 1, W - 1);
  const w = c1 - c0 + 1;
  const h = r1 - r0 + 1;
  const m = w * h;

  // มาสก์ในกรอบ (ดัชนีท้องถิ่น)
  const fl = new Uint8Array(m);
  const dry = new Uint8Array(m);
  const dem = new Float64Array(m);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const g = (r + r0) * W + (c + c0);
      const i = r * w + c;
      dem[i] = heights[g]!;
      if (!inside || inside[g]) {
        if (flooded[g]) fl[i] = 1;
        else dry[i] = 1;
      }
    }
  }
  const boundary = new Uint8Array(m);
  let boundaryCells = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      if (fl[i] && Number.isFinite(dem[i]!) && hasDryNeighbour(dry, w, h, r, c)) {
        boundary[i] = 1;
        boundaryCells++;
      }
    }
  }
  if (boundaryCells === 0) {
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) if (fl[r * w + c]) cls[(r + r0) * W + (c + c0)] = GISTDA_CELL_NOT_EST;
    }
    return { width: W, height: H, cls, depthCm, floodedCells, boundaryCells: 0, maxDepthCm: null };
  }

  // WSE ที่ขอบ = median 3×3 เฉพาะเซลล์ขอบ (ตัวเองอยู่ในหน้าต่างเสมอ)
  const wseB = new Float64Array(m);
  const win: number[] = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      if (!boundary[i]) continue;
      win.length = 0;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= h) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= w) continue;
          const j = rr * w + cc;
          if (boundary[j]) win.push(dem[j]!);
        }
      }
      wseB[i] = median(win);
    }
  }

  const nearest = nearestSiteIndex(boundary, w, h);
  const capM = GISTDA_DEPTH_CAP_CM / 100;
  const depthM = new Float64Array(m);
  const hasDepth = new Uint8Array(m);
  for (let i = 0; i < m; i++) {
    if (!fl[i] || !Number.isFinite(dem[i]!)) continue;
    const b = nearest[i]!;
    depthM[i] = Math.min(Math.max(wseB[b]! - dem[i]!, 0), capM);
    hasDepth[i] = 1;
  }
  let out = depthM;
  if (smooth) {
    // `_smooth_depth`: เฉลี่ย 3×3 เฉพาะเซลล์ที่มีค่า — ไม่เกลี่ยข้ามเซลล์ที่ไม่มีค่า
    out = new Float64Array(m);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const i = r * w + c;
        if (!hasDepth[i]) continue;
        let sum = 0;
        let cnt = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= h) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc;
            if (cc < 0 || cc >= w) continue;
            const j = rr * w + cc;
            if (!hasDepth[j]) continue;
            sum += depthM[j]!;
            cnt++;
          }
        }
        out[i] = sum / cnt;
      }
    }
  }
  let maxDepthCm: number | null = null;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      if (!fl[i]) continue;
      const g = (r + r0) * W + (c + c0);
      if (!hasDepth[i]) {
        cls[g] = GISTDA_CELL_NOT_EST;
        continue;
      }
      const cm = Math.round(out[i]! * 100);
      cls[g] = GISTDA_CELL_DEPTH;
      depthCm[g] = cm;
      if (maxDepthCm === null || cm > maxDepthCm) maxDepthCm = cm;
    }
  }
  return { width: W, height: H, cls, depthCm, floodedCells, boundaryCells, maxDepthCm };
}
