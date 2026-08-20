#!/usr/bin/env node
/**
 * Building-coverage gate for the shipped AOI dataset (roadmap E8.3).
 *
 * E8.3 deletes `apps/web/public/aoi/{code}/buildings.geojson` for all 77
 * provinces because `buildings.tiles` replaced it. This script is what makes
 * that deletion safe to repeat: it asserts, from the shipped manifests alone,
 * that every province still has a building tile pyramid — and that any AOI
 * *without* one still names a GeoJSON that actually exists on disk.
 *
 * It runs before `npm run deploy:web` (root package.json), so a dataset that
 * lost its building tiles can never be deployed as "no buildings anywhere".
 * Deliberately NOT a CI job: the check is about the dataset in the working
 * tree, and ci.yml is not where dataset invariants belong.
 *
 * Usage:  node scripts/check-building-tiles.mjs [aoiDir]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Thailand has 77 provinces and the dataset ships one directory per province.
 * The count is asserted, not just iterated: a loop over three directories that
 * finds three good manifests would otherwise report "ok" for a dataset that is
 * 74 provinces short — green exactly when it is most wrong.
 */
const EXPECTED_PROVINCES = 77;

const aoiDir = path.resolve(
  process.argv[2] ?? path.join(import.meta.dirname, "../apps/web/public/aoi"),
);
/** `public/` root, so a manifest URL like `/aoi/xx/buildings.geojson` resolves. */
const publicDir = path.resolve(aoiDir, "..");

const failures = [];
const notes = [];

let dirs;
try {
  dirs = readdirSync(aoiDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
} catch (err) {
  console.error(`building tiles: cannot read ${aoiDir}`);
  console.error(String(err));
  process.exit(1);
}

const isProvince = (name) => /^\d{2}$/.test(name);
const provinces = dirs.filter(isProvince);
const legacy = dirs.filter((d) => !isProvince(d));

for (const name of dirs) {
  const manifestPath = path.join(aoiDir, name, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    failures.push(`${name}: cannot read manifest.json — ${String(err)}`);
    continue;
  }

  const buildings = manifest.buildings;
  const tiles = buildings?.tiles;
  const levels = Array.isArray(tiles?.levels) ? tiles.levels : [];

  if (isProvince(name)) {
    if (!buildings) {
      failures.push(`${name}: manifest.buildings is ${buildings === null ? "null" : "missing"}`);
      continue;
    }
    if (!tiles) {
      failures.push(`${name}: no buildings.tiles — its buildings.geojson may not be deleted`);
    } else if (levels.length === 0) {
      failures.push(`${name}: buildings.tiles has no levels`);
    } else if (!tiles.urlTemplate) {
      failures.push(`${name}: buildings.tiles has no urlTemplate — the client cannot request a tile`);
    } else {
      notes.push(
        `  ${name}  ${String(tiles.count ?? 0).padStart(7)} bldg  ` +
          `levels ${levels.map((l) => `z${l.z}:${l.count ?? "?"}`).join(" ")}`,
      );
    }
  } else if (!tiles) {
    // AOI รุ่นเก่า (เช่น chiangmai-old-city) ยังใช้ geojson ก้อนเดียว — ยอมได้
    // ตราบใดที่ไฟล์ที่ manifest อ้างยังมีอยู่จริง นี่คือด่านที่กันไม่ให้ใครลบมัน
    // ตามไปด้วยตอนกวาด buildings.geojson ของจังหวัด
    if (buildings === null) {
      notes.push(`  ${name}  no buildings (manifest.buildings = null)`);
    } else if (!buildings?.url) {
      failures.push(`${name}: legacy AOI with neither buildings.tiles nor buildings.url`);
    } else {
      const file = path.join(publicDir, buildings.url.replace(/^\//, ""));
      if (!existsSync(file) || statSync(file).size === 0) {
        failures.push(`${name}: buildings.url points at ${buildings.url}, which is missing or empty`);
      } else {
        notes.push(`  ${name}  legacy geojson ${(statSync(file).size / 1e6).toFixed(1)} MB`);
      }
    }
  }

  // ไม่ว่าจะ AOI แบบไหน: url ที่ชี้ไปยังไฟล์ที่ไม่มีอยู่จริงคือแหล่งข้อมูลตาย
  if (buildings?.url) {
    const file = path.join(publicDir, buildings.url.replace(/^\//, ""));
    if (!existsSync(file)) {
      failures.push(
        `${name}: manifest still advertises buildings.url ${buildings.url}, but that file does not ship`,
      );
    }
  }
}

console.log(`building tiles — ${aoiDir}`);
for (const n of notes) console.log(n);
console.log(`  ${provinces.length} province AOI(s), ${legacy.length} other AOI(s)`);

if (provinces.length !== EXPECTED_PROVINCES) {
  failures.push(
    `found ${provinces.length} province directories, expected ${EXPECTED_PROVINCES} — ` +
      `the dataset is incomplete, so "every province has building tiles" proves nothing`,
  );
}

if (failures.length > 0) {
  for (const f of failures) console.error(`building tiles FAILED: ${f}`);
  process.exit(1);
}
console.log(`  ok: all ${provinces.length} provinces carry buildings.tiles`);
