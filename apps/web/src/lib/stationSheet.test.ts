import { describe, expect, it } from "vitest";
import {
  fillStationSheet,
  seedCell,
  sheetFade,
  SHEET_FADE_START_FRAC,
  SHEET_DEPTH_CAP_M,
  SHEET_MAX_RADIUS_M,
  SHEET_NONE,
  type SheetGrid,
  type SheetStation,
} from "./stationSheet";

/** กริดทดสอบ: ทุกเซลล์ 5 ม. ยกเว้นที่ `set` กำหนด */
function terrain(width: number, height: number, cellSizeM: number, base = 5) {
  const grid: SheetGrid = { width, height, cellSizeM };
  const heights = new Float32Array(width * height).fill(base);
  const set = (c: number, r: number, h: number) => {
    heights[r * width + c] = h;
  };
  const at = (c: number, r: number) => r * width + c;
  return { grid, heights, set, at };
}

const station = (col: number, row: number, wseM: number, bankM = wseM - 0.5): SheetStation => ({ col, row, wseM, bankM });

describe("fillStationSheet", () => {
  it("สถานีที่ระดับน้ำไม่เกินตลิ่ง → ไม่มีแผ่นเลย (น้ำยังอยู่ในลำน้ำ)", () => {
    const t = terrain(9, 9, 100, 0);
    const out = fillStationSheet(t.grid, t.heights, null, [station(4, 4, 3, 3), station(4, 4, 2, 2.5)]);
    expect(out.filledCells).toBe(0);
    expect(out.cellsPerStation).toEqual([0, 0]);
    expect([...out.depthCm].every((d) => d === SHEET_NONE)).toBe(true);
  });

  it("แอ่งต่ำที่มีสันกั้นยังแห้ง แม้พื้นจะต่ำกว่าระดับน้ำ (การเติมต้องต่อเนื่อง)", () => {
    // แถบต่ำ 1 ม. ทางซ้าย (คอลัมน์ 0–2) | สัน 10 ม. คอลัมน์ 3 | แอ่ง 0 ม. คอลัมน์ 4–6
    // (เซลล์ 1 กม. — วงค้นหาจุดตั้งต้น 300 ม. จึงไม่ข้ามสันไปเจอแอ่ง)
    const t = terrain(7, 5, 1000, 1);
    for (let r = 0; r < 5; r++) {
      t.set(3, r, 10);
      for (let c = 4; c < 7; c++) t.set(c, r, 0);
    }
    const out = fillStationSheet(t.grid, t.heights, null, [station(1, 2, 3)]);
    expect(out.filledCells).toBe(15); // 3 คอลัมน์ × 5 แถว ฝั่งสถานี
    expect(out.depthCm[t.at(1, 2)]).toBe(200);
    for (let r = 0; r < 5; r++) {
      expect(out.station[t.at(3, r)]).toBe(SHEET_NONE);
      for (let c = 4; c < 7; c++) expect(out.depthCm[t.at(c, r)]).toBe(SHEET_NONE);
    }
  });

  it("การเติมเป็น 4 ทิศ — ช่องทแยงระหว่างสันสองก้อนไม่ให้น้ำลอด", () => {
    const t = terrain(3, 3, 100, 10);
    t.set(0, 0, 0); // สถานี
    t.set(1, 1, 0); // ต่อกันแค่ทางทแยง
    const out = fillStationSheet(t.grid, t.heights, null, [station(0, 0, 2)]);
    expect(out.filledCells).toBe(1);
    expect(out.station[t.at(1, 1)]).toBe(SHEET_NONE);
  });

  it("ขอบเขตรัศมี: ไม่เติมไกลกว่า SHEET_MAX_RADIUS_M จากจุดตั้งต้น", () => {
    const cell = 1000;
    const t = terrain(21, 1, cell, 0);
    const out = fillStationSheet(t.grid, t.heights, null, [station(0, 0, 1)]);
    const reach = SHEET_MAX_RADIUS_M / cell; // 5 เซลล์
    for (let c = 0; c < 21; c++) {
      expect(out.station[t.at(c, 0)] === SHEET_NONE).toBe(c > reach);
    }
    expect(out.filledCells).toBe(reach + 1);
  });

  it("สองสถานีซ้อนกัน → ใช้ผิวน้ำที่สูงกว่า (max WSE) และจำสถานีนั้น", () => {
    const t = terrain(10, 1, 100, 0);
    const out = fillStationSheet(t.grid, t.heights, null, [station(1, 0, 1.5), station(8, 0, 2.25)]);
    for (let c = 0; c < 10; c++) {
      expect(out.station[t.at(c, 0)]).toBe(1);
      expect(out.depthCm[t.at(c, 0)]).toBe(225);
    }
    expect(out.cellsPerStation).toEqual([10, 10]);
  });

  it("ความลึกถูกตัดที่ [0, 10] ม.", () => {
    const t = terrain(3, 1, 100, -30);
    t.set(2, 0, 4.99);
    const out = fillStationSheet(t.grid, t.heights, null, [station(0, 0, 5)]);
    expect(out.depthCm[t.at(0, 0)]).toBe(SHEET_DEPTH_CAP_M * 100);
    expect(out.depthCm[t.at(2, 0)]).toBe(1);
    expect(Math.max(...out.depthCm)).toBeLessThanOrEqual(1000);
  });

  it("เคารพมาสก์จังหวัด: ไม่เติมเซลล์นอกจังหวัด และไม่ลอดผ่านเซลล์นอกจังหวัด", () => {
    const t = terrain(5, 1, 100, 0);
    const mask = new Uint8Array([1, 1, 0, 1, 1]);
    const out = fillStationSheet(t.grid, t.heights, mask, [station(0, 0, 2)]);
    expect(out.station[t.at(2, 0)]).toBe(SHEET_NONE);
    expect(out.station[t.at(3, 0)]).toBe(SHEET_NONE);
    expect(out.filledCells).toBe(2);
  });

  it("จุดตั้งต้นลงเซลล์ต่ำสุดใน 300 ม. (ร่องน้ำ) — พื้นใต้พิกัดสถานีสูงกว่าน้ำก็ยังเติมได้", () => {
    const t = terrain(9, 9, 100, 5);
    t.set(6, 4, 0.5); // ร่องน้ำ 200 ม. ทางตะวันออกของสถานี
    expect(seedCell(t.grid, t.heights, null, 4, 4)).toBe(t.at(6, 4));
    const out = fillStationSheet(t.grid, t.heights, null, [station(4, 4, 2)]);
    expect(out.filledCells).toBe(1);
    expect(out.depthCm[t.at(6, 4)]).toBe(150);
    // เกิน 300 ม. → ไม่ใช่จุดตั้งต้น
    const far = terrain(9, 9, 100, 5);
    far.set(8, 4, 0.5);
    expect(fillStationSheet(far.grid, far.heights, null, [station(4, 4, 2)]).filledCells).toBe(0);
  });

  it("จุดตั้งต้นต้องอยู่ในจังหวัด — ทั้งวงค้นหาอยู่นอกมาสก์ = ไม่มีแผ่น", () => {
    const t = terrain(3, 3, 100, 0);
    const mask = new Uint8Array(9);
    expect(seedCell(t.grid, t.heights, mask, 1, 1)).toBe(-1);
    expect(fillStationSheet(t.grid, t.heights, mask, [station(1, 1, 3)]).filledCells).toBe(0);
  });
});

describe("sheetFade — จางลงตามระยะห่างจากสถานี", () => {
  it("ทึบเต็มถึง 60 % ของรัศมี แล้ว smoothstep ลงเป็น 0 ที่รัศมี (ลดลงเรื่อย ๆ ไม่มีขั้น)", () => {
    const R = SHEET_MAX_RADIUS_M;
    expect(SHEET_FADE_START_FRAC).toBe(0.6);
    expect(sheetFade(0)).toBe(1);
    expect(sheetFade(0.6 * R)).toBe(1);
    expect(sheetFade(0.8 * R)).toBeCloseTo(0.5, 6);
    expect(sheetFade(R)).toBe(0);
    expect(sheetFade(2 * R)).toBe(0);
    let prev = 1;
    for (let d = 0.6 * R; d <= R; d += R / 200) {
      const f = sheetFade(d);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });

  it("fadePct ของเซลล์ = ค่าสูงสุดของทุกสถานีที่เติม (สถานีใกล้สุดเป็นตัวกำหนด) และรอยเท้าต่อสถานีครบ", () => {
    // 100 × 1 เซลล์ ขนาด 100 ม. — สถานีที่คอลัมน์ 0 และ 60
    const t = terrain(100, 1, 100, 0);
    // แอ่งตรงสถานี — จุดตั้งต้น (เซลล์ต่ำสุดในระยะค้นหา) จึงอยู่ที่พิกัดสถานีพอดี
    t.set(0, 0, -1);
    t.set(60, 0, -1);
    const out = fillStationSheet(t.grid, t.heights, null, [station(0, 0, 2), station(60, 0, 1.5)]);
    expect(out.fadePct[0]).toBe(100);
    expect(out.fadePct[99]).toBe(Math.round(sheetFade(3900) * 100)); // เฉพาะสถานี 60 (3.9 กม.)
    expect(out.fadePct[99]).toBeLessThan(100);
    expect(out.fadePct[45]).toBe(100); // 4.5 กม. จากสถานี 0 (จาง) แต่ 1.5 กม. จากสถานี 60 → ค่าสูงสุด
    expect(out.fadePct[50]).toBe(100); // 1 กม. จากสถานี 60
    expect(out.station[50]).toBe(0); // แต่ผิวน้ำยังเป็นของสถานีที่สูงกว่า
    expect(out.stationCells[0].length).toBe(out.cellsPerStation[0]);
    expect([...out.stationCells[1]].sort((a, b) => a - b)[0]).toBe(10);
  });
});
