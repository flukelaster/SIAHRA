import { describe, expect, it } from "vitest";
import type { FloodSceneIndex, FloodSceneIndexEntry } from "@siahra/shared-types";
import {
  FLOOD_SCENE_MAX_AGE_MS,
  floodFieldRequest,
  indexForProvince,
  isFloodSceneIndex,
  pickFloodScene,
} from "./floodScenes";

const entry = (sceneId: string, observedAt: string): FloodSceneIndexEntry => ({
  sceneId,
  observedAt,
  publishedAt: null,
  orbit: null,
  floodedCells: 0,
  excludedCells: 0,
  observedCells: 1,
  floodedAreaKm2: 0,
  maxDepthCm: null,
  medianDepthCm: null,
  depthEstimatedFraction: 0,
  gfmItemIds: [],
});

const layer = (epistemicClass: "observed" | "illustrative") => ({
  id: epistemicClass,
  epistemicClass,
  liveOrStatic: "live" as const,
  fetchedAt: null,
  sourceIds: [],
});

const index = (scenes: FloodSceneIndexEntry[]): FloodSceneIndex => ({
  provinceCode: "57",
  grid: { width: 2, height: 2, cellSizeM: 30, originEasting: 0, originNorthing: 0, utmZone: "32647" },
  layers: { extent: layer("observed"), depth: layer("illustrative") },
  generatedAt: "2026-09-01T00:00:00Z",
  scenes,
});

const DAY = 24 * 60 * 60 * 1000;

describe("pickFloodScene", () => {
  const a = entry("A", "2026-08-01T00:00:00Z");
  const b = entry("B", "2026-08-13T00:00:00Z");
  const c = entry("C", "2026-08-25T00:00:00Z");
  const idx = index([c, b, a]);

  it("เลือกฉากใหม่สุดที่บันทึกก่อนหรือเท่ากับเวลาที่เลือก", () => {
    expect(pickFloodScene(idx, Date.parse("2026-08-26T00:00:00Z")).scene?.sceneId).toBe("C");
    expect(pickFloodScene(idx, Date.parse("2026-08-25T00:00:00Z")).scene?.sceneId).toBe("C");
    expect(pickFloodScene(idx, Date.parse("2026-08-24T23:59:59Z")).scene?.sceneId).toBe("B");
    // ไม่พึ่งลำดับในดัชนี
    expect(pickFloodScene(index([a, b, c]), Date.parse("2026-08-20T00:00:00Z")).scene?.sceneId).toBe("B");
  });

  it("ไม่มีฉากในหน้าต่าง 14 วัน → null พร้อมเหตุผล และบอกฉากล่าสุดก่อนหน้านั้น", () => {
    const at = Date.parse("2026-08-25T00:00:00Z") + FLOOD_SCENE_MAX_AGE_MS + 1;
    const r = pickFloodScene(idx, at);
    expect(r.scene).toBeNull();
    expect(r.reason).toBe("no-scene-in-window");
    expect(r.latestBefore?.sceneId).toBe("C");
    // พอดีขอบหน้าต่างยังใช้ได้
    const edge = pickFloodScene(idx, Date.parse("2026-08-25T00:00:00Z") + FLOOD_SCENE_MAX_AGE_MS);
    expect(edge.scene?.sceneId).toBe("C");
    expect(edge.reason).toBeNull();
  });

  it("ก่อนฉากแรกสุด → ไม่มีฉาก และไม่มีฉากก่อนหน้า", () => {
    const r = pickFloodScene(idx, Date.parse("2026-07-01T00:00:00Z"));
    expect(r).toEqual({ scene: null, latestBefore: null, reason: "no-scene-in-window" });
  });

  it("ดัชนีว่าง/ไม่มี → ไม่มีเหตุผล (ไม่ใช่ 'ไม่มีฉากในหน้าต่าง')", () => {
    expect(pickFloodScene(null, Date.now())).toEqual({ scene: null, latestBefore: null, reason: null });
    expect(pickFloodScene(index([]), Date.now())).toEqual({ scene: null, latestBefore: null, reason: null });
  });

  it("หน้าต่างคือ 14 วัน (รอบบิน Sentinel-1 6–12 วัน)", () => {
    expect(FLOOD_SCENE_MAX_AGE_MS).toBe(14 * DAY);
  });
});

/**
 * สลับจังหวัด 57 → 50: มีหนึ่งเฟรมที่ `provinceCode = "50"` แต่ดัชนีในมือยังเป็น
 * ของ 57 (useFloodScenes รีเซ็ตใน effect) — เส้นทางเดียวกับที่ hook ใช้ต้องไม่ผลิต
 * คำขอ `/aoi/50/flood/<sceneId ของ 57>/field.bin` ออกมาเลย (เคย 404 บน prod)
 */
describe("indexForProvince + floodFieldRequest (57 → 50)", () => {
  const scene57 = entry("20260831T231435-AS020M", "2026-08-31T23:14:35Z");
  const idx57 = index([scene57]);
  const at = Date.parse("2026-09-02T00:00:00Z");

  it("ดัชนีของ 57 ถูกใช้กับ 57 เท่านั้น — กับ 50 เท่ากับไม่มีดัชนี", () => {
    expect(indexForProvince(idx57, "57")).toBe(idx57);
    expect(indexForProvince(idx57, "50")).toBeNull();
    expect(indexForProvince(idx57, null)).toBeNull();
    expect(indexForProvince(null, "57")).toBeNull();
  });

  it("จังหวัด 50 กับดัชนีของ 57 → ไม่มีฉาก ไม่มีคำขอ; จังหวัด 57 → คำขอใต้ path ของ 57", () => {
    const pick50 = pickFloodScene(indexForProvince(idx57, "50"), at);
    expect(pick50).toEqual({ scene: null, latestBefore: null, reason: null });
    expect(floodFieldRequest("50", pick50.scene)).toBeNull();

    const pick57 = pickFloodScene(indexForProvince(idx57, "57"), at);
    expect(pick57.scene?.sceneId).toBe(scene57.sceneId);
    expect(floodFieldRequest("57", pick57.scene)).toEqual({
      cacheKey: `57/${scene57.sceneId}`,
      url: `/aoi/57/flood/${scene57.sceneId}/field.bin`,
    });
    // ไม่มีทางประกอบ URL ของ 50 ที่มี sceneId ของ 57 ผ่านเส้นทางนี้
    expect(floodFieldRequest("50", pickFloodScene(indexForProvince(idx57, "50"), at).scene)?.url).toBeUndefined();
  });
});

describe("isFloodSceneIndex", () => {
  it("รับรูปร่างขั้นต่ำ และปฏิเสธเมื่อขาดจังหวัด/กริด/ชั้น/รายการฉาก", () => {
    const ok = index([entry("A", "2026-08-01T00:00:00Z")]);
    expect(isFloodSceneIndex(ok)).toBe(true);
    expect(isFloodSceneIndex(null)).toBe(false);
    expect(isFloodSceneIndex("{}")).toBe(false);
    expect(isFloodSceneIndex({ ...ok, provinceCode: 57 })).toBe(false);
    expect(isFloodSceneIndex({ ...ok, grid: { width: "686" } })).toBe(false);
    expect(isFloodSceneIndex({ ...ok, layers: { extent: ok.layers.extent } })).toBe(false);
    expect(isFloodSceneIndex({ ...ok, layers: { extent: {}, depth: {} } })).toBe(false);
    expect(isFloodSceneIndex({ ...ok, scenes: {} })).toBe(false);
    expect(isFloodSceneIndex({ ...ok, scenes: [{ sceneId: "A" }] })).toBe(false);
  });
});
