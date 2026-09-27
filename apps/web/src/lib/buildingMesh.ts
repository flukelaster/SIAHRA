import { Earcut } from "three/src/extras/Earcut.js";

/**
 * Extrudes one building tile (see BuildingTilePyramid for the byte layout)
 * into a flat-shaded mesh: walls + earcut roof per footprint, positions in
 * scene metres. Pure (no DOM/worker globals) so it can be unit-tested; the
 * worker in `workers/buildingTiles.worker.ts` only wraps it.
 *
 * รูปแบบผลลัพธ์ถูกบีบให้เล็กเพื่อมือถือ (ไม่แตะไฟล์ .bin): สีเป็น Uint8 ×3 แบบ
 * normalized (3 B/vertex แทน 12) และ index เป็น Uint16 เมื่อจำนวน vertex ≤ 65535
 *
 * ทิศของหน้า (winding): หลังคาหงายขึ้น (+y) เสมอ — earcut คืนสามเหลี่ยมทิศเดียวกัน
 * ไม่ว่า ring ขาเข้าจะวนทางไหน — แต่ผนังขึ้นกับทิศของ ring และ ETL ไม่ได้จัดทิศ ring
 * จาก OSM ไว้ จึงเลือก winding ของผนังต่ออาคารจากพื้นที่มีเครื่องหมายใน x/z ของฉาก
 * ให้หน้าผนังชี้ออกนอกอาคารเสมอ วัสดุจึงใช้ FrontSide ได้
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
  /** RGB 0–255 — ใช้กับ `BufferAttribute(colors, 3, true)` */
  colors: Uint8Array;
  indices: Uint16Array | Uint32Array;
  count: number;
}

const MAGIC = 0x444c4253;
const UINT16_MAX_VERTICES = 65535;

// Kept fairly dark: the scene lights are bright (physically based units)
// and light grey blows out to white under them.
const WALL = [0.19, 0.20, 0.23];
const ROOF = [0.27, 0.28, 0.30];
const TALL_TINT = [0.20, 0.25, 0.34];

const toByte = (c: number) => Math.max(0, Math.min(255, Math.round(c * 255)));

export function emptyBuildingMesh(id: string): BuildingTileMesh {
  return { id, positions: new Float32Array(0), colors: new Uint8Array(0), indices: new Uint16Array(0), count: 0 };
}

export function buildBuildingMesh(job: BuildingTileJob): BuildingTileMesh {
  const dv = new DataView(job.buffer);
  if (dv.byteLength < 8 || dv.getUint32(0, true) !== MAGIC) return emptyBuildingMesh(job.id);
  const count = dv.getUint32(4, true);

  // First pass: sizes.
  let o = 8;
  let vertexTotal = 0;
  let indexTotal = 0;
  for (let b = 0; b < count; b++) {
    const k = dv.getUint16(o, true);
    o += 8 + k * 4;
    vertexTotal += k * 4 + k; // 4 per wall quad + roof ring
    indexTotal += k * 6 + Math.max(0, k - 2) * 3;
  }
  const positions = new Float32Array(vertexTotal * 3);
  const colors = new Uint8Array(vertexTotal * 3);
  const indices = vertexTotal <= UINT16_MAX_VERTICES ? new Uint16Array(indexTotal) : new Uint32Array(indexTotal);

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

    // พื้นที่มีเครื่องหมายของ ring ใน (x, z) ของฉาก: > 0 = ลำดับที่สามเหลี่ยมผนังข้างล่าง
    // หันหน้าออกนอก (normal ของขอบ a→b คือ (dz, 0, −dx)), < 0 = ต้องสลับ winding
    let area2 = 0;
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k;
      area2 += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
    }
    const outward = area2 >= 0;

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
        colors[v * 3] = toByte(wc[0] * shade);
        colors[v * 3 + 1] = toByte(wc[1] * shade);
        colors[v * 3 + 2] = toByte(wc[2] * shade);
        v++;
      }
      if (outward) {
        indices[ii++] = base;
        indices[ii++] = base + 2;
        indices[ii++] = base + 1;
        indices[ii++] = base;
        indices[ii++] = base + 3;
        indices[ii++] = base + 2;
      } else {
        indices[ii++] = base;
        indices[ii++] = base + 1;
        indices[ii++] = base + 2;
        indices[ii++] = base;
        indices[ii++] = base + 2;
        indices[ii++] = base + 3;
      }
    }

    // Roof.
    const roofBase = v;
    for (let i = 0; i < k; i++) {
      positions[v * 3] = ring[i * 2];
      positions[v * 3 + 1] = y1;
      positions[v * 3 + 2] = ring[i * 2 + 1];
      colors[v * 3] = toByte(ROOF[0] * (1 - 0.15 * tall));
      colors[v * 3 + 1] = toByte(ROOF[1] * (1 - 0.1 * tall));
      colors[v * 3 + 2] = toByte(ROOF[2]);
      v++;
    }
    const tris = Earcut.triangulate(ring, undefined, 2);
    // Earcut works in x/y; our ring is x/z with +z south, which mirrors the
    // winding — flip so roofs face up (+y). Earcut normalises the ring's
    // orientation internally, so this holds for CW and CCW input alike.
    for (let t = 0; t + 2 < tris.length; t += 3) {
      indices[ii++] = roofBase + tris[t];
      indices[ii++] = roofBase + tris[t + 2];
      indices[ii++] = roofBase + tris[t + 1];
    }
    // Rings that earcut could not triangulate leave unused index slots; trim.
  }

  return {
    id: job.id,
    positions,
    colors,
    indices: ii === indices.length ? indices : indices.slice(0, ii),
    count,
  };
}
