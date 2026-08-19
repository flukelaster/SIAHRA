/**
 * ส่วน "คำนวณล้วน" ของ overlay ที่ terrain shader อ่าน (ดู hazardOverlay.ts
 * สำหรับความหมายของแต่ละแชนแนล)
 *
 * แยกออกจาก hazardOverlay.ts เพราะไฟล์นี้ต้อง **ไม่ import three**: มันถูกเรียก
 * ทั้งจาก main thread และจาก `workers/overlay.worker.ts` การลาก three เข้าไปใน
 * worker bundle จะทำให้ worker หนักกว่างานที่มันทำ
 *
 * ฟังก์ชันนี้บริสุทธิ์: input เดิมให้ผลลัพธ์ไบต์ต่อไบต์เท่ากันเสมอ และไม่แก้ไข
 * อาร์เรย์ที่รับเข้ามา — เป็นเหตุผลว่าทำไมการย้ายไป worker จึงตรวจสอบได้ว่า
 * "ผลเท่าเดิม" ด้วยเทสต์เดียว
 */

/** Neighbourhood over which "lower than its surroundings" is judged. */
export const LOWLAND_WINDOW_M = 3000;
/** Metres of standard deviation below which flat ground is treated as flat. */
const LOWLAND_STD_FLOOR_M = 1.5;
/** Neighbourhood relief (σ) at which ground stops counting as a plain. */
const PLAIN_STD_FROM_M = 35;
const PLAIN_STD_TO_M = 120;
const FADE_RADIUS_M = 14000;
const EDGE_FADE_M = 5000;

export interface OverlayGrid {
  width: number;
  height: number;
  cellSizeM: number;
}

export interface OverlayFieldData {
  /** RGBA ของ DataTexture (แถวเรียงจากล่างขึ้นบน) — แชนแนล G ยังเป็น 0 */
  data: Uint8Array;
  /** Fraction of in-province cells classed as low-lying (for the legend). */
  lowlandShare: number;
}

/** Separable box blur with running sums (O(N) per pass). */
export function boxBlur(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = radius * 2 + 1;
  for (let r = 0; r < height; r++) {
    const row = r * width;
    let sum = 0;
    for (let c = -radius; c <= radius; c++) sum += src[row + Math.min(width - 1, Math.max(0, c))];
    for (let c = 0; c < width; c++) {
      tmp[row + c] = sum / span;
      const add = Math.min(width - 1, c + radius + 1);
      const rem = Math.max(0, c - radius);
      sum += src[row + add] - src[row + rem];
    }
  }
  for (let c = 0; c < width; c++) {
    let sum = 0;
    for (let r = -radius; r <= radius; r++) sum += tmp[Math.min(height - 1, Math.max(0, r)) * width + c];
    for (let r = 0; r < height; r++) {
      out[r * width + c] = sum / span;
      const add = Math.min(height - 1, r + radius + 1);
      const rem = Math.max(0, r - radius);
      sum += tmp[add * width + c] - tmp[rem * width + c];
    }
  }
  return out;
}

export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * คำนวณแชนแนล R (พื้นที่ลุ่มต่ำ — ภาพประกอบจาก DEM), B (มาสก์ในจังหวัด) และ
 * A (การจางที่ขอบ) ลงในบัฟเฟอร์ RGBA ก้อนเดียว
 *
 * แชนแนล G (ฮาโลรอบสถานีที่ตรวจวัดฝนหนัก/น้ำสูง) **ไม่ได้คำนวณที่นี่** — มันถูก
 * เขียนทับทุกครั้งที่ observations รีเฟรช ซึ่งเป็นงานเบาและต้องแตะ texture ที่มี
 * ชีวิตอยู่บน main thread อยู่แล้ว (ดู `updateObserved` ใน hazardOverlay.ts)
 */
export function computeOverlayField(
  grid: OverlayGrid,
  heights: Float32Array,
  insideMask: Uint8Array | null,
): OverlayFieldData {
  const { width, height, cellSizeM } = grid;
  const n = width * height;

  // --- R: low-lying ground -------------------------------------------------
  // Three box passes approximate a Gaussian; radius chosen so the kernel
  // spans roughly LOWLAND_WINDOW_M either side.
  const radius = Math.max(2, Math.round(LOWLAND_WINDOW_M / cellSizeM / 2));
  const blur3 = (src: Float32Array) =>
    boxBlur(boxBlur(boxBlur(src, width, height, radius), width, height, radius), width, height, radius);
  const mean = blur3(heights);
  const sq = new Float32Array(n);
  for (let i = 0; i < n; i++) sq[i] = heights[i] * heights[i];
  const meanSq = blur3(sq);
  const lowRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const variance = Math.max(0, meanSq[i] - mean[i] * mean[i]);
    const std = Math.max(LOWLAND_STD_FLOOR_M, Math.sqrt(variance));
    const zScore = (heights[i] - mean[i]) / std;
    // Full strength ~1σ below the neighbourhood mean, gone slightly above it —
    // and only where the neighbourhood is a plain, so every mountain creek
    // does not light up (that is drainage, not low-lying ground).
    const plain = 1 - smoothstep(PLAIN_STD_FROM_M, PLAIN_STD_TO_M, std);
    lowRaw[i] = (1 - smoothstep(-1.0, 0.15, zScore)) * plain;
  }
  // Smooth to contiguous zones rather than per-cell speckle (DSM noise).
  const lowRadius = Math.max(1, Math.round(350 / cellSizeM));
  const low = boxBlur(boxBlur(lowRaw, width, height, lowRadius), width, height, lowRadius);

  // --- B / A: boundary mask + fade -----------------------------------------
  const maskF = new Float32Array(n);
  if (insideMask) for (let i = 0; i < n; i++) maskF[i] = insideMask[i];
  else maskF.fill(1);
  const maskSoft = boxBlur(maskF, width, height, 1);
  const fadeRadius = Math.max(2, Math.round(FADE_RADIUS_M / cellSizeM / 2));
  const fade = boxBlur(boxBlur(maskF, width, height, fadeRadius), width, height, fadeRadius);
  // Outside the province, also dissolve toward the raster edge so the
  // rectangular DEM clip never shows a hard border.
  const edgeCells = Math.max(2, EDGE_FADE_M / cellSizeM);

  const data = new Uint8Array(n * 4);
  let lowlandCells = 0;
  let insideCells = 0;
  for (let r = 0; r < height; r++) {
    // DataTexture rows run bottom-up (flipY = false) while grid row 0 is north.
    const texRow = height - 1 - r;
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      const o = (texRow * width + c) * 4;
      const inside = maskSoft[i];
      const distToEdge = Math.min(c, width - 1 - c, r, height - 1 - r);
      const edgeFade = smoothstep(0, edgeCells, distToEdge);
      const outsideAlpha = Math.pow(Math.min(1, fade[i] * 1.25), 0.45) * 0.95 * edgeFade;
      const alpha = Math.max(inside, outsideAlpha);
      data[o] = Math.round(low[i] * 255);
      data[o + 1] = 0;
      data[o + 2] = Math.round(inside * 255);
      data[o + 3] = Math.round(alpha * 255);
      if (maskF[i] > 0.5) {
        insideCells++;
        if (low[i] > 0.5) lowlandCells++;
      }
    }
  }

  return { data, lowlandShare: insideCells > 0 ? lowlandCells / insideCells : 0 };
}
