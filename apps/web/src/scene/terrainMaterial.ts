import * as THREE from "three";

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
  /** 1 at province scale -> ~0.4 close up; the lowland wash is a regional cue. */
  uDetailFade: { value: number };
  /** 1 when the observation source is stale/unreachable: halos desaturate. */
  uHazardStale: { value: number };
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
    uHazardStale: { value: 0 },
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
uniform float uHazardStale;
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
// lighting (flat ground ~0.71 in gdaldem's output => neutral).
if (uHasHillshade > 0.5) {
  float hs = texture2D(uHillshade, vTerrainUv).r;
  diffuseColor.rgb *= mix(1.0, clamp(hs / 0.71, 0.35, 1.45), 0.6 * uDetailFade);
}

// Neighbouring provinces: darker and slightly desaturated so the selected
// province reads clearly, then dissolve toward the sky.
float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
vec3 outsideCol = mix(vec3(lum), diffuseColor.rgb, 0.55) * uOutsideDim;
diffuseColor.rgb = mix(outsideCol, diffuseColor.rgb, inside);

// Low-lying ground: animated water tint (illustrative, topography only).
vec2 flowUv = vTerrainUv * vec2(90.0, 110.0);
float n1 = siahraNoise(flowUv * 1.0 + vec2(uTime * 0.05, -uTime * 0.035));
float n2 = siahraNoise(flowUv * 2.3 - vec2(uTime * 0.09, uTime * 0.02));
float shimmer = 0.6 * n1 + 0.4 * n2;
float low = ov.r * uShowLowland * uDetailFade;
low = smoothstep(0.22, 0.85, low);
vec3 waterDeep = vec3(0.07, 0.38, 0.92);
vec3 waterLight = vec3(0.36, 0.76, 1.0);
vec3 waterCol = mix(waterDeep, waterLight, shimmer);
float waterMix = low * (0.36 + 0.22 * shimmer);
diffuseColor.rgb = mix(diffuseColor.rgb, waterCol, waterMix);
siahraEmissive += waterCol * low * (0.07 + 0.06 * shimmer);

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
