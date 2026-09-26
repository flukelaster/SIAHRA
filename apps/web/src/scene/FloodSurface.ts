import * as THREE from "three";
import type { AoiManifest } from "@siahra/shared-types";
import { FLOOD_RGB, FLOOD_STIPPLE_DOT_FRAC, STATION_SHEET_MAX_ALPHA } from "../lib/floodStyle";
import {
  ILLUSTRATIVE_HATCH_DUTY,
  ILLUSTRATIVE_RGB,
  STATION_SHEET_HATCH_GAP_ALPHA,
  STATION_SHEET_HATCH_MIX,
} from "../lib/illustrativeStyle";
import { floodFieldDepthBounds, floodFieldGlsl, type FloodField } from "./floodField";
import type { TerrainField } from "./TerrainMesh";
import { createWaterMaterial } from "./waterMaterial";

/**
 * แผ่นน้ำ 3 มิติของฉาก Copernicus GFM (E14.F4): ผิวน้ำสะท้อนแสงที่ลอยอยู่ที่
 * `y = ความสูงภูมิประเทศ + ความลึกภาพประกอบ (FwDET)` เหนือเซลล์ที่ท่วมและมีค่า
 * ความลึก — อาคารและต้นไม้ที่สูงกว่านั้นโผล่พ้นน้ำ
 *
 * ## ตำแหน่ง vertex
 *
 * ใช้การวางจุดชุดเดียวกับ `buildTerrainMesh` (กริด overview ของ `manifest.terrain`):
 * คอลัมน์ c → x = c·cell − gridWidthM/2, แถว r (0 = เหนือ) → z = r·cell −
 * gridHeightM/2, uv = (c/(w−1), 1 − r/(h−1)) — uv เดียวกับที่ shader ของ
 * ภูมิประเทศ sample `uOverlay`/`uFloodField` จึงชี้เซลล์เดียวกันเป๊ะ
 * แต่สร้างเฉพาะ **กรอบของเซลล์ที่มีค่าความลึก** (+ ขอบ 1 เซลล์,
 * `floodFieldDepthBounds`) ไม่ใช่ทั้งจังหวัด: จังหวัด 686×802 = 550k vertex
 * ส่วนน้ำท่วมมักอยู่ในแอ่งไม่กี่แอ่ง
 *
 * ## ความสูงและมาตราส่วนแนวดิ่ง
 *
 * vertex shader อ่านความสูงพื้นจาก `uTerrainHeight` (R32F, สร้างครั้งเดียวจาก
 * `terrain.heights` ของ overview) + ความลึกจาก `uFloodField` แล้วเขียน `y` ใน
 * หน่วยเมตรจริง — **ไม่มี uniform ของมาตราส่วนแนวดิ่ง**: mesh อยู่ใต้
 * `handles.world` ซึ่ง `setExaggeration` ตั้ง `world.scale.y = factor` ให้ทุกชั้น
 * georeferenced (ภูมิประเทศ อาคาร วงแหวน ขอบเขต) พร้อมกัน (`scene/setupScene.ts`)
 * แผ่นน้ำจึงยืด/หดตามภูมิประเทศเองโดยไม่ต้องรับ `applyExaggeration` แบบหมุดสไปรต์
 *
 * ## วัสดุ
 *
 * `createWaterMaterial(uTime)` (ผิวน้ำเดียวกับแม่น้ำ/คลอง) ต่อยอดด้วย
 * `onBeforeCompile` ซ้อน: สีไล่ตาม `siahraDepthMix` (สูตรเดียวกับภูมิประเทศและ
 * legend), ความทึบ 0.35 → 0.9 ตามความลึก + Fresnel ที่มุมเฉียง, `discard` ที่
 * นอกขอบเขตจังหวัด (ช่อง B ของ `terrain.overlay` — มาสก์เดียวกับที่ภูมิประเทศใช้
 * หรี่จังหวัดข้างเคียง) / coverage < 0.5 / ไม่ได้ประมาณความลึก / ลึกน้อยกว่า 2 ซม.
 * โปร่งแสง ไม่เขียน depth และ polygonOffset (ติดมากับวัสดุน้ำ) จึงไม่ z-fight กับ
 * พื้นที่ขอบน้ำตื้น กรอบ vertex ยังเป็น bbox ของเซลล์ที่มีความลึกทั้งหมด (รวมที่อยู่
 * นอกจังหวัด) — การตัดเกิดต่อ fragment ไม่ใช่ตอนสร้าง geometry
 */
export interface FloodSurface {
  mesh: THREE.Mesh;
  vertexCount: number;
  dispose: () => void;
}

const DEPTH_MIN_M = 0.02;
/**
 * แผ่น GFM วาดหลังแผ่นจำลองจากสถานี (`STATION_SHEET_RENDER_ORDER` = 1 ใน `StationSheet.ts`) —
 * ดาวเทียมที่เห็นจริงอยู่ข้างบน (E16 B-1 รอบ 3); ต่ำกว่าผิวน้ำ/ถนนของ FeatureTiles (6/8)
 */
export const FLOOD_SURFACE_RENDER_ORDER = 2;
/**
 * เกณฑ์ "อยู่ในจังหวัด" ของช่อง B ใน overlay — มาสก์ถูกเบลอหนึ่งเซลล์ตอนสร้าง
 * (`overlayField.ts` maskSoft) ครึ่งทางจึงคือเส้นขอบเขตพอดี ไม่ใช่ล้ำเข้า/ออก
 */
const MASK_INSIDE_MIN = 0.5;

/**
 * texture ความสูงพื้น (R32F, แถวล่างขึ้นบนแบบเดียวกับ `uFloodField`) — Nearest
 * เพราะ float texture กรองเชิงเส้นไม่ได้โดยไม่มี extension และ vertex อยู่ที่ศูนย์
 * เซลล์พอดีอยู่แล้ว
 */
function buildHeightTexture(heights: Float32Array, width: number, height: number): THREE.DataTexture {
  const data = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    const texRow = height - 1 - r;
    data.set(heights.subarray(r * width, (r + 1) * width), texRow * width);
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.FloatType);
  tex.flipY = false;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * รูปแบบที่สองของแผ่นน้ำ (E16 B-1: แผ่นน้ำจำลองจากระดับน้ำที่สถานี `scene/StationSheet.ts`) —
 * ท่อเดียวกันทุกอย่าง ต่างแค่สีไล่ระดับ, ตัวคูณความทึบ (หรี่เมื่อค่าตรวจวัดค้าง) และคีย์ของ
 * program cache ไม่ส่ง = แผ่น GFM เดิมทุกไบต์ (GLSL และคีย์ cache ไม่เปลี่ยน)
 */
export interface FloodSurfaceVariant {
  /** คีย์ program cache — ต้องต่างจาก "siahra-flood-surface" ไม่งั้น three ใช้ program ของ GFM ซ้ำ */
  cacheKey: string;
  name: string;
  palette: { shallow: readonly [number, number, number]; deep: readonly [number, number, number] };
  /** ตัวคูณความทึบสุดท้าย (1 = ปกติ) — ผู้เรียกเขียนค่าเองเมื่อหรี่/เลิกหรี่ */
  opacity: { value: number };
  /**
   * แผ่นจำลองจากสถานี (E16 B-1 รอบ 3): ช่อง B ของ texture = ความจางตามระยะจากสถานี (คูณความทึบ),
   * เซลล์ "ไม่ได้ประมาณความลึก" (อาคาร/ต้นไม้) วาดเป็นลายจุดบนพื้น แทนการ discard
   */
  sheet?: {
    /** คาบของลายจุด (px) — uniform ตัวเดียวกับของภูมิประเทศ (`uHatchPx`) */
    hatchPx: { value: number };
    /**
     * ตัดแผ่น overview ออกตรงหน้าต่าง 30 ม. (texture R8 ขนาดตารางไทล์ leaf, 1 = มีหน้าต่าง)
     * `x0/z0` = พิกัดฉากของมุมหน้าต่าง (0, 0), `tileM` = ขนาดหน้าต่าง — ขอบเดียวกับ vertex ของหน้าต่าง
     */
    clip?: { texture: { value: THREE.Texture }; xf: { value: THREE.Vector3 } };
  };
  /**
   * กริดของตัวเอง (หน้าต่าง 30 ม. หนึ่งไทล์) แทนกริด overview: vertex (c, r) อยู่ที่
   * `(x0 + c·cell, z0 + r·cell)` ตรงศูนย์กลาง texel พอดี ความสูงจาก `heights` (แถว 0 = เหนือ)
   * มาสก์จังหวัดยัง sample จาก overlay ของ overview ผ่านตำแหน่งฉาก
   */
  window?: { cols: number; rows: number; x0: number; z0: number; cellSizeM: number; heights: Float32Array };
  /**
   * แผ่นบนขอบเขตที่ **ตรวจวัดจริง** (E16 B-2: แผ่นน้ำ GISTDA) — วาดทุกเซลล์ FLOODED ที่มีค่าความลึก
   * รวมที่ตื้นกว่า 2 ซม. (ขอบเขตคือสิ่งที่ดาวเทียมเห็น ความลึกแค่ไล่เฉด — ตัดเซลล์ตื้นทิ้งจะทำให้พื้นที่
   * ที่เห็นว่าท่วมหายเป็นรู) ความทึบขั้นต่ำ `minAlpha` แทน 0.35 ใช้ได้เฉพาะเมื่อไม่มี `sheet`
   */
  observedExtent?: { minAlpha: number };
}

const glslVec3 = (c: readonly [number, number, number]) =>
  `vec3(${c.map((v) => v.toFixed(4)).join(", ")})`;

// ---- แผ่นจำลองจากสถานี (variant.sheet) เท่านั้น ----
const SHEET_VERTEX_DECL = /* glsl */ `uniform vec2 uGridSize;
varying vec2 vSheetPos;
varying vec2 vSheetMaskUv;
`;
// uv ของ overlay ภูมิประเทศจากตำแหน่งฉาก — สูตรเดียวกับ TerrainTiles (x + W/2)/W, 1 − (z + H/2)/H
const SHEET_VERTEX_BODY = /* glsl */ `
  vSheetPos = position.xz;
  vSheetMaskUv = vec2((position.x + 0.5 * uGridSize.x) / uGridSize.x, 1.0 - (position.z + 0.5 * uGridSize.y) / uGridSize.y);`;

function sheetFragmentDecl(clip: boolean): string {
  return /* glsl */ `uniform float uHatchPx;
varying vec2 vSheetPos;
varying vec2 vSheetMaskUv;
${clip ? "uniform sampler2D uClipTiles;\nuniform vec3 uClipXf;\n" : ""}`;
}

/**
 * ความจางตามระยะจากสถานี (ช่อง B) เฉลี่ยแบบ bilinear เฉพาะ texel ที่ท่วม (รวม "ไม่ได้ประมาณ") —
 * ขอบนุ่มแบบเดียวกับ `siahraFloodSample` ต้องอยู่หลัง `floodFieldGlsl()` (ใช้ค่าคงที่ของมัน)
 */
const SHEET_FADE_GLSL = /* glsl */ `
float siahraSheetFade(sampler2D tex, vec2 uv) {
  ivec2 size = textureSize(tex, 0);
  vec2 p = uv * vec2(size) - 0.5;
  ivec2 i0 = ivec2(floor(p));
  vec2 f = fract(p);
  float covSum = 0.0;
  float fadeSum = 0.0;
  for (int dy = 0; dy < 2; dy++) {
    for (int dx = 0; dx < 2; dx++) {
      ivec2 ij = clamp(i0 + ivec2(dx, dy), ivec2(0), size - 1);
      vec4 t = texelFetch(tex, ij, 0);
      float w = (dx == 0 ? 1.0 - f.x : f.x) * (dy == 0 ? 1.0 - f.y : f.y);
      float cls = floor(t.r * 255.0 / SIAHRA_FLOOD_CLASS_STEP + 0.5);
      float c = (cls == SIAHRA_FLOOD_CLS_FLOODED || cls == SIAHRA_FLOOD_CLS_NOT_EST) ? 1.0 : 0.0;
      covSum += w * c;
      fadeSum += w * c * t.b;
    }
  }
  return covSum > 1e-4 ? fadeSum / covSum : 0.0;
}
`;

function sheetFragmentBody(
  maskUv: string,
  clip: boolean,
  palette: { shallow: readonly [number, number, number]; deep: readonly [number, number, number] },
): string {
  return /* glsl */ `#include <map_fragment>
if (texture2D(uMaskOverlay, ${maskUv}).b < ${MASK_INSIDE_MIN.toFixed(3)}) discard;
${
  clip
    ? `{
  // หน้าต่าง 30 ม. แทนแผ่น overview ในพื้นที่ของมันพอดี — ขอบเดียวกับ vertex ของหน้าต่าง
  ivec2 ct = ivec2(floor((vSheetPos - uClipXf.xy) / uClipXf.z));
  ivec2 cs = textureSize(uClipTiles, 0);
  if (ct.x >= 0 && ct.y >= 0 && ct.x < cs.x && ct.y < cs.y && texelFetch(uClipTiles, ct, 0).r > 0.5) discard;
}
`
    : ""
}float sfCov; float sfDepth; float sfNotEst;
siahraFloodSample(uFloodField, vFloodUv, sfCov, sfDepth, sfNotEst);
float sfFade = siahraSheetFade(uFloodField, vFloodUv);
if (sfCov < 0.5 || sfFade < 0.004) discard;
// ตัวคูณความทึบของลายทแยง (1 = บนเส้น) — ใช้ตอนตั้งเพดานความทึบหลัง Fresnel
float sfHatchA = 1.0;
if (sfNotEst > 0.5) {
  // ท่วมแต่ไม่ได้ประมาณความลึก (อาคาร/ต้นไม้ — DSM วัดหลังคา/ยอดไม้): ลายจุดในปริภูมิจอภาพ
  // คาบและขนาดจุดเดียวกับเซลล์ "ไม่ได้ประมาณ" ของ GFM บนภูมิประเทศ — ห้ามอ่านเป็น 0 ม.
  float hatchPx = max(uHatchPx, 2.0);
  float hatchAa = clamp(1.0 / hatchPx, 0.02, 0.5);
  vec2 stippleCell = fract(gl_FragCoord.xy / hatchPx) - 0.5;
  float stippleDot = 1.0 - smoothstep(${FLOOD_STIPPLE_DOT_FRAC.toFixed(6)} - hatchAa, ${FLOOD_STIPPLE_DOT_FRAC.toFixed(6)} + hatchAa, length(stippleCell));
  diffuseColor.rgb = mix(${glslVec3(palette.shallow)}, ${glslVec3(palette.deep)}, stippleDot);
  diffuseColor.a = mix(0.3, 0.85, stippleDot);
} else {
  if (sfDepth < ${DEPTH_MIN_M.toFixed(3)}) discard;
  float sfMix = siahraDepthMix(sfDepth);
  diffuseColor.rgb = mix(${glslVec3(palette.shallow)}, ${glslVec3(palette.deep)}, sfMix);
  diffuseColor.a = mix(0.35, 0.9, sfMix);
  // ลายทแยง "ภาพประกอบ" บนแผ่น — สูตร/คาบ/สัดส่วน/สีเดียวกับชั้นลุ่มต่ำใน terrainMaterial และ swatch
  // ใน legend (lib/illustrativeStyle.ts): แผ่นนี้เป็นการเติมน้ำจำลอง ต้องไม่อ่านเป็นน้ำทึบที่ตรวจวัดจริง
  float hatchPx = max(uHatchPx, 2.0);
  float hatchAa = clamp(1.0 / hatchPx, 0.02, 0.5);
  float hatchTri = abs(fract((gl_FragCoord.x + gl_FragCoord.y) / (hatchPx * 1.4142136)) - 0.5) * 2.0;
  float stripe = 1.0 - smoothstep(${ILLUSTRATIVE_HATCH_DUTY.toFixed(4)} - hatchAa, ${ILLUSTRATIVE_HATCH_DUTY.toFixed(4)} + hatchAa, hatchTri);
  diffuseColor.rgb = mix(diffuseColor.rgb, ${glslVec3(ILLUSTRATIVE_RGB.light)}, ${STATION_SHEET_HATCH_MIX.toFixed(4)} * stripe);
  sfHatchA = mix(${STATION_SHEET_HATCH_GAP_ALPHA.toFixed(4)}, 1.0, stripe);
}`;
}

/**
 * ตัวเนื้อของแผ่นบนขอบเขตที่ตรวจวัดจริง (`variant.observedExtent`, แผ่นน้ำ GISTDA) — เหมือนแผ่น GFM
 * ทุกอย่าง ยกเว้นไม่ทิ้งเซลล์ที่ตื้นกว่า 2 ซม. และความทึบเริ่มที่ `minAlpha` (ไม่มีลายทแยง: ขอบเขตไม่ใช่
 * ภาพประกอบ) — แผ่น GFM ไม่ผ่านฟังก์ชันนี้ จึงได้ GLSL เดิมทุกไบต์
 */
function observedExtentFragmentBody(
  palette: { shallow: readonly [number, number, number]; deep: readonly [number, number, number] },
  minAlpha: number,
): string {
  return /* glsl */ `#include <map_fragment>
if (texture2D(uMaskOverlay, vFloodUv).b < ${MASK_INSIDE_MIN.toFixed(3)}) discard;
float sfCov; float sfDepth; float sfNotEst;
siahraFloodSample(uFloodField, vFloodUv, sfCov, sfDepth, sfNotEst);
if (sfCov < 0.5 || sfNotEst > 0.5) discard;
float sfMix = siahraDepthMix(sfDepth);
diffuseColor.rgb = mix(${glslVec3(palette.shallow)}, ${glslVec3(palette.deep)}, sfMix);
diffuseColor.a = mix(${minAlpha.toFixed(3)}, 0.9, sfMix);`;
}

/**
 * `null` เมื่อฉากไม่มีเซลล์ที่มีค่าความลึกเลย (ฉากแห้ง หรือท่วมเฉพาะบริเวณที่ไม่
 * ประมาณ) — ไม่มีอะไรให้ยกเป็นแผ่น; ภูมิประเทศยังระบายสีตามฉากอยู่
 */
export function createFloodSurface(
  terrain: TerrainField,
  manifest: AoiManifest,
  field: FloodField,
  fieldTexture: THREE.Texture,
  uTime: { value: number },
  variant?: FloodSurfaceVariant,
): FloodSurface | null {
  const win = variant?.window;
  const sheet = variant?.sheet;
  const { width, height, cellSizeM } = win
    ? { width: win.cols, height: win.rows, cellSizeM: win.cellSizeM }
    : manifest.terrain;
  if (field.width !== width || field.height !== height) return null;
  const bounds = floodFieldDepthBounds(field, sheet !== undefined);
  if (!bounds) return null;
  const { gridWidthM, gridHeightM } = terrain.projection;

  // กรอบอยู่ในแถวของ texture (ล่างขึ้นบน) → แถวของ mesh r = height − 1 − texRow
  const rTop = height - 1 - bounds.r1;
  const rBottom = height - 1 - bounds.r0;
  const cols = bounds.c1 - bounds.c0 + 1;
  const rows = rBottom - rTop + 1;
  const n = cols * rows;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  let k = 0;
  for (let r = rTop; r <= rBottom; r++) {
    for (let c = bounds.c0; c <= bounds.c1; c++) {
      if (win) {
        // ศูนย์กลาง texel พอดี — vertex อ่านค่าของเซลล์ตัวเองโดยไม่ผสมเพื่อนบ้าน
        positions[k * 3] = win.x0 + c * cellSizeM;
        positions[k * 3 + 2] = win.z0 + r * cellSizeM;
        uvs[k * 2] = (c + 0.5) / width;
        uvs[k * 2 + 1] = 1 - (r + 0.5) / height;
      } else {
        positions[k * 3] = c * cellSizeM - gridWidthM / 2;
        positions[k * 3 + 2] = r * cellSizeM - gridHeightM / 2;
        uvs[k * 2] = c / (width - 1);
        uvs[k * 2 + 1] = 1 - r / (height - 1);
      }
      positions[k * 3 + 1] = 0; // y มาจาก vertex shader
      normals[k * 3 + 1] = 1;
      k++;
    }
  }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let q = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      indices[q++] = a;
      indices[q++] = d;
      indices[q++] = b;
      indices[q++] = b;
      indices[q++] = d;
      indices[q++] = e;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  // ขอบเขตจริงอยู่ที่ความสูงภูมิประเทศ ซึ่ง position (y = 0) ไม่รู้ — ตั้งทรงกลม
  // ล้อมให้ครอบช่วงความสูงของจังหวัดเอง แทนที่จะปิด frustum culling ทั้งก้อน
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  bb.min.y = terrain.minZ;
  bb.max.y = terrain.maxZ + 12;
  geometry.boundingSphere = bb.getBoundingSphere(new THREE.Sphere());

  const heightTexture = win
    ? buildHeightTexture(win.heights, width, height)
    : buildHeightTexture(terrain.heights, width, height);
  const uniforms = {
    uTerrainHeight: { value: heightTexture as THREE.Texture },
    uFloodField: { value: fieldTexture },
    // มาสก์จังหวัด (ช่อง B ของ overlay ภูมิประเทศ, กริดและ uv เดียวกัน) — GFM
    // จำแนกทั้ง bbox ของจังหวัด แผ่นน้ำจึงต้องถูกตัดที่ขอบเขตเหมือนที่ภูมิประเทศ
    // หรี่ส่วนนอกจังหวัด ไม่ใช่ลอยอยู่เหนือจังหวัดข้างเคียง
    uMaskOverlay: { value: terrain.overlay.texture as THREE.Texture },
    ...(variant ? { uSurfaceOpacity: variant.opacity } : {}),
    ...(sheet
      ? {
          uHatchPx: sheet.hatchPx,
          uGridSize: { value: new THREE.Vector2(gridWidthM, gridHeightM) },
          ...(sheet.clip ? { uClipTiles: sheet.clip.texture, uClipXf: sheet.clip.xf } : {}),
        }
      : {}),
  };
  // GLSL เฉพาะแผ่นจำลองจากสถานี — แผ่น GFM (ไม่มี variant) ได้ string เดิมทุกไบต์
  const maskUv = win ? "vSheetMaskUv" : "vFloodUv";
  const clip = sheet?.clip !== undefined;
  const palette = variant?.palette ?? FLOOD_RGB;
  const observed = sheet ? undefined : variant?.observedExtent;

  const material = createWaterMaterial(uTime);
  const baseCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    baseCompile(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
uniform sampler2D uTerrainHeight;
uniform sampler2D uFloodField;
varying vec2 vFloodUv;
${sheet ? SHEET_VERTEX_DECL : ""}${floodFieldGlsl()}`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
{
  float sCov; float sDepth; float sNotEst;
  siahraFloodSample(uFloodField, uv, sCov, sDepth, sNotEst);
  // เมตรจริง — มาตราส่วนแนวดิ่งมาจาก world.scale.y ของกลุ่มแม่ (setupScene)
  transformed.y = texture2D(uTerrainHeight, uv).r + sDepth;
  vFloodUv = uv;${sheet ? SHEET_VERTEX_BODY : ""}
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
uniform sampler2D uFloodField;
uniform sampler2D uMaskOverlay;
${variant ? "uniform float uSurfaceOpacity;\n" : ""}varying vec2 vFloodUv;
${sheet ? sheetFragmentDecl(clip) : ""}${floodFieldGlsl()}${sheet ? SHEET_FADE_GLSL : ""}`,
      )
      .replace(
        "#include <map_fragment>",
        sheet
          ? sheetFragmentBody(maskUv, clip, palette)
          : observed
            ? observedExtentFragmentBody(palette, observed.minAlpha)
            : /* glsl */ `#include <map_fragment>
// นอกขอบเขตจังหวัด (มาสก์ B ของ overlay = 0) ไม่วาดแผ่นน้ำเลย — bbox ของฉาก
// ครอบเซลล์ท่วมของจังหวัดข้างเคียงด้วย แต่แผ่นน้ำเป็นของจังหวัดที่เลือกเท่านั้น
if (texture2D(uMaskOverlay, vFloodUv).b < ${MASK_INSIDE_MIN.toFixed(3)}) discard;
float sfCov; float sfDepth; float sfNotEst;
siahraFloodSample(uFloodField, vFloodUv, sfCov, sfDepth, sfNotEst);
// เฉพาะเซลล์ FLOODED ที่มีค่าความลึก ≥ 2 ซม.: "ไม่ได้ประมาณ" ไม่ยกเป็นแผ่น เพราะ
// ไม่มีความสูงผิวน้ำให้วาง — บนภูมิประเทศมันยังเป็นสีน้ำ + ลายจุด
if (sfCov < 0.5 || sfNotEst > 0.5 || sfDepth < ${DEPTH_MIN_M.toFixed(3)}) discard;
float sfMix = siahraDepthMix(sfDepth);
diffuseColor.rgb = mix(${glslVec3(palette.shallow)}, ${glslVec3(palette.deep)}, sfMix);
diffuseColor.a = mix(0.35, 0.9, sfMix);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
{
  // Fresnel: มองเฉียงยิ่งสะท้อน/ทึบขึ้น (normal ถูกลายคลื่นของวัสดุน้ำรบกวนแล้ว)
  vec3 sfView = normalize(vViewPosition);
  float sfFres = pow(1.0 - clamp(dot(normal, sfView), 0.0, 1.0), 3.0);
  diffuseColor.a = clamp(diffuseColor.a + 0.3 * sfFres, 0.0, 0.95);${sheet ? `\n  diffuseColor.a = min(diffuseColor.a, ${STATION_SHEET_MAX_ALPHA.toFixed(4)}) * sfHatchA;` : ""}${variant ? "\n  diffuseColor.a *= uSurfaceOpacity;" : ""}${sheet ? "\n  diffuseColor.a *= sfFade;" : ""}
}`,
      );
  };
  const cacheKey = variant
    ? `${variant.cacheKey}${sheet ? `:sheet${win ? ":win" : ""}${clip ? ":clip" : ""}` : observed ? ":observed" : ""}`
    : "siahra-flood-surface";
  material.customProgramCacheKey = () => cacheKey;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = variant ? `${variant.name}:${manifest.aoiId}` : `flood-surface:${manifest.aoiId}`;
  // ผู้เรียกแผ่นจำลองตั้งลำดับของตัวเอง (ต่ำกว่านี้)
  mesh.renderOrder = FLOOD_SURFACE_RENDER_ORDER;
  mesh.receiveShadow = false;
  mesh.castShadow = false;

  return {
    mesh,
    vertexCount: n,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      heightTexture.dispose();
      // fieldTexture เป็นของผู้เรียก (แชร์กับ uFloodField ของภูมิประเทศ) — ผู้เรียก dispose เอง
    },
  };
}
