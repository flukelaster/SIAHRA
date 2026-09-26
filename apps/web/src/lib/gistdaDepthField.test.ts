import { describe, expect, it } from "vitest";
import {
  FLOOD_FIELD_NO_DEPTH,
  FLOOD_FIELD_NO_LIKELIHOOD,
  FloodFieldClass,
  type HazardLayerDescriptor,
} from "@siahra/shared-types";
import { gistdaDepthDescriptor } from "../hooks/useLayerDescriptors";
import { encodeFloodFieldRgba } from "../scene/floodField";
import { estimateGistdaDepth, GISTDA_CELL_DEPTH, GISTDA_CELL_NOT_EST, GISTDA_NO_DEPTH } from "./gistdaDepth";
import { gfmFloodedMaskFromField, gistdaCellAt, gistdaToFloodField, unionMasks } from "./gistdaDepthField";
import { SHEET_NONE } from "./stationSheet";
import { applyObservedPrecedence } from "./stationSheetLeaf";
import { observedMaskFromField } from "./stationSheetField";

/** ดัชนีแถว-หลัก (เขียนแถว 0 เป็น `0 * w + c` ตรง ๆ แล้ว oxlint เตือน erasing-op) */
const ix = (r: number, c: number, w: number) => r * w + c;

/** 4×3 (แถว 0 = เหนือ): เซลล์ (0,1) ลึก 120 ซม., (1,2) ไม่ได้ประมาณ, (2,3) ลึก 1 ซม. */
function cells() {
  const width = 4;
  const height = 3;
  const cls = new Uint8Array(width * height);
  const depthCm = new Uint16Array(width * height).fill(GISTDA_NO_DEPTH);
  cls[ix(0, 1, width)] = GISTDA_CELL_DEPTH;
  depthCm[ix(0, 1, width)] = 120;
  cls[1 * width + 2] = GISTDA_CELL_NOT_EST;
  cls[2 * width + 3] = GISTDA_CELL_DEPTH;
  depthCm[2 * width + 3] = 1;
  return { width, height, cls, depthCm };
}

describe("gistdaToFloodField", () => {
  it("กลับแถวเป็นล่างขึ้นบน (แบบ field.bin) + คลาส/ความลึก/likelihood ว่าง", () => {
    const f = gistdaToFloodField(cells());
    // แถว 0 (เหนือ) → แถว 2 ของฟิลด์
    expect(f.cls[2 * 4 + 1]).toBe(FloodFieldClass.FLOODED);
    expect(f.depthCm[2 * 4 + 1]).toBe(120);
    expect(f.cls[1 * 4 + 2]).toBe(FloodFieldClass.FLOODED_DEPTH_NOT_ESTIMATED);
    expect(f.depthCm[1 * 4 + 2]).toBe(FLOOD_FIELD_NO_DEPTH);
    expect(f.cls[0]).toBe(FloodFieldClass.NO_OBSERVATION);
    expect([...f.likelihood].every((l) => l === FLOOD_FIELD_NO_LIKELIHOOD)).toBe(true);
    // texture เดียวกับของ GFM: A = 255 เฉพาะเซลล์ที่มีค่าความลึก
    const rgba = encodeFloodFieldRgba(f);
    expect(rgba[(2 * 4 + 1) * 4 + 3]).toBe(255);
    expect(rgba[(1 * 4 + 2) * 4 + 3]).toBe(0);
  });

  it("GFM มาก่อน: เซลล์ที่ฉาก GFM ว่าท่วมถูกตัดออก — ที่ GFM ว่าแห้งยังอยู่", () => {
    const n = 12;
    // ฟิลด์ GFM (ล่างขึ้นบน): แถวบนสุดของกริด = แถว 2 ของฟิลด์
    const gfm = { width: 4, height: 3, cls: new Uint8Array(n).fill(FloodFieldClass.NO_OBSERVATION) };
    gfm.cls[2 * 4 + 1] = FloodFieldClass.FLOODED; // = เซลล์ (0,1) ของกริด
    gfm.cls[ix(0, 3, 4)] = FloodFieldClass.DRY; // = เซลล์ (2,3) ของกริด
    const mask = gfmFloodedMaskFromField(gfm);
    expect(mask[ix(0, 1, 4)]).toBe(1);
    expect(mask[2 * 4 + 3]).toBe(0);
    const f = gistdaToFloodField(cells(), mask);
    expect(f.cls[2 * 4 + 1]).toBe(FloodFieldClass.NO_OBSERVATION);
    expect(f.cls[ix(0, 3, 4)]).toBe(FloodFieldClass.FLOODED);
  });
});

describe("gistdaCellAt", () => {
  // กริด 4×3 เซลล์ 100 ม. (gridWidthM = (w−1)·cell แบบ localProjection) — vertex (c, r) อยู่ที่
  // x = c·100 − 150, z = r·100 − 100
  const grid = { width: 4, height: 3, cellSizeM: 100, gridWidthM: 300, gridHeightM: 200 };
  const at = (c: number, r: number) => [c * 100 - 150, r * 100 - 100] as const;

  it("อ่านความลึก / ไม่ได้ประมาณ / ตื้นเกินวาด / ไม่มีแผ่น / GFM มาก่อน", () => {
    const g = cells();
    expect(gistdaCellAt(g, grid, null, ...at(1, 0), 2)).toEqual({ depthCm: 120, cellSizeM: 100 });
    expect(gistdaCellAt(g, grid, null, ...at(2, 1), 2)).toEqual({ depthCm: null, cellSizeM: 100 });
    expect(gistdaCellAt(g, grid, null, ...at(3, 2), 2)).toBeNull();
    expect(gistdaCellAt(g, grid, null, ...at(0, 0), 2)).toBeNull();
    const ex = new Uint8Array(12);
    ex[1] = 1;
    expect(gistdaCellAt(g, grid, ex, ...at(1, 0), 2)).toBeNull();
    expect(gistdaCellAt(g, grid, null, 9999, 0, 2)).toBeNull();
  });

  it("ขอบนุ่มของแผ่น: จุดระหว่างเซลล์ท่วมกับเซลล์ว่าง ตอบตามความครอบคลุม bilinear แบบ shader", () => {
    const g = cells();
    // ระหว่างคอลัมน์ 0 (ว่าง) กับ 1 (ลึก 120) บนแถว 0 — pc = 0.75 → น้ำหนัก 0.75 ที่คอลัมน์ 1 → มีแผ่น
    const x = ((0.75 + 0.5) / 4) * 300 - 150;
    expect(gistdaCellAt(g, grid, null, x, -100, 0)).toEqual({ depthCm: 120, cellSizeM: 100 });
    // pc = 0.25 → น้ำหนัก 0.25 → ไม่มีแผ่น (shader discard ที่ cov < 0.5)
    const x2 = ((0.25 + 0.5) / 4) * 300 - 150;
    expect(gistdaCellAt(g, grid, null, x2, -100, 0)).toBeNull();
  });
});

describe("unionMasks", () => {
  it("OR ทีละเซลล์; null ตัวเดียว = อีกตัว", () => {
    const a = Uint8Array.from([1, 0, 0]);
    const b = Uint8Array.from([0, 0, 1]);
    expect([...unionMasks(a, b)!]).toEqual([1, 0, 1]);
    expect(unionMasks(a, null)).toBe(a);
    expect(unionMasks(null, null)).toBeNull();
  });
});

describe("ดาวเทียมมาก่อนแผ่นจำลองจากสถานี (GISTDA ท่วม = สังเกตแล้ว)", () => {
  it("เซลล์ที่ GISTDA ว่าท่วมถูกลบจากแผ่นจำลอง ส่วนเซลล์ที่ GISTDA ไม่ได้บอก (สมมติว่าแห้ง) ยังอยู่", () => {
    const n = 12;
    const overview = {
      depthCm: new Uint16Array(n).fill(80),
      station: new Uint16Array(n).fill(0),
      fadePct: new Uint8Array(n).fill(100),
    };
    const gistdaFlooded = new Uint8Array(n);
    gistdaFlooded[5] = 1;
    // ฉาก GFM ที่แสดงอยู่เห็นเซลล์ 0 ว่าแห้ง (แถว 0 ของกริด = แถว 2 ของฟิลด์)
    const gfm = { width: 4, height: 3, cls: new Uint8Array(n).fill(FloodFieldClass.NO_OBSERVATION) };
    gfm.cls[2 * 4 + 0] = FloodFieldClass.DRY;
    const observed = unionMasks(observedMaskFromField(gfm), gistdaFlooded);
    const out = applyObservedPrecedence(null, observed, overview, []);
    expect(out.overview.station[5]).toBe(SHEET_NONE);
    expect(out.overview.station[0]).toBe(SHEET_NONE);
    expect(out.overview.station[6]).toBe(0);
    expect(out.filledCells).toBe(n - 2);
  });
});

describe("ผลจาก worker → ฟิลด์: ครบทั้งสาย", () => {
  it("แอ่งเล็ก: เซลล์ท่วมมีความลึก ≥ 0 และฟิลด์ไม่มีเซลล์ท่วมนอกมาสก์", () => {
    const w = 10;
    const h = 8;
    const heights = new Float32Array(w * h).fill(10);
    const flooded = new Uint8Array(w * h);
    for (let r = 2; r < 6; r++) for (let c = 2; c < 8; c++) {
      flooded[r * w + c] = 1;
      heights[r * w + c] = 8;
    }
    const res = estimateGistdaDepth({ width: w, height: h }, heights, flooded, null, { smooth: false });
    const f = gistdaToFloodField(res);
    let floodedInField = 0;
    for (let i = 0; i < w * h; i++) if (f.cls[i] === FloodFieldClass.FLOODED) floodedInField++;
    expect(floodedInField).toBe(res.floodedCells);
    // ขอบ (DEM 8) ล้อมด้วยพื้น 10 → WSE = 8 → ความลึก 0 ทั้งแอ่ง (ไม่มีข้อมูลใดบอกว่าลึกกว่านั้น)
    expect(res.maxDepthCm).toBe(0);
  });
});

describe("gistdaDepthDescriptor", () => {
  const gistda: HazardLayerDescriptor = {
    id: "gistda-flood-extent",
    epistemicClass: "observed",
    liveOrStatic: "live",
    publishedAt: "2026-09-20T00:00:00Z",
    fetchedAt: null,
    staleAfterSeconds: 10800,
    methodologyUrl: "https://opendata.gistda.or.th/dataset/floodcheck",
    sourceIds: ["gistda-flood"],
  };

  it("illustrative + GISTDA + DEM; fetchedAt null ยังเป็น null; ไม่มี observedAt ก็ไม่สังเคราะห์", () => {
    const d = gistdaDepthDescriptor(gistda);
    expect(d.id).toBe("gistda-flood-depth-illustrative");
    expect(d.epistemicClass).toBe("illustrative");
    expect(d.sourceIds).toEqual(["gistda-flood", "copernicus-dem"]);
    expect(d.fetchedAt).toBeNull();
    expect("observedAt" in d).toBe(false);
    expect(d.publishedAt).toBeNull();
    expect(d.staleAfterSeconds).toBe(10800);
    expect(d.methodologyUrl).toBeUndefined();
  });

  it("คัดลอก fetchedAt/observedAt ตามที่ backend ประกาศ", () => {
    const d = gistdaDepthDescriptor({ ...gistda, fetchedAt: "2026-09-26T10:00:00Z", observedAt: "2026-09-25T23:10:00Z" });
    expect(d.fetchedAt).toBe("2026-09-26T10:00:00Z");
    expect(d.observedAt).toBe("2026-09-25T23:10:00Z");
  });
});
