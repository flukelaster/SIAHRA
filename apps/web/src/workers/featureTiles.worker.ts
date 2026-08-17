/// <reference lib="webworker" />
import { Earcut } from "three/src/extras/Earcut.js";

/**
 * Turns one feature tile (see FeatureTilePyramid) into two meshes: road
 * ribbons (vertex-coloured by class) and water (waterway ribbons + water
 * body polygons), all pre-draped from the per-vertex DEM heights baked by
 * the ETL. Widths grow with the LOD level so roads/rivers stay visible from
 * afar instead of thinning to nothing.
 */
export interface FeatureTileJob {
  id: string;
  buffer: ArrayBuffer;
  centreX: number;
  centreZ: number;
  /** 1 at leaf, larger at coarser levels. */
  widthScale: number;
}

export interface FeatureTileMesh {
  id: string;
  roads: { positions: Float32Array; colors: Float32Array; indices: Uint32Array };
  water: { positions: Float32Array; indices: Uint32Array };
  count: number;
}

const MAGIC = 0x4e494c53;
const ROAD_LIFT = 1.6;
const WATER_LINE_LIFT = 0.9;
const WATER_AREA_LIFT = 1.2;

const ROAD_WIDTH: Record<number, number> = { 10: 24, 11: 18, 12: 13, 13: 9, 14: 8 };
const ROAD_COLOR: Record<number, [number, number, number]> = {
  10: [0.95, 0.62, 0.22],
  11: [0.95, 0.68, 0.30],
  12: [0.93, 0.80, 0.45],
  13: [0.88, 0.86, 0.72],
  14: [0.90, 0.66, 0.32],
};
const WATER_WIDTH: Record<number, number> = { 1: 32, 2: 10, 3: 5 };

class MeshBuilder {
  positions: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  withColor: boolean;
  constructor(withColor: boolean) {
    this.withColor = withColor;
  }
  ribbon(pts: [number, number, number][], width: number, lift: number, color?: [number, number, number]) {
    if (pts.length < 2) return;
    const half = width / 2;
    const base = this.positions.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      let dx = next[0] - prev[0];
      let dz = next[2] - prev[2];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      // Perpendicular in the ground plane.
      const nx = -dz;
      const nz = dx;
      const [x, y, z] = pts[i];
      this.positions.push(x + nx * half, y + lift, z + nz * half, x - nx * half, y + lift, z - nz * half);
      if (this.withColor && color) this.colors.push(...color, ...color);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      // Two triangles per segment, both windings covered by DoubleSide.
      this.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  polygon(ring: [number, number, number][], y: number) {
    if (ring.length < 3) return;
    const flat: number[] = [];
    for (const [x, , z] of ring) flat.push(x, z);
    const tris = Earcut.triangulate(flat, undefined, 2);
    if (tris.length === 0) return;
    const base = this.positions.length / 3;
    for (const [x, , z] of ring) this.positions.push(x, y, z);
    for (const t of tris) this.indices.push(base + t);
  }
  finish() {
    return {
      positions: new Float32Array(this.positions),
      colors: new Float32Array(this.colors),
      indices: new Uint32Array(this.indices),
    };
  }
}

self.onmessage = (ev: MessageEvent<FeatureTileJob>) => {
  const job = ev.data;
  const dv = new DataView(job.buffer);
  const roads = new MeshBuilder(true);
  const water = new MeshBuilder(false);
  let count = 0;
  if (dv.byteLength >= 8 && dv.getUint32(0, true) === MAGIC) {
    count = dv.getUint32(4, true);
    let o = 8;
    for (let r = 0; r < count; r++) {
      const kind = dv.getUint8(o);
      const cls = dv.getUint8(o + 1);
      const k = dv.getUint16(o + 2, true);
      const levelZ = dv.getInt16(o + 4, true);
      const unitM = dv.getFloat32(o + 6, true);
      o += 10;
      const pts: [number, number, number][] = [];
      for (let i = 0; i < k; i++) {
        const dx = dv.getInt16(o, true) * unitM;
        const dz = dv.getInt16(o + 2, true) * unitM;
        const z = dv.getInt16(o + 4, true);
        o += 6;
        pts.push([job.centreX + dx, z, job.centreZ + dz]);
      }
      if (kind === 1) {
        water.polygon(pts, levelZ + WATER_AREA_LIFT);
      } else if (cls >= 10) {
        roads.ribbon(pts, (ROAD_WIDTH[cls] ?? 8) * job.widthScale, ROAD_LIFT, ROAD_COLOR[cls] ?? [0.9, 0.85, 0.7]);
      } else {
        water.ribbon(pts, (WATER_WIDTH[cls] ?? 6) * job.widthScale, WATER_LINE_LIFT);
      }
    }
  }
  const rd = roads.finish();
  const wt = water.finish();
  const result: FeatureTileMesh = {
    id: job.id,
    roads: { positions: rd.positions, colors: rd.colors, indices: rd.indices },
    water: { positions: wt.positions, indices: wt.indices },
    count,
  };
  (self as unknown as Worker).postMessage(result, [
    rd.positions.buffer,
    rd.colors.buffer,
    rd.indices.buffer,
    wt.positions.buffer,
    wt.indices.buffer,
  ]);
};
