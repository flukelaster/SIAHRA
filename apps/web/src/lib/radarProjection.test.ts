import { describe, expect, it } from "vitest";
import type { RadarFramesResponse } from "@siahra/shared-types";
import {
  RADAR_DECODE_MAX_PIXELS,
  frameGeoreference,
  radarColFromLeft,
  radarDecodeSize,
  radarRowFromTop,
  selectRadarFrames,
} from "./radarProjection";

/**
 * ภาพเรดาร์ TMD รุ่น 1800×2644 เป็น Web Mercator บนกรอบ 95–108 E, 4–22.5 N
 * (RADAR_COORDS ของ viewer TMD, ตรวจ 2026-09-27) — ถ้าวางแบบ plate carrée
 * แถวแถวกรุงเทพฯ จะคลาดราว 26 พิกเซล ≈ 0.18° ≈ 20 กม. ซึ่งคือบั๊กที่ไฟล์นี้กันไว้
 */
const MERC = { minLon: 95, minLat: 4, maxLon: 108, maxLat: 22.5 };

describe("radarRowFromTop", () => {
  it("กรุงเทพฯ 13.75°N บนภาพ Web Mercator อยู่ที่ 0.48264 ของความสูงจากขอบบน", () => {
    // ค่าคาดหวังคำนวณแยกนอกโค้ดนี้ (node, Math.log/Math.tan): merc(φ)=ln(tan(45°+φ/2))
    // merc(22.5)=0.403200, merc(13.75)=0.242320, merc(4)=0.069870
    // (0.403200−0.242320)/(0.403200−0.069870) = 0.482644
    expect(radarRowFromTop(13.75, MERC, "web-mercator")).toBeCloseTo(0.482644, 5);
  });

  it("Mercator กับ plate carrée ต่างกันเกิน 0.009 ของความสูงแถวกรุงเทพฯ (≈26 px จาก 2644)", () => {
    const merc = radarRowFromTop(13.75, MERC, "web-mercator");
    const plate = radarRowFromTop(13.75, MERC, "equirectangular");
    expect(plate).toBeCloseTo(8.75 / 18.5, 10);
    expect((merc - plate) * 2644).toBeGreaterThan(25);
  });

  it("ขอบกรอบตรงกับขอบภาพทั้งสอง projection", () => {
    for (const p of ["web-mercator", "equirectangular"] as const) {
      expect(radarRowFromTop(22.5, MERC, p)).toBeCloseTo(0, 12);
      expect(radarRowFromTop(4, MERC, p)).toBeCloseTo(1, 12);
    }
    expect(radarColFromLeft(95, MERC)).toBe(0);
    expect(radarColFromLeft(108, MERC)).toBe(1);
    expect(radarColFromLeft(100.5, MERC)).toBeCloseTo(5.5 / 13, 12);
  });
});

describe("radarDecodeSize", () => {
  it("ย่อ 1800×2644 ให้ไม่เกินจำนวนพิกเซลของภาพรุ่นเดิม โดยคง aspect", () => {
    const { width, height } = radarDecodeSize(1800, 2644);
    expect([width, height]).toEqual([1154, 1695]);
    expect(width * height).toBeLessThanOrEqual(RADAR_DECODE_MAX_PIXELS);
    expect(Math.abs(width / height / (1800 / 2644) - 1)).toBeLessThan(0.001);
    // ≈7.8 MB RGBA ต่อเฟรม แทน ≈19 MB
    expect(width * height * 4).toBeLessThan(8e6);
  });

  it("ภาพที่ไม่ใหญ่กว่าเพดานไม่ถูกขยายหรือย่อ", () => {
    expect(radarDecodeSize(1173, 1668)).toEqual({ width: 1173, height: 1668 });
  });
});

/**
 * bundle เว็บนี้ต้องวาดได้กับ payload ของ API ที่ deploy อยู่จริง — รวม API รุ่นก่อน
 * (rollback ตาม docs/ops.md) ที่ไม่มี `georeferences` และ `frame.projection`
 * ก่อนหน้านี้ `data.georeferences[f.projection]` โยน TypeError ใน useEffect → ทั้งแอปดับ
 */
const LEGACY_BOUNDS = { minLon: 95.005, minLat: 3.995, maxLon: 108.005, maxLat: 22.495 };
const layer = {
  id: "tmd-radar-composite",
  epistemicClass: "observed",
  liveOrStatic: "live",
  fetchedAt: "2026-09-28T00:00:00.000Z",
  sourceIds: ["tmd-radar"],
} as unknown as RadarFramesResponse["layer"];

describe("selectRadarFrames / frameGeoreference กับ payload ที่ไม่ครบ", () => {
  it("payload ของ API รุ่นก่อน (ไม่มี georeferences, ไม่มี projection): ไม่โยน เก็บทุกเฟรม ใช้ equirectangular + กรอบเดิม", () => {
    const oldApi = {
      layer,
      bounds: LEGACY_BOUNDS,
      widthPx: 1173,
      heightPx: 1668,
      fetchedAt: "2026-09-28T00:00:00.000Z",
      frames: [
        { t: "2026-09-27T16:15:00.000Z", url: "/api/v1/radar/frame/1.png" },
        { t: "2026-09-27T16:30:00.000Z", url: "/api/v1/radar/frame/2.png" },
      ],
    } as unknown as RadarFramesResponse;

    let frames: ReturnType<typeof selectRadarFrames> = [];
    expect(() => {
      frames = selectRadarFrames(oldApi, 8);
    }).not.toThrow();
    expect(frames.map((f) => f.url)).toEqual(["/api/v1/radar/frame/1.png", "/api/v1/radar/frame/2.png"]);
    for (const f of frames) {
      expect(f.geo.projection).toBe("equirectangular");
      expect(f.geo.bounds).toEqual(LEGACY_BOUNDS);
      expect([f.geo.widthPx, f.geo.heightPx]).toEqual([1173, 1668]);
    }
  });

  it("projection ที่ไม่รู้จัก: ไม่โยน และข้ามเฉพาะเฟรมนั้น (ห้ามวาดด้วยกรอบที่เดา)", () => {
    const merc = {
      projection: "web-mercator" as const,
      bounds: MERC,
      widthPx: 1800,
      heightPx: 2644,
      basis: "test",
    };
    const data = {
      layer,
      georeferences: { "web-mercator": merc, equirectangular: { ...merc, projection: "equirectangular", bounds: LEGACY_BOUNDS, widthPx: 1173, heightPx: 1668 } },
      bounds: MERC,
      widthPx: 1800,
      heightPx: 2644,
      fetchedAt: null,
      frames: [
        { t: "2026-09-27T16:15:00.000Z", url: "/a.png", projection: "lambert-conformal" },
        { t: "2026-09-27T16:30:00.000Z", url: "/b.png", projection: "web-mercator" },
      ],
    } as unknown as RadarFramesResponse;

    let frames: ReturnType<typeof selectRadarFrames> = [];
    expect(() => {
      frames = selectRadarFrames(data, 8);
    }).not.toThrow();
    expect(frames.map((f) => f.url)).toEqual(["/b.png"]);
    expect(frames[0].geo.projection).toBe("web-mercator");
    expect(frameGeoreference(data, "lambert-conformal")).toBeNull();
  });

  it("projection มีแต่ georeferences หายไป หรือช่องเดิมก็ไม่มี: ข้ามเฟรม ไม่โยน", () => {
    const noGeo = {
      layer,
      fetchedAt: null,
      frames: [
        { t: "2026-09-27T16:30:00.000Z", url: "/c.png", projection: "web-mercator" },
        { t: "2026-09-27T16:45:00.000Z", url: "/d.png" },
      ],
    } as unknown as RadarFramesResponse;
    expect(() => selectRadarFrames(noGeo, 8)).not.toThrow();
    expect(selectRadarFrames(noGeo, 8)).toEqual([]);
    expect(frameGeoreference(null, undefined)).toBeNull();
  });

  it("เก็บเฉพาะ `max` เฟรมล่าสุด", () => {
    const data = {
      layer,
      bounds: LEGACY_BOUNDS,
      widthPx: 1173,
      heightPx: 1668,
      fetchedAt: null,
      frames: Array.from({ length: 10 }, (_, i) => ({ t: `2026-09-27T1${i}:00:00.000Z`, url: `/${i}.png` })),
    } as unknown as RadarFramesResponse;
    expect(selectRadarFrames(data, 8).map((f) => f.url)).toEqual(Array.from({ length: 8 }, (_, i) => `/${i + 2}.png`));
  });
});
