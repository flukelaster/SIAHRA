import * as THREE from "three";

/**
 * Animated water surface for rivers, canals and water bodies: a glossy
 * standard material whose normal is perturbed by two scrolling noise fields
 * so the sun glints move, plus a faint emissive shimmer. Shares `uTime` with
 * the terrain so everything breathes at the same clock.
 */
export function createWaterMaterial(uTime: { value: number }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0x1e5b93,
    roughness: 0.14,
    metalness: 0.02,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSiahraWorld;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\n  vSiahraWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
uniform float uTime;
varying vec3 vSiahraWorld;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float wNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y);
}`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `#include <normal_fragment_maps>
{
  vec2 p = vSiahraWorld.xz * 0.02;
  float n1 = wNoise(p * 1.7 + vec2(uTime * 0.11, uTime * 0.07));
  float n2 = wNoise(p * 3.1 - vec2(uTime * 0.09, uTime * 0.13));
  vec2 slope = vec2(n1 - 0.5, n2 - 0.5) * 0.28;
  normal = normalize(normal + vec3(slope.x, 0.0, slope.y));
}`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
{
  vec2 p = vSiahraWorld.xz * 0.02;
  float s = wNoise(p * 2.3 + vec2(-uTime * 0.05, uTime * 0.08));
  totalEmissiveRadiance += vec3(0.05, 0.16, 0.30) * (0.35 + 0.65 * s) * 0.35;
}`,
      );
  };
  material.customProgramCacheKey = () => "siahra-water";
  return material;
}
