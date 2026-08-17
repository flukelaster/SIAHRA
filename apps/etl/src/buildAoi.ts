import path from "node:path";
import { getAoi } from "./aoi.js";
import { buildBuildings } from "./buildBuildings.js";
import { buildTerrain } from "./buildTerrain.js";
import { fetchDemTiles } from "./fetchDem.js";
import { fetchThailandOsm } from "./fetchOsm.js";
import { writeManifest } from "./writeManifest.js";

const aoiId = process.argv[2];
if (!aoiId) {
  console.error("Usage: tsx src/buildAoi.ts <aoiId>");
  process.exit(1);
}

const aoi = getAoi(aoiId);
const outDir = path.resolve(import.meta.dirname, `../../web/public/aoi/${aoi.aoiId}`);

console.log(`=== Building AOI "${aoi.aoiId}" -> ${outDir} ===`);

const demTiles = await fetchDemTiles(aoi);
const terrain = await buildTerrain(aoi, demTiles, outDir);
console.log(`[terrain] ${terrain.width}x${terrain.height} cells, z[${terrain.minZ}, ${terrain.maxZ}]`);

const osmPbf = await fetchThailandOsm();
const buildings = await buildBuildings(aoi, osmPbf, outDir);
console.log(`[buildings] ${buildings.buildingCount} features`, buildings.heightSourceCounts);

const manifest = writeManifest(aoi, terrain, buildings.buildingCount > 0, outDir);
console.log("[manifest]", JSON.stringify(manifest, null, 2));

console.log(`=== Done: ${aoi.aoiId} ===`);
