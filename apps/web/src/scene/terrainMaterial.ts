import * as THREE from "three";
import {
  ILLUSTRATIVE_BASE_MIX,
  ILLUSTRATIVE_HATCH_DUTY,
  ILLUSTRATIVE_HATCH_PERIOD_PX,
  ILLUSTRATIVE_RGB,
  ILLUSTRATIVE_RIM_MIX,
  ILLUSTRATIVE_STRIPE_MIX,
} from "../lib/illustrativeStyle";
import { EXPOSURE_RGB } from "../lib/exposureStyle";

/** ค่าคงที่ TS → literal ของ GLSL (GLSL ต้องมีจุดทศนิยมเสมอ) */
const glslFloat = (v: number) => v.toFixed(4);
const glslVec3 = (c: readonly [number, number, number]) =>
  `vec3(${c.map((v) => v.toFixed(4)).join(", ")})`;

/**
 * Terrain surface material: a standard PBR material with a small shader
 * extension that
 *   - drapes satellite imagery (map, uv channel 1) or falls back to the
 *     elevation-ramp vertex colours when no imagery is available,
 *   - blends the hazard overlay (see hazardOverlay.ts): animated water tint
 *     on low-lying ground, warm halos around stations reporting hazards,
 *   - dims terrain outside the province and fades the DEM clip's rectangular
 *     edge into the background.
 *
 * Kept as onBeforeCompile on MeshStandardMaterial so lighting, shadows and
 * tone mapping stay the stock three.js pipeline.
 */
/** Uniforms shared by every terrain material of one province (overview + tiles). */
export interface TerrainSharedUniforms {
  uOverlay: { value: THREE.Texture | null };
  uTime: { value: number };
  uShowLowland: { value: number };
  uShowHazard: { value: number };
  uOutsideDim: { value: number };
  uHillshade: { value: THREE.Texture | null };
  uHasHillshade: { value: number };
  /**
   * 1 at province scale -> ~0.4 close up; the lowland wash is a regional cue
   * and a full-strength one fills the screen with blue once a single district
   * fills the frame. Relief (the hillshade) is deliberately outside this.
   */
  uDetailFade: { value: number };
  /**
   * ระยะห่างลายเส้นของชั้น "ภาพประกอบ" หน่วยพิกเซลของ drawing buffer
   * = ILLUSTRATIVE_HATCH_PERIOD_PX × pixelRatio (ตั้งค่าใน Map3DCanvas)
   */
  uHatchPx: { value: number };
  /** 1 when the observation source is stale/unreachable: halos desaturate. */
  uHazardStale: { value: number };
  /**
   * ชั้น "ระดับการเผชิญน้ำ (ภาพประกอบ)" (E10.4) — R = ความแรงของฮาโล, G = รหัสแถบ
   * (สร้างโดย `hazardOverlay.updateExposure` บนกริดเดียวกับ `uOverlay`)
   */
  uExposure: { value: THREE.Texture | null };
  /** ปิดไว้เป็นค่าเริ่มต้น: ชั้นนี้ off by default และไม่มีการ fetch จนกว่าจะเปิด */
  uShowExposure: { value: number };
  /**
   * 1 = ไม่มีผลคำนวณรอบใหม่ (api ล่ม/ยังไม่เคยมี run) — ชั้นหรี่ลงแทนที่จะหายไป
   * และ legend บอกว่าไม่มี run ตั้งแต่เมื่อไหร่
   */
  uExposureStale: { value: number };
  /** Satellite flood-extent mask (R channel, province overlay grid). */
  uFloodMask: { value: THREE.Texture | null };
  uShowFlood: { value: number };
  /** TMD radar composite frame + geo mapping (see RadarOverlay). */
  uRadar: { value: THREE.Texture | null };
  uShowRadar: { value: number };
  uRadarBounds: { value: THREE.Vector4 };
  uRadarLL: { value: THREE.Vector2[] };
}

export interface TerrainUniforms extends TerrainSharedUniforms {
  /** Per material: whether `map` (imagery) is set. */
  uHasImagery: { value: number };
}

export function createTerrainSharedUniforms(): TerrainSharedUniforms {
  return {
    uOverlay: { value: null },
    uTime: { value: 0 },
    uShowLowland: { value: 1 },
    uShowHazard: { value: 1 },
    uOutsideDim: { value: 0.68 },
    uHillshade: { value: null },
    uHasHillshade: { value: 0 },
    uDetailFade: { value: 1 },
    uHatchPx: { value: ILLUSTRATIVE_HATCH_PERIOD_PX },
    uHazardStale: { value: 0 },
    uExposure: { value: null },
    uShowExposure: { value: 0 },
    uExposureStale: { value: 0 },
    uFloodMask: { value: null },
    uShowFlood: { value: 0 },
    uRadar: { value: null },
    uShowRadar: { value: 0 },
    uRadarBounds: { value: new THREE.Vector4(95.005, 3.995, 108.005, 22.495) },
    uRadarLL: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
  };
}

export interface TerrainMaterial {
  material: THREE.MeshStandardMaterial;
  uniforms: TerrainUniforms;
  setImagery: (texture: THREE.Texture | null) => void;
  setOverlay: (texture: THREE.Texture | null) => void;
  setHillshade: (texture: THREE.Texture | null) => void;
}

const VERTEX_PARS = /* glsl */ `
varying vec2 vTerrainUv;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uOverlay;
uniform float uTime;
uniform float uShowLowland;
uniform float uShowHazard;
uniform float uOutsideDim;
uniform float uHasImagery;
uniform sampler2D uHillshade;
uniform float uHasHillshade;
uniform float uDetailFade;
uniform float uHatchPx;
uniform float uHazardStale;
uniform sampler2D uExposure;
uniform float uShowExposure;
uniform float uExposureStale;
uniform sampler2D uFloodMask;
uniform float uShowFlood;
uniform sampler2D uRadar;
uniform float uShowRadar;
uniform vec4 uRadarBounds;
uniform vec2 uRadarLL[4];
varying vec2 vTerrainUv;
vec3 siahraEmissive = vec3(0.0);

float siahraHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float siahraNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = siahraHash(i);
  float b = siahraHash(i + vec2(1.0, 0.0));
  float c = siahraHash(i + vec2(0.0, 1.0));
  float d = siahraHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// สีไล่ตามแถบของชั้นการเผชิญน้ำ — จุดยึดตรงกับ EXPOSURE_CODE ใน lib/exposureStyle.ts
// (0.25 = แถบต่ำสุด, 0.5 elevated, 0.75 high, 1.0 severe) แถบต่ำสุดไม่เคยถูกระบาย
// จริง แต่คงจุดยึดไว้เพื่อให้การไล่สีของค่าที่ถูก filter มาไม่กระโดด
vec3 siahraExposureRamp(float code) {
  vec3 c = ${glslVec3(EXPOSURE_RGB.low)};
  c = mix(c, ${glslVec3(EXPOSURE_RGB.elevated)}, smoothstep(0.25, 0.5, code));
  c = mix(c, ${glslVec3(EXPOSURE_RGB.high)}, smoothstep(0.5, 0.75, code));
  c = mix(c, ${glslVec3(EXPOSURE_RGB.severe)}, smoothstep(0.75, 1.0, code));
  return c;
}
`;

// Replaces <color_fragment>: vertex colours are the imagery fallback only.
const COLOR_FRAGMENT = /* glsl */ `
#if defined(USE_COLOR)
  if (uHasImagery < 0.5) diffuseColor.rgb *= vColor.rgb;
#endif
if (uHasImagery > 0.5) {
  // Basemap tiles are tuned for flat 2D maps; lift and saturate a touch so
  // the draped surface reads as daylight under our lighting.
  vec3 img = pow(diffuseColor.rgb, vec3(0.88)) * 1.08;
  float imgLum = dot(img, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = clamp(mix(vec3(imgLum), img, 1.22), 0.0, 1.0);
}

vec4 ov = texture2D(uOverlay, vTerrainUv);
float inside = ov.b;

// Analytic hillshade from the DEM adds crisp relief on top of the scene
// lighting (flat ground ~0.71 in gdaldem's output => neutral). Deliberately
// NOT scaled by uDetailFade: relief is what makes the surface read as 3D at
// every scale, and dimming it close up flattened the terrain just as the
// slopes became worth looking at.
if (uHasHillshade > 0.5) {
  float hs = texture2D(uHillshade, vTerrainUv).r;
  diffuseColor.rgb *= mix(1.0, clamp(hs / 0.71, 0.35, 1.45), 0.6);
}

// Neighbouring provinces: darker and slightly desaturated so the selected
// province reads clearly, then dissolve toward the sky.
float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
vec3 outsideCol = mix(vec3(lum), diffuseColor.rgb, 0.55) * uOutsideDim;
diffuseColor.rgb = mix(outsideCol, diffuseColor.rgb, inside);

// พื้นที่ลุ่มต่ำ = ชั้น "ภาพประกอบ" ที่เราคำนวณจาก DEM เอง จึงต้องดูไม่เหมือน
// ผิวน้ำที่ใครวัดมา: ลายเส้นทแยงสีม่วง ไม่เคลื่อนไหว และไม่ใช่สีของน้ำ ตรงข้ามกับ
// พื้นที่น้ำท่วมจากภาพดาวเทียม (GISTDA) ด้านล่างที่เป็นพื้นทึบสีน้ำ — ต่างกันทั้ง
// เนื้อลาย ค่าความสว่างและสี จึงแยกออกได้แม้ในภาพขาวดำ
// (ค่าสี/ระยะห่างลาย/สัดส่วนเส้น/เส้นขอบ มาจาก lib/illustrativeStyle.ts ที่สัญลักษณ์
//  ใน legend อ่านชุดเดียวกัน — ห้ามแก้ค่าที่นี่ฝั่งเดียว)
vec2 flowUv = vTerrainUv * vec2(90.0, 110.0);
float lowRaw = ov.r * uShowLowland;
float low = smoothstep(0.22, 0.85, lowRaw);
// ลายเส้นวางในปริภูมิ "จอภาพ": ระยะห่างคงที่เป็นพิกเซลไม่ว่ากล้องจะอยู่ไกลแค่ไหน
// หรือจังหวัดจะมีขนาดเท่าใด — แปลงลุ่มต่ำส่วนใหญ่กว้างราว 5 px ถ้าผูกความถี่กับ
// UV ของจังหวัด แปลงพวกนี้จะตกอยู่ในเส้นเดียวและอ่านเป็นพื้นทึบ (= ภาษาของข้อมูล
// ตรวจวัดจริง) ผลพลอยได้: ลายต่อเนื่องข้ามรอยต่อ LOD tile และข้ามชั้น overview
// โดยไม่ต้องพึ่งพิกัดใด ๆ ของ tile
float hatchPx = max(uHatchPx, 2.0);
float hatchT = (gl_FragCoord.x + gl_FragCoord.y) / (hatchPx * 1.4142136);
float hatchTri = abs(fract(hatchT) - 0.5) * 2.0;
// ลายยึดกับ pixel grid จึงไม่มีทางเกิด moire — ขอบเส้นจึงกำหนดคงที่ที่ ~0.5 px
// (ในหน่วยของ hatchTri = 1/hatchPx) ให้เส้นคมที่สุดเท่าที่ยังไม่หยัก
float hatchAa = clamp(1.0 / hatchPx, 0.02, 0.5);
float stripe = 1.0 - smoothstep(${glslFloat(ILLUSTRATIVE_HATCH_DUTY)} - hatchAa, ${glslFloat(ILLUSTRATIVE_HATCH_DUTY)} + hatchAa, hatchTri);
vec3 illusDark = ${glslVec3(ILLUSTRATIVE_RGB.dark)};
vec3 illusLight = ${glslVec3(ILLUSTRATIVE_RGB.light)};
vec3 illusRim = ${glslVec3(ILLUSTRATIVE_RGB.rim)};
vec3 illusCol = mix(illusDark, illusLight, stripe);
// uDetailFade ลด "น้ำหนัก" ของพื้น ไม่ใช่ตัด mask ทิ้ง: เดิมคูณก่อน smoothstep
// ทำให้เข้าใกล้แล้วแปลงหดหายทั้งแปลง เหลือแต่น้ำท่วม GISTDA เป็นพื้นทึบ — สองชั้น
// จึงแยกกันไม่ออกในช่วงซูมนั้น ตอนนี้ขอบเขตคงเดิม แค่จางลงราว 0.55 เท่า
float illusFill = low * mix(0.55, 1.0, uDetailFade) * mix(0.45, 1.0, inside);
float illusMix = illusFill * (${glslFloat(ILLUSTRATIVE_BASE_MIX)} + ${glslFloat(ILLUSTRATIVE_STRIPE_MIX)} * stripe);
diffuseColor.rgb = mix(diffuseColor.rgb, illusCol, illusMix);
// เส้นขอบแปลง — สัญญาณที่ยังเหลือรอดเมื่อแปลงเล็กกว่าหนึ่งช่วงลาย ใช้ความชันบน
// จอภาพของ mask จึงหนาราว 1–2 px เสมอ และ "แรงเองเมื่อแปลงเล็ก" (แปลงกว้าง ๆ
// ไล่ค่านุ่ม ความชันต่ำ แทบไม่มีขอบ — ตรงนั้นลายเส้นทำหน้าที่แทนอยู่แล้ว)
// สีเข้มลง ตรงข้ามกับขอบสีขาวจางของน้ำท่วม GISTDA จึงต่างกันแม้ในภาพขาวดำ
float illusRimW = clamp(length(vec2(dFdx(low), dFdy(low))) * 2.0, 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, illusRim, illusRimW * mix(0.45, 1.0, inside) * ${glslFloat(ILLUSTRATIVE_RIM_MIX)});
siahraEmissive += illusCol * illusFill * 0.05 * stripe;

// ชั้น "ระดับการเผชิญน้ำ (ภาพประกอบ)" (E10.4) — พื้นที่ลุ่มต่ำที่ *ขณะนี้* มีสถานี
// ข้างเคียงรายงานฝนหนัก/น้ำสูง เป็นการจัดอันดับค่าที่วัดมาแล้ว ไม่ใช่การพยากรณ์
//
// ใช้ภาษาภาพชุดเดียวกับพื้นที่ลุ่มต่ำ (คาบลายเท่ากัน วางในปริภูมิจอภาพเหมือนกัน)
// แต่ **ทแยงกลับด้าน** (x − y) จึงซ้อนกันเป็นลายตาราง อ่านออกทันทีว่าเป็นคนละชั้น
// กับลายทแยงเดี่ยว และคนละชั้นกับพื้นทึบของน้ำท่วมที่ตรวจวัดจริงข้างล่าง — แยกกันได้
// แม้ในภาพขาวดำ ส่วนสีมาจาก ramp ม่วง→บานเย็นใน lib/exposureStyle.ts ซึ่งไม่ใช่สีน้ำ
//
// ประตูคือ ov.r **ตัวข้อมูลตรง ๆ ไม่ใช่ตัวแปร low** ที่คูณ uShowLowland มาแล้ว: การปิด
// ชั้นพื้นที่ลุ่มต่ำคือการซ่อนสัญลักษณ์ ไม่ใช่การประกาศว่าที่ลุ่มต่ำไม่มีอยู่ ผลพลอยได้
// ที่ตั้งใจ: terrain.bin ที่ไม่ผ่านการตรวจลายเซ็นทำให้ ov.r เป็นศูนย์ทั้งก้อน (E9.1)
// ชั้นนี้จึงดับตามไปเอง ไม่มีทางวาดทับ DEM ที่เชื่อไม่ได้
if (uShowExposure > 0.5) {
  vec4 ex = texture2D(uExposure, vTerrainUv);
  float lowlandGate = smoothstep(0.22, 0.85, ov.r);
  float expo = smoothstep(0.06, 0.55, ex.r) * lowlandGate;
  if (expo > 0.004) {
    vec3 expoCol = siahraExposureRamp(ex.g);
    float hatchT2 = (gl_FragCoord.x - gl_FragCoord.y) / (hatchPx * 1.4142136);
    float hatchTri2 = abs(fract(hatchT2) - 0.5) * 2.0;
    float stripe2 = 1.0 - smoothstep(${glslFloat(ILLUSTRATIVE_HATCH_DUTY)} - hatchAa, ${glslFloat(ILLUSTRATIVE_HATCH_DUTY)} + hatchAa, hatchTri2);
    // ไม่มีผลคำนวณรอบใหม่ = หรี่ลง ไม่ใช่หายไป (legend บอกว่าไม่มีตั้งแต่เมื่อไหร่)
    float expoFill = expo * mix(0.6, 1.0, uDetailFade) * mix(0.45, 1.0, inside) * (1.0 - 0.6 * uExposureStale);
    float expoMix = expoFill * (${glslFloat(ILLUSTRATIVE_BASE_MIX)} + ${glslFloat(ILLUSTRATIVE_STRIPE_MIX)} * stripe2);
    diffuseColor.rgb = mix(diffuseColor.rgb, expoCol, expoMix);
    siahraEmissive += expoCol * expoFill * 0.07 * stripe2;
  }
}

// Satellite-observed flood extent (GISTDA): murky standing water with a
// slow drift and a pale rim along the mapped edge. Drawn over the lowland
// wash so an actual flood always reads stronger than the topographic cue.
float fm = texture2D(uFloodMask, vTerrainUv).r * uShowFlood;
if (fm > 0.02) {
  float fl = smoothstep(0.15, 0.7, fm);
  float drift = siahraNoise(flowUv * 1.6 + vec2(uTime * 0.03, uTime * 0.05));
  vec3 floodDeep = vec3(0.10, 0.34, 0.50);
  vec3 floodLight = vec3(0.30, 0.58, 0.72);
  vec3 floodCol = mix(floodDeep, floodLight, drift);
  float rim = smoothstep(0.12, 0.45, fm) * (1.0 - smoothstep(0.45, 0.85, fm));
  floodCol = mix(floodCol, vec3(0.85, 0.93, 0.98), rim * 0.55);
  diffuseColor.rgb = mix(diffuseColor.rgb, floodCol, fl * 0.78);
  siahraEmissive += floodCol * fl * 0.06;
}

// Observed hazard halos: warm, gently pulsing.
float hz = ov.g * uShowHazard * (1.0 - 0.7 * uHazardStale);
float pulse = 0.5 + 0.5 * sin(uTime * 2.2 + hz * 3.0);
vec3 hazCol = mix(vec3(1.0, 0.62, 0.12), vec3(1.0, 0.16, 0.10), smoothstep(0.35, 0.95, hz));
float hazMix = clamp(hz * 0.85, 0.0, 0.8) * (0.85 + 0.15 * pulse);
diffuseColor.rgb = mix(diffuseColor.rgb, hazCol, hazMix);
siahraEmissive += hazCol * hz * (0.16 + 0.10 * pulse);

// TMD radar echoes (observed reflectivity), draped by lon/lat.
if (uShowRadar > 0.5) {
  vec2 ll = mix(mix(uRadarLL[0], uRadarLL[1], vTerrainUv.x), mix(uRadarLL[2], uRadarLL[3], vTerrainUv.x), vTerrainUv.y);
  vec2 ruv = (ll - uRadarBounds.xy) / (uRadarBounds.zw - uRadarBounds.xy);
  if (all(greaterThanEqual(ruv, vec2(0.0))) && all(lessThanEqual(ruv, vec2(1.0)))) {
    vec4 rc = texture2D(uRadar, ruv);
    float ra = rc.a * 0.82;
    diffuseColor.rgb = mix(diffuseColor.rgb, rc.rgb, ra);
    siahraEmissive += rc.rgb * rc.a * 0.22;
  }
}

diffuseColor.a *= ov.a;
`;

export function createTerrainMaterial(
  shared: TerrainSharedUniforms = createTerrainSharedUniforms(),
): TerrainMaterial {
  const uniforms: TerrainUniforms = { ...shared, uHasImagery: { value: 0 } };

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    transparent: true,
    depthWrite: true,
    // Tile skirts are seen from either side; the surface itself only from above.
    side: THREE.DoubleSide,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n  vTerrainUv = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_PARS}`)
      .replace("#include <color_fragment>", COLOR_FRAGMENT)
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n  totalEmissiveRadiance += siahraEmissive;",
      );
  };
  // Distinct cache key so this program is not shared with plain standard materials.
  material.customProgramCacheKey = () => "siahra-terrain";

  return {
    material,
    uniforms,
    setImagery: (texture) => {
      material.map = texture;
      uniforms.uHasImagery.value = texture ? 1 : 0;
      material.needsUpdate = true;
    },
    setOverlay: (texture) => {
      uniforms.uOverlay.value = texture;
    },
    setHillshade: (texture) => {
      uniforms.uHillshade.value = texture;
      uniforms.uHasHillshade.value = texture ? 1 : 0;
    },
  };
}
