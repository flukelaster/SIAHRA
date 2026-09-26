import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  estimateGistdaDepth,
  GISTDA_CELL_DEPTH,
  GISTDA_CELL_NONE,
  GISTDA_CELL_NOT_EST,
  GISTDA_NO_DEPTH,
  median,
  nearestSiteIndex,
} from "./gistdaDepth";

/**
 * E16 B-2 — พอร์ต FwDET (apps/etl/gfm/gfm/fwdet.py) ฝั่งเว็บ: เทสชุดเดียวกับ tests/test_fwdet.py
 * + เทียบผลกับตัว Python จริงบนกริดสังเคราะห์ (`__fixtures__/fwdet-golden.json`, สร้างด้วย
 * `gfm.fwdet.estimate_depth` ผ่าน `__fixtures__/fwdet-golden.gen.py` — excluded/refwater = False,
 * landcover = 40 = ไม่มีมาสก์; แก้ fwdet.py แล้วต้องสร้างใหม่ด้วยสคริปต์นั้น)
 */
const here = dirname(fileURLToPath(import.meta.url));

interface GoldenCase {
  name: string;
  width: number;
  height: number;
  smooth: boolean;
  heights: number[];
  flooded: number[];
  inside: number[];
  /** contract.CLASS_*: 0 NO_OBSERVATION, 1 DRY, 2 FLOODED, 5 FLOODED_DEPTH_NOT_ESTIMATED */
  expectedCls: number[];
  expectedDepthCm: number[];
  boundaryCells: number;
  /** 1 = เซลล์ขอบที่ใกล้ที่สุดเสมอกันหลายเซลล์ — EDT ของ scipy กับของเราอาจเลือกคนละเซลล์ */
  tie: number[];
  /** ช่วงความลึก (ซม.) ที่ทุกตัวเลือกของเซลล์ขอบที่เสมอกันให้ได้ (หลัง smooth เมื่อเปิด) */
  depthLoCm: number[];
  depthHiCm: number[];
}
const golden = JSON.parse(readFileSync(resolve(here, "__fixtures__/fwdet-golden.json"), "utf8")) as {
  cases: GoldenCase[];
};

/** เซลล์นี้ (หรือเพื่อนบ้าน 3×3 เมื่อ smooth) มีขอบใกล้สุดเสมอกัน */
function tieNear(g: GoldenCase, i: number): boolean {
  if (!g.smooth) return g.tie[i] === 1;
  const r = Math.floor(i / g.width);
  const c = i % g.width;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= g.height || cc >= g.width) continue;
      if (g.tie[rr * g.width + cc] === 1) return true;
    }
  }
  return false;
}

const PY_FLOODED = 2;
const PY_NOT_EST = 5;

function bowl(n = 200, k = 3e-5, radius = 80) {
  const heights = new Float32Array(n * n);
  const flooded = new Uint8Array(n * n);
  const c = n / 2;
  const level = k * radius * radius;
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      const r2 = (col - c) ** 2 + (r - c) ** 2;
      const z = Math.fround(k * r2);
      heights[r * n + col] = z;
      flooded[r * n + col] = z < level ? 1 : 0;
    }
  }
  return { n, heights, flooded, level };
}

describe("median", () => {
  it("จำนวนคู่ = เฉลี่ยสองค่ากลาง แบบ np.nanmedian", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });
});

describe("nearestSiteIndex", () => {
  it("ระยะถึง site ที่เลือก = ระยะยุคลิดที่สั้นที่สุด (เทียบ brute force)", () => {
    const w = 37;
    const h = 29;
    const site = new Uint8Array(w * h);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < w * h; i++) if (rnd() < 0.03) site[i] = 1;
    const sites: number[] = [];
    site.forEach((v, i) => v && sites.push(i));
    const idx = nearestSiteIndex(site, w, h);
    for (let i = 0; i < w * h; i++) {
      const r = Math.floor(i / w);
      const c = i % w;
      let best = Infinity;
      for (const s of sites) best = Math.min(best, (Math.floor(s / w) - r) ** 2 + ((s % w) - c) ** 2);
      const j = idx[i]!;
      expect(site[j]).toBe(1);
      expect((Math.floor(j / w) - r) ** 2 + ((j % w) - c) ** 2).toBe(best);
    }
  });

  it("ไม่มี site เลย = −1 ทุกเซลล์", () => {
    expect([...nearestSiteIndex(new Uint8Array(12), 4, 3)].every((v) => v === -1)).toBe(true);
  });
});

describe("estimateGistdaDepth", () => {
  it("แอ่งพาราโบลา: ความลึกด้านในคลาดไม่เกิน 1 ซม. (test_bowl_depth_within_1cm)", () => {
    const { n, heights, flooded, level } = bowl();
    const res = estimateGistdaDepth({ width: n, height: n }, heights, flooded, null);
    expect(res.boundaryCells).toBeGreaterThan(0);
    let checked = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        if (!flooded[i]) {
          expect(res.cls[i]).toBe(GISTDA_CELL_NONE);
          expect(res.depthCm[i]).toBe(GISTDA_NO_DEPTH);
          continue;
        }
        if ((c - n / 2) ** 2 + (r - n / 2) ** 2 >= 50 * 50) continue;
        expect(res.cls[i]).toBe(GISTDA_CELL_DEPTH);
        expect(Math.abs(res.depthCm[i]! - (level - heights[i]!) * 100)).toBeLessThanOrEqual(1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it("ขอบ = เซลล์ท่วมที่ชนเซลล์แห้งในจังหวัดเท่านั้น — ด้านที่ชนนอกจังหวัดไม่นับ", () => {
    const n = 12;
    const heights = new Float32Array(n * n).fill(5);
    const flooded = new Uint8Array(n * n);
    const inside = new Uint8Array(n * n).fill(1);
    for (let r = 2; r < 10; r++) for (let c = 2; c < 10; c++) flooded[r * n + c] = 1;
    // ซ้าย (คอลัมน์ 0–1) และบน (แถว 0–1) อยู่นอกจังหวัด — ไม่ใช่ "แห้ง"
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (c < 2 || r < 2) inside[r * n + c] = 0;
    const res = estimateGistdaDepth({ width: n, height: n }, heights, flooded, inside);
    // เหมือน test_boundary_ignores_unobserved_and_excluded_neighbours: 8 + 8 − 1 = 15
    expect(res.boundaryCells).toBe(15);
  });

  it("median ของขอบตัด spike (test_boundary_median_removes_spike)", () => {
    const n = 20;
    const heights = new Float32Array(n * n).fill(10);
    for (let r = 6; r < 14; r++) for (let c = 6; c < 14; c++) heights[r * n + c] = 9;
    const flooded = new Uint8Array(n * n);
    for (let r = 5; r < 15; r++) for (let c = 5; c < 15; c++) flooded[r * n + c] = 1;
    heights[5 * n + 9] = 15; // ต้นไม้/หลังคาบนขอบ
    const res = estimateGistdaDepth({ width: n, height: n }, heights, flooded, null, { smooth: false });
    expect(res.depthCm[6 * n + 9]).toBe(100);
  });

  it("ความลึกถูกตัดที่ 0 และ 10 ม.", () => {
    const n = 9;
    const heights = new Float32Array(n * n).fill(20);
    const flooded = new Uint8Array(n * n);
    for (let r = 2; r < 7; r++) for (let c = 2; c < 7; c++) flooded[r * n + c] = 1;
    heights[4 * n + 4] = -5; // ลึก 25 ม. → 10 ม.
    heights[3 * n + 4] = 30; // สูงกว่าผิวน้ำ → 0
    const res = estimateGistdaDepth({ width: n, height: n }, heights, flooded, null, { smooth: false });
    expect(res.depthCm[4 * n + 4]).toBe(1000);
    expect(res.depthCm[3 * n + 4]).toBe(0);
    expect(res.cls[3 * n + 4]).toBe(GISTDA_CELL_DEPTH);
    expect(res.maxDepthCm).toBe(1000);
  });

  it("ไม่มีเซลล์ขอบ = ทุกเซลล์ท่วม 'ไม่ได้ประมาณ' ไม่ใช่ 0 ม. (test_no_boundary_means_no_depth)", () => {
    const n = 8;
    const res = estimateGistdaDepth(
      { width: n, height: n },
      new Float32Array(n * n).fill(5),
      new Uint8Array(n * n).fill(1),
      null,
    );
    expect(res.boundaryCells).toBe(0);
    expect([...res.cls].every((c) => c === GISTDA_CELL_NOT_EST)).toBe(true);
    expect([...res.depthCm].every((d) => d === GISTDA_NO_DEPTH)).toBe(true);
    expect(res.maxDepthCm).toBeNull();
  });

  it("ไม่มีเซลล์ท่วม = ผลว่าง", () => {
    const res = estimateGistdaDepth({ width: 3, height: 2 }, new Float32Array(6), new Uint8Array(6), null);
    expect(res.floodedCells).toBe(0);
    expect(res.maxDepthCm).toBeNull();
    expect([...res.cls].every((c) => c === GISTDA_CELL_NONE)).toBe(true);
  });

  it("กริดไม่ตรงกัน = throw", () => {
    expect(() => estimateGistdaDepth({ width: 3, height: 3 }, new Float32Array(8), new Uint8Array(9), null)).toThrow();
  });

  describe("golden: เทียบกับ gfm.fwdet.estimate_depth (Python)", () => {
    for (const g of golden.cases) {
      it(g.name, () => {
        const res = estimateGistdaDepth(
          { width: g.width, height: g.height },
          Float32Array.from(g.heights),
          Uint8Array.from(g.flooded),
          Uint8Array.from(g.inside),
          { smooth: g.smooth },
        );
        expect(res.boundaryCells).toBe(g.boundaryCells);
        let compared = 0;
        let checked = 0;
        for (let i = 0; i < g.width * g.height; i++) {
          const py = g.expectedCls[i]!;
          const isFlooded = py === PY_FLOODED || py === PY_NOT_EST;
          expect(res.cls[i]).toBe(py === PY_FLOODED ? GISTDA_CELL_DEPTH : py === PY_NOT_EST ? GISTDA_CELL_NOT_EST : GISTDA_CELL_NONE);
          if (!isFlooded || py === PY_NOT_EST) {
            expect(res.depthCm[i]).toBe(GISTDA_NO_DEPTH);
            continue;
          }
          // ทุกเซลล์ท่วม: อยู่ในช่วงที่ตัวเลือกเซลล์ขอบที่เสมอกันให้ได้ (Python เองก็อยู่ในช่วงนี้)
          const lo = g.depthLoCm[i]! - 1;
          const hi = g.depthHiCm[i]! + 1;
          expect(g.expectedDepthCm[i]!).toBeGreaterThanOrEqual(lo);
          expect(g.expectedDepthCm[i]!).toBeLessThanOrEqual(hi);
          expect(res.depthCm[i]!).toBeGreaterThanOrEqual(lo);
          expect(res.depthCm[i]!).toBeLessThanOrEqual(hi);
          checked++;
          // ไม่มีการเสมอกันในหน้าต่างที่มีผล: ต้องตรงกับ Python (np.rint ปัดครึ่งไปเลขคู่ / Math.round
          // ปัดครึ่งขึ้น → คลาดได้ 1 ซม.)
          if (tieNear(g, i)) continue;
          expect(Math.abs(res.depthCm[i]! - g.expectedDepthCm[i]!)).toBeLessThanOrEqual(1);
          compared++;
        }
        const floodedCells = g.expectedCls.filter((c) => c === PY_FLOODED).length;
        expect(checked).toBe(floodedCells);
        expect(compared).toBeGreaterThan(20);
      });
    }
  });
});
