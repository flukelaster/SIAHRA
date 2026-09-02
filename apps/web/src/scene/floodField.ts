import * as THREE from "three";
import {
  FLOOD_FIELD_CELL_BYTES,
  FLOOD_FIELD_HEADER_BYTES,
  FLOOD_FIELD_MAGIC,
  FLOOD_FIELD_NO_DEPTH,
  FLOOD_FIELD_NO_LIKELIHOOD,
  FLOOD_FIELD_VERSION,
  FloodFieldClass,
} from "@siahra/shared-types";
import { FLOOD_DEPTH_K } from "../lib/floodStyle";

/**
 * `aoi/{code}/flood/{sceneId}/field.bin` (E14) → typed arrays → RGBA8 texture
 * ที่ทั้ง shader ของภูมิประเทศ (`terrainMaterial.ts`) และแผ่นน้ำ 3 มิติ
 * (`FloodSurface.ts`) sample ร่วมกัน
 *
 * Layout ของไฟล์อยู่ที่ `packages/shared-types/src/flood.ts` — ตัวเลขทุกตัว
 * (magic, version, ขนาด header/เซลล์, รหัสคลาส, ค่า "ไม่มี") อ่านจากที่นั่น
 * ไม่พิมพ์ซ้ำที่นี่ ตัวอ่านที่เห็น magic/version/ความยาวไม่ตรง **ต้อง throw**
 * ไม่ใช่เดาต่อ: ไฟล์ที่ผิดรูปคือไฟล์ที่ห้ามวาด
 *
 * ## Layout ของ texture (RGBA8, `NearestFilter`, แถวจากล่างขึ้นบนตามไฟล์)
 *
 * ไฟล์เรียงแถวแรก = ขอบใต้ของจังหวัด ซึ่งคือลำดับของ `THREE.DataTexture`
 * อยู่แล้ว (`flipY = false`) จึงคัดลอกแถวตามลำดับเดิม **ไม่มีการพลิก** — ต่างจาก
 * `floodMask.ts` ที่รับ polygon (บน→ล่าง) แล้วต้องกลับแถวเอง
 *
 *   R = class × FLOOD_TEX_CLASS_STEP (0,40,…,200)  → shader ถอดกลับด้วย
 *       `floor(r × 255 / 40 + 0.5)` แล้วเทียบกับ `FloodFieldClass`
 *   G = min(depthCm, FLOOD_TEX_DEPTH_FULL_SCALE_CM) / FULL_SCALE × 255
 *       (0 เมื่อไม่มีค่า = 0xFFFF) — 8 บิตบน 10 ม. = ขั้นละ ~4 ซม. พอสำหรับการวาด
 *   B = likelihood 0..100 × 2.55 (255 = ไม่มีค่า → 0) — "ความเชื่อมั่นของการ
 *       จำแนกภาพ" ของ GFM ยังไม่ถูกวาดใน F4 แต่อยู่ใน texture แล้ว
 *   A = 255 เมื่อเซลล์นั้นมีค่าความลึก (class = FLOODED และ depth ≠ 0xFFFF) ไม่งั้น 0
 *
 * ค่าคงที่สามตัวข้างล่างถูกฝังลง GLSL ผ่าน `floodFieldGlsl()` — ที่เดียวที่
 * ประกาศ layout นี้ทั้งฝั่ง CPU และ GPU
 */
export interface FloodField {
  width: number;
  height: number;
  cls: Uint8Array;
  depthCm: Uint16Array;
  likelihood: Uint8Array;
}

/** R = class × 40 */
export const FLOOD_TEX_CLASS_STEP = 40;
/** G เต็มสเกลที่ 10 ม. — เพดานความลึกของสัญญา (`depthCm 0..1000`, `depthCapCm: 1000`) */
export const FLOOD_TEX_DEPTH_FULL_SCALE_CM = 1000;
/** B = likelihood × 2.55 */
export const FLOOD_TEX_LIKELIHOOD_SCALE = 255 / 100;

/** ไฟล์ผิดรูป — ผู้เรียกต้องแสดงเป็นความล้มเหลว ไม่ใช่วาดอะไรบางส่วน */
export class FloodFieldFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FloodFieldFormatError";
  }
}

const hex = (v: number) => `0x${v.toString(16)}`;

/** สองไบต์แรกของสตรีม gzip (RFC 1952) — `1f 8b` */
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/**
 * true เมื่อบัฟเฟอร์ยังเป็น gzip อยู่ (ยังไม่ได้แกะ) — ชนกับ magic "SFLD"
 * (`53 46 4c 44`) ไม่ได้ จึงตัดสินจากสองไบต์แรกได้อย่างปลอดภัย
 */
export function isGzipBytes(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 2) return false;
  const b = new Uint8Array(buf, 0, 2);
  return b[0] === GZIP_MAGIC_0 && b[1] === GZIP_MAGIC_1;
}

/**
 * แกะ gzip ในเบราว์เซอร์ **เฉพาะเมื่อไบต์บอกว่าเป็น gzip** — ไม่ใช่ตาม header
 *
 * วัดบน prod 2026-09-02: เมื่อ Cloudflare ตอบจาก cache (HIT) `field.bin` บางครั้ง
 * กลับมา **โดยไม่มี** `content-encoding: gzip` ทั้งที่ body ยังเป็นไบต์ gzip
 * (`1f 8b`) เดิม — `fetch()` จึงส่งไบต์ที่ยังบีบอัดอยู่ให้เรา ส่วนตอน MISS
 * header ครบ เบราว์เซอร์แกะให้แล้ว ตัวอ่านจึงต้องดูที่ไบต์ ไม่ใช่ header:
 * ขึ้นต้นด้วย `1f 8b` → แกะด้วย `DecompressionStream("gzip")` ก่อน; ไม่งั้นส่งต่อ
 * ตามเดิม `decodeFloodField` เองยังเข้มงวดเท่าเดิม (รับเฉพาะ magic SFLD) — สตรีม
 * gzip ที่เสียจะ reject ที่นี่ ไม่ใช่ไปหลุดเป็น "magic ไม่ตรง"
 */
export async function inflateFloodFieldBytes(buf: ArrayBuffer): Promise<ArrayBuffer> {
  if (!isGzipBytes(buf)) return buf;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/**
 * ถอด `field.bin` (ไบต์ดิบหลัง gunzip — ผ่าน `inflateFloodFieldBytes` มาก่อน
 * เมื่อ fetch ได้ไบต์ที่ยังบีบอัดอยู่) ตรวจ magic → version → ความยาวรวม ตามลำดับ
 * แล้ว throw ทันทีที่ไม่ตรง
 */
export function decodeFloodField(buf: ArrayBuffer): FloodField {
  if (buf.byteLength < FLOOD_FIELD_HEADER_BYTES) {
    throw new FloodFieldFormatError(
      `field.bin สั้นกว่า header: ${buf.byteLength} < ${FLOOD_FIELD_HEADER_BYTES} ไบต์`,
    );
  }
  const view = new DataView(buf);
  const magic = view.getUint32(0, true);
  if (magic !== FLOOD_FIELD_MAGIC) {
    throw new FloodFieldFormatError(`magic ของ field.bin ไม่ตรง: ${hex(magic)} ≠ ${hex(FLOOD_FIELD_MAGIC)}`);
  }
  const version = view.getUint16(4, true);
  if (version !== FLOOD_FIELD_VERSION) {
    throw new FloodFieldFormatError(`รุ่นของ field.bin ไม่รู้จัก: ${version} (ตัวอ่านนี้รู้จักรุ่น ${FLOOD_FIELD_VERSION})`);
  }
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  if (width === 0 || height === 0) {
    throw new FloodFieldFormatError(`ขนาดตารางของ field.bin เป็นศูนย์: ${width}×${height}`);
  }
  const n = width * height;
  const expected = FLOOD_FIELD_HEADER_BYTES + n * FLOOD_FIELD_CELL_BYTES;
  if (buf.byteLength !== expected) {
    throw new FloodFieldFormatError(
      `ความยาว field.bin ไม่ตรง: ${buf.byteLength} ≠ ${expected} (${width}×${height} เซลล์)`,
    );
  }
  const cls = new Uint8Array(n);
  const depthCm = new Uint16Array(n);
  const likelihood = new Uint8Array(n);
  // u16 อยู่ที่ offset 1 ของเซลล์ (ไม่ align 2 ไบต์) จึงต้องอ่านผ่าน DataView
  for (let i = 0, o = FLOOD_FIELD_HEADER_BYTES; i < n; i++, o += FLOOD_FIELD_CELL_BYTES) {
    cls[i] = view.getUint8(o);
    depthCm[i] = view.getUint16(o + 1, true);
    likelihood[i] = view.getUint8(o + 3);
  }
  return { width, height, cls, depthCm, likelihood };
}

/** ไบต์ RGBA ของ texture ตาม layout ที่หัวไฟล์ประกาศ — แยกออกมาให้เทสอ่านได้โดยไม่ต้องมี GPU */
export function encodeFloodFieldRgba(field: FloodField): Uint8Array {
  const n = field.width * field.height;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = field.cls[i];
    const d = field.depthCm[i];
    const l = field.likelihood[i];
    const hasDepth = c === FloodFieldClass.FLOODED && d !== FLOOD_FIELD_NO_DEPTH;
    out[i * 4] = c * FLOOD_TEX_CLASS_STEP;
    out[i * 4 + 1] = hasDepth
      ? Math.round((Math.min(d, FLOOD_TEX_DEPTH_FULL_SCALE_CM) / FLOOD_TEX_DEPTH_FULL_SCALE_CM) * 255)
      : 0;
    out[i * 4 + 2] = l === FLOOD_FIELD_NO_LIKELIHOOD ? 0 : Math.round(Math.min(l, 100) * FLOOD_TEX_LIKELIHOOD_SCALE);
    out[i * 4 + 3] = hasDepth ? 255 : 0;
  }
  return out;
}

export interface FloodFieldTexture {
  texture: THREE.DataTexture;
  dispose: () => void;
}

/**
 * RGBA8 บนกริด overview ของจังหวัด — `NearestFilter` เพราะ R เป็นรหัสคลาสที่ห้าม
 * ถูกเฉลี่ย (shader ทำ bilinear เองเฉพาะช่องที่เฉลี่ยได้ ดู `floodFieldGlsl`)
 */
export function buildFloodFieldTexture(field: FloodField): FloodFieldTexture {
  const texture = new THREE.DataTexture(
    encodeFloodFieldRgba(field),
    field.width,
    field.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.flipY = false;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return { texture, dispose: () => texture.dispose() };
}

export interface FloodFieldSummary {
  /** เซลล์ที่ GFM จำแนกว่าท่วม (FLOODED + FLOODED_DEPTH_NOT_ESTIMATED) */
  floodedCells: number;
  /** เซลล์ท่วมที่มีค่าความลึก (class FLOODED และ depth ≠ 0xFFFF) */
  depthEstimatedCells: number;
  /** null เมื่อไม่มีเซลล์ใดมีค่าความลึก — ห้ามรายงานเป็น 0 */
  maxDepthCm: number | null;
}

export function summarizeFloodField(field: FloodField): FloodFieldSummary {
  let floodedCells = 0;
  let depthEstimatedCells = 0;
  let maxDepthCm: number | null = null;
  const n = field.width * field.height;
  for (let i = 0; i < n; i++) {
    const c = field.cls[i];
    if (c === FloodFieldClass.FLOODED) {
      floodedCells++;
      const d = field.depthCm[i];
      if (d !== FLOOD_FIELD_NO_DEPTH) {
        depthEstimatedCells++;
        if (maxDepthCm === null || d > maxDepthCm) maxDepthCm = d;
      }
    } else if (c === FloodFieldClass.FLOODED_DEPTH_NOT_ESTIMATED) {
      floodedCells++;
    }
  }
  return { floodedCells, depthEstimatedCells, maxDepthCm };
}

/** กริดที่ฟิลด์วางอยู่ (จาก `manifest.terrain` + `terrain.projection`) — พอสำหรับแปลงพิกัดฉาก → เซลล์ */
export interface FloodFieldGrid {
  width: number;
  height: number;
  cellSizeM: number;
  gridWidthM: number;
  gridHeightM: number;
}

/** ค่าของเซลล์เดียวในฟิลด์ — ที่ popup ของจุดบนแผนที่แสดง (E14.F5) */
export interface FloodCell {
  cls: number;
  /** ซม. เฉพาะ class FLOODED ที่มีค่า (0xFFFF → null) — ห้ามอ่าน null เป็น 0 */
  depthCm: number | null;
  /** ความเชื่อมั่นของการจำแนกภาพ 0–100 ของ GFM (255 → null) — ไม่ใช่ความน่าจะเป็นของอะไรที่ยังไม่เกิด */
  likelihood: number | null;
}

/**
 * ค่าความเชื่อมั่นที่ UI *แสดงได้* ของเซลล์ — `null` = ไม่มีบรรทัดนั้น
 *
 * likelihood มีความหมายเฉพาะเซลล์ที่ GFM *จำแนก* จริง (ท่วม / ท่วมแต่ไม่ได้ประมาณ
 * ความลึก / แห้ง) — เซลล์ที่ SAR มองไม่เห็น (EXCLUDED) หรือไม่มีภาพ (NO_OBSERVATION)
 * ไม่มีการจำแนกให้เชื่อมั่น ค่าที่ติดมาในไฟล์เป็นเศษของมาสก์ ต้องไม่โผล่เป็น "11/100"
 * ใต้ประโยค "ไม่มีการจำแนก" (น้ำอ้างอิงก็ไม่ใช่ผลการจำแนกของฉากนี้ — มาจากมาสก์
 * น้ำถาวร) — 88% ของฟิลด์เชียงรายจริงเป็น EXCLUDED จึงเป็นคลิกส่วนใหญ่
 */
export function gfmConfidence(cell: Pick<FloodCell, "cls" | "likelihood">): number | null {
  if (cell.likelihood === null) return null;
  return cell.cls === FloodFieldClass.FLOODED ||
    cell.cls === FloodFieldClass.FLOODED_DEPTH_NOT_ESTIMATED ||
    cell.cls === FloodFieldClass.DRY
    ? cell.likelihood
    : null;
}

/**
 * เซลล์ของฟิลด์ใต้จุด `(localX, localZ)` ในพิกัดฉาก (เมตร, จุดกำเนิดกลางกริด) —
 * การวางจุดชุดเดียวกับ `buildTerrainMesh` / `createFloodSurface`: คอลัมน์ c อยู่ที่
 * `x = c·cell − W/2`, แถว r (0 = เหนือ) ที่ `z = r·cell − H/2` จึงกลับทางด้วย
 * `col = floor((x + W/2)/cell)`, `row = floor((z + H/2)/cell)` แล้วชี้เข้าไฟล์ซึ่งเรียง
 * แถว **จากล่างขึ้นบน** (`texRow = height − 1 − row`, ดูหัวไฟล์)
 *
 * `null` เมื่อจุดอยู่นอกกริด หรือขนาดฟิลด์ไม่ตรงกริด (ฉากจาก manifest คนละรุ่น —
 * Map3DCanvas ไม่วาดฟิลด์นั้นอยู่แล้ว popup จึงต้องไม่อ่านค่าจากมันเช่นกัน)
 */
export function floodCellAt(field: FloodField, grid: FloodFieldGrid, localX: number, localZ: number): FloodCell | null {
  if (field.width !== grid.width || field.height !== grid.height) return null;
  const col = Math.floor((localX + grid.gridWidthM / 2) / grid.cellSizeM);
  const row = Math.floor((localZ + grid.gridHeightM / 2) / grid.cellSizeM);
  if (col < 0 || col >= grid.width || row < 0 || row >= grid.height) return null;
  const i = (grid.height - 1 - row) * grid.width + col;
  const cls = field.cls[i];
  const d = field.depthCm[i];
  const l = field.likelihood[i];
  return {
    cls,
    depthCm: cls === FloodFieldClass.FLOODED && d !== FLOOD_FIELD_NO_DEPTH ? d : null,
    likelihood: l === FLOOD_FIELD_NO_LIKELIHOOD ? null : l,
  };
}

/** กรอบ (คอลัมน์/แถวของ texture, ล่างขึ้นบน, ปิดทั้งสองด้าน) ของเซลล์ที่มีค่าความลึก */
export interface FloodFieldBounds {
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}

/**
 * กรอบของเซลล์ FLOODED ที่มีค่าความลึก — แผ่นน้ำ 3 มิติสร้าง vertex เฉพาะในกรอบนี้
 * (บวกขอบ 1 เซลล์) แทนทั้งจังหวัด; `null` = ไม่มีอะไรให้ยกเป็นแผ่น
 */
export function floodFieldDepthBounds(field: FloodField): FloodFieldBounds | null {
  let c0 = Infinity;
  let c1 = -Infinity;
  let r0 = Infinity;
  let r1 = -Infinity;
  const { width, height } = field;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      if (field.cls[i] !== FloodFieldClass.FLOODED || field.depthCm[i] === FLOOD_FIELD_NO_DEPTH) continue;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
    }
  }
  if (!Number.isFinite(c0)) return null;
  return {
    c0: Math.max(0, c0 - 1),
    c1: Math.min(width - 1, c1 + 1),
    r0: Math.max(0, r0 - 1),
    r1: Math.min(height - 1, r1 + 1),
  };
}

const glslFloat = (v: number) => v.toFixed(6);

/**
 * ฟังก์ชัน GLSL ที่ถอด layout ข้างบนกลับมา — ใช้ทั้งใน terrainMaterial (fragment)
 * และ FloodSurface (vertex + fragment) จึงมีที่เดียว
 *
 * `siahraFloodSample(tex, uv, cov, depthM, notEst)` ทำ bilinear ด้วย `texelFetch`
 * สี่จุดรอบ uv **เฉพาะช่องที่เฉลี่ยได้**:
 *   - `cov`    = สัดส่วนที่ท่วม (FLOODED หรือ FLOODED_DEPTH_NOT_ESTIMATED) 0–1
 *                → ขอบนุ่มระดับครึ่งเซลล์ ไม่หยักตามกริด 200 ม.
 *   - `depthM` = ความลึกเฉลี่ยถ่วงน้ำหนักของเซลล์ FLOODED รอบ ๆ (เมตร)
 *   - `notEst` = สัดส่วนของส่วนที่ท่วมซึ่ง "ไม่ได้ประมาณความลึก" 0–1
 * รหัสคลาสไม่ถูกเฉลี่ยข้ามกัน (เทียบเท่ากันทีละ texel) และ texture เองเป็น
 * NearestFilter จึงไม่มีทางได้คลาสปลอมจากการผสม 2 กับ 5
 *
 * `siahraDepthMix(depthM)` = `1 − exp(−k·depth)` ตัวเดียวกับ `depthToMix` ใน
 * lib/floodStyle.ts (k ฝังมาจากค่าเดียวกัน)
 */
export function floodFieldGlsl(): string {
  return /* glsl */ `
const float SIAHRA_FLOOD_CLASS_STEP = ${glslFloat(FLOOD_TEX_CLASS_STEP)};
const float SIAHRA_FLOOD_DEPTH_FULL_M = ${glslFloat(FLOOD_TEX_DEPTH_FULL_SCALE_CM / 100)};
const float SIAHRA_FLOOD_CLS_FLOODED = ${glslFloat(FloodFieldClass.FLOODED)};
const float SIAHRA_FLOOD_CLS_NOT_EST = ${glslFloat(FloodFieldClass.FLOODED_DEPTH_NOT_ESTIMATED)};
const float SIAHRA_FLOOD_DEPTH_K = ${glslFloat(FLOOD_DEPTH_K)};
float siahraDepthMix(float depthM) {
  return 1.0 - exp(-SIAHRA_FLOOD_DEPTH_K * max(depthM, 0.0));
}
void siahraFloodSample(sampler2D tex, vec2 uv, out float cov, out float depthM, out float notEst) {
  ivec2 size = textureSize(tex, 0);
  vec2 p = uv * vec2(size) - 0.5;
  ivec2 i0 = ivec2(floor(p));
  vec2 f = fract(p);
  float covSum = 0.0;
  float depthW = 0.0;
  float depthSum = 0.0;
  float notEstSum = 0.0;
  for (int dy = 0; dy < 2; dy++) {
    for (int dx = 0; dx < 2; dx++) {
      ivec2 ij = clamp(i0 + ivec2(dx, dy), ivec2(0), size - 1);
      vec4 t = texelFetch(tex, ij, 0);
      float w = (dx == 0 ? 1.0 - f.x : f.x) * (dy == 0 ? 1.0 - f.y : f.y);
      float cls = floor(t.r * 255.0 / SIAHRA_FLOOD_CLASS_STEP + 0.5);
      float isFlooded = cls == SIAHRA_FLOOD_CLS_FLOODED ? 1.0 : 0.0;
      float isNotEst = cls == SIAHRA_FLOOD_CLS_NOT_EST ? 1.0 : 0.0;
      covSum += w * (isFlooded + isNotEst);
      depthW += w * isFlooded;
      depthSum += w * isFlooded * t.g * SIAHRA_FLOOD_DEPTH_FULL_M;
      notEstSum += w * isNotEst;
    }
  }
  cov = covSum;
  depthM = depthW > 1e-4 ? depthSum / depthW : 0.0;
  notEst = covSum > 1e-4 ? notEstSum / covSum : 0.0;
}
`;
}
