/// <reference lib="webworker" />
import { Earcut } from "three/src/extras/Earcut.js";

/**
 * Extrudes one building tile (see BuildingTilePyramid for the byte layout)
 * into a flat-shaded mesh: walls + earcut roof per footprint, positions in
 * scene metres, per-vertex colour, Uint32 indices. Runs off the main thread
 * so a dense city tile (10–20k footprints) never stalls the frame.
 */
export interface BuildingTileJob {
  id: string;
  buffer: ArrayBuffer;
  unitM: number;
  /** Tile centre in scene metres (x east, z south). */
  centreX: number;
  centreZ: number;
  /** Sink each footprint slightly so it never floats over uneven terrain. */
  sinkM: number;
}

export interface BuildingTileMesh {
  id: string;
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  count: number;
}

const MAGIC = 0x444c4253;

// Kept fairly dark: the scene lights are bright (physically based units)
// and light grey blows out to white under them.
const WALL = [0.19, 0.20, 0.23];
const ROOF = [0.27, 0.28, 0.30];
const TALL_TINT = [0.20, 0.25, 0.34];

self.onmessage = (ev: MessageEvent<BuildingTileJob>) => {
  const job = ev.data;
  const dv = new DataView(job.buffer);
  if (dv.byteLength < 8 || dv.getUint32(0, true) !== MAGIC) {
    const empty: BuildingTileMesh = {
      id: job.id,
      positions: new Float32Array(0),
      colors: new Float32Array(0),
      indices: new Uint32Array(0),
      count: 0,
    };
    (self as unknown as Worker).postMessage(empty);
    return;
  }
  const count = dv.getUint32(4, true);

  // First pass: sizes.
  let o = 8;
  let vertexTotal = 0;
  let indexTotal = 0;
  for (let b = 0; b < count; b++) {
    const k = dv.getUint16(o, true);
    o += 8 + k * 4;
    vertexTotal += k * 4 + k; // 4 per wall quad + roof ring
    indexTotal += k * 6 + (k - 2) * 3;
  }
  const positions = new Float32Array(vertexTotal * 3);
  const colors = new Float32Array(vertexTotal * 3);
  const indices = new Uint32Array(indexTotal);

  o = 8;
  let v = 0;
  let ii = 0;
  const ring: number[] = [];
  for (let b = 0; b < count; b++) {
    const k = dv.getUint16(o, true);
    const heightM = dv.getUint16(o + 2, true) / 10;
    const groundZ = dv.getInt16(o + 4, true);
    o += 8;
    ring.length = 0;
    for (let i = 0; i < k; i++) {
      const dx = dv.getInt16(o, true) * job.unitM;
      const dz = dv.getInt16(o + 2, true) * job.unitM;
      o += 4;
      ring.push(job.centreX + dx, job.centreZ + dz);
    }
    const y0 = groundZ - job.sinkM;
    const y1 = groundZ + heightM;
    const tall = Math.min(1, Math.max(0, (heightM - 20) / 80));
    const wc = [
      WALL[0] + (TALL_TINT[0] - WALL[0]) * tall,
      WALL[1] + (TALL_TINT[1] - WALL[1]) * tall,
      WALL[2] + (TALL_TINT[2] - WALL[2]) * tall,
    ];

    // Walls: one quad per edge, own vertices so flat shading gives crisp faces.
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k;
      const ax = ring[i * 2];
      const az = ring[i * 2 + 1];
      const bx = ring[j * 2];
      const bz = ring[j * 2 + 1];
      const base = v;
      const quad = [
        [ax, y0, az],
        [bx, y0, bz],
        [bx, y1, bz],
        [ax, y1, az],
      ];
      // Slight vertical gradient: darker at the base.
      for (let q = 0; q < 4; q++) {
        positions[v * 3] = quad[q][0];
        positions[v * 3 + 1] = quad[q][1];
        positions[v * 3 + 2] = quad[q][2];
        const shade = q < 2 ? 0.86 : 1;
        colors[v * 3] = wc[0] * shade;
        colors[v * 3 + 1] = wc[1] * shade;
        colors[v * 3 + 2] = wc[2] * shade;
        v++;
      }
      // Two triangles; winding chosen so faces point outward for CCW rings.
      indices[ii++] = base;
      indices[ii++] = base + 2;
      indices[ii++] = base + 1;
      indices[ii++] = base;
      indices[ii++] = base + 3;
      indices[ii++] = base + 2;
    }

    // Roof.
    const roofBase = v;
    for (let i = 0; i < k; i++) {
      positions[v * 3] = ring[i * 2];
      positions[v * 3 + 1] = y1;
      positions[v * 3 + 2] = ring[i * 2 + 1];
      colors[v * 3] = ROOF[0] * (1 - 0.15 * tall);
      colors[v * 3 + 1] = ROOF[1] * (1 - 0.1 * tall);
      colors[v * 3 + 2] = ROOF[2];
      v++;
    }
    const tris = Earcut.triangulate(ring, undefined, 2);
    // Earcut works in x/y; our ring is x/z with +z south, which mirrors the
    // winding — flip so roofs face up (+y).
    for (let t = 0; t + 2 < tris.length; t += 3) {
      indices[ii++] = roofBase + tris[t];
      indices[ii++] = roofBase + tris[t + 2];
      indices[ii++] = roofBase + tris[t + 1];
    }
    // Rings that earcut could not triangulate leave unused index slots; trim.
  }

  const result: BuildingTileMesh = {
    id: job.id,
    positions,
    colors,
    indices: ii === indices.length ? indices : indices.slice(0, ii),
    count,
  };
  (self as unknown as Worker).postMessage(result, [
    result.positions.buffer,
    result.colors.buffer,
    result.indices.buffer,
  ]);
};
