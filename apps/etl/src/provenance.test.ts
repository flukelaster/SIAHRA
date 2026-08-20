import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AoiManifest } from "@siahra/shared-types";
import { buildAoiProvenance, isoUtc, sha256File, touchLayerProvenance } from "./provenance.js";
import { writeManifest } from "./writeManifest.js";
import type { AoiDefinition } from "./aoi.js";
import type { TerrainResult } from "./buildTerrain.js";

/**
 * เทสของ E9.1 — สิ่งที่ต้องกันไว้ไม่ให้พังคือ "กฎการไม่เดาเวลา" ไม่ใช่แค่รูปร่าง
 * ของ object: ชั้นที่ไม่มี artefact ต้อง **ไม่มีคีย์** และห้ามมีเวลาอื่น
 * (`generatedAt`, `datasetVersion`, เวลาปัจจุบัน) รั่วเข้ามาแทน
 *
 * ทุกเคสรันได้บนเครื่องที่ไม่มีชุด tile 5.6 GB, ไม่มี osmium และไม่มีไฟล์ pbf —
 * `publishedAt` ถูกส่งเข้ามาเป็นพารามิเตอร์ ไม่ได้ spawn process
 */

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), "siahra-prov-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** โฟลเดอร์ tile ปลอมพร้อม mtime ที่กำหนดเอง (จำลอง artefact ที่ build ไว้ก่อน) */
function fakeTileDir(root: string, layer: string, mtimeMs: number) {
  const dir = path.join(root, layer, "4");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "9_9.bin");
  writeFileSync(file, Buffer.alloc(16));
  utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
}

const AOI: AoiDefinition = {
  aoiId: "test-aoi",
  bbox: { minLon: 100, maxLon: 100.1, minLat: 13, maxLat: 13.1 },
  utmZone: "32647",
  demTileUrls: [],
  cellSizeM: 30,
};

const TERRAIN: TerrainResult = {
  binPath: "terrain.bin",
  hillshadePath: "hillshade.png",
  width: 4,
  height: 4,
  cellSizeM: 30,
  minZ: 0,
  maxZ: 10,
  originEasting: 600000,
  originNorthing: 1400000,
};

// artefact ถูกสร้างเมื่อ 2026-08-17 ส่วน manifest ถูกเขียนวันที่ 2026-08-20 —
// สองเวลานี้ต่างกันได้จริง และนั่นคือเหตุผลทั้งหมดที่ต้องมี provenance รายชั้น
const BUILT_MS = Date.parse("2026-08-17T02:51:03Z");
const GENERATED_AT = "2026-08-20T04:00:00.000Z";
const OSM_PUBLISHED_AT = "2026-08-15T20:21:20.000Z";

describe("buildAoiProvenance", () => {
  it("บันทึก builtAt ของแต่ละชั้นจาก mtime ของ artefact ชั้นนั้นเอง", () => {
    const aoiDir = tmp();
    const tilesDir = tmp();
    writeFileSync(path.join(aoiDir, "terrain.bin"), Buffer.from([1, 2, 3, 4]));
    fakeTileDir(tilesDir, "terrain", BUILT_MS);
    fakeTileDir(tilesDir, "buildings", BUILT_MS + 60_000);
    fakeTileDir(tilesDir, "features", BUILT_MS + 120_000);
    fakeTileDir(tilesDir, "landcover", BUILT_MS + 180_000);

    const p = buildAoiProvenance({
      aoiDir,
      tilesDir,
      datasetVersion: "2026-08-17",
      generatedAt: GENERATED_AT,
      osmPublishedAt: OSM_PUBLISHED_AT,
    });

    expect(p.datasetVersion).toBe("2026-08-17");
    expect(p.generatedAt).toBe(GENERATED_AT);

    expect(p.sources.terrain?.builtAt).toBe(isoUtc(BUILT_MS));
    expect(p.sources.buildings?.builtAt).toBe(isoUtc(BUILT_MS + 60_000));
    // ถนนกับแหล่งน้ำมาจาก build เดียวกัน (features) จึงมีเวลาเดียวกัน
    expect(p.sources.roads?.builtAt).toBe(isoUtc(BUILT_MS + 120_000));
    expect(p.sources.water?.builtAt).toBe(p.sources.roads?.builtAt);
    expect(p.sources.trees?.builtAt).toBe(isoUtc(BUILT_MS + 180_000));

    expect(p.sources.terrain?.sourceIds).toEqual(["copernicus-dem"]);
    expect(p.sources.trees?.sourceIds).toEqual(["worldcover"]);
    expect(p.sources.roads?.sourceIds).toEqual(["osm"]);

    // generatedAt ต้องไม่กลายเป็น builtAt ของชั้นใดเลย
    for (const entry of Object.values(p.sources)) {
      expect(entry.builtAt).not.toBe(p.generatedAt);
      expect(entry.builtAt).not.toBe(p.datasetVersion);
    }

    expect(p.checksums["terrain.bin"]).toBe(sha256File(path.join(aoiDir, "terrain.bin")));
    expect(p.checksums["terrain.bin"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ใส่ publishedAt เฉพาะชั้นที่มาจาก OSM", () => {
    const aoiDir = tmp();
    const tilesDir = tmp();
    for (const layer of ["terrain", "buildings", "features", "landcover"]) {
      fakeTileDir(tilesDir, layer, BUILT_MS);
    }
    const p = buildAoiProvenance({
      aoiDir,
      tilesDir,
      datasetVersion: "v1",
      generatedAt: GENERATED_AT,
      osmPublishedAt: OSM_PUBLISHED_AT,
    });
    expect(p.sources.roads?.publishedAt).toBe(OSM_PUBLISHED_AT);
    expect(p.sources.water?.publishedAt).toBe(OSM_PUBLISHED_AT);
    expect(p.sources.buildings?.publishedAt).toBe(OSM_PUBLISHED_AT);
    // WorldCover/Copernicus บอกแค่ "ยุค" ของผลิตภัณฑ์ ไม่ใช่ timestamp
    expect(p.sources.terrain?.publishedAt).toBeUndefined();
    expect(p.sources.trees?.publishedAt).toBeUndefined();
  });

  it("อ่านเวลาเผยแพร่ไม่ได้ = ไม่มีฟิลด์ publishedAt เลย (ไม่ใช่ค่าเดา)", () => {
    const tilesDir = tmp();
    fakeTileDir(tilesDir, "features", BUILT_MS);
    const p = buildAoiProvenance({
      aoiDir: tmp(),
      tilesDir,
      datasetVersion: "v1",
      osmPublishedAt: null,
    });
    expect(p.sources.roads?.builtAt).toBe(isoUtc(BUILT_MS));
    expect(Object.hasOwn(p.sources.roads!, "publishedAt")).toBe(false);
  });

  it("ไม่มีโฟลเดอร์ artefact = ไม่มี entry ของชั้นนั้นเลย", () => {
    const aoiDir = tmp();
    const tilesDir = tmp();
    fakeTileDir(tilesDir, "terrain", BUILT_MS);
    const p = buildAoiProvenance({
      aoiDir,
      tilesDir,
      datasetVersion: "2026-08-17",
      generatedAt: GENERATED_AT,
      osmPublishedAt: OSM_PUBLISHED_AT,
    });
    expect(Object.keys(p.sources)).toEqual(["terrain"]);
    for (const layer of ["roads", "water", "buildings", "trees"] as const) {
      expect(Object.hasOwn(p.sources, layer)).toBe(false);
    }
    // ไม่มี terrain.bin ใน aoiDir → ไม่มี checksum (ไม่ใช่ hash ของสตริงว่าง)
    expect(p.checksums).toEqual({});
  });

  it("เครื่องที่ไม่มีชุด tile เลย → sources ว่าง แต่ manifest ยังใช้ได้", () => {
    const p = buildAoiProvenance({
      aoiDir: tmp(),
      tilesDir: null,
      datasetVersion: "2026-08-17",
      generatedAt: GENERATED_AT,
    });
    expect(p.sources).toEqual({});
    expect(p.generatedAt).toBe(GENERATED_AT);
    expect(p.datasetVersion).toBe("2026-08-17");
  });

  it("generatedAt ช้ากว่า builtAt ทุกชั้นได้เป็นเรื่องปกติ", () => {
    const tilesDir = tmp();
    fakeTileDir(tilesDir, "terrain", BUILT_MS);
    const p = buildAoiProvenance({
      aoiDir: tmp(),
      tilesDir,
      datasetVersion: "v1",
      generatedAt: GENERATED_AT,
    });
    expect(Date.parse(p.generatedAt)).toBeGreaterThan(Date.parse(p.sources.terrain!.builtAt));
  });
});

describe("touchLayerProvenance", () => {
  it("เลื่อนเฉพาะชั้นที่เพิ่ง rebuild ชั้นอื่นไม่ขยับ และคำนวณ checksum ใหม่", () => {
    const aoiDir = tmp();
    writeFileSync(path.join(aoiDir, "terrain.bin"), Buffer.from([1, 1, 1, 1]));
    const base = buildAoiProvenance({
      aoiDir,
      tilesDir: (() => {
        const d = tmp();
        fakeTileDir(d, "terrain", BUILT_MS);
        fakeTileDir(d, "landcover", BUILT_MS);
        return d;
      })(),
      datasetVersion: "v1",
      generatedAt: GENERATED_AT,
    });
    const next = touchLayerProvenance(base, ["trees"], "2026-08-21T00:00:00.000Z", aoiDir)!;
    expect(next.sources.trees?.builtAt).toBe("2026-08-21T00:00:00.000Z");
    expect(next.sources.terrain?.builtAt).toBe(base.sources.terrain?.builtAt);
    expect(next.checksums).toEqual(base.checksums);

    // ไฟล์ที่ ship ถูกเขียนใหม่ → ลายเซ็นต้องตามไปด้วย ไม่ใช่หิ้วค่าเก่ามาต่อ
    // (ลายเซ็นค้าง = "mismatch" ปลอม ที่จะปิดชั้นพื้นที่ลุ่มต่ำทั้งที่ build ถูก)
    writeFileSync(path.join(aoiDir, "terrain.bin"), Buffer.from([2, 2, 2, 2]));
    const rebuilt = touchLayerProvenance(base, ["terrain"], "2026-08-21T00:00:00.000Z", aoiDir)!;
    expect(rebuilt.checksums["terrain.bin"]).not.toBe(base.checksums["terrain.bin"]);
    expect(rebuilt.checksums["terrain.bin"]).toBe(sha256File(path.join(aoiDir, "terrain.bin")));
  });

  it("manifest ที่ยังไม่มี provenance ถูกปล่อยไว้เหมือนเดิม", () => {
    expect(touchLayerProvenance(undefined, ["trees"], GENERATED_AT, tmp())).toBeUndefined();
  });
});

describe("writeManifest", () => {
  it("เขียน datasetVersion / generatedAt / sources / checksums ลง manifest.json", () => {
    const outDir = tmp();
    writeFileSync(path.join(outDir, "terrain.bin"), Buffer.from([9, 8, 7, 6]));
    const tilesDir = tmp();
    fakeTileDir(tilesDir, "features", BUILT_MS);

    const manifest = writeManifest(AOI, TERRAIN, true, outDir, {
      tilesDir,
      osmPublishedAt: OSM_PUBLISHED_AT,
      generatedAt: GENERATED_AT,
      builtAt: { terrain: "2026-08-20T03:00:00.000Z", buildings: "2026-08-20T03:05:00.000Z" },
    });

    const onDisk = JSON.parse(
      readFileSync(path.join(outDir, "manifest.json"), "utf8"),
    ) as AoiManifest;
    expect(onDisk).toEqual(manifest);

    const p = onDisk.provenance!;
    expect(p.datasetVersion).toBe(manifest.version);
    expect(p.generatedAt).toBe(GENERATED_AT);
    // ชั้นที่รันนี้สร้างเองใช้เวลาที่จดตอนเขียน; ชั้นที่มีแต่ artefact เก่าใช้ mtime
    expect(p.sources.terrain?.builtAt).toBe("2026-08-20T03:00:00.000Z");
    expect(p.sources.buildings?.builtAt).toBe("2026-08-20T03:05:00.000Z");
    expect(p.sources.roads?.builtAt).toBe(isoUtc(BUILT_MS));
    // ไม่มีโฟลเดอร์ landcover → ไม่มี entry ของ trees
    expect(Object.hasOwn(p.sources, "trees")).toBe(false);
    expect(p.checksums["terrain.bin"]).toBe(sha256File(path.join(outDir, "terrain.bin")));
  });

  it("AOI ที่ไม่มีอาคาร ไม่มี entry ของ buildings", () => {
    const outDir = tmp();
    const manifest = writeManifest(AOI, TERRAIN, false, outDir, { tilesDir: null });
    expect(Object.hasOwn(manifest.provenance!.sources, "buildings")).toBe(false);
    expect(manifest.provenance!.sources.terrain?.builtAt).toBeTruthy();
  });
});
