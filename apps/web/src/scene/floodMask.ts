import * as THREE from "three";
import type { AoiManifest, FloodExtentFeature } from "@siahra/shared-types";
import { rasterizeBoundaryMask, type Ring } from "./boundaryMask";

/**
 * Rasterises GISTDA flood polygons onto the province overlay grid so the
 * terrain shader can tint flooded ground exactly where the satellite scene
 * says — draped for free on every LOD tile, no z-fighting, no extra meshes.
 * Tambon polygons are km-scale, so the overview grid (100–400 m cells) is
 * ample resolution for them.
 */
export interface FloodMask {
  texture: THREE.DataTexture;
  /** Fraction of in-province cells flagged flooded (for the legend/summary). */
  coverage: number;
  dispose: () => void;
}

export function buildFloodMask(
  manifest: AoiManifest,
  features: FloodExtentFeature[],
  insideMask: Uint8Array | null,
): FloodMask | null {
  const rings: Ring[] = [];
  for (const f of features) {
    if (f.geometry.type === "Polygon") rings.push(...(f.geometry.coordinates as Ring[]));
    else for (const poly of f.geometry.coordinates as Ring[][]) rings.push(...poly);
  }
  if (rings.length === 0) return null;

  const { width, height } = manifest.terrain;
  const mask = rasterizeBoundaryMask(manifest, rings);
  const data = new Uint8Array(width * height);
  let flooded = 0;
  let inside = 0;
  for (let r = 0; r < height; r++) {
    const texRow = height - 1 - r; // DataTexture rows are bottom-up
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      // Soften with a 3x3 mean so edges are not stair-stepped at the cell size.
      let sum = 0;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= height) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= width) continue;
          sum += mask[rr * width + cc];
          n++;
        }
      }
      data[texRow * width + c] = Math.round((sum / n) * 255);
      if (!insideMask || insideMask[i]) {
        inside++;
        if (mask[i]) flooded++;
      }
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { texture, coverage: inside > 0 ? flooded / inside : 0, dispose: () => texture.dispose() };
}
