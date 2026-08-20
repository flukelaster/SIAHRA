import { writeFileSync } from "node:fs";
import path from "node:path";
import type { AoiManifest } from "@siahra/shared-types";
import type { AoiDefinition } from "./aoi.js";
import type { TerrainResult } from "./buildTerrain.js";

export function writeManifest(
  aoi: AoiDefinition,
  terrain: TerrainResult,
  hasBuildings: boolean,
  outDir: string,
): AoiManifest {
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
    version: new Date().toISOString().slice(0, 10),
  };

  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
