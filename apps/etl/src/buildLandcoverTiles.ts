/**
 * Adds ESA WorldCover land-cover tiles (vegetation layer) to provinces that
 * have a terrain pyramid, and patches `landcover` into the manifest.
 * Downloads the 3° WorldCover source tiles on demand (~1.1 GB for all of
 * Thailand; a single province needs 1–4 tiles).
 *
 *   npm run build:landcover-tiles -w apps/etl -- --only=10,50
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AoiManifest } from "@siahra/shared-types";
import type { AoiDefinition } from "./aoi.js";
import { buildProvinceLandcoverTiles } from "./buildProvinceLandcoverTiles.js";
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
const failures: string[] = [];
for (const code of codes) {
  i++;
  const manifestPath = path.join(OUT_ROOT, code, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as AoiManifest;
  const tag = `[${i}/${codes.length}] ${code} ${manifest.provinceNameTh ?? ""}`;
  if (!manifest.terrain.tiles) {
    console.log(`${tag} — skip (no terrain tiles)`);
    continue;
  }
  if (!force && manifest.landcover) {
    console.log(`${tag} — skip (landcover present)`);
    continue;
  }
  const aoi: AoiDefinition = { aoiId: code, bbox: manifest.bbox, utmZone: manifest.utmZone, demTileUrls: [], cellSizeM: MIN_CELL_SIZE_M };
  const started = Date.now();
  try {
    const result = await buildProvinceLandcoverTiles(aoi, manifest.terrain.tiles, `/aoi/${code}`);
    manifest.landcover = result.pyramid;
    // ชั้นนี้เพิ่งถูกสร้างใหม่ — เลื่อน builtAt ตาม ไม่งั้น manifest จะประกาศ
    // เวลาเก่าของ artefact ที่ไม่มีอยู่แล้ว (manifest ที่ยังไม่มี provenance
    // ถูกปล่อยไว้ให้ `npm run refresh:manifests` เป็นคนเติมทีเดียว)
    manifest.provenance = touchLayerProvenance(manifest.provenance, ["trees"], isoUtc(Date.now()), path.join(OUT_ROOT, code));
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(
      `${tag} — ${result.fileCount} tiles, ${(result.bytes / 1e6).toFixed(1)} MB, tree share ${(result.pyramid.classShare["10"] ?? 0) * 100}%, ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${code}: ${msg.slice(0, 160)}`);
    console.error(`${tag} — FAILED: ${msg.slice(0, 200)}`);
  }
}
console.log(`\n=== landcover: failed ${failures.length} ===`);
if (failures.length) console.log(failures.join("\n"));
