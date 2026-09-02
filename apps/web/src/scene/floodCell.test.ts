import { describe, expect, it } from "vitest";
import { FLOOD_FIELD_NO_DEPTH, FLOOD_FIELD_NO_LIKELIHOOD, FloodFieldClass } from "@siahra/shared-types";
import { floodCellAt, type FloodField, type FloodFieldGrid } from "./floodField";

/**
 * ฟิลด์สังเคราะห์ 3×2 — แถวในไฟล์เรียง **ล่างขึ้นบน** (แถวแรกของไฟล์ = ขอบใต้):
 *
 *   texRow 1 (เหนือ, mesh row 0): [FLOODED 120 cm/87] [DRY] [REFERENCE_WATER]
 *   texRow 0 (ใต้,   mesh row 1): [NOT_ESTIMATED]      [EXCLUDED] [NO_OBSERVATION]
 *
 * กริด 3×2 เซลล์ละ 100 ม. → กว้าง 300 สูง 200 จุดกำเนิดกลางกริด: x ∈ [−150, 150),
 * z ∈ [−100, 100) โดย z ลบ = เหนือ (แถว 0 ของ mesh)
 */
const C = FloodFieldClass;
const field: FloodField = {
  width: 3,
  height: 2,
  cls: Uint8Array.from([C.FLOODED_DEPTH_NOT_ESTIMATED, C.EXCLUDED, C.NO_OBSERVATION, C.FLOODED, C.DRY, C.REFERENCE_WATER]),
  depthCm: Uint16Array.from([FLOOD_FIELD_NO_DEPTH, FLOOD_FIELD_NO_DEPTH, FLOOD_FIELD_NO_DEPTH, 120, FLOOD_FIELD_NO_DEPTH, 0]),
  likelihood: Uint8Array.from([60, FLOOD_FIELD_NO_LIKELIHOOD, FLOOD_FIELD_NO_LIKELIHOOD, 87, 95, 99]),
};
const grid: FloodFieldGrid = { width: 3, height: 2, cellSizeM: 100, gridWidthM: 300, gridHeightM: 200 };

describe("floodCellAt", () => {
  it("แถวเหนือของ mesh (z ลบ) อ่านจากแถวบนสุดของไฟล์ (texRow = height − 1)", () => {
    // คอลัมน์ 0 แถว 0: x ∈ [−150, −50), z ∈ [−100, 0)
    expect(floodCellAt(field, grid, -150, -100)).toEqual({ cls: C.FLOODED, depthCm: 120, likelihood: 87 });
    expect(floodCellAt(field, grid, -50.01, -0.01)).toEqual({ cls: C.FLOODED, depthCm: 120, likelihood: 87 });
    expect(floodCellAt(field, grid, 0, -50)).toEqual({ cls: C.DRY, depthCm: null, likelihood: 95 });
    // REFERENCE_WATER มี depthCm 0 ในไฟล์ แต่ไม่ใช่ FLOODED → null ไม่ใช่ 0
    expect(floodCellAt(field, grid, 120, -50)).toEqual({ cls: C.REFERENCE_WATER, depthCm: null, likelihood: 99 });
  });

  it("แถวใต้ของ mesh (z บวก) อ่านจากแถวแรกของไฟล์", () => {
    expect(floodCellAt(field, grid, -100, 50)).toEqual({ cls: C.FLOODED_DEPTH_NOT_ESTIMATED, depthCm: null, likelihood: 60 });
    expect(floodCellAt(field, grid, 0, 0)).toEqual({ cls: C.EXCLUDED, depthCm: null, likelihood: null });
    expect(floodCellAt(field, grid, 149.9, 99.9)).toEqual({ cls: C.NO_OBSERVATION, depthCm: null, likelihood: null });
  });

  it("ตรงกับการวางจุดของ FloodSurface/TerrainMesh: vertex (c, r) อยู่ที่ x = c·cell − W/2, z = r·cell − H/2", () => {
    for (let r = 0; r < grid.height; r++) {
      for (let c = 0; c < grid.width; c++) {
        const x = c * grid.cellSizeM - grid.gridWidthM / 2;
        const z = r * grid.cellSizeM - grid.gridHeightM / 2;
        const expectedCls = field.cls[(grid.height - 1 - r) * grid.width + c];
        expect(floodCellAt(field, grid, x, z)?.cls).toBe(expectedCls);
      }
    }
  });

  it("นอกกริด → null; ขนาดฟิลด์ไม่ตรงกริด → null (ไม่เดา)", () => {
    expect(floodCellAt(field, grid, -150.01, 0)).toBeNull();
    expect(floodCellAt(field, grid, 150, 0)).toBeNull();
    expect(floodCellAt(field, grid, 0, -100.01)).toBeNull();
    expect(floodCellAt(field, grid, 0, 100)).toBeNull();
    expect(floodCellAt(field, { ...grid, width: 4, gridWidthM: 400 }, 0, 0)).toBeNull();
  });
});
