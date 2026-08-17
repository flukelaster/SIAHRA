/**
 * Adds (or rebuilds) the native-resolution terrain tile pyramid for provinces
 * that already have a manifest, and patches `terrain.tiles` into it.
 *
 *   npm run build:tiles -w apps/etl -- --only=10,50
 *   npm run build:tiles -w apps/etl            # every province with a manifest
 *   ... --force                                 # rebuild even if tiles exist
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AoiManifest } from "@siahra/shared-types";
import type { AoiDefinition } from "./aoi.js";
import { buildProvinceTerrainTiles } from "./buildProvinceTerrainTiles.js";
import { MIN_CELL_SIZE_M } from "./provinceAoi.js";

const OUT_ROOT = path.resolve(import.meta.dirname, "../../web/public/aoi");
const WORK_DIR = path.resolve(import.meta.dirname, "../data/work");
const VRT_PATH = path.join(WORK_DIR, "thailand-dem.vrt");

const force = process.argv.includes("--force");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;

if (!existsSync(VRT_PATH)) {
  console.error(`missing ${VRT_PATH} — run build:all first so the DEM mosaic exists`);
  process.exit(1);
}

const codes = readdirSync(OUT_ROOT)
  .filter((d) => /^\d{2}$/.test(d) && existsSync(path.join(OUT_ROOT, d, "manifest.json")))
  .filter((d) => !only || only.includes(d))
  .sort();

let i = 0;
let totalBytes = 0;
let totalFiles = 0;
const failures: string[] = [];
for (const code of codes) {
  i++;
  const outDir = path.join(OUT_ROOT, code);
  const manifestPath = path.join(outDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as AoiManifest;
  const tag = `[${i}/${codes.length}] ${code} ${manifest.provinceNameTh ?? ""}`;
  if (!force && manifest.terrain.tiles) {
    console.log(`${tag} — skip (tiles present)`);
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
    const result = await buildProvinceTerrainTiles(aoi, VRT_PATH, outDir, `/aoi/${code}`);
    manifest.terrain.tiles = result.pyramid;
    manifest.version = new Date().toISOString().slice(0, 10);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    totalBytes += result.bytes;
    totalFiles += result.fileCount;
    const leaf = result.pyramid.levels.at(-1)!;
    console.log(
      `${tag} — ${leaf.width}x${leaf.height} @30m, ${result.pyramid.levels.length} levels, ` +
        `${result.fileCount} tiles, ${(result.bytes / 1e6).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${code}: ${msg.slice(0, 160)}`);
    console.error(`${tag} — FAILED: ${msg.slice(0, 200)}`);
  }
}
console.log(
  `\n=== tiles: ${totalFiles} files, ${(totalBytes / 1e6).toFixed(0)} MB, failed ${failures.length} ===`,
);
if (failures.length) console.log(failures.join("\n"));
