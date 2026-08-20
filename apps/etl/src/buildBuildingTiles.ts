/**
 * Adds (or rebuilds) whole-province building LOD tiles for provinces that
 * already have a manifest with a terrain tile pyramid, and patches
 * `buildings.tiles` into it.
 *
 *   npm run build:building-tiles -w apps/etl -- --only=10,50
 *   npm run build:building-tiles -w apps/etl            # every province
 *   ... --force                                          # rebuild existing
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AoiManifest } from "@siahra/shared-types";
import type { AoiDefinition } from "./aoi.js";
import { buildProvinceBuildingTiles } from "./buildProvinceBuildingTiles.js";
import { MIN_CELL_SIZE_M } from "./provinceAoi.js";
import { isoUtc, touchLayerProvenance } from "./provenance.js";

const OUT_ROOT = path.resolve(import.meta.dirname, "../../web/public/aoi");

const force = process.argv.includes("--force");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;

const codes = readdirSync(OUT_ROOT)
  .filter((d) => /^\d{2}$/.test(d) && existsSync(path.join(OUT_ROOT, d, "manifest.json")))
  .filter((d) => !only || only.includes(d))
  .sort();

let i = 0;
let totalBytes = 0;
let totalFiles = 0;
let totalBuildings = 0;
const failures: string[] = [];
for (const code of codes) {
  i++;
  const manifestPath = path.join(OUT_ROOT, code, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as AoiManifest;
  const tag = `[${i}/${codes.length}] ${code} ${manifest.provinceNameTh ?? ""}`;
  if (!manifest.terrain.tiles) {
    console.log(`${tag} — skip (no terrain tiles; run build:tiles first)`);
    continue;
  }
  if (!manifest.buildings) {
    console.log(`${tag} — skip (no buildings)`);
    continue;
  }
  if (!force && manifest.buildings.tiles) {
    console.log(`${tag} — skip (building tiles present)`);
    continue;
  }
  const aoi: AoiDefinition = {
    aoiId: code,
    bbox: manifest.bbox,
    utmZone: manifest.utmZone,
    demTileUrls: [],
    cellSizeM: MIN_CELL_SIZE_M,
  };
  const started = Date.now();
  try {
    const result = await buildProvinceBuildingTiles(aoi, manifest.terrain.tiles, `/aoi/${code}`);
    manifest.buildings.tiles = result.pyramid;
    // ชั้นนี้เพิ่งถูกสร้างใหม่ — เลื่อน builtAt ตาม ไม่งั้น manifest จะประกาศ
    // เวลาเก่าของ artefact ที่ไม่มีอยู่แล้ว (manifest ที่ยังไม่มี provenance
    // ถูกปล่อยไว้ให้ `npm run refresh:manifests` เป็นคนเติมทีเดียว)
    manifest.provenance = touchLayerProvenance(manifest.provenance, ["buildings"], isoUtc(Date.now()), path.join(OUT_ROOT, code));
    manifest.version = new Date().toISOString().slice(0, 10);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    totalBytes += result.bytes;
    totalFiles += result.fileCount;
    totalBuildings += result.pyramid.count;
    console.log(
      `${tag} — ${result.pyramid.count.toLocaleString()} bldg, ` +
        `${result.pyramid.levels.map((l) => `z${l.z}:${l.count}`).join(" ")}, ` +
        `${result.fileCount} tiles, ${(result.bytes / 1e6).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${code}: ${msg.slice(0, 160)}`);
    console.error(`${tag} — FAILED: ${msg.slice(0, 200)}`);
  }
}
console.log(
  `\n=== building tiles: ${totalBuildings.toLocaleString()} buildings, ${totalFiles} files, ${(totalBytes / 1e6).toFixed(0)} MB, failed ${failures.length} ===`,
);
if (failures.length) console.log(failures.join("\n"));
