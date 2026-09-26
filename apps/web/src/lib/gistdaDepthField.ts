/**
 * ฝั่ง main thread ของแผ่นน้ำ GISTDA 3 มิติ (E16 B-2) — แปลงผล FwDET จาก worker
 * (`lib/gistdaDepth.ts`, แถว 0 = เหนือ) เป็น `FloodField` (แถวล่างขึ้นบนแบบ `field.bin`) เพื่อใช้ท่อวาด
 * เดียวกับแผ่นความลึก GFM (`encodeFloodFieldRgba` + `createFloodSurface`) + มาสก์ลำดับความสำคัญ +
 * อ่านเซลล์ใต้จุดคลิก
 *
 * ไฟล์นี้ **ห้าม import three** (เทสรันใน node) และ import จาก `lib/gistdaDepth.ts` ได้เฉพาะค่าคงที่/
 * ชนิด — ฟังก์ชันคำนวณต้องอยู่ในก้อน worker เท่านั้น
 *
 * ## ลำดับความสำคัญของสามแหล่ง (ตัดสินใจใน B-2)
 *
 * 1. **GFM มาก่อน GISTDA** เมื่อชั้น GFM เปิดและมีฉากที่แสดงอยู่: เซลล์ที่ฉาก GFM จำแนกว่าท่วม
 *    (FLOODED / FLOODED_DEPTH_NOT_ESTIMATED) ไม่ถูกแผ่น GISTDA วาดซ้ำ — GFM มีเวลาบันทึกภาพต่อรอบบิน
 *    และมีเซลล์ "แห้ง" ที่ดาวเทียมเห็นจริงให้ FwDET อ้าง (GISTDA ไม่มี ต้องสมมติ) ความลึกของ GFM จึง
 *    น่าเชื่อกว่า เซลล์ที่ GFM ว่าแห้งแต่ GISTDA ว่าท่วม (ภาพต่างเวลากัน) **ยังวาด** — ทั้งคู่เป็นสิ่งที่
 *    ดาวเทียมเห็นจริง และ GFM ไม่วาดแผ่นตรงเซลล์แห้งอยู่แล้ว สองแผ่นจึงไม่ซ้อนกัน (renderOrder เดียวกันได้)
 * 2. **ดาวเทียมมาก่อนแบบจำลอง**: เซลล์ที่ GISTDA ระบุว่าท่วมถูกนับเป็น "สังเกตแล้ว" ของแผ่นจำลอง
 *    จากสถานี (`unionMasks` กับมาสก์ GFM) — เฉพาะ *ท่วม*; "แห้ง" ของ GISTDA เป็นข้อสมมติของเรา
 *    ไม่ใช่การสังเกต จึงไม่ห้ามแผ่นจำลองตรงนั้น
 */
import { FLOOD_FIELD_NO_DEPTH, FLOOD_FIELD_NO_LIKELIHOOD, FloodFieldClass } from "@siahra/shared-types";
import type { FloodField } from "../scene/floodField";
import { GISTDA_CELL_DEPTH, GISTDA_CELL_NOT_EST } from "./gistdaDepth";

/** ผล FwDET ที่ main thread ถือไว้ (แถว 0 = เหนือ) */
export interface GistdaDepthCells {
  width: number;
  height: number;
  cls: Uint8Array;
  depthCm: Uint16Array;
}

/**
 * แปลงเป็น `FloodField` (แถวล่างขึ้นบน) — `GISTDA_CELL_DEPTH` → FLOODED + ความลึก,
 * `GISTDA_CELL_NOT_EST` → FLOODED_DEPTH_NOT_ESTIMATED, ที่เหลือ NO_OBSERVATION (ไม่ใช่ "แห้ง")
 * `exclude` (แถว 0 = เหนือ, 1 = ตัดออก) = เซลล์ที่ GFM จำแนกว่าท่วมแล้ว
 * ช่อง likelihood ว่าง (255) — GISTDA ไม่มีค่าความเชื่อมั่นของการจำแนก
 */
export function gistdaToFloodField(cells: GistdaDepthCells, exclude: Uint8Array | null = null): FloodField {
  const { width, height } = cells;
  const n = width * height;
  const cls = new Uint8Array(n).fill(FloodFieldClass.NO_OBSERVATION);
  const depthCm = new Uint16Array(n).fill(FLOOD_FIELD_NO_DEPTH);
  const likelihood = new Uint8Array(n).fill(FLOOD_FIELD_NO_LIKELIHOOD);
  for (let r = 0; r < height; r++) {
    const src = r * width;
    const dst = (height - 1 - r) * width;
    for (let c = 0; c < width; c++) {
      const k = cells.cls[src + c];
      if (exclude && exclude[src + c]) continue;
      if (k === GISTDA_CELL_DEPTH) {
        cls[dst + c] = FloodFieldClass.FLOODED;
        depthCm[dst + c] = cells.depthCm[src + c]!;
      } else if (k === GISTDA_CELL_NOT_EST) {
        cls[dst + c] = FloodFieldClass.FLOODED_DEPTH_NOT_ESTIMATED;
      }
    }
  }
  return { width, height, cls, depthCm, likelihood };
}

/**
 * มาสก์ "GFM จำแนกว่าท่วม" บนกริด overview (แถว 0 = เหนือ) จากฟิลด์ของฉาก (แถวล่างขึ้นบน) —
 * FLOODED / FLOODED_DEPTH_NOT_ESTIMATED เท่านั้น (ต่างจาก `observedMaskFromField` ที่รวม DRY)
 */
export function gfmFloodedMaskFromField(field: { width: number; height: number; cls: Uint8Array }): Uint8Array {
  const { width, height, cls } = field;
  const out = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    const src = (height - 1 - r) * width;
    const dst = r * width;
    for (let c = 0; c < width; c++) {
      const k = cls[src + c];
      if (k === FloodFieldClass.FLOODED || k === FloodFieldClass.FLOODED_DEPTH_NOT_ESTIMATED) out[dst + c] = 1;
    }
  }
  return out;
}

/** OR ของสองมาสก์บนกริดเดียวกัน — null ทั้งคู่ = null, ตัวเดียว = ตัวนั้น (ไม่คัดลอก) */
export function unionMasks(a: Uint8Array | null, b: Uint8Array | null): Uint8Array | null {
  if (!a) return b;
  if (!b) return a;
  if (a.length !== b.length) throw new Error("unionMasks: masks are not on the same grid");
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] || b[i] ? 1 : 0;
  return out;
}

export interface GistdaDepthCellPick {
  /** ซม. — null = ท่วม (GISTDA) แต่ไม่ได้ประมาณความลึก */
  depthCm: number | null;
  /** ขนาดเซลล์ของกริดที่คำนวณ (ม.) */
  cellSizeM: number;
}

/**
 * ค่าของแผ่นใต้จุด `(localX, localZ)` ของฉาก — **สูตรเดียวกับที่ shader วาด** (`siahraFloodSample`):
 * uv ของจุด (vertex c อยู่ที่ `x = c·cell − W/2`, uv = c/(w−1)) → bilinear สี่ texel รอบ ๆ, ความครอบคลุม
 * ≥ 0.5 = มีแผ่นตรงนี้, ความลึก = ค่าเฉลี่ยถ่วงน้ำหนักของ texel ที่มีค่า — popup จึงตอบตรงกับสิ่งที่
 * เห็นบนจอ (ไม่ใช่แค่เซลล์ใกล้สุด ซึ่งพลาดขอบนุ่มครึ่งเซลล์ของแผ่น) `null` = นอกกริด/ไม่มีแผ่นตรงนี้/
 * GFM มาก่อน (`exclude`) `minDepthCm` = ตื้นกว่านี้ไม่ถูกวาด (0 = วาดทุกเซลล์)
 */
export function gistdaCellAt(
  cells: GistdaDepthCells,
  grid: { width: number; height: number; cellSizeM: number; gridWidthM: number; gridHeightM: number },
  exclude: Uint8Array | null,
  localX: number,
  localZ: number,
  minDepthCm: number,
): GistdaDepthCellPick | null {
  const { width: w, height: h } = grid;
  if (cells.width !== w || cells.height !== h || w < 2 || h < 2) return null;
  // ตำแหน่งบน texture (แกน u ตามคอลัมน์, แถว 0 = เหนือ) แบบ `uv · size − 0.5` ของ shader
  const pc = ((localX + grid.gridWidthM / 2) / (grid.cellSizeM * (w - 1))) * w - 0.5;
  const pr = ((localZ + grid.gridHeightM / 2) / (grid.cellSizeM * (h - 1))) * h - 0.5;
  if (!(pc >= -0.5 && pc <= w - 0.5 && pr >= -0.5 && pr <= h - 0.5)) return null;
  const c0 = Math.floor(pc);
  const r0 = Math.floor(pr);
  const fc = pc - c0;
  const fr = pr - r0;
  let cov = 0;
  let depthW = 0;
  let depthSum = 0;
  let notEst = 0;
  for (let dr = 0; dr < 2; dr++) {
    for (let dc = 0; dc < 2; dc++) {
      const r = Math.min(Math.max(r0 + dr, 0), h - 1);
      const c = Math.min(Math.max(c0 + dc, 0), w - 1);
      const i = r * w + c;
      if (exclude && exclude[i]) continue;
      const wt = (dc === 0 ? 1 - fc : fc) * (dr === 0 ? 1 - fr : fr);
      const k = cells.cls[i];
      if (k === GISTDA_CELL_DEPTH) {
        cov += wt;
        depthW += wt;
        depthSum += wt * cells.depthCm[i]!;
      } else if (k === GISTDA_CELL_NOT_EST) {
        cov += wt;
        notEst += wt;
      }
    }
  }
  if (cov < 0.5) return null;
  // "ไม่ได้ประมาณ" ไม่ถูกยกเป็นแผ่น (FloodSurface ทิ้งส่วนนั้น) — popup บอกได้ แต่ไม่ใช่ตัวเลข
  if (notEst / cov > 0.5 || depthW <= 1e-4) return { depthCm: null, cellSizeM: grid.cellSizeM };
  const d = Math.round(depthSum / depthW);
  if (d < minDepthCm) return null;
  return { depthCm: d, cellSizeM: grid.cellSizeM };
}
