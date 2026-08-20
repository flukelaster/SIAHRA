import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AoiManifest } from "@siahra/shared-types";
import { verifyTerrainIntegrity, layerProvenance } from "./loadAoiManifest";
import { computeOverlayField, suppressLowlandChannel } from "./overlayField";

/**
 * E9.1 — สิ่งที่เทสนี้กันไว้คือ "ระดับของการลงโทษ" ต้องตรงกับหลักฐานที่มี:
 *
 * - manifest ไม่มี checksum → `unknown` และ **ห้ามปิดอะไรเลย** (manifest รุ่นก่อน
 *   E9.1 ยังใช้งานได้ตลอดไป การปิดชั้นเพราะ "ยังไม่ได้ตรวจ" คือการกล่าวหาลอย ๆ)
 * - checksum ไม่ตรง → `mismatch` แล้วเฉพาะแชนแนล R (พื้นที่ลุ่มต่ำ ซึ่งเป็น
 *   อนุพันธ์ของ DEM ก้อนนั้น) ถูกล้าง ส่วน G/B/A ไม่ถูกแตะ
 */

const BASE: AoiManifest = {
  aoiId: "11",
  bbox: { minLon: 100, maxLon: 100.1, minLat: 13, maxLat: 13.1 },
  utmZone: "32647",
  originEasting: 600000,
  originNorthing: 1400000,
  terrain: {
    url: "/aoi/11/terrain.bin",
    width: 8,
    height: 8,
    cellSizeM: 30,
    minZ: 0,
    maxZ: 20,
    demType: "DSM",
  },
  buildings: null,
  version: "2026-08-17",
};

const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const buffer = bytes.buffer.slice(0) as ArrayBuffer;
const sha = createHash("sha256").update(bytes).digest("hex");

describe("verifyTerrainIntegrity", () => {
  it("manifest รุ่นก่อน E9.1 (ไม่มี provenance) โหลดได้และได้ unknown", async () => {
    expect(await verifyTerrainIntegrity(BASE, buffer)).toBe("unknown");
  });

  it("มี provenance แต่ไม่มี checksum ของ terrain.bin ก็ยังเป็น unknown", async () => {
    const m: AoiManifest = {
      ...BASE,
      provenance: {
        datasetVersion: "2026-08-17",
        generatedAt: "2026-08-20T04:00:00.000Z",
        sources: { terrain: { builtAt: "2026-08-17T02:51:03.000Z", sourceIds: ["copernicus-dem"] } },
        checksums: {},
      },
    };
    expect(await verifyTerrainIntegrity(m, buffer)).toBe("unknown");
    expect(layerProvenance(m, "terrain")?.builtAt).toBe("2026-08-17T02:51:03.000Z");
    expect(layerProvenance(m, "trees")).toBeUndefined();
    expect(layerProvenance(BASE, "terrain")).toBeUndefined();
  });

  it("checksum ตรง → verified", async () => {
    const m: AoiManifest = {
      ...BASE,
      provenance: {
        datasetVersion: "2026-08-17",
        generatedAt: "2026-08-20T04:00:00.000Z",
        sources: {},
        checksums: { "terrain.bin": sha },
      },
    };
    expect(await verifyTerrainIntegrity(m, buffer)).toBe("verified");
  });

  it("ไฟล์ถูกแก้แม้ไบต์เดียว → mismatch", async () => {
    const m: AoiManifest = {
      ...BASE,
      provenance: {
        datasetVersion: "2026-08-17",
        generatedAt: "2026-08-20T04:00:00.000Z",
        sources: {},
        checksums: { "terrain.bin": sha },
      },
    };
    const corrupted = new Uint8Array(bytes);
    corrupted[3] ^= 0xff;
    expect(await verifyTerrainIntegrity(m, corrupted.buffer as ArrayBuffer)).toBe("mismatch");
  });
});

describe("suppressLowlandChannel", () => {
  /** DEM สังเคราะห์: แอ่งตรงกลางบนที่ราบ → แชนแนล R มีค่ามากกว่าศูนย์แน่นอน */
  function syntheticField() {
    const width = 64;
    const height = 64;
    const heights = new Float32Array(width * height);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const d = Math.hypot(c - width / 2, r - height / 2);
        heights[r * width + c] = 50 - 12 * Math.exp(-(d * d) / 200);
      }
    }
    return computeOverlayField({ width, height, cellSizeM: 30 }, heights, null);
  }

  it("ล้างเฉพาะ R — G/B/A คงเดิมทุกไบต์", () => {
    const before = syntheticField();
    const original = Uint8Array.from(before.data);
    expect(original.some((_, i) => i % 4 === 0 && original[i] > 0)).toBe(true);

    const after = suppressLowlandChannel(before);
    for (let i = 0; i < after.data.length; i += 4) {
      expect(after.data[i]).toBe(0);
      expect(after.data[i + 1]).toBe(original[i + 1]);
      expect(after.data[i + 2]).toBe(original[i + 2]);
      expect(after.data[i + 3]).toBe(original[i + 3]);
    }
    // 0 อ่านว่า "ไม่มีพื้นที่ลุ่มต่ำเลย" ซึ่งเป็นคำกล่าวอ้าง — ต้องเป็น null
    expect(after.lowlandShare).toBeNull();
  });
});
