import { afterEach, describe, expect, it, vi } from "vitest";
import type { AoiManifest } from "@siahra/shared-types";
import { buildBuildingLayer } from "./BuildingLayer";

/**
 * E8.3 — `buildings.geojson` ของทั้ง 77 จังหวัดถูกถอดออกจากชุดข้อมูลแล้ว เหลือ
 * AOI สาธิต (chiangmai-old-city) ที่ยังใช้ไฟล์เดียวอยู่ ชั้นนี้จึงเป็น "ทางสำรอง"
 * และสิ่งที่ต้องกันไว้คือ: มันต้องไม่ยิง fetch เมื่อไม่มี url และต้องไม่ reject
 * เพราะฝั่ง Map3DCanvas จับ error ก้อนเดียวกับทั้งฉาก — โหลดอาคารพลาดจึงจะทำให้
 * ทั้งแผนที่ขึ้น error ได้ ซึ่งขัดกับหลัก "เสียแบบเห็นได้ ไม่ใช่พังทั้งจอ"
 */
const manifest = (buildings: AoiManifest["buildings"]): AoiManifest => ({
  aoiId: "test-aoi",
  bbox: { minLon: 98.94, maxLon: 99.02, minLat: 18.76, maxLat: 18.82 },
  utmZone: "32647",
  originEasting: 494000,
  originNorthing: 2075000,
  terrain: {
    url: "/aoi/test-aoi/terrain.bin",
    width: 4,
    height: 4,
    cellSizeM: 30,
    minZ: 300,
    maxZ: 400,
    demType: "DSM",
  },
  buildings,
  version: "2026-08-20",
});

const sampleGround = () => 300;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildBuildingLayer", () => {
  it("manifest.buildings = null → ไม่มีอาคาร ไม่ยิง fetch และไม่เรียก onError (ไม่ใช่ความล้มเหลว)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const onError = vi.fn();
    await expect(
      buildBuildingLayer(manifest(null), sampleGround, undefined, onError),
    ).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("มี tiles → ปล่อยให้ BuildingTiles สตรีมเอง ไม่ดึง geojson และไม่เรียก onError", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onError = vi.fn();
    const tiles = {
      urlTemplate: "/aoi/test-aoi/buildings/{z}/{x}_{y}.bin",
      unitM: 0.25,
      levels: [{ z: 4, tilesX: 2, tilesY: 2, present: "AA==", count: 10, minAreaM2: 0, minHeightM: 0 }],
      count: 10,
      heightSourceCounts: {},
    };
    await expect(
      buildBuildingLayer(
        manifest({ url: "/aoi/test-aoi/buildings.geojson", tiles }),
        sampleGround,
        undefined,
        onError,
      ),
    ).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("ไม่มีทั้ง tiles และ url → เตือนใน console แล้วคืน null ไม่ throw และไม่เรียก onError (ไม่ใช่ความล้มเหลว)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onError = vi.fn();
    await expect(
      buildBuildingLayer(manifest({ count: 0 }), sampleGround, undefined, onError),
    ).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("url ที่หายไป (static host ตอบ SPA shell/404) → คืน null ไม่ reject แต่ต้องเรียก onError ให้ผู้เรียกโชว์บน UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!doctype html>", { status: 404 })),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onError = vi.fn();
    await expect(
      buildBuildingLayer(
        manifest({ url: "/aoi/test-aoi/buildings.geojson" }),
        sampleGround,
        undefined,
        onError,
      ),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    // ความล้มเหลวจริง (มี url แต่โหลดไม่ผ่าน) ต้องโผล่ให้ผู้เรียกเห็น ไม่ใช่แค่ console
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("404"));
  });

  it("url ที่ยังมีจริง → สร้าง mesh ตามจำนวน feature (ทางสำรองของ AOI รุ่นเก่า)", async () => {
    const collection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { building: "yes", height: 9 },
          geometry: {
            type: "Polygon",
            // UTM metres รอบ origin ของ manifest ด้านบน
            coordinates: [
              [
                [494000, 2075000],
                [494020, 2075000],
                [494020, 2075020],
                [494000, 2075020],
                [494000, 2075000],
              ],
            ],
          },
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(collection)));
    const result = await buildBuildingLayer(
      manifest({ url: "/aoi/test-aoi/buildings.geojson" }),
      sampleGround,
    );
    expect(result?.count).toBe(1);
    expect(result?.mesh.geometry.attributes.position.count).toBeGreaterThan(0);
  });
});
