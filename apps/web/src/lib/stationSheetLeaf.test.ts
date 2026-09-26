import { describe, expect, it } from "vitest";
import { FloodFieldClass } from "@siahra/shared-types";
import { fillStationSheet, SHEET_NONE, type SheetStation } from "./stationSheet";
import {
  applyObservedPrecedence,
  buildLeafSpec,
  fillLeafWindows,
  landcoverKey,
  leafRequestFor,
  planLeafFetches,
  SHEET_LEAF_MAX_CONCURRENT,
  SHEET_LEAF_MAX_REQUESTS,
  stationLeafNeeds,
  terrainKey,
  WORLDCOVER_BUILT,
  WORLDCOVER_TREE,
  type LeafSpec,
} from "./stationSheetLeaf";
import { observedMaskFromField } from "./stationSheetField";
import { terrainTileSpan, tileUrl } from "./tileCodec";

describe("ข้อจำกัด devops ของงาน 30 ม. (ค่าคงที่ต้องไม่ถูกขยับเงียบ ๆ)", () => {
  it("C1: งบ 48 คำขอต่อจังหวัด · พร้อมกันไม่เกิน 6 คำขอ", () => {
    expect(SHEET_LEAF_MAX_REQUESTS).toBe(48);
    expect(SHEET_LEAF_MAX_CONCURRENT).toBeLessThanOrEqual(6);
  });
});

/** bitset `present` ที่ทุกไทล์มีอยู่ ยกเว้น `absent` (ดัชนี y·tilesX + x) */
function bits(tilesX: number, tilesY: number, absent: number[] = []): Uint8Array {
  const out = new Uint8Array(Math.ceil((tilesX * tilesY) / 8));
  for (let i = 0; i < tilesX * tilesY; i++) if (!absent.includes(i)) out[i >> 3] |= 1 << (i & 7);
  return out;
}

/**
 * จังหวัดสังเคราะห์: overview `ow × oh` เซลล์ขนาด `cO` ม., ไทล์ leaf `T` เซลล์ × 30 ม.,
 * landcover หยาบกว่าหนึ่งขั้น (60 ม., factor 2) — pyramid เริ่มที่มุมบนซ้ายของ raster (offset 0)
 */
function spec(ow: number, oh: number, cO: number, T: number, opts: { absentT?: number[]; absentL?: number[] } = {}): LeafSpec {
  const tileM = T * 30;
  const tilesX = Math.ceil((ow * cO) / tileM);
  const tilesY = Math.ceil((oh * cO) / tileM);
  const lX = Math.ceil(tilesX / 2);
  const lY = Math.ceil(tilesY / 2);
  return {
    overview: { width: ow, height: oh, cellSizeM: cO },
    terrain: {
      z: 5,
      urlTemplate: "/aoi/99/terrain/{z}/{x}_{y}.bin",
      tileSize: T,
      border: 1,
      nodata: -32768,
      cellSizeM: 30,
      tilesX,
      tilesY,
      present: bits(tilesX, tilesY, opts.absentT),
    },
    offsetXM: 0,
    offsetYM: 0,
    landcover: {
      z: 4,
      urlTemplate: "/aoi/99/landcover/{z}/{x}_{y}.bin",
      cellSizeM: 60,
      tilesX: lX,
      tilesY: lY,
      present: bits(lX, lY, opts.absentL),
      factor: 2,
    },
  };
}

const st = (col: number, row: number, wseM = 2, bankM = 1): SheetStation => ({ col, row, wseM, bankM });

describe("buildLeafSpec", () => {
  it("leaf = ระดับสุดท้ายของ pyramid, มาสก์ = landcover หยาบกว่าหนึ่งขั้น (60 ม.), offset จาก manifest", () => {
    const b64 = btoa("\xff");
    const s = buildLeafSpec({
      overview: { width: 10, height: 10, cellSizeM: 83 },
      originEasting: 1000,
      originNorthing: 5000,
      tiles: {
        urlTemplate: "/aoi/14/terrain/{z}/{x}_{y}.bin",
        tileSize: 128,
        border: 1,
        leafCellSizeM: 30,
        originEasting: 1000,
        originNorthing: 5830,
        nodata: -32768,
        minZ: 0,
        maxZ: 10,
        levels: [
          { z: 0, cellSizeM: 60, width: 14, height: 14, tilesX: 1, tilesY: 1, present: b64 },
          { z: 1, cellSizeM: 30, width: 28, height: 28, tilesX: 1, tilesY: 1, present: b64 },
        ],
      },
      landcover: {
        urlTemplate: "/aoi/14/landcover/{z}/{x}_{y}.bin",
        attribution: "",
        classShare: {},
        levels: [
          { z: 1, tilesX: 1, tilesY: 1, present: b64 },
          { z: 0, tilesX: 1, tilesY: 1, present: b64 },
        ],
      },
    })!;
    expect(s.terrain.z).toBe(1);
    expect(s.terrain.cellSizeM).toBe(30);
    expect(s.landcover?.z).toBe(0);
    expect(s.landcover?.cellSizeM).toBe(60);
    expect(s.landcover?.factor).toBe(2);
    expect(s.offsetXM).toBe(0);
    expect(s.offsetYM).toBe(0);
  });

  it("ไม่มี pyramid → null (แผ่นอยู่บน overview ทั้งหมด)", () => {
    expect(
      buildLeafSpec({ overview: { width: 1, height: 1, cellSizeM: 1 }, originEasting: 0, originNorthing: 0, tiles: undefined, landcover: undefined }),
    ).toBeNull();
  });
});

describe("C1 — งบคำขอไทล์ต่อจังหวัด", () => {
  it(`สถานีเกินตลิ่ง 10 แห่งห่างกัน ≥ 10 กม. → แผนขอไม่เกิน ${SHEET_LEAF_MAX_REQUESTS} URL และที่เหลืออยู่บน overview`, () => {
    // 150 × 150 กม. ที่ 100 ม., ไทล์ 128 × 30 ม. — พื้นราบ 0 ม. ทุกสถานีเติมเต็มวง 5 กม.
    const s = spec(1500, 1500, 100, 128);
    const heights = new Float32Array(1500 * 1500);
    const stations: SheetStation[] = [];
    for (let k = 0; k < 10; k++) stations.push(st(150 + (k % 5) * 250, 300 + Math.floor(k / 5) * 600));
    // ห่างกันจริง ≥ 10 กม.
    for (let a = 0; a < stations.length; a++)
      for (let b = a + 1; b < stations.length; b++)
        expect(Math.hypot(stations[a].col - stations[b].col, stations[a].row - stations[b].row) * 100).toBeGreaterThanOrEqual(10_000);
    const fill = fillStationSheet({ width: 1500, height: 1500, cellSizeM: 100 }, heights, null, stations);
    const needs = stations.map((_, k) => stationLeafNeeds(s, fill.stationCells[k]));
    expect(needs.every((n) => n.keys.length > 0)).toBe(true);
    const total = new Set(needs.flatMap((n) => n.keys)).size;
    expect(total).toBeGreaterThan(SHEET_LEAF_MAX_REQUESTS); // งบต้อง "บีบ" จริงในเทสนี้
    const plan = planLeafFetches(needs.map((n) => ({ keys: n.keys, priority: 1 })), new Set(), 0);
    expect(plan.fetch.length).toBeLessThanOrEqual(SHEET_LEAF_MAX_REQUESTS);
    expect(new Set(plan.fetch).size).toBe(plan.fetch.length);
    expect(plan.status.filter((x) => x === "planned").length).toBeGreaterThan(0);
    expect(plan.status.filter((x) => x === "budget").length).toBeGreaterThan(0);
    // URL ทุกตัวสร้างด้วย tileUrl ของตัววาด (C5)
    const urls = plan.fetch.map((k) => leafRequestFor(s, k).url);
    expect(urls.every((u) => /^\/aoi\/99\/(terrain\/5|landcover\/4)\/\d+_\d+\.bin$/.test(u))).toBe(true);
  });

  it("งบนับข้ามงาน: ขอไปแล้ว 40 → งานถัดไปขอใหม่ได้ไม่เกิน 8; คีย์ที่ขอแล้วไม่เสียงบ", () => {
    const keys = Array.from({ length: 20 }, (_, i) => terrainKey(5, i, 0));
    const known = new Set(keys.slice(0, 15));
    const plan = planLeafFetches([{ keys, priority: 1 }], known, 40);
    expect(plan.status).toEqual(["planned"]);
    expect(plan.fetch).toEqual(keys.slice(15));
    const over = planLeafFetches([{ keys: Array.from({ length: 9 }, (_, i) => terrainKey(5, i, 1)), priority: 1 }], new Set(), 40);
    expect(over.fetch).toEqual([]);
    expect(over.status).toEqual(["budget"]);
  });

  it("ทั้งหมดหรือไม่เลยต่อสถานี ตามลำดับความสำคัญ — สถานีเล็กที่ยังพอได้งบต่อ", () => {
    const big = { keys: Array.from({ length: 30 }, (_, i) => terrainKey(5, i, 2)), priority: 1 };
    const high = { keys: Array.from({ length: 30 }, (_, i) => terrainKey(5, i, 3)), priority: 5 };
    const small = { keys: [terrainKey(5, 0, 4)], priority: 0 };
    const plan = planLeafFetches([big, high, small], new Set(), 0);
    expect(plan.status).toEqual(["budget", "planned", "planned"]);
    expect(plan.fetch.length).toBe(31);
  });
});

describe("C2 — ไทล์มาจากรอยเท้าของขั้นที่ 1 เท่านั้น", () => {
  it("สถานีที่ขั้นที่ 1 ไม่เติมอะไร → ไม่ขอไทล์เลย", () => {
    const s = spec(200, 200, 100, 128);
    const heights = new Float32Array(200 * 200).fill(10); // พื้นสูงกว่าผิวน้ำ
    const fill = fillStationSheet({ width: 200, height: 200, cellSizeM: 100 }, heights, null, [st(100, 100, 2, 1)]);
    expect(fill.cellsPerStation[0]).toBe(0);
    const needs = stationLeafNeeds(s, fill.stationCells[0]);
    expect(needs).toEqual({ terrain: [], keys: [] });
    expect(planLeafFetches([{ keys: needs.keys, priority: 1 }], new Set(), 0)).toEqual({ fetch: [], status: ["none"] });
  });

  it("เซลล์เดียว → เฉพาะไทล์ที่ตัดกับเซลล์นั้นขยายหนึ่งเซลล์ overview", () => {
    // ไทล์ 3840 ม.; เซลล์ (col 38, row 5) ที่ 100 ม. → ขยาย = x [3700, 4000), y [400, 700)
    // → ไทล์ x 0..1, y 0 → ภูมิประเทศ 2 ใบ + landcover (0,0) ใบเดียว (factor 2 ครอบทั้งคู่)
    const s = spec(200, 200, 100, 128);
    const needs = stationLeafNeeds(s, [5 * 200 + 38]);
    expect(needs.terrain).toEqual([0, 1]);
    expect(needs.keys).toEqual([terrainKey(5, 0, 0), landcoverKey(4, 0, 0), terrainKey(5, 1, 0)]);
    // เซลล์กลางไทล์ → ไทล์เดียว
    expect(stationLeafNeeds(s, [20 * 200 + 20]).terrain).toEqual([0]);
  });
});

describe("C4 — บิต present = 0 ไม่ถูกขอ", () => {
  it("ไทล์ภูมิประเทศ/landcover ที่ไม่มีอยู่ไม่อยู่ในรายการ", () => {
    const s = spec(200, 200, 100, 128, { absentT: [1], absentL: [0] });
    const needs = stationLeafNeeds(s, [5 * 200 + 38]);
    expect(needs.terrain).toEqual([0]);
    expect(needs.keys).toEqual([terrainKey(5, 0, 0)]);
    const plan = planLeafFetches([{ keys: needs.keys, priority: 1 }], new Set(), 0);
    expect(plan.fetch).not.toContain(terrainKey(5, 1, 0));
    expect(plan.fetch).not.toContain(landcoverKey(4, 0, 0));
  });
});

describe("C5 — URL ตรงกับตัววาดทุกไบต์", () => {
  it("leafRequestFor = tileUrl(urlTemplate) = การแทนแบบเดิมของ TerrainTiles/VegetationTiles", () => {
    const s = spec(200, 200, 100, 128);
    const tpl = s.terrain.urlTemplate;
    expect(leafRequestFor(s, terrainKey(5, 3, 7)).url).toBe(
      tpl.replace("{z}", "5").replace("{x}", "3").replace("{y}", "7"),
    );
    expect(leafRequestFor(s, landcoverKey(4, 1, 2)).url).toBe("/aoi/99/landcover/4/1_2.bin");
    expect(tileUrl("/aoi/10/v/abc/terrain/{z}/{x}_{y}.bin", 5, 0, 12)).toBe("/aoi/10/v/abc/terrain/5/0_12.bin");
  });
});

/** ไทล์ภูมิประเทศสังเคราะห์ (มีขอบ) จากฟังก์ชันความสูงบนกริด leaf ทั้งจังหวัด */
function terrainTile(s: LeafSpec, tx: number, ty: number, h: (gc: number, gr: number) => number): Int16Array {
  const { tileSize: T, border: B } = s.terrain;
  const span = terrainTileSpan(T, B);
  const out = new Int16Array(span * span);
  for (let j = 0; j < span; j++) for (let i = 0; i < span; i++) out[j * span + i] = h(tx * T + i - B, ty * T + j - B);
  return out;
}

describe("fillLeafWindows — เติมบน 30 ม.", () => {
  // overview 60 ม. (2 × leaf) 16×8 เซลล์ = 960×480 ม.; ไทล์ 16 เซลล์ × 30 ม. = 480 ม. → 2×1 ไทล์
  const s = spec(16, 8, 60, 16);
  const flat = (gc: number) => (gc === 20 ? 9 : 0); // กำแพงแนวตั้งที่คอลัมน์ leaf 20
  const tiles = {
    terrain: new Map([
      [0, terrainTile(s, 0, 0, flat)],
      [1, terrainTile(s, 1, 0, flat)],
    ]),
    landcover: new Map<number, Uint8Array>(),
  };

  it("รอยต่อไทล์: น้ำข้ามขอบไทล์ได้ และจุดยอดขอบร่วมของสองหน้าต่างมีค่าเดียวกัน", () => {
    const stations = [st(2, 4, 2, 1)];
    const ov = fillStationSheet({ width: 16, height: 8, cellSizeM: 60 }, new Float32Array(16 * 8), null, stations);
    const wins = fillLeafWindows({
      spec: s,
      tiles,
      windowTiles: [0, 1],
      stations,
      refined: [true],
      overview: { station: ov.station, fadePct: ov.fadePct },
      insideMask: null,
    });
    expect(wins.map((w) => [w.tx, w.size])).toEqual([
      [0, 17],
      [1, 17],
    ]);
    const [a, b] = wins;
    for (let j = 0; j < 17; j++) {
      // คอลัมน์ 16 ของหน้าต่าง 0 = คอลัมน์ 0 ของหน้าต่าง 1 (เซลล์ leaf 16)
      expect(a.station[j * 17 + 16]).toBe(b.station[j * 17]);
      expect(a.depthCm[j * 17 + 16]).toBe(b.depthCm[j * 17]);
      expect(a.heights[j * 17 + 16]).toBe(b.heights[j * 17]);
    }
    // ข้ามรอยต่อไปถึงคอลัมน์ 19 แต่ไม่ข้ามกำแพงที่ 20
    expect(b.station[4 * 17 + 3]).toBe(0); // gc 19
    expect(b.station[4 * 17 + 4]).toBe(SHEET_NONE); // gc 20 = กำแพง
    expect(b.station[4 * 17 + 6]).toBe(SHEET_NONE); // หลังกำแพง
    expect(a.depthCm[4 * 17 + 5]).toBe(200);
  });

  it("อาคาร/ต้นไม้ตาม WorldCover (60 ม.) = ไม่ได้ประมาณความลึก เฉพาะเซลล์ที่ถูกเติม", () => {
    const lc = new Uint8Array(16 * 16);
    lc[2 * 16 + 1] = WORLDCOVER_BUILT; // เซลล์ 60 ม. (1, 2) → leaf (2..3, 4..5)
    lc[2 * 16 + 2] = WORLDCOVER_TREE; // leaf (4..5, 4..5)
    lc[2 * 16 + 3] = 40; // นาข้าว — ไม่ใช่
    const stations = [st(2, 4, 2, 1)];
    const ov = fillStationSheet({ width: 16, height: 8, cellSizeM: 60 }, new Float32Array(16 * 8), null, stations);
    const [w] = fillLeafWindows({
      spec: s,
      tiles: { terrain: tiles.terrain, landcover: new Map([[0, lc]]) },
      windowTiles: [0],
      stations,
      refined: [true],
      overview: { station: ov.station, fadePct: ov.fadePct },
      insideMask: null,
    });
    expect(w.notEst[4 * 17 + 2]).toBe(1);
    expect(w.notEst[5 * 17 + 3]).toBe(1);
    expect(w.notEst[4 * 17 + 4]).toBe(1);
    expect(w.notEst[4 * 17 + 6]).toBe(0);
    expect(w.notEst[4 * 17 + 8]).toBe(0);
  });

  it("สถานีที่ไม่ละเอียด (งบหมด) ถูกสุ่มจาก overview ลงหน้าต่าง ไม่ถูกตัดหายตรงขอบหน้าต่าง", () => {
    const stations = [st(12, 4, 3, 1)];
    const ov = fillStationSheet({ width: 16, height: 8, cellSizeM: 60 }, new Float32Array(16 * 8), null, stations);
    const [w] = fillLeafWindows({
      spec: s,
      tiles,
      windowTiles: [1],
      stations,
      refined: [false],
      overview: { station: ov.station, fadePct: ov.fadePct },
      insideMask: null,
    });
    expect(w.station[4 * 17 + 10]).toBe(0);
    expect(w.depthCm[4 * 17 + 10]).toBe(300);
    // กำแพง 9 ม. สูงกว่าผิวน้ำ 3 ม. — พื้น 30 ม. ตัดสิน ไม่ใช่ overview
    expect(w.station[4 * 17 + 4]).toBe(SHEET_NONE);
  });
});

describe("applyObservedPrecedence — ดาวเทียมที่เห็นจริงมาก่อน", () => {
  it("เซลล์ที่ GFM สังเกตแล้ว (ท่วม/แห้ง) ถูกลบจากแผ่นทั้ง overview และหน้าต่าง; ต้นฉบับไม่ถูกแตะ", () => {
    const s = spec(16, 8, 60, 16);
    const n = 16 * 8;
    const overview = {
      depthCm: new Uint16Array(n).fill(100),
      station: new Uint16Array(n).fill(0),
      fadePct: new Uint8Array(n).fill(100),
    };
    const size = 17;
    const win = {
      tx: 0,
      ty: 0,
      size,
      heights: new Float32Array(size * size),
      depthCm: new Uint16Array(size * size).fill(50),
      station: new Uint16Array(size * size).fill(0),
      fadePct: new Uint8Array(size * size).fill(100),
      notEst: new Uint8Array(size * size),
      filledCells: size * size,
    };
    // ฟิลด์ GFM (แถวล่างขึ้นบน): overview แถว 0 (เหนือ) = แถว 7 ของฟิลด์
    const cls = new Uint8Array(n).fill(FloodFieldClass.NO_OBSERVATION);
    cls[7 * 16 + 0] = FloodFieldClass.FLOODED; // overview (0, 0)
    cls[7 * 16 + 1] = FloodFieldClass.DRY; // overview (1, 0)
    cls[7 * 16 + 2] = FloodFieldClass.EXCLUDED; // ไม่ใช่การสังเกต
    cls[7 * 16 + 3] = FloodFieldClass.REFERENCE_WATER; // ไม่ใช่การสังเกตของฉากนี้
    cls[7 * 16 + 4] = FloodFieldClass.FLOODED_DEPTH_NOT_ESTIMATED;
    const observed = observedMaskFromField({ width: 16, height: 8, cls });
    expect([...observed.slice(0, 6)]).toEqual([1, 1, 0, 0, 1, 0]);
    const out = applyObservedPrecedence(s, observed, overview, [win]);
    expect(out.overview.station[0]).toBe(SHEET_NONE);
    expect(out.overview.station[1]).toBe(SHEET_NONE);
    expect(out.overview.station[2]).toBe(0);
    expect(out.overview.station[3]).toBe(0);
    expect(out.overview.station[4]).toBe(SHEET_NONE);
    // leaf (0..1, 0..1) อยู่ใต้ overview (0, 0); leaf (2..3, 0) ใต้ (1, 0); leaf (4, 0) ใต้ (2, 0)
    const w = out.windows[0];
    expect(w.station[0]).toBe(SHEET_NONE);
    expect(w.station[1 * size + 1]).toBe(SHEET_NONE);
    expect(w.station[3]).toBe(SHEET_NONE);
    expect(w.station[4]).toBe(0);
    expect(w.filledCells).toBeLessThan(size * size);
    // ต้นฉบับยังอยู่ — worker ใช้ซ้ำเมื่อฉากเปลี่ยน โดยไม่ต้องขอไทล์ใหม่
    expect(overview.station[0]).toBe(0);
    expect(win.station[0]).toBe(0);
    // ไม่มีฉาก → สำเนาเดิม
    expect(applyObservedPrecedence(s, null, overview, [win]).overview.station[0]).toBe(0);
  });
});
