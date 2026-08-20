import { describe, expect, it } from "vitest";
import type { AoiManifest, AoiProvenance } from "@siahra/shared-types";
import {
  DATASET_VERSION_RE,
  assertDatasetVersion,
  diffTileContent,
  isSafeVersionReuse,
  retargetTileTemplates,
  tileContentSignature,
  tileUrlTemplate,
  versionedTilePrefix,
  type VersionSignatureLedger,
} from "./datasetVersion.js";

/**
 * เทสของ E9.2 — สิ่งที่ต้องกันไว้คือ "prefix ที่ยังชี้ที่เดิมทั้งที่ไบต์ข้างใต้
 * เปลี่ยนไปแล้ว" เพราะ tile ถูกส่งด้วย `immutable, max-age=1y` การตอบผิดหนึ่งครั้ง
 * จึงแก้ไม่ได้อีกหนึ่งปี
 */

function provenance(over: Partial<AoiProvenance> = {}): AoiProvenance {
  return {
    datasetVersion: "2026-08-17",
    generatedAt: "2026-08-20T00:00:00.000Z",
    sources: {
      terrain: { builtAt: "2026-08-17T02:51:03.000Z", sourceIds: ["copernicus-dem"] },
      roads: { builtAt: "2026-08-17T03:32:44.000Z", sourceIds: ["osm"] },
    },
    checksums: { "terrain.bin": "a".repeat(64) },
    ...over,
  };
}

describe("รูปแบบของ datasetVersion", () => {
  it("รับวันที่ และวันที่+serial", () => {
    expect(DATASET_VERSION_RE.test("2026-08-17")).toBe(true);
    expect(DATASET_VERSION_RE.test("2026-08-17.2")).toBe(true);
    expect(assertDatasetVersion("2026-08-17")).toBe("2026-08-17");
  });

  /** ค่าที่หลุดเข้าไปเป็น segment ของ URL/คีย์ R2 ได้ ต้องไม่ผ่านตั้งแต่ที่นี่ */
  it("ปฏิเสธค่าที่ apps/web/worker/tilePath.ts จะเสิร์ฟไม่ได้", () => {
    for (const bad of ["", "..", "latest", "2026-8-17", "2026-08-17-2", "2026-08-17/x", "v/2026-08-17", " 2026-08-17"]) {
      expect(DATASET_VERSION_RE.test(bad)).toBe(false);
      expect(() => assertDatasetVersion(bad)).toThrow();
    }
  });

  it("prefix และ template ตรงกับรูปแบบ URL ที่ Worker รับ", () => {
    expect(versionedTilePrefix("11", "2026-08-17")).toBe("/aoi/11/v/2026-08-17");
    expect(tileUrlTemplate("11", "2026-08-17", "features")).toBe("/aoi/11/v/2026-08-17/features/{z}/{x}_{y}.bin");
  });
});

describe("retargetTileTemplates", () => {
  function manifest(): AoiManifest {
    return {
      aoiId: "11",
      bbox: { minLon: 100, maxLon: 101, minLat: 13, maxLat: 14 },
      utmZone: "32647",
      originEasting: 0,
      originNorthing: 0,
      version: "2026-08-17",
      terrain: {
        url: "/aoi/11/terrain.bin",
        width: 1,
        height: 1,
        cellSizeM: 30,
        minZ: 0,
        maxZ: 1,
        demType: "DSM",
        tiles: { urlTemplate: "/aoi/11/terrain/{z}/{x}_{y}.bin" } as AoiManifest["terrain"]["tiles"],
      },
      buildings: { tiles: { urlTemplate: "/aoi/11/buildings/{z}/{x}_{y}.bin" } as never },
      features: { urlTemplate: "/aoi/11/features/{z}/{x}_{y}.bin" } as never,
      landcover: { urlTemplate: "/aoi/11/landcover/{z}/{x}_{y}.bin" } as never,
    };
  }

  it("ชี้ทุก pyramid ไปที่ prefix ของรุ่น", () => {
    const m = manifest();
    const changes = retargetTileTemplates(m, "2026-08-21");
    expect(changes.map((c) => c.layer).sort()).toEqual(["buildings", "features", "landcover", "terrain"]);
    expect(m.terrain.tiles!.urlTemplate).toBe("/aoi/11/v/2026-08-21/terrain/{z}/{x}_{y}.bin");
    expect(m.buildings!.tiles!.urlTemplate).toBe("/aoi/11/v/2026-08-21/buildings/{z}/{x}_{y}.bin");
    expect(m.features!.urlTemplate).toBe("/aoi/11/v/2026-08-21/features/{z}/{x}_{y}.bin");
    expect(m.landcover!.urlTemplate).toBe("/aoi/11/v/2026-08-21/landcover/{z}/{x}_{y}.bin");
  });

  it("รันซ้ำด้วยรุ่นเดิมแล้วไม่มีอะไรเปลี่ยน (idempotent)", () => {
    const m = manifest();
    retargetTileTemplates(m, "2026-08-21");
    expect(retargetTileTemplates(m, "2026-08-21")).toEqual([]);
  });

  it("ย้ายจาก prefix ของรุ่นหนึ่งไปอีกรุ่นได้ ไม่ซ้อน v/ ทับกัน", () => {
    const m = manifest();
    retargetTileTemplates(m, "2026-08-21");
    retargetTileTemplates(m, "2026-08-22");
    expect(m.features!.urlTemplate).toBe("/aoi/11/v/2026-08-22/features/{z}/{x}_{y}.bin");
  });

  it("AOI ที่ไม่มี pyramid เลย (chiangmai-old-city) ไม่ถูกแตะ", () => {
    const m = manifest();
    m.terrain.tiles = undefined;
    m.buildings = { url: "/aoi/x/buildings.geojson" };
    m.features = undefined;
    m.landcover = undefined;
    expect(retargetTileTemplates(m, "2026-08-21")).toEqual([]);
  });

  /**
   * Worker เสิร์ฟเฉพาะ `/aoi/{2 หลัก}/…` — AOI สาธิตที่ id ไม่ใช่รหัสจังหวัดจึงต้อง
   * คงอยู่ที่ prefix เดิม ไม่งั้น prod จะ 404 ทุกไทล์โดยที่ dev ยังเขียว
   */
  it("AOI ที่ Worker เสิร์ฟไม่ได้ (id ไม่ใช่สองหลัก) ไม่ถูกเขียน prefix แบบมีรุ่น", () => {
    const m = manifest();
    m.aoiId = "chiangmai-old-city";
    expect(retargetTileTemplates(m, "2026-08-21")).toEqual([]);
    expect(m.terrain.tiles!.urlTemplate).toBe("/aoi/11/terrain/{z}/{x}_{y}.bin");
    expect(m.features!.urlTemplate).toBe("/aoi/11/features/{z}/{x}_{y}.bin");
  });

  it("รุ่นผิดรูปแบบไม่ถูกเขียนลง manifest", () => {
    const m = manifest();
    expect(() => retargetTileTemplates(m, "../../etc")).toThrow();
    expect(m.features!.urlTemplate).toBe("/aoi/11/features/{z}/{x}_{y}.bin");
  });
});

describe("diffTileContent — กันการใช้รุ่นเดิมซ้ำหลัง rebuild", () => {
  it("เนื้อหาเท่าเดิม = ไม่มีอะไรเปลี่ยน", () => {
    expect(diffTileContent(provenance(), provenance())).toEqual({ changed: [], removed: [] });
  });

  it("rebuild ชั้นเดียว = changed (นี่คือเคสที่ต้องบังคับให้ขึ้นรุ่นใหม่)", () => {
    const next = provenance({
      sources: {
        terrain: { builtAt: "2026-08-17T02:51:03.000Z", sourceIds: ["copernicus-dem"] },
        roads: { builtAt: "2026-08-20T10:00:00.000Z", sourceIds: ["osm"] },
      },
    });
    const delta = diffTileContent(provenance(), next);
    expect(delta.changed).toHaveLength(1);
    expect(delta.changed[0]).toContain("roads");
    expect(delta.removed).toEqual([]);
  });

  it("checksum ของ terrain.bin เปลี่ยน = changed", () => {
    const delta = diffTileContent(provenance(), provenance({ checksums: { "terrain.bin": "b".repeat(64) } }));
    expect(delta.changed).toHaveLength(1);
    expect(delta.changed[0]).toContain("terrain.bin");
  });

  it("ชั้นที่เพิ่มเข้ามา = changed", () => {
    const next = provenance({
      sources: {
        ...provenance().sources,
        trees: { builtAt: "2026-08-20T05:00:00.000Z", sourceIds: ["worldcover"] },
      },
    });
    expect(diffTileContent(provenance(), next).changed).toHaveLength(1);
  });

  /**
   * เครื่องที่ไม่ได้ symlink ชุด tile (clone ใหม่ / CI) จะอ่าน builtAt ไม่ได้เลย
   * — นั่นไม่ใช่ "ไบต์เปลี่ยน" จึงต้องไม่บล็อกการรีเฟรช แต่ต้องพูดออกมา
   */
  it("ชั้นที่หายไปเพราะไม่มีโฟลเดอร์ tile = removed ไม่ใช่ changed", () => {
    const delta = diffTileContent(provenance(), provenance({ sources: {} }));
    expect(delta.changed).toEqual([]);
    expect(delta.removed).toHaveLength(2);
  });

  it("publishedAt/generatedAt ที่ต่างกันไม่นับเป็นการเปลี่ยนเนื้อหา", () => {
    const next = provenance({
      generatedAt: "2027-01-01T00:00:00.000Z",
      sources: {
        terrain: { builtAt: "2026-08-17T02:51:03.000Z", sourceIds: ["copernicus-dem"] },
        roads: { builtAt: "2026-08-17T03:32:44.000Z", publishedAt: "2026-08-15T20:21:20.000Z", sourceIds: ["osm"] },
      },
    });
    expect(diffTileContent(provenance(), next)).toEqual({ changed: [], removed: [] });
  });

  it("manifest ที่ยังไม่มี provenance ไม่ถือว่าเปลี่ยน (ไม่มีอะไรให้เทียบ)", () => {
    expect(diffTileContent(undefined, provenance())).toEqual({ changed: [], removed: [] });
  });
});

describe("isSafeVersionReuse — กันการใช้ชื่อรุ่นเดิมซ้ำไม่ว่าจะเป็นรุ่นปัจจุบันของ manifest หรือรุ่นเก่ากว่านั้น", () => {
  it("รุ่นที่ไม่เคยอยู่ใน ledger เลย = ปลอดภัยเสมอ (รุ่นใหม่จริง ๆ)", () => {
    expect(isSafeVersionReuse({}, "2026-08-21", "sig-a")).toBe(true);
  });

  it("รุ่นเดิม เนื้อหาเดิมเป๊ะ = ปลอดภัย (resume งานที่ยังไม่เสร็จ)", () => {
    const ledger: VersionSignatureLedger = { "2026-08-17": "sig-a" };
    expect(isSafeVersionReuse(ledger, "2026-08-17", "sig-a")).toBe(true);
  });

  it("รุ่นเดิม เนื้อหาต่าง = ไม่ปลอดภัย", () => {
    const ledger: VersionSignatureLedger = { "2026-08-17": "sig-a" };
    expect(isSafeVersionReuse(ledger, "2026-08-17", "sig-b")).toBe(false);
  });

  /**
   * ฉากที่การ์ดเดิมของ `refresh:manifests` (ก่อน review round 6) มองไม่เห็น:
   * AOI หนึ่งปล่อยรุ่น A แล้วปล่อยรุ่น B (manifest ปัจจุบันจำ B ไว้) จากนั้นถูก
   * เรียกซ้ำด้วย `--dataset-version=A` (พิมพ์ผิด/สคริปต์เก่าค้าง/rollback พลาด)
   * ทั้งที่เนื้อหาบนดิสก์ตอนนี้คือของ B ไม่ใช่ของ A แล้ว — การเทียบกับ "รุ่น
   * ปัจจุบันของ manifest" อย่างเดียว (`=== datasetVersion`) จะเป็นเท็จเพราะ
   * manifest จำ B ไว้ ไม่ใช่ A จึงข้ามการตรวจไปเงียบ ๆ `isSafeVersionReuse`
   * ต้องจับกรณีนี้ได้ด้วยประวัติทั้งหมด ไม่ใช่แค่รุ่นล่าสุด
   */
  it("ปล่อยรุ่น A แล้วปล่อยรุ่น B (เนื้อหาเปลี่ยน) แล้วขอปล่อยรุ่น A ซ้ำด้วยเนื้อหาของ B = ไม่ปลอดภัย", () => {
    const provA = provenance({ datasetVersion: "2026-08-17" });
    const provB = provenance({
      datasetVersion: "2026-08-20",
      sources: {
        terrain: { builtAt: "2026-08-20T02:51:03.000Z", sourceIds: ["copernicus-dem"] },
        roads: { builtAt: "2026-08-20T03:32:44.000Z", sourceIds: ["osm"] },
      },
      checksums: { "terrain.bin": "b".repeat(64) },
    });

    // ลำดับเดียวกับที่ refreshManifests.ts ทำจริง: bootstrap รุ่นแรกตอนยังไม่มี
    // ledger เลย แล้วเมื่อปล่อยรุ่น B สำเร็จก็บันทึกรุ่น B เพิ่มเข้าไป
    const ledger: VersionSignatureLedger = {};
    ledger[provA.datasetVersion] = tileContentSignature(provA);
    ledger[provB.datasetVersion] = tileContentSignature(provB);

    // ตอนนี้ผู้ใช้งานขอปล่อยรุ่น "2026-08-17" (= A) ซ้ำ แต่เนื้อหาบนดิสก์ตอนนี้
    // คือของ B แล้ว (สคริปต์จริงจะคำนวณ `next` จากไฟล์ปัจจุบันบนดิสก์เสมอ ไม่ใช่
    // จาก provA/provB ที่นี่ — จำลองด้วยการส่งลายเซ็นของ B เข้าไปตรง ๆ)
    const requestedVersion = provA.datasetVersion;
    const currentDiskSignature = tileContentSignature(provB);
    expect(isSafeVersionReuse(ledger, requestedVersion, currentDiskSignature)).toBe(false);

    // เทียบกับการ์อดเดิม (ก่อนแก้) ที่เช็คแค่ `manifest.provenance?.datasetVersion === datasetVersion`
    // เท่านั้น — manifest ปัจจุบันจำ B ไว้ ไม่ใช่ A การเทียบแบบนั้นจะเป็นเท็จและ
    // ปล่อยผ่านไปเงียบ ๆ ซึ่งเป็นบั๊กที่เทสนี้พิสูจน์ว่า `isSafeVersionReuse` ปิดได้
    const legacyGuardWouldHaveFired = provB.datasetVersion === requestedVersion;
    expect(legacyGuardWouldHaveFired).toBe(false);
  });
});
