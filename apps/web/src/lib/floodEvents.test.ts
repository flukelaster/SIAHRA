import { describe, expect, it } from "vitest";
import type { FloodSceneIndex, FloodSceneIndexEntry } from "@siahra/shared-types";
import { snapAtIso } from "../hooks/useFloodExtent";
import { AT_ISO_SNAP_MS, FLOOD_EVENT_GAP_MS, gapParts, groupFloodEvents, isFloodedScene, sceneAtIso } from "./floodEvents";
import { pickFloodScene } from "./floodScenes";

const entry = (sceneId: string, observedAt: string, floodedAreaKm2 = 0): FloodSceneIndexEntry => ({
  sceneId,
  observedAt,
  publishedAt: null,
  orbit: null,
  floodedCells: floodedAreaKm2 > 0 ? 10 : 0,
  excludedCells: 0,
  observedCells: 1,
  floodedAreaKm2,
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

/** ดัชนีสังเคราะห์ตามรูปของจังหวัด 57: สองรอบบินติดกันปลายส.ค. 2026 + หนึ่งรอบปี 2024 + ฉากแห้ง */
const S_2024 = entry("20240913T112151-AS020M", "2024-09-13T11:21:51Z", 131.7452);
const S_0829 = entry("20260829T112054-AS020M", "2026-08-29T11:20:54Z", 26.5386);
const S_0831 = entry("20260831T231435-AS020M", "2026-08-31T23:14:35Z", 94.6571);
const S_DRY = entry("20260817T231400-AS020M", "2026-08-17T23:14:00Z", 0);
const S_ON_BOUNDARY = entry("20260805T230000-AS020M", "2026-08-05T23:00:00Z", 3);
const IDX = index([S_0831, S_0829, S_DRY, S_ON_BOUNDARY, S_2024]);

describe("sceneAtIso", () => {
  it("ปัด observedAt ขึ้นเป็นขอบ 10 นาทีถัดไป (อยู่บนขอบพอดี = ไม่ขยับ)", () => {
    expect(sceneAtIso(S_0831)).toBe("2026-08-31T23:20:00.000Z");
    expect(sceneAtIso(S_0829)).toBe("2026-08-29T11:30:00.000Z");
    expect(sceneAtIso(S_ON_BOUNDARY)).toBe("2026-08-05T23:00:00.000Z");
    expect(AT_ISO_SNAP_MS).toBe(10 * 60 * 1000);
  });

  it("pickFloodScene เลือกฉากนั้นพอดีสำหรับทุกฉากในดัชนี — ทั้งก่อนและหลัง snapAtIso", () => {
    for (const s of IDX.scenes) {
      const at = sceneAtIso(s);
      expect(pickFloodScene(IDX, Date.parse(at)).scene).toBe(s);
      // เส้นทางจริง: useFloodScene ปัด atIso ลงด้วย snapAtIso ก่อนเลือก — ต้องยังได้ฉากเดิม
      const snapped = snapAtIso(at);
      expect(snapped).not.toBeNull();
      expect(pickFloodScene(IDX, Date.parse(snapped!)).scene).toBe(s);
    }
  });

  it("ถ้าปัด observedAt *ลง* แทน จะได้รอบบินก่อนหน้า ไม่ใช่ฉากที่ตั้งใจ", () => {
    const floored = snapAtIso(S_0831.observedAt)!;
    expect(floored).toBe("2026-08-31T23:10:00.000Z");
    expect(pickFloodScene(IDX, Date.parse(floored)).scene).toBe(S_0829);
    // ฉากที่มีรอบก่อนหน้าเกิน 14 วัน: ปัดลงแล้วไม่ได้ฉากเลย
    const flooredOld = snapAtIso(S_2024.observedAt)!;
    expect(pickFloodScene(IDX, Date.parse(flooredOld)).scene).toBeNull();
  });
});

describe("isFloodedScene", () => {
  it("ท่วม = มีเซลล์ที่ GFM จำแนกว่าท่วมอย่างน้อยหนึ่งเซลล์ — ไม่ใช่ตร.กม. ที่ปัดแล้ว", () => {
    expect(isFloodedScene(S_0831)).toBe(true);
    expect(isFloodedScene(S_DRY)).toBe(false);
    // เซลล์เดียว (30 ม. × 30 ม. = 0.0009 ตร.กม.) ปัดเป็น 0.0 ได้ แต่ยังคือฉากที่ท่วม
    const oneCell: FloodSceneIndexEntry = { ...S_DRY, floodedCells: 1, floodedAreaKm2: 0 };
    expect(isFloodedScene(oneCell)).toBe(true);
    expect(isFloodedScene({ floodedCells: 0 })).toBe(false);
  });

  it("groupFloodEvents ใช้นิยามเดียวกัน: ฉากที่มีเซลล์ท่วมแต่พื้นที่ปัดเป็น 0 ก็อยู่ในเหตุการณ์", () => {
    const tiny = { ...entry("TINY", "2026-07-01T00:00:00Z", 0), floodedCells: 1 };
    expect(isFloodedScene(tiny)).toBe(true);
    expect(groupFloodEvents([tiny]).flatMap((e) => e.sceneIds)).toEqual(["TINY"]);
  });
});

describe("groupFloodEvents", () => {
  it("ตัดฉากแห้งออก ต่อรอบบินที่ห่างกันไม่เกิน 7 วันเป็นเหตุการณ์เดียว และเรียงตาม peak มาก → น้อย", () => {
    const events = groupFloodEvents(IDX.scenes);
    expect(events.map((e) => e.peak.sceneId)).toEqual([S_2024.sceneId, S_0831.sceneId, S_ON_BOUNDARY.sceneId]);
    const aug = events[1];
    expect(aug.startAt).toBe(S_0829.observedAt);
    expect(aug.endAt).toBe(S_0831.observedAt);
    expect(aug.sceneCount).toBe(2);
    expect(aug.sceneIds).toEqual([S_0829.sceneId, S_0831.sceneId]);
    expect(events[0].sceneCount).toBe(1);
    expect(events[0].startAt).toBe(S_2024.observedAt);
    // ฉากแห้ง (17 ส.ค.) ไม่อยู่ในเหตุการณ์ใดเลย
    expect(events.flatMap((e) => e.sceneIds)).not.toContain(S_DRY.sceneId);
  });

  it("ช่องว่างพอดี 7 วันยังเป็นเหตุการณ์เดียว เกินแม้ 1 ms จึงแยก", () => {
    const a = entry("A", "2026-01-01T00:00:00Z", 5);
    const bEdge = entry("B", new Date(Date.parse(a.observedAt) + FLOOD_EVENT_GAP_MS).toISOString(), 9);
    expect(groupFloodEvents([bEdge, a])).toHaveLength(1);
    const bOver = entry("B", new Date(Date.parse(a.observedAt) + FLOOD_EVENT_GAP_MS + 1).toISOString(), 9);
    expect(groupFloodEvents([bOver, a])).toHaveLength(2);
    expect(FLOOD_EVENT_GAP_MS).toBe(7 * DAY);
  });

  it("ไม่มีฉากท่วม → ไม่มีเหตุการณ์ (ไม่ใช่เหตุการณ์ว่าง)", () => {
    expect(groupFloodEvents([S_DRY])).toEqual([]);
    expect(groupFloodEvents([])).toEqual([]);
  });
});

describe("gapParts", () => {
  it("ดูสด → null; ห่างไม่ถึง 10 นาที (ฉากที่เลือกผ่าน sceneAtIso) → null", () => {
    expect(gapParts(null, S_0831.observedAt)).toBeNull();
    expect(gapParts(sceneAtIso(S_0831), S_0831.observedAt)).toBeNull();
    expect(gapParts(S_0831.observedAt, S_0831.observedAt)).toBeNull();
  });

  it("แยกเป็นวัน/ชั่วโมง/นาที ปัดลง", () => {
    const obs = "2026-08-31T23:14:35Z";
    expect(gapParts("2026-09-04T03:20:00Z", obs)).toEqual({ days: 3, hours: 4, minutes: 5 });
    expect(gapParts("2026-09-01T00:00:00Z", obs)).toEqual({ days: 0, hours: 0, minutes: 45 });
    expect(gapParts("2026-09-01T05:14:35Z", obs)).toEqual({ days: 0, hours: 6, minutes: 0 });
  });

  it("เวลาอ่านไม่ออก → null", () => {
    expect(gapParts("not-a-date", S_0831.observedAt)).toBeNull();
    expect(gapParts("2026-09-01T00:00:00Z", "nope")).toBeNull();
  });
});
