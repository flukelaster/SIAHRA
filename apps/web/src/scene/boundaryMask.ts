import type { AoiManifest } from "@siahra/shared-types";
import { createLocalProjection } from "./localProjection";

export type Ring = [number, number][];

export interface BoundaryGeoJson {
  features?: { geometry: { type: string; coordinates: unknown } | null }[];
  geometry?: { type: string; coordinates: unknown };
}

export function extractRings(data: BoundaryGeoJson): Ring[] {
  const rings: Ring[] = [];
  const collect = (g: { type?: string; coordinates?: unknown } | null) => {
    if (!g?.type) return;
    if (g.type === "Polygon") rings.push(...(g.coordinates as Ring[]));
    else if (g.type === "MultiPolygon")
      for (const poly of g.coordinates as Ring[][]) rings.push(...poly);
  };
  if (data.features) for (const f of data.features) collect(f.geometry);
  else if (data.geometry) collect(data.geometry);
  return rings;
}

/** Fetches the province polygon(s) as lon/lat rings, or null when absent. */
export async function loadBoundaryRings(manifest: AoiManifest): Promise<Ring[] | null> {
  if (!manifest.boundary) return null;
  try {
    const res = await fetch(manifest.boundary.url);
    if (!res.ok) return null;
    const rings = extractRings((await res.json()) as BoundaryGeoJson);
    return rings.length > 0 ? rings : null;
  } catch {
    return null;
  }
}

/**
 * Rasterizes the province polygon onto the terrain grid via scanline fill,
 * returning 1 for cells inside the province and 0 outside.
 *
 * Rings are projected to scene metres first (true UTM), so the mask lines up
 * with the heightfield and the imagery to sub-cell accuracy. Scanline
 * (O(rows × edges)) rather than per-vertex point-in-polygon, which would be
 * ~500M tests on a province-sized grid.
 */
export function rasterizeBoundaryMask(manifest: AoiManifest, rings: Ring[]): Uint8Array {
  const { width, height, cellSizeM } = manifest.terrain;
  const proj = createLocalProjection(manifest);
  const mask = new Uint8Array(width * height);

  const localRings = rings.map((ring) => ring.map(([lon, lat]) => proj.lonLatToLocal(lon, lat)));

  const xs: number[] = [];
  for (let r = 0; r < height; r++) {
    const z = r * cellSizeM - proj.gridHeightM / 2;
    xs.length = 0;

    for (const ring of localRings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, z1] = ring[i];
        const [x2, z2] = ring[j];
        // Half-open crossing test avoids double-counting shared vertices.
        if (z1 > z !== z2 > z) {
          const t = (z - z1) / (z2 - z1);
          const x = x1 + t * (x2 - x1);
          xs.push((x + proj.gridWidthM / 2) / cellSizeM);
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);

    const rowOffset = r * width;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const start = Math.max(0, Math.ceil(xs[k]));
      const end = Math.min(width - 1, Math.floor(xs[k + 1]));
      for (let c = start; c <= end; c++) mask[rowOffset + c] = 1;
    }
  }
  return mask;
}

export async function loadBoundaryMask(manifest: AoiManifest): Promise<Uint8Array | null> {
  const rings = await loadBoundaryRings(manifest);
  if (!rings) return null;
  return rasterizeBoundaryMask(manifest, rings);
}
