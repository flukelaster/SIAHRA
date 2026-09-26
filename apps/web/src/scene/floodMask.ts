import * as THREE from "three";
import type { AoiManifest, FloodExtentFeature } from "@siahra/shared-types";
import type { Ring } from "./boundaryMask";
import { createLocalProjection } from "./localProjection";

/**
 * Rasterises GISTDA flood polygons onto the province overlay grid so the
 * terrain shader can tint flooded ground exactly where the satellite scene
 * says — draped for free on every LOD tile, no z-fighting, no extra meshes.
 *
 * E16.PR0: the source is now H3 res-9 cells (~0.1 km², ~340 m across), a few
 * thousand per province — about one overview cell each (83–240 m grids), so
 * this is the resolution floor of the tint, not of the data: the card and the
 * pick popup read the cells themselves. The tint is an even-odd scanline at
 * cell centres like `rasterizeBoundaryMask`, but with edges bucketed by the
 * rows they span — the boundary rasteriser tests every edge on every row,
 * which at ~200k edges × ~800 rows would stall the main thread.
 */
export interface FloodMask {
  texture: THREE.DataTexture;
  /** Fraction of in-province cells flagged flooded (for the legend/summary). */
  coverage: number;
  /**
   * มาสก์ท่วม **ก่อนเบลอ** (1 = กึ่งกลางเซลล์อยู่ในเซลล์ GISTDA, แถว 0 = เหนือ ลำดับเดียวกับ
   * `terrain.heights`) — ข้อมูลเข้าของ FwDET ใน `scene/GistdaSheet.ts` (E16 B-2) และมาสก์ "ดาวเทียม
   * สังเกตแล้วว่าท่วม" ของแผ่นจำลองจากสถานี ไม่ต้อง rasterise ซ้ำ
   */
  raw: Uint8Array;
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
  const mask = rasterizeRingsBucketed(manifest, rings);
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
  return { texture, coverage: inside > 0 ? flooded / inside : 0, raw: mask, dispose: () => texture.dispose() };
}

/**
 * Even-odd scanline fill at cell centres, same sampling as
 * `rasterizeBoundaryMask` (row z = r·cellSize − H/2, half-open crossing test),
 * but each edge only visits the rows it actually crosses.
 */
export function rasterizeRingsBucketed(manifest: AoiManifest, rings: Ring[]): Uint8Array {
  const { width, height, cellSizeM } = manifest.terrain;
  const proj = createLocalProjection(manifest);
  const mask = new Uint8Array(width * height);
  const halfH = proj.gridHeightM / 2;
  const halfW = proj.gridWidthM / 2;
  const crossings: number[][] = Array.from({ length: height }, () => []);
  for (const ring of rings) {
    const pts = ring.map(([lon, lat]) => proj.lonLatToLocal(lon, lat));
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [x1, z1] = pts[i]!;
      const [x2, z2] = pts[j]!;
      if (z1 === z2) continue;
      // แถว r ถูกนับเมื่อ min(z1,z2) ≤ z < max(z1,z2) — เท่ากับ `z1 > z !== z2 > z`
      const zLo = Math.min(z1, z2);
      const zHi = Math.max(z1, z2);
      // ขยายหนึ่งแถวทั้งสองข้างกันปัดเศษ float — การทดสอบ half-open ข้างล่างเป็นตัวตัดสินจริง
      const r0 = Math.max(0, Math.ceil((zLo + halfH) / cellSizeM) - 1);
      const r1 = Math.min(height - 1, Math.ceil((zHi + halfH) / cellSizeM));
      for (let r = r0; r <= r1; r++) {
        const z = r * cellSizeM - halfH;
        if (!(z1 > z !== z2 > z)) continue;
        const x = x1 + ((z - z1) / (z2 - z1)) * (x2 - x1);
        crossings[r]!.push((x + halfW) / cellSizeM);
      }
    }
  }
  for (let r = 0; r < height; r++) {
    const xs = crossings[r]!;
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const rowOffset = r * width;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const start = Math.max(0, Math.ceil(xs[k]!));
      const end = Math.min(width - 1, Math.floor(xs[k + 1]!));
      for (let c = start; c <= end; c++) mask[rowOffset + c] = 1;
    }
  }
  return mask;
}
