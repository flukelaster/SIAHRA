import { writeFileSync } from "node:fs";
import path from "node:path";
import type { AoiManifest, AoiProvenanceLayer } from "@siahra/shared-types";
import type { AoiDefinition } from "./aoi.js";
import type { TerrainResult } from "./buildTerrain.js";
import { buildAoiProvenance, isoUtc } from "./provenance.js";

export interface WriteManifestOptions {
  /**
   * `apps/etl/data/tiles/{aoiId}` — AOI สาธิตไม่มี tile pyramid จึงเป็น null
   * ตามปกติ (เทสต์ส่ง temp dir เข้ามาได้)
   */
  tilesDir?: string | null;
  /** จาก `readOsmPublishedAt()` — null = ต้นทางไม่ได้ประกาศเวลาไว้ */
  osmPublishedAt?: string | null;
  /**
   * เวลาที่ artefact ถูกผลิตในรันนี้ ค่าเริ่มต้นคือ "ตอนนี้" สำหรับชั้นที่
   * ฟังก์ชันนี้เพิ่งเห็นว่าถูกเขียนจริง — ส่งเข้ามาเองได้เพื่อให้เทสต์กำหนดเวลาได้
   */
  builtAt?: Partial<Record<AoiProvenanceLayer, string>>;
  /** เวลาที่ manifest ถูกเขียน (ค่าเริ่มต้น = ตอนนี้) */
  generatedAt?: string;
}

/**
 * เขียน manifest ของ AOI สาธิตขนาดเล็ก (เส้นทาง `buildAoi.ts`)
 *
 * provenance ที่นี่ต่างจากเส้นทางรีเฟรชตรงที่ artefact **เพิ่งถูกสร้างจริง**
 * ในรันเดียวกัน จึงจดเวลาปัจจุบันได้อย่างซื่อสัตย์ ส่วนชั้นที่ AOI นี้ไม่มี
 * (roads/water/trees ไม่มี tile pyramid) จะไม่มี entry เลย — ไม่ใช่มี entry
 * ที่ยืมเวลาจากชั้นอื่น
 */
export function writeManifest(
  aoi: AoiDefinition,
  terrain: TerrainResult,
  hasBuildings: boolean,
  outDir: string,
  options: WriteManifestOptions = {},
): AoiManifest {
  const now = isoUtc(Date.now());
  const version = new Date().toISOString().slice(0, 10);
  const builtAt: Partial<Record<AoiProvenanceLayer, string>> = {
    terrain: now,
    ...(hasBuildings ? { buildings: now } : {}),
    ...options.builtAt,
  };

  const manifest: AoiManifest = {
    aoiId: aoi.aoiId,
    bbox: aoi.bbox,
    utmZone: aoi.utmZone,
    originEasting: terrain.originEasting,
    originNorthing: terrain.originNorthing,
    terrain: {
      url: `/aoi/${aoi.aoiId}/terrain.bin`,
      width: terrain.width,
      height: terrain.height,
      cellSizeM: terrain.cellSizeM,
      minZ: terrain.minZ,
      maxZ: terrain.maxZ,
      demType: "DSM",
    },
    // AOI สาธิตขนาดเล็ก (buildAoi.ts) ยังใช้ geojson ก้อนเดียวอยู่ และยังเผยแพร่
    // ไฟล์นั้นจริง — `url` จึงยังต้องเขียน ต่างจาก build ระดับจังหวัดใน
    // buildAllProvinces.ts ที่ใช้ tile pyramid แล้วเลิกเขียน url ไปตั้งแต่ E8.3
    buildings: hasBuildings ? { url: `/aoi/${aoi.aoiId}/buildings.geojson` } : null,
    version,
  };

  // ต้องประกอบ provenance **หลัง** artefact ถูกเขียนลง outDir ครบ เพราะ
  // checksum อ่านจากไฟล์จริง
  manifest.provenance = buildAoiProvenance({
    aoiDir: outDir,
    tilesDir: options.tilesDir ?? null,
    datasetVersion: version,
    generatedAt: options.generatedAt,
    osmPublishedAt: options.osmPublishedAt ?? null,
    builtAt,
  });

  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
