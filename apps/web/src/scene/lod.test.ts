import { describe, expect, it } from "vitest";
import {
  DETAIL_TILE_ALTITUDE_GATE_M,
  LOD_MERGE_HYSTERESIS,
  detailTilesAllowed,
  shouldSplit,
} from "./lod";

const SIZE = 1000;
const FACTOR = 2.3;
const SPLIT_AT = SIZE * FACTOR; // 2300
const MERGE_AT = SPLIT_AT * LOD_MERGE_HYSTERESIS; // 2875

describe("shouldSplit", () => {
  it("แตกไทล์เมื่อกล้องเข้าใกล้กว่าเส้นแตก ไม่ว่าเฟรมก่อนจะแตกอยู่หรือไม่", () => {
    for (const wasSplit of [false, true]) {
      expect(shouldSplit(SPLIT_AT - 1, SIZE, FACTOR, wasSplit)).toBe(true);
      expect(shouldSplit(0, SIZE, FACTOR, wasSplit)).toBe(true);
    }
  });

  it("ยุบไทล์เมื่อกล้องไกลกว่าเส้นยุบ ไม่ว่าเฟรมก่อนจะแตกอยู่หรือไม่", () => {
    for (const wasSplit of [false, true]) {
      expect(shouldSplit(MERGE_AT + 1, SIZE, FACTOR, wasSplit)).toBe(false);
      expect(shouldSplit(1e9, SIZE, FACTOR, wasSplit)).toBe(false);
    }
  });

  it("ในแถบแช่ สถานะเดิมเป็นผู้ชนะ — นี่คือสิ่งที่หยุดการกระพริบ", () => {
    for (const d of [SPLIT_AT, SPLIT_AT + 1, (SPLIT_AT + MERGE_AT) / 2, MERGE_AT]) {
      expect(shouldSplit(d, SIZE, FACTOR, true)).toBe(true);
      expect(shouldSplit(d, SIZE, FACTOR, false)).toBe(false);
    }
  });

  it("ไต่เข้าแล้วถอยออกผ่านเส้นเดิม ให้สลับสถานะได้ครั้งเดียวต่อทิศทาง", () => {
    let state = false;
    const path = [4000, 3000, 2500, 2299, 2400, 2800, 2874, 2876, 3000];
    const flips: number[] = [];
    for (const d of path) {
      const next = shouldSplit(d, SIZE, FACTOR, state);
      if (next !== state) flips.push(d);
      state = next;
    }
    // เข้าใกล้จนต่ำกว่า 2300 → แตกหนึ่งครั้ง, ถอยจนเกิน 2875 → ยุบหนึ่งครั้ง
    expect(flips).toEqual([2299, 2876]);
  });

  it("ขนาดไทล์ที่ต่างกันเลื่อนทั้งสองเส้นไปพร้อมกัน", () => {
    expect(shouldSplit(4599, 2000, FACTOR, false)).toBe(true);
    expect(shouldSplit(4601, 2000, FACTOR, false)).toBe(false);
    expect(shouldSplit(5749, 2000, FACTOR, true)).toBe(true);
    expect(shouldSplit(5751, 2000, FACTOR, true)).toBe(false);
  });
});

describe("detailTilesAllowed", () => {
  it("เปิดใต้เพดาน ปิดเหนือเพดาน", () => {
    expect(detailTilesAllowed(DETAIL_TILE_ALTITUDE_GATE_M - 1, 1)).toBe(true);
    expect(detailTilesAllowed(DETAIL_TILE_ALTITUDE_GATE_M, 1)).toBe(true);
    expect(detailTilesAllowed(DETAIL_TILE_ALTITUDE_GATE_M + 1, 1)).toBe(false);
  });

  it("ไม่ขึ้นกับ vertical exaggeration — 24 กม. จริงยังผ่านที่ 3×", () => {
    expect(detailTilesAllowed(24000 * 3, 3)).toBe(true);
    expect(detailTilesAllowed(26000 * 3, 3)).toBe(false);
    expect(detailTilesAllowed(24000 * 0.5, 0.5)).toBe(true);
  });

  it("worldScaleY เป็นศูนย์ไม่ทำให้ได้ NaN", () => {
    expect(detailTilesAllowed(1000, 0)).toBe(false);
  });
});
