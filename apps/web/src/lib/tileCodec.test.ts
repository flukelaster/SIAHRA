import { describe, expect, it } from "vitest";
import { decodeLandcoverTile, decodePresentBits, decodeTerrainTile, presentBit, terrainTileSpan, tileUrl } from "./tileCodec";

describe("tileCodec — ตัวเดียวกับตัววาดและ worker ของแผ่นน้ำ 30 ม.", () => {
  it("tileUrl แทน {z}/{x}/{y} ตามแบบเดิมของ TerrainTiles/VegetationTiles ทุกไบต์ (C5)", () => {
    const tpl = "/aoi/14/v/2026-09-01/terrain/{z}/{x}_{y}.bin";
    expect(tileUrl(tpl, 5, 17, 3)).toBe(tpl.replace("{z}", "5").replace("{x}", "17").replace("{y}", "3"));
    expect(tileUrl(tpl, 5, 17, 3)).toBe("/aoi/14/v/2026-09-01/terrain/5/17_3.bin");
  });

  it("present bitset: row-major, LSB ก่อน, นอกช่วง = ไม่มี", () => {
    const bits = decodePresentBits(btoa(String.fromCharCode(0b00000101, 0b00000001)));
    expect(presentBit(bits, 3, 3, 0, 0)).toBe(true);
    expect(presentBit(bits, 3, 3, 1, 0)).toBe(false);
    expect(presentBit(bits, 3, 3, 2, 0)).toBe(true);
    expect(presentBit(bits, 3, 3, 2, 2)).toBe(true); // idx 8
    expect(presentBit(bits, 3, 3, 3, 0)).toBe(false);
    expect(presentBit(bits, 3, 3, -1, 0)).toBe(false);
  });

  it("ความยาวไม่ตรง (SPA shell) = null ไม่ใช่ไทล์", () => {
    const span = terrainTileSpan(4, 1);
    expect(span).toBe(7);
    expect(decodeTerrainTile(new ArrayBuffer(span * span * 2), 4, 1)?.length).toBe(49);
    expect(decodeTerrainTile(new ArrayBuffer(100), 4, 1)).toBeNull();
    expect(decodeLandcoverTile(new ArrayBuffer(16), 4)?.length).toBe(16);
    expect(decodeLandcoverTile(new ArrayBuffer(17), 4)).toBeNull();
  });
});
