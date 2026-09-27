import { describe, expect, it } from "vitest";
import { buildBuildingMesh } from "./buildingMesh";

/** ไทล์อาคารตาม BuildingTilePyramid: หัว 8 ไบต์ แล้วต่ออาคารละ 8 ไบต์ + k × (dx, dz) Int16 */
function tile(rings: number[][][], heightDm = 200, groundZ = 5): ArrayBuffer {
  let size = 8;
  for (const r of rings) size += 8 + r.length * 4;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  dv.setUint32(0, 0x444c4253, true);
  dv.setUint32(4, rings.length, true);
  let o = 8;
  for (const r of rings) {
    dv.setUint16(o, r.length, true);
    dv.setUint16(o + 2, heightDm, true);
    dv.setInt16(o + 4, groundZ, true);
    o += 8;
    for (const [x, z] of r) {
      dv.setInt16(o, x, true);
      dv.setInt16(o + 2, z, true);
      o += 4;
    }
  }
  return buf;
}

const job = (rings: number[][][]) => ({
  id: "t",
  buffer: tile(rings),
  unitM: 1,
  centreX: 100,
  centreZ: -50,
  sinkM: 1.5,
});

const SQUARE = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];
const L_SHAPE = [
  [0, 0],
  [20, 0],
  [20, 10],
  [10, 10],
  [10, 20],
  [0, 20],
];
const reversed = (r: number[][]) => [...r].reverse();

function pointInRing(x: number, z: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** normal ของหน้าสามเหลี่ยมแบบ front-face ของ three (CCW เมื่อมองจากด้านหน้า) */
function triangles(mesh: ReturnType<typeof buildBuildingMesh>) {
  const p = (i: number) => [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
  const out: { centre: number[]; normal: number[] }[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = p(mesh.indices[t]);
    const b = p(mesh.indices[t + 1]);
    const c = p(mesh.indices[t + 2]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len === 0) continue;
    out.push({
      centre: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3],
      normal: n.map((x) => x / len),
    });
  }
  return out;
}

describe("buildBuildingMesh — winding (เงื่อนไขของ FrontSide)", () => {
  for (const [name, ring] of [
    ["สี่เหลี่ยม", SQUARE],
    ["สี่เหลี่ยม (วนกลับ)", reversed(SQUARE)],
    ["รูปตัว L (เว้า)", L_SHAPE],
    ["รูปตัว L (วนกลับ)", reversed(L_SHAPE)],
  ] as const) {
    it(`${name}: หลังคาหงายขึ้น และผนังทุกด้านหันออกนอกอาคาร`, () => {
      const mesh = buildBuildingMesh(job([ring as number[][]]));
      const sceneRing = (ring as number[][]).map(([x, z]) => [100 + x, -50 + z]);
      const tris = triangles(mesh);
      let walls = 0;
      let roofs = 0;
      for (const { centre, normal } of tris) {
        if (Math.abs(normal[1]) > 0.99) {
          roofs++;
          expect(normal[1]).toBeGreaterThan(0);
        } else {
          walls++;
          expect(Math.abs(normal[1])).toBeLessThan(1e-6);
          // จุดที่ขยับออกไปตาม normal เล็กน้อยต้องอยู่นอก footprint, ขยับเข้าต้องอยู่ใน
          const out = [centre[0] + normal[0] * 0.5, centre[2] + normal[2] * 0.5];
          const inn = [centre[0] - normal[0] * 0.5, centre[2] - normal[2] * 0.5];
          expect(pointInRing(out[0], out[1], sceneRing)).toBe(false);
          expect(pointInRing(inn[0], inn[1], sceneRing)).toBe(true);
        }
      }
      expect(walls).toBe(ring.length * 2);
      expect(roofs).toBe(ring.length - 2);
    });
  }
});

describe("buildBuildingMesh — รูปแบบข้อมูลที่บีบแล้ว", () => {
  it("สีเป็น Uint8 (normalized 0–255) และ index เป็น Uint16 เมื่อ vertex ≤ 65535", () => {
    const mesh = buildBuildingMesh(job([SQUARE]));
    expect(mesh.colors).toBeInstanceOf(Uint8Array);
    expect(mesh.colors.length).toBe((mesh.positions.length / 3) * 3);
    expect(mesh.indices).toBeInstanceOf(Uint16Array);
    // สีหลังคาของอาคารเตี้ย (tall = 0) = ROOF × 255
    const roofVertex = SQUARE.length * 4;
    expect(Array.from(mesh.colors.slice(roofVertex * 3, roofVertex * 3 + 3))).toEqual([69, 71, 77]);
    expect(mesh.count).toBe(1);
  });

  it("index เป็น Uint32 เมื่อ vertex เกิน 65535", () => {
    // สี่เหลี่ยมละ 20 vertex → 3277 หลัง = 65540 vertex
    const rings = Array.from({ length: 3277 }, () => SQUARE);
    const mesh = buildBuildingMesh(job(rings));
    expect(mesh.positions.length / 3).toBe(65540);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);
    expect(Math.max(...mesh.indices.slice(-6))).toBe(65539);
  });

  it("ไฟล์ที่ไม่ใช่ไทล์อาคาร (เช่น SPA shell) → mesh ว่าง ไม่ throw", () => {
    const mesh = buildBuildingMesh({ ...job([SQUARE]), buffer: new TextEncoder().encode("<!doctype html>").buffer });
    expect(mesh.count).toBe(0);
    expect(mesh.indices.length).toBe(0);
  });
});
