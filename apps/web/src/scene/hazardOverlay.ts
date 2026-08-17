import * as THREE from "three";
import type {
  AoiManifest,
  RainfallObservation,
  WaterLevelObservation,
} from "@siahra/shared-types";
import { createLocalProjection } from "./localProjection";

/**
 * Per-cell overlay data sampled by the terrain shader (see terrainMaterial):
 *
 *   R  low-lying ground   — ILLUSTRATIVE. How far a cell sits below the mean
 *                           elevation of its ~3 km neighbourhood, in units of
 *                           the local relief (standard deviation), computed
 *                           from the DEM and restricted to plains (low
 *                           neighbourhood relief). Picks out broad valley
 *                           floors and the lowest ground of a delta. Not a flood
 *                           forecast; it only says "this is the low ground
 *                           water would collect on".
 *   G  observed hazard    — OBSERVED. Halo around stations currently reporting
 *                           heavy rain or high/overflowing water. The radius
 *                           is a display convention, not a modelled extent.
 *   B  inside province    — soft boundary mask (dims neighbours).
 *   A  visibility         — 1 inside, fading to 0 away from the province so
 *                           the rectangular DEM clip dissolves into the sky.
 *
 * Every layer here is either directly observed or a plain topographic
 * derivative; the legend states which is which.
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

export interface OverlayField {
  texture: THREE.DataTexture;
  data: Uint8Array;
  width: number;
  height: number;
  /** Fraction of in-province cells classed as low-lying (for the legend). */
  lowlandShare: number;
  /** Rewrites the observed-hazard channel; cheap enough to run per refresh. */
  updateObserved: (
    rainfall: RainfallObservation[],
    waterlevel: WaterLevelObservation[],
  ) => { haloCount: number };
  dispose: () => void;
}

/** Separable box blur with running sums (O(N) per pass). */
function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
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

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function buildOverlayField(
  manifest: AoiManifest,
  heights: Float32Array,
  insideMask: Uint8Array | null,
): OverlayField {
  const { width, height, cellSizeM } = manifest.terrain;
  const n = width * height;
  const proj = createLocalProjection(manifest);

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

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  // --- G: observed hazard halos --------------------------------------------
  const paintHalo = (
    field: Float32Array,
    lon: number,
    lat: number,
    radiusM: number,
    strength: number,
  ) => {
    const [x, z] = proj.lonLatToLocal(lon, lat);
    if (!proj.insideGrid(x, z)) return false;
    const fc = (x + proj.gridWidthM / 2) / cellSizeM;
    const fr = (z + proj.gridHeightM / 2) / cellSizeM;
    const rad = radiusM / cellSizeM;
    const c0 = Math.max(0, Math.floor(fc - rad));
    const c1 = Math.min(width - 1, Math.ceil(fc + rad));
    const r0 = Math.max(0, Math.floor(fr - rad));
    const r1 = Math.min(height - 1, Math.ceil(fr + rad));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d = Math.hypot(c - fc, r - fr) / rad;
        if (d > 1) continue;
        // Smooth bump: full at the centre, zero at the rim.
        const w = strength * (1 - d * d) * (1 - d * d);
        const i = r * width + c;
        if (w > field[i]) field[i] = w;
      }
    }
    return true;
  };

  const updateObserved = (rainfall: RainfallObservation[], waterlevel: WaterLevelObservation[]) => {
    const field = new Float32Array(n);
    let haloCount = 0;
    for (const w of waterlevel) {
      const level = w.situationLevel ?? 0;
      if (level < 4) continue;
      const strength = level >= 5 ? 1 : 0.62;
      if (paintHalo(field, w.station.lon, w.station.lat, 4500, strength)) haloCount++;
    }
    for (const rf of rainfall) {
      const mm = rf.rain24h ?? 0;
      if (mm < 35) continue;
      const strength = mm >= 90 ? 0.9 : 0.5;
      if (paintHalo(field, rf.station.lon, rf.station.lat, 6000, strength)) haloCount++;
    }
    for (let r = 0; r < height; r++) {
      const texRow = height - 1 - r;
      for (let c = 0; c < width; c++) {
        data[(texRow * width + c) * 4 + 1] = Math.round(Math.min(1, field[r * width + c]) * 255);
      }
    }
    texture.needsUpdate = true;
    return { haloCount };
  };

  return {
    texture,
    data,
    width,
    height,
    lowlandShare: insideCells > 0 ? lowlandCells / insideCells : 0,
    updateObserved,
    dispose: () => texture.dispose(),
  };
}
