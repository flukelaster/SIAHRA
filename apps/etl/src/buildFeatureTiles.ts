/**
 * Adds (or rebuilds) waterway / water body / road LOD tiles for provinces
 * with a terrain tile pyramid, and patches `features` into the manifest.
 *
 *   npm run build:feature-tiles -w apps/etl -- --only=10,50
 *   npm run build:feature-tiles -w apps/etl [-- --force]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AoiManifest } from "@siahra/shared-types";
import type { AoiDefinition } from "./aoi.js";
import { buildProvinceFeatureTiles } from "./buildProvinceFeatureTiles.js";
import { MIN_CELL_SIZE_M } from "./provinceAoi.js";

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
  if (!force && manifest.features) {
    console.log(`${tag} — skip (feature tiles present)`);
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
    const result = await buildProvinceFeatureTiles(aoi, manifest.terrain.tiles, `/aoi/${code}`);
    manifest.features = result.pyramid;
    manifest.version = new Date().toISOString().slice(0, 10);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    totalBytes += result.bytes;
    totalFiles += result.fileCount;
    console.log(
      `${tag} — ${result.pyramid.lineCount} lines, ${result.pyramid.waterAreaCount} water areas, ` +
        `${result.fileCount} tiles, ${(result.bytes / 1e6).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${code}: ${msg.slice(0, 160)}`);
    console.error(`${tag} — FAILED: ${msg.slice(0, 200)}`);
  }
}
console.log(`\n=== feature tiles: ${totalFiles} files, ${(totalBytes / 1e6).toFixed(0)} MB, failed ${failures.length} ===`);
if (failures.length) console.log(failures.join("\n"));
