import { describe, expect, it } from "vitest";
import {
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  planEviction,
  retryDelayMs,
  textureBytes,
  type CacheEntryInfo,
} from "./tileCache";

const MB = 1024 * 1024;
const e = (id: string, state: CacheEntryInfo["state"], bytes: number, lastUsed: number, retryAt = 0): CacheEntryInfo => ({
  id,
  state,
  bytes,
  lastUsed,
  retryAt,
});

describe("planEviction", () => {
  it("ใต้งบ → ไม่ไล่ไทล์ ready ออก แต่ stub ที่ไม่ได้ใช้ถูกลบเสมอ", () => {
    const plan = planEviction({
      entries: [e("a", "ready", 10 * MB, 1), e("b", "idle", 0, 1), e("c", "empty", 0, 1)],
      keepReady: new Set(),
      budgetBytes: 80 * MB,
      now: 100,
    });
    expect(plan.evict).toEqual([]);
    expect(plan.drop.sort()).toEqual(["b", "c"]);
  });

  it("เกินงบ → ไล่ ready ที่ไม่ได้วาดตาม LRU จนไบต์รวม ≤ งบ", () => {
    const plan = planEviction({
      entries: [
        e("old", "ready", 30 * MB, 1),
        e("mid", "ready", 30 * MB, 5),
        e("new", "ready", 30 * MB, 9),
        e("vis", "ready", 30 * MB, 0),
      ],
      keepReady: new Set(["vis"]),
      budgetBytes: 80 * MB,
      now: 100,
    });
    // 120 MB → ต้องออก 2 ใบ (เหลือ 60) — เก่าสุดก่อน ใบที่วาดอยู่ไม่ถูกแตะแม้จะเก่าที่สุด
    expect(plan.evict).toEqual(["old", "mid"]);
  });

  it("สิ่งที่วาดอยู่ใหญ่กว่างบเอง → ไล่ได้เท่าที่ไล่ได้ ไม่แตะใบที่วาดอยู่", () => {
    const plan = planEviction({
      entries: [e("v1", "ready", 60 * MB, 1), e("v2", "ready", 60 * MB, 1), e("x", "ready", 1 * MB, 1)],
      keepReady: new Set(["v1", "v2"]),
      budgetBytes: 80 * MB,
      now: 100,
    });
    expect(plan.evict).toEqual(["x"]);
  });

  it("ไทล์ loading ไม่ถูกไล่และไม่ถูกลบ ไม่ว่าจะอยู่ใน keep หรือไม่", () => {
    const plan = planEviction({
      entries: [e("l", "loading", 0, 0), e("r", "ready", 100 * MB, 0)],
      keepReady: new Set(),
      budgetBytes: 1,
      now: 100,
    });
    expect(plan.evict).toEqual(["r"]);
    expect(plan.drop).toEqual([]);
  });

  it("stub ใน keep ไม่ถูกลบ; failed ที่ยังไม่ถึงเวลาลองใหม่ถูกเก็บไว้ (ไม่ทิ้ง backoff)", () => {
    const plan = planEviction({
      entries: [e("kept", "idle", 0, 0), e("f-wait", "failed", 0, 0, 500), e("f-due", "failed", 0, 0, 50)],
      keepReady: new Set(["kept"]),
      budgetBytes: 80 * MB,
      now: 100,
    });
    expect(plan.drop).toEqual(["f-due"]);
  });

  it("stub ไม่นับเป็นไบต์ — stub จำนวนมากไม่ทำให้ ready ถูกไล่", () => {
    const entries = [e("r", "ready", 50 * MB, 0)];
    for (let i = 0; i < 1000; i++) entries.push(e(`s${i}`, "empty", 0, 0));
    const plan = planEviction({ entries, keepReady: new Set(), budgetBytes: 80 * MB, now: 1 });
    expect(plan.evict).toEqual([]);
    expect(plan.drop).toHaveLength(1000);
  });

  it("keepStubs แยกจาก keepReady (terrain: stub ที่ทางเดินแตะ ≠ ไทล์ที่ปกป้อง)", () => {
    const plan = planEviction({
      entries: [e("touched", "idle", 0, 0), e("far", "idle", 0, 0), e("r", "ready", 1, 0)],
      keepReady: new Set(["r"]),
      keepStubs: new Set(["touched"]),
      budgetBytes: 80 * MB,
      now: 1,
    });
    expect(plan.drop).toEqual(["far"]);
  });

  it("งบ geometry แยกจากงบ texture: texture ต่ำกว่างบแต่ geometry เกิน → ยังไล่ออกตาม LRU", () => {
    const g = (id: string, lastUsed: number, geo: number): CacheEntryInfo => ({
      ...e(id, "ready", 1 * MB, lastUsed),
      geometryBytes: geo,
    });
    const plan = planEviction({
      entries: [g("old", 1, 20 * MB), g("mid", 2, 20 * MB), g("new", 3, 20 * MB), g("vis", 0, 20 * MB)],
      keepReady: new Set(["vis"]),
      budgetBytes: 96 * MB,
      geometryBudgetBytes: 40 * MB,
      maxReady: 320,
      now: 1,
    });
    // geometry 80 MB → ต้องออก 2 ใบ (เหลือ 40) ใบที่วาดอยู่ไม่ถูกแตะ
    expect(plan.evict).toEqual(["old", "mid"]);
  });

  it("ไม่ส่งงบ geometry = ไม่จำกัด (BuildingTiles/FeatureTiles)", () => {
    const plan = planEviction({
      entries: [{ ...e("a", "ready", 1, 1), geometryBytes: 1e12 }],
      keepReady: new Set(),
      budgetBytes: 80 * MB,
      now: 1,
    });
    expect(plan.evict).toEqual([]);
  });

  it("maxReady นับเฉพาะไทล์ ready ไม่นับ stub", () => {
    const plan = planEviction({
      entries: [
        e("a", "ready", 1, 1),
        e("b", "ready", 1, 2),
        e("c", "ready", 1, 3),
        e("s1", "idle", 0, 0),
        e("s2", "failed", 0, 0, 1e9),
      ],
      keepReady: new Set(),
      budgetBytes: Infinity,
      maxReady: 2,
      now: 1,
    });
    expect(plan.evict).toEqual(["a"]);
  });
});

describe("retryDelayMs", () => {
  it("เริ่ม 5 s แล้วเพิ่มเป็นสองเท่า มีเพดาน", () => {
    expect(retryDelayMs(1)).toBe(RETRY_BASE_MS);
    expect(retryDelayMs(2)).toBe(2 * RETRY_BASE_MS);
    expect(retryDelayMs(3)).toBe(4 * RETRY_BASE_MS);
    expect(retryDelayMs(50)).toBe(RETRY_MAX_MS);
    expect(retryDelayMs(0)).toBe(RETRY_BASE_MS);
  });
});

describe("textureBytes", () => {
  it("RGBA8 + mipmap = ×4/3", () => {
    expect(textureBytes(256, 256, false)).toBe(262144);
    expect(textureBytes(768, 512)).toBe(Math.ceil((768 * 512 * 4 * 4) / 3));
  });
});
