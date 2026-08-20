import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AoiManifest } from "@siahra/shared-types";
import { buildProvinceBuildings } from "./buildProvinceBuildings.js";
import { buildProvinceTerrain } from "./buildProvinceTerrain.js";
import { buildProvinceBuildingTiles } from "./buildProvinceBuildingTiles.js";
import { buildProvinceFeatureTiles } from "./buildProvinceFeatureTiles.js";
import { buildProvinceTerrainTiles } from "./buildProvinceTerrainTiles.js";
import { buildVrt, downloadTiles, tilesForBbox } from "./demTiles.js";
import { buildProvinceBoundaries, writeBoundaryGeojson } from "./provinceBoundaries.js";
import { provinceToAoi } from "./provinceAoi.js";
import { fetchThailandOsm } from "./fetchOsm.js";

const OUT_ROOT = path.resolve(import.meta.dirname, "../../web/public/aoi");
const WORK_DIR = path.resolve(import.meta.dirname, "../data/work");
const VRT_PATH = path.join(WORK_DIR, "thailand-dem.vrt");

const REQUIRED_FILES = [
  "manifest.json",
  "terrain.bin",
  "terrain.hdr",
  "hillshade.png",
  "boundary.geojson",
];

const force = process.argv.includes("--force");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;

/**
 * "สร้างครบแล้ว" = ไฟล์ที่ยัง ship อยู่ครบ **และ** manifest ประกาศ tile pyramid
 * ของอาคารไว้จริง
 *
 * E8.3 ถอด `buildings.geojson` ออกจากรายการนี้ เพราะไฟล์นั้นไม่ถูกเผยแพร่แล้ว
 * (ถ้าปล่อยไว้ ทุกจังหวัดจะดู "ไม่ครบ" แล้วถูก rebuild ใหม่หมด) แต่จะเช็คแค่ไฟล์
 * อย่างเดียวก็ไม่ได้: tile ของอาคารอยู่ใน `apps/etl/data/tiles` ไม่ใช่ `outDir`
 * จึงมองเห็นได้ทางเดียวคืออ่านจาก manifest — และจังหวัดที่ไม่มีอาคารเลย
 * (`buildings: null`) ต้องนับว่าครบ ไม่งั้นจะ rebuild ทุกรอบไม่จบ
 */
function isComplete(dir: string): boolean {
  const filesOk = REQUIRED_FILES.every((f) => {
    const p = path.join(dir, f);
    return existsSync(p) && statSync(p).size > 0;
  });
  if (!filesOk) return false;
  try {
    const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as AoiManifest;
    return manifest.buildings === null || (manifest.buildings?.tiles?.levels?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

const osmPbf = await fetchThailandOsm();
const boundaries = await buildProvinceBoundaries(osmPbf);

const targets = only ? boundaries.filter((b) => only.includes(b.code)) : boundaries;

// One shared VRT across every province, over the union of required tiles.
const allTiles = new Set<string>();
for (const b of boundaries) for (const t of tilesForBbox(b.bbox)) allTiles.add(t);
const { missing } = await downloadTiles([...allTiles].sort(), 6);
if (missing.length > 0) {
  console.warn(`[dem] ${missing.length} tile(s) unavailable (ocean/no-data): ${missing.join(", ")}`);
}
mkdirSync(WORK_DIR, { recursive: true });
await buildVrt([...allTiles].sort(), VRT_PATH);

interface Row {
  code: string;
  nameTh: string;
  w: number;
  h: number;
  cell: number;
  binKb: number;
  buildings: number;
  coverage: string;
  minZ: number;
  maxZ: number;
  source: string;
}
const rows: Row[] = [];
const failures: { code: string; nameTh: string; error: string }[] = [];

let i = 0;
for (const b of targets) {
  i++;
  const outDir = path.join(OUT_ROOT, b.code);
  const tag = `[${i}/${targets.length}] ${b.code} ${b.nameTh}`;

  if (!force && isComplete(outDir)) {
    console.log(`${tag} — skip (complete)`);
    continue;
  }

  try {
    const aoi = provinceToAoi(b);
    mkdirSync(outDir, { recursive: true });

    const terrain = await buildProvinceTerrain(aoi, VRT_PATH, outDir);
    const tiles = await buildProvinceTerrainTiles(aoi, VRT_PATH, outDir, `/aoi/${b.code}`);
    const buildings = await buildProvinceBuildings(aoi, osmPbf);
    const buildingTiles = await buildProvinceBuildingTiles(aoi, tiles.pyramid, `/aoi/${b.code}`);
    const featureTiles = await buildProvinceFeatureTiles(aoi, tiles.pyramid, `/aoi/${b.code}`);
    writeBoundaryGeojson(b, outDir);

    const manifest: AoiManifest = {
      aoiId: b.code,
      provinceCode: b.code,
      provinceNameTh: b.nameTh,
      bbox: aoi.bbox,
      utmZone: aoi.utmZone,
      originEasting: terrain.originEasting,
      originNorthing: terrain.originNorthing,
      terrain: {
        url: `/aoi/${b.code}/terrain.bin`,
        width: terrain.width,
        height: terrain.height,
        cellSizeM: terrain.cellSizeM,
        minZ: terrain.minZ,
        maxZ: terrain.maxZ,
        demType: "DSM",
        hillshadeUrl: `/aoi/${b.code}/hillshade.png`,
        tiles: tiles.pyramid,
      },
      buildings: {
        // ไม่มี `url` อีกแล้ว (E8.3) — จังหวัดใช้ tile pyramid ล้วน ๆ และ
        // `buildings.geojson` ไม่ถูกเผยแพร่ ถ้ายังเขียน url ไว้ก็จะเป็นลิงก์ตาย
        count: buildings.buildingCount,
        coverage: buildings.coverage,
        coverageBbox: buildings.coverageBbox,
        tiles: buildingTiles.pyramid,
      },
      boundary: { url: `/aoi/${b.code}/boundary.geojson` },
      features: featureTiles.pyramid,
      version: new Date().toISOString().slice(0, 10),
    };
    writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    const binKb = Math.round(statSync(path.join(outDir, "terrain.bin")).size / 1024);
    rows.push({
      code: b.code,
      nameTh: b.nameTh,
      w: terrain.width,
      h: terrain.height,
      cell: terrain.cellSizeM,
      binKb,
      buildings: buildings.buildingCount,
      coverage: buildings.coverage,
      minZ: Math.round(terrain.minZ),
      maxZ: Math.round(terrain.maxZ),
      source: b.boundarySource,
    });
    console.log(
      `${tag} — ${terrain.width}x${terrain.height} @${terrain.cellSizeM}m, ${binKb}KB, ` +
        `${buildings.buildingCount} bldg (${buildings.coverage}), z[${Math.round(terrain.minZ)},${Math.round(terrain.maxZ)}]`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push({ code: b.code, nameTh: b.nameTh, error: msg.slice(0, 200) });
    console.error(`${tag} — FAILED: ${msg.slice(0, 200)}`);
  }
}

writeFileSync(path.join(WORK_DIR, "build-report.json"), JSON.stringify({ rows, failures }, null, 2));
console.log(`\n=== built ${rows.length}, failed ${failures.length} ===`);
if (failures.length > 0) console.log(JSON.stringify(failures, null, 2));
