import { describe, expect, it } from "vitest";
import { FLOOD_FIELD_NO_DEPTH, FloodFieldClass, type WaterLevelObservation } from "@siahra/shared-types";
import { SHEET_NONE } from "./stationSheet";
import {
  SHEET_MAX_READING_AGE_MS,
  selectSheetStations,
  sheetCellAt,
  sheetToFloodField,
  windowToFloodField,
} from "./stationSheetField";

const NOW = Date.parse("2026-09-26T06:00:00Z");

function obs(over: Partial<WaterLevelObservation> & { id?: number }): WaterLevelObservation {
  return {
    station: {
      id: over.id ?? 1,
      nameTh: "สถานีทดสอบ",
      nameEn: null,
      lat: 13.8,
      lon: 100.6,
      provinceCode: "10",
      provinceNameTh: null,
      amphoeNameTh: null,
      basinNameTh: null,
      agencyShortTh: null,
    } as WaterLevelObservation["station"],
    waterlevelMsl: 2.82,
    waterlevelLocalM: null,
    minBankMsl: 2.2,
    groundLevelMsl: -0.33,
    freeboardM: -0.62,
    situationLevel: 5,
    storagePercent: null,
    dischargeM3s: null,
    qmaxM3s: null,
    criticalLevelMsl: null,
    observedAt: "2026-09-26T05:40:00.000Z",
    ...over,
  };
}

const toGrid = (): [number, number] => [3, 4];

describe("selectSheetStations", () => {
  it("เฉพาะสถานีที่น้ำเกินตลิ่ง มีเวลาตรวจวัดไม่เก่าเกิน และตกในกริด", () => {
    const picked = selectSheetStations(
      [
        obs({ id: 1 }),
        obs({ id: 2, waterlevelMsl: 2.2 }), // เสมอตลิ่ง → ไม่ใช่เกินตลิ่ง
        obs({ id: 3, minBankMsl: null }),
        obs({ id: 4, waterlevelMsl: null }),
        obs({ id: 5, observedAt: null }),
        obs({ id: 6, observedAt: new Date(NOW - SHEET_MAX_READING_AGE_MS - 60_000).toISOString() }),
      ],
      NOW,
      toGrid,
    );
    expect(picked.map((p) => p.obs.station.id)).toEqual([1]);
    expect(picked[0].sheet).toEqual({ col: 3, row: 4, wseM: 2.82, bankM: 2.2 });
    expect(selectSheetStations([obs({})], NOW, () => null)).toEqual([]);
  });
});

describe("sheetToFloodField / sheetCellAt", () => {
  // กริด 2×3 (แถว 0 = เหนือ) เติมเฉพาะเซลล์ (c=1, r=0)
  const cells = {
    width: 2,
    height: 3,
    depthCm: new Uint16Array([SHEET_NONE, 150, SHEET_NONE, SHEET_NONE, SHEET_NONE, SHEET_NONE]),
    station: new Uint16Array([SHEET_NONE, 0, SHEET_NONE, SHEET_NONE, SHEET_NONE, SHEET_NONE]),
  };

  it("พลิกแถวเป็นล่างขึ้นบนแบบ field.bin; เซลล์ที่ไม่ถูกเติมไม่ใช่ 'แห้ง'", () => {
    const f = sheetToFloodField(cells);
    // แถวเหนือสุด (r=0) → แถวบนสุดของ texture (texRow = 2)
    expect(f.cls[2 * 2 + 1]).toBe(FloodFieldClass.FLOODED);
    expect(f.depthCm[2 * 2 + 1]).toBe(150);
    expect(f.cls[1]).toBe(FloodFieldClass.NO_OBSERVATION);
    expect(f.depthCm[1]).toBe(FLOOD_FIELD_NO_DEPTH);
    expect([...f.cls].filter((c) => c === FloodFieldClass.DRY)).toHaveLength(0);
  });

  it("อ่านเซลล์ใกล้ที่สุดใต้จุดคลิก (พิกัดฉาก) → ความลึก + ดัชนีสถานี", () => {
    const grid = { width: 2, height: 3, cellSizeM: 100, gridWidthM: 100, gridHeightM: 200 };
    // เซลล์ (1, 0): x = 1·100 − 50 = 50, z = 0·100 − 100 = −100
    expect(sheetCellAt(cells, grid, 48, -95)).toEqual({ depthCm: 150, stationIdx: 0 });
    expect(sheetCellAt(cells, grid, -50, -100)).toBeNull();
    expect(sheetCellAt(cells, grid, 5000, 0)).toBeNull();
    expect(sheetCellAt(cells, { ...grid, width: 3 }, 50, -100)).toBeNull();
  });
});

describe("windowToFloodField — หน้าต่าง 30 ม.", () => {
  it("อาคาร/ต้นไม้ = FLOODED_DEPTH_NOT_ESTIMATED ไม่มีความลึก, ช่อง likelihood เก็บความจาง, แถวกลับล่างขึ้นบน", () => {
    const size = 2;
    const f = windowToFloodField({
      tx: 0,
      ty: 0,
      size,
      heights: new Float32Array(4),
      depthCm: Uint16Array.from([120, 80, SHEET_NONE, 30]),
      station: Uint16Array.from([0, 0, SHEET_NONE, 1]),
      fadePct: Uint8Array.from([100, 40, 0, 70]),
      notEst: Uint8Array.from([0, 1, 0, 0]),
      filledCells: 3,
    });
    // แถว 0 (เหนือ) ของหน้าต่าง → แถว 1 ของฟิลด์
    expect([...f.cls]).toEqual([
      FloodFieldClass.NO_OBSERVATION,
      FloodFieldClass.FLOODED,
      FloodFieldClass.FLOODED,
      FloodFieldClass.FLOODED_DEPTH_NOT_ESTIMATED,
    ]);
    expect([...f.depthCm]).toEqual([FLOOD_FIELD_NO_DEPTH, 30, 120, FLOOD_FIELD_NO_DEPTH]);
    expect([...f.likelihood]).toEqual([255, 70, 100, 40]);
  });
});
