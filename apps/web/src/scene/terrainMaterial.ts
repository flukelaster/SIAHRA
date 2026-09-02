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
import { FORECAST_RGB } from "../lib/forecastStyle";
import { FLOOD_RGB, FLOOD_STIPPLE_DOT_FRAC, GISTDA_RGB } from "../lib/floodStyle";
import { floodFieldGlsl } from "./floodField";

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
  /**
   * "แถบฝนพยากรณ์รายวัน (TMD)" (E12.4b) — รหัสแถบเดียวกันกับ `EXPOSURE_CODE`
   * (0 = ไม่มีแถบ, 0.5/0.75/1 = elevated/high/severe; "low" ไม่มีรหัส เพราะไม่วาด)
   * เป็น uniform หนึ่งค่าต่อจังหวัด ไม่ใช่ texture: TMD ให้ปริมาณฝนมาหนึ่งค่าต่อ
   * จังหวัด (`ProvinceForecastBatch.queryPoint` จุดเดียว) ไม่ใช่รายสถานีแบบ
   * `hazardOverlay.updateExposure`, การ drape เป็น texture จะสื่อความละเอียด
   * เชิงพื้นที่ที่ข้อมูลไม่มีอยู่จริง
   */
  uForecastBand: { value: number };
  /** ปิดไว้เป็นค่าเริ่มต้น: มีค่าเมื่อผู้ใช้เลือกขั้นใน ForecastStrip เท่านั้น */
  uShowForecast: { value: number };
  /** Satellite flood-extent mask (R channel, province overlay grid). */
  uFloodMask: { value: THREE.Texture | null };
  uShowFlood: { value: number };
  /**
   * ฉาก Copernicus GFM (E14.F4) — RGBA8 บนกริด overview เดียวกัน (layout ใน
   * `scene/floodField.ts`: R = คลาส, G = ความลึก, B = ความเชื่อมั่นการจำแนก, A =
   * มีค่าความลึก) null = ไม่มีฉากให้วาด (ยังไม่โหลด / ไม่มีฉากในหน้าต่าง 14 วัน)
   */
  uFloodField: { value: THREE.Texture | null };
  uShowFloodField: { value: number };
  /**
   * 1 = ไล่ระดับสีตามความลึกภาพประกอบ (FwDET) · 0 = สีเดียว "พื้นที่ที่ดาวเทียม
   * เห็นน้ำ" ล้วน ๆ — สวิตช์ `floodDepth` มีผลเฉพาะเมื่อ `floodGfm` เปิดอยู่
   */
  uShowFloodDepth: { value: number };
  /** 1 = แหล่ง GFM ค้าง/ไม่ปกติ (health ไม่ ok หรือดัชนีเก่ากว่า staleAfterSeconds) → หรี่ลง ไม่หายไป */
  uFloodFieldDim: { value: number };
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
    uForecastBand: { value: 0 },
    uShowForecast: { value: 0 },
    uFloodMask: { value: null },
    uShowFlood: { value: 0 },
    uFloodField: { value: null },
    uShowFloodField: { value: 0 },
    uShowFloodDepth: { value: 1 },
    uFloodFieldDim: { value: 0 },
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
uniform float uForecastBand;
uniform float uShowForecast;
uniform sampler2D uFloodMask;
uniform float uShowFlood;
uniform sampler2D uFloodField;
uniform float uShowFloodField;
uniform float uShowFloodDepth;
uniform float uFloodFieldDim;
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
// สีไล่ตามแถบของ "แถบฝนพยากรณ์รายวัน (TMD)" — จุดยึดตรงกับรหัสเดียวกับ
// siahraExposureRamp ข้างบน (0.5 elevated, 0.75 high, 1.0 severe; ไม่มีแถบ 0.25
// เพราะ "low" ไม่เคยถูกวาด — ดู ForecastBandLevel ใน lib/forecastStyle.ts) จุดสี
// มาจาก FORECAST_RGB ไฟล์เดียวกับที่ legend อ่าน ไม่ได้เลือกเลขฐานสิบหกใหม่ที่นี่
vec3 siahraForecastRamp(float code) {
  vec3 c = ${glslVec3(FORECAST_RGB.elevated)};
  c = mix(c, ${glslVec3(FORECAST_RGB.high)}, smoothstep(0.5, 0.75, code));
  c = mix(c, ${glslVec3(FORECAST_RGB.severe)}, smoothstep(0.75, 1.0, code));
  return c;
}
// ตัวถอด layout ของ texture ฉาก GFM + สูตรไล่ระดับความลึก — ฝังจาก scene/floodField.ts
// (ที่เดียวกับที่เข้ารหัสฝั่ง CPU) และ lib/floodStyle.ts (ที่เดียวกับที่ legend อ่าน)
${floodFieldGlsl()}
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

// "แถบฝนพยากรณ์รายวัน (TMD)" (E12.4b) — ผู้ใช้เลือกขั้นรายชั่วโมงหนึ่งขั้นใน
// ForecastStrip แล้วฝั่ง App.tsx หาขั้นรายวันของวันปฏิทินกรุงเทพฯ วันเดียวกันมา
// จัดแถบด้วยเกณฑ์ TMD (bandRain24h) — ต่างจากทั้งสองชั้นข้างบนสามอย่างจงใจ:
// (ห้ามใช้ backtick ในคอมเมนต์ช่วงนี้ — เทมเพลตลิเทอรัลของ JS ทั้งก้อน (COLOR_
// FRAGMENT) ถูกครอบด้วย backtick อยู่แล้ว backtick ซ้อนในคอมเมนต์จะปิดสตริงก่อน)
//
//   1. ประตูคือ inside อย่างเดียว ไม่ใช่ ov.r (ช่องพื้นที่ลุ่มต่ำ) — ชั้นการเผชิญ
//      น้ำผูกกับพื้นที่ลุ่มต่ำเพราะเป็นการชี้จุดเสี่ยงที่ใกล้แหล่งน้ำ แต่ฝนพยากรณ์
//      เป็นค่าระดับจังหวัดล้วน ๆ (จุดกริดเดียวของ TMD) ไม่มีความหมายเชิงพื้นที่ที่
//      จะผูกกับพื้นที่ลุ่มต่ำได้ — ระบายทั่วทั้งจังหวัดเท่ากันแทน
//   2. ลายเส้นแนวตั้งล้วน (gl_FragCoord.x อย่างเดียว ไม่หารด้วยรากสอง เหมือน
//      สองลายทแยงข้างบน เพราะไม่ใช่ลายทแยง 45 องศา ระยะห่างจึงตรงกับ hatchPx เป๊ะ
//      ไม่ใช่ระยะตามแนวตั้งฉากของเส้นทแยง) — ต่างจากทแยงเดี่ยว (x+y) ของพื้นที่
//      ลุ่มต่ำ และทแยงกลับด้าน/ลายตาราง (x-y) ของชั้นการเผชิญน้ำ ทั้งสามชั้นจึง
//      อ่านออกได้แม้ตัดสีออกหมด (greyscale)
//   3. สีฟ้าอมเขียว (teal/seafoam) จาก FORECAST_RGB ใน lib/forecastStyle.ts —
//      ไม่ใช่ม่วงไปบานเย็นของชั้นการเผชิญน้ำ ไม่ใช่ฟ้า/น้ำเงินของน้ำท่วม GISTDA
//      ด้านล่าง และไม่ใช่ส้ม/แดงของฮาโลค่าตรวจวัดจริง — luma ของทั้งสามจุดสี
//      (ราว 0.58-0.80 ตามสูตร Rec.601) อยู่นอกแถบราว 0.50-0.54 ของ ramp ม่วง
//      ไปบานเย็น โดยตั้งใจ (ดูหมายเหตุคำนวณเต็มใน lib/forecastStyle.ts)
//
// uForecastBand เป็นค่าเดียว ไม่ใช่รหัสที่แยกกรณี "ไม่มีค่า" กับ "ต่ำกว่าเกณฑ์"
// (ทั้งสองกรณีคือ uShowForecast = 0 เท่ากัน) — สองสถานะนั้นแยกกันที่ legend
// (MapLegend.tsx) ไม่ใช่บน terrain เพราะ uniform บนแผนที่บอกได้แค่ "มี/ไม่มี
// สัญญาณให้ดู" ส่วนเหตุผลที่ไม่มีเป็นข้อความ ไม่ใช่สี
if (uShowForecast > 0.5 && uForecastBand > 0.001) {
  vec3 fcCol = siahraForecastRamp(uForecastBand);
  float hatchT3 = gl_FragCoord.x / hatchPx;
  float hatchTri3 = abs(fract(hatchT3) - 0.5) * 2.0;
  float stripe3 = 1.0 - smoothstep(${glslFloat(ILLUSTRATIVE_HATCH_DUTY)} - hatchAa, ${glslFloat(ILLUSTRATIVE_HATCH_DUTY)} + hatchAa, hatchTri3);
  float fcFill = inside * mix(0.5, 1.0, uDetailFade);
  float fcMix = fcFill * (${glslFloat(ILLUSTRATIVE_BASE_MIX)} + ${glslFloat(ILLUSTRATIVE_STRIPE_MIX)} * stripe3);
  diffuseColor.rgb = mix(diffuseColor.rgb, fcCol, fcMix);
  siahraEmissive += fcCol * fcFill * 0.06 * stripe3;
}

// Satellite-observed flood extent (GISTDA): a light translucent wash plus a
// crisp ~1.5 px outline along the mapped edge, drawn over the lowland wash so
// an actual flood always reads stronger than the topographic cue.
//
// F4 restyle: the *outline* is now this layer's signal, and the fill is kept
// light on purpose — the second observed source below (Copernicus GFM) is the
// solid, depth-graded one, so the two never look alike even where they
// overlap. Colours come from lib/floodStyle.ts (GISTDA_RGB), the same values
// the legend swatch draws; no hex is picked here.
//
// อนุพันธ์ (fwidth) คำนวณนอก if เสมอ — ใน GLSL ES 3.0 อนุพันธ์ภายใน control flow
// ที่ไม่ uniform เป็นค่าไม่นิยาม (ตัวแปร low ข้างบนก็ทำแบบเดียวกัน)
float fmRaw = texture2D(uFloodMask, vTerrainUv).r;
float fmFw = fwidth(fmRaw);
float fm = fmRaw * uShowFlood;
if (fm > 0.02) {
  float fl = smoothstep(0.15, 0.7, fm);
  float drift = siahraNoise(flowUv * 1.6 + vec2(uTime * 0.03, uTime * 0.05));
  vec3 gistdaCol = mix(${glslVec3(GISTDA_RGB.deep)}, ${glslVec3(GISTDA_RGB.light)}, drift);
  vec3 gistdaRim = ${glslVec3(GISTDA_RGB.rim)};
  diffuseColor.rgb = mix(diffuseColor.rgb, gistdaCol, fl * 0.36);
  // เส้นขอบบน isoline fm = 0.45 ของ mask ที่เบลอ 3×3 ไว้แล้ว — ความหนาคงที่บนจอ
  // (~1.5 px) ไม่ว่ากล้องจะอยู่ไกลแค่ไหน เพราะวัดจากความชันบนจอของ mask
  float gistdaLine = 1.0 - smoothstep(0.0, max(fmFw, 1e-4) * 1.5, abs(fm - 0.45));
  diffuseColor.rgb = mix(diffuseColor.rgb, gistdaRim, gistdaLine * 0.9);
  siahraEmissive += gistdaRim * gistdaLine * 0.12 + gistdaCol * fl * 0.03;
}

// Copernicus GFM flood scene (E14.F4) — the second observed source, drawn
// AFTER the GISTDA block so it wins where both exist:
//   FLOODED                      → solid water graded by the illustrative FwDET
//                                  depth, shallow → deep as 1 − exp(−k·depth)
//                                  (Beer–Lambert look; k from lib/floodStyle.ts),
//                                  slow drift, faint pale rim on the 0.5 isoline
//   FLOODED_DEPTH_NOT_ESTIMATED  → the shallow colour + a screen-space stipple
//                                  (same period as the illustrative hatch) so it
//                                  can never be read as 0 m
//   REFERENCE_WATER / EXCLUDED / NO_OBSERVATION / DRY → nothing in F4
// uShowFloodDepth = 0 drops the ramp and the stipple: one flat observed colour
// for "the satellite saw water here", nothing about how deep.
float gfmCov = 0.0;
float gfmDepth = 0.0;
float gfmNotEst = 0.0;
if (uShowFloodField > 0.5) siahraFloodSample(uFloodField, vTerrainUv, gfmCov, gfmDepth, gfmNotEst);
float gfmFw = fwidth(gfmCov);
if (gfmCov > 0.02) {
  float gfmFl = smoothstep(0.2, 0.7, gfmCov);
  float gfmDrift = siahraNoise(flowUv * 1.3 + vec2(-uTime * 0.025, uTime * 0.04));
  vec3 gfmShallow = ${glslVec3(FLOOD_RGB.shallow)};
  vec3 gfmDeep = ${glslVec3(FLOOD_RGB.deep)};
  vec3 gfmCol = ${glslVec3(FLOOD_RGB.extent)};
  if (uShowFloodDepth > 0.5) {
    gfmCol = mix(gfmShallow, gfmDeep, siahraDepthMix(gfmDepth));
    if (gfmNotEst > 0.5) {
      // ลายจุดในปริภูมิจอภาพ: จุดสีน้ำลึกบนพื้นสีน้ำตื้น คาบเท่าลายเส้นของชั้น
      // ภาพประกอบ — "ไม่ได้ประมาณ" ต้องอ่านเป็นลาย ไม่ใช่ปลายตื้นของ ramp
      vec2 stippleCell = fract(gl_FragCoord.xy / hatchPx) - 0.5;
      float stippleDot = 1.0 - smoothstep(${glslFloat(FLOOD_STIPPLE_DOT_FRAC)} - hatchAa, ${glslFloat(FLOOD_STIPPLE_DOT_FRAC)} + hatchAa, length(stippleCell));
      gfmCol = mix(gfmShallow, gfmDeep, stippleDot);
    }
  }
  gfmCol *= 0.92 + 0.12 * gfmDrift;
  float gfmLine = 1.0 - smoothstep(0.0, max(gfmFw, 1e-4) * 1.5, abs(gfmCov - 0.5));
  gfmCol = mix(gfmCol, ${glslVec3(FLOOD_RGB.rim)}, gfmLine * 0.45);
  // แหล่งค้าง/ไม่ปกติ = หรี่ลง ไม่ใช่หายไป (legend บอกเหตุผล) — กฎเดียวกับ uExposureStale
  float gfmFill = gfmFl * 0.86 * (1.0 - 0.6 * uFloodFieldDim) * mix(0.45, 1.0, inside);
  diffuseColor.rgb = mix(diffuseColor.rgb, gfmCol, gfmFill);
  siahraEmissive += gfmCol * gfmFill * 0.05;
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
