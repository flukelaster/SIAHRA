import * as THREE from "three";
import type { AoiManifest } from "@siahra/shared-types";
import { FLOOD_RGB } from "../lib/floodStyle";
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
 * เกณฑ์ "อยู่ในจังหวัด" ของช่อง B ใน overlay — มาสก์ถูกเบลอหนึ่งเซลล์ตอนสร้าง
 * (`overlayField.ts` maskSoft) ครึ่งทางจึงคือเส้นขอบเขตพอดี ไม่ใช่ล้ำเข้า/ออก
 */
const MASK_INSIDE_MIN = 0.5;

/**
 * texture ความสูงพื้น (R32F, แถวล่างขึ้นบนแบบเดียวกับ `uFloodField`) — Nearest
 * เพราะ float texture กรองเชิงเส้นไม่ได้โดยไม่มี extension และ vertex อยู่ที่ศูนย์
 * เซลล์พอดีอยู่แล้ว
 */
function buildHeightTexture(terrain: TerrainField, manifest: AoiManifest): THREE.DataTexture {
  const { width, height } = manifest.terrain;
  const data = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    const texRow = height - 1 - r;
    data.set(terrain.heights.subarray(r * width, (r + 1) * width), texRow * width);
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

const glslVec3 = (c: readonly [number, number, number]) =>
  `vec3(${c.map((v) => v.toFixed(4)).join(", ")})`;

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
): FloodSurface | null {
  const { width, height, cellSizeM } = manifest.terrain;
  if (field.width !== width || field.height !== height) return null;
  const bounds = floodFieldDepthBounds(field);
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
      positions[k * 3] = c * cellSizeM - gridWidthM / 2;
      positions[k * 3 + 1] = 0; // y มาจาก vertex shader
      positions[k * 3 + 2] = r * cellSizeM - gridHeightM / 2;
      normals[k * 3 + 1] = 1;
      uvs[k * 2] = c / (width - 1);
      uvs[k * 2 + 1] = 1 - r / (height - 1);
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

  const heightTexture = buildHeightTexture(terrain, manifest);
  const uniforms = {
    uTerrainHeight: { value: heightTexture as THREE.Texture },
    uFloodField: { value: fieldTexture },
    // มาสก์จังหวัด (ช่อง B ของ overlay ภูมิประเทศ, กริดและ uv เดียวกัน) — GFM
    // จำแนกทั้ง bbox ของจังหวัด แผ่นน้ำจึงต้องถูกตัดที่ขอบเขตเหมือนที่ภูมิประเทศ
    // หรี่ส่วนนอกจังหวัด ไม่ใช่ลอยอยู่เหนือจังหวัดข้างเคียง
    uMaskOverlay: { value: terrain.overlay.texture as THREE.Texture },
  };

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
${floodFieldGlsl()}`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
{
  float sCov; float sDepth; float sNotEst;
  siahraFloodSample(uFloodField, uv, sCov, sDepth, sNotEst);
  // เมตรจริง — มาตราส่วนแนวดิ่งมาจาก world.scale.y ของกลุ่มแม่ (setupScene)
  transformed.y = texture2D(uTerrainHeight, uv).r + sDepth;
  vFloodUv = uv;
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
uniform sampler2D uFloodField;
uniform sampler2D uMaskOverlay;
varying vec2 vFloodUv;
${floodFieldGlsl()}`,
      )
      .replace(
        "#include <map_fragment>",
        /* glsl */ `#include <map_fragment>
// นอกขอบเขตจังหวัด (มาสก์ B ของ overlay = 0) ไม่วาดแผ่นน้ำเลย — bbox ของฉาก
// ครอบเซลล์ท่วมของจังหวัดข้างเคียงด้วย แต่แผ่นน้ำเป็นของจังหวัดที่เลือกเท่านั้น
if (texture2D(uMaskOverlay, vFloodUv).b < ${MASK_INSIDE_MIN.toFixed(3)}) discard;
float sfCov; float sfDepth; float sfNotEst;
siahraFloodSample(uFloodField, vFloodUv, sfCov, sfDepth, sfNotEst);
// เฉพาะเซลล์ FLOODED ที่มีค่าความลึก ≥ 2 ซม.: "ไม่ได้ประมาณ" ไม่ยกเป็นแผ่น เพราะ
// ไม่มีความสูงผิวน้ำให้วาง — บนภูมิประเทศมันยังเป็นสีน้ำ + ลายจุด
if (sfCov < 0.5 || sfNotEst > 0.5 || sfDepth < ${DEPTH_MIN_M.toFixed(3)}) discard;
float sfMix = siahraDepthMix(sfDepth);
diffuseColor.rgb = mix(${glslVec3(FLOOD_RGB.shallow)}, ${glslVec3(FLOOD_RGB.deep)}, sfMix);
diffuseColor.a = mix(0.35, 0.9, sfMix);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
{
  // Fresnel: มองเฉียงยิ่งสะท้อน/ทึบขึ้น (normal ถูกลายคลื่นของวัสดุน้ำรบกวนแล้ว)
  vec3 sfView = normalize(vViewPosition);
  float sfFres = pow(1.0 - clamp(dot(normal, sfView), 0.0, 1.0), 3.0);
  diffuseColor.a = clamp(diffuseColor.a + 0.3 * sfFres, 0.0, 0.95);
}`,
      );
  };
  material.customProgramCacheKey = () => "siahra-flood-surface";

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `flood-surface:${manifest.aoiId}`;
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
