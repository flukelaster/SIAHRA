/**
 * เติม `manifest.provenance` (E9.1) ลง manifest ที่ build ไปแล้ว โดยไม่ต้อง
 * rebuild ชุดข้อมูลทั้ง 5.6 GB ใหม่
 *
 *   npm run refresh:manifests -w apps/etl -- --dry-run
 *   npm run refresh:manifests -w apps/etl
 *
 * ที่มาของ `builtAt` แต่ละชั้นคือ mtime ล่าสุดของโฟลเดอร์ tile ใน
 * `apps/etl/data/tiles/{code}/{layer}/` เท่านั้น (ดูเหตุผลยาว ๆ ในหัวไฟล์
 * `provenance.ts`) เครื่องที่ไม่ได้ symlink ชุดข้อมูลจะไม่มีโฟลเดอร์นั้น →
 * ชั้นนั้นไม่มี entry และฝั่ง web แสดงว่า "ไม่ได้บันทึกเวลาที่ดึงข้อมูล"
 *
 * **idempotent**: ถ้า provenance ที่คำนวณได้เท่าของเดิมทุกฟิลด์ยกเว้น
 * `generatedAt` จะไม่เขียนไฟล์และคง `generatedAt` เดิมไว้ — `generatedAt` คือ
 * "เวลาที่เนื้อหานี้ถูกเขียน" การเลื่อนมันทั้งที่เนื้อหาไม่เปลี่ยนคือการรายงาน
 * งานที่ไม่ได้เกิดขึ้น
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AoiManifest, AoiProvenance } from "@siahra/shared-types";
import { buildAoiProvenance, isoUtc, readOsmPublishedAt } from "./provenance.js";

const OUT_ROOT = path.resolve(import.meta.dirname, "../../web/public/aoi");
const TILES_ROOT = path.resolve(import.meta.dirname, "../data/tiles");

const dryRun = process.argv.includes("--dry-run");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;
const versionArg = process.argv.find((a) => a.startsWith("--dataset-version="));
const datasetVersionOverride = versionArg ? versionArg.slice("--dataset-version=".length) : null;

/** เทียบทุกฟิลด์ยกเว้น `generatedAt` — ใช้ตัดสินว่า "มีอะไรเปลี่ยนจริงไหม" */
function sameContent(a: AoiProvenance | undefined, b: AoiProvenance): boolean {
  if (!a) return false;
  const strip = (p: AoiProvenance) => JSON.stringify({ ...p, generatedAt: "" });
  return strip(a) === strip(b);
}

function describe(p: AoiProvenance): string {
  const layers = Object.entries(p.sources)
    .map(([k, v]) => `${k}=${v.builtAt.slice(0, 10)}${v.publishedAt ? `(pub ${v.publishedAt.slice(0, 10)})` : ""}`)
    .join(" ");
  const sums = Object.keys(p.checksums).length;
  return `v${p.datasetVersion} · ${layers || "ไม่มีชั้นใดมี artefact"} · checksum ${sums} ไฟล์`;
}

if (!existsSync(TILES_ROOT)) {
  console.warn(
    `[refresh] ไม่พบ ${TILES_ROOT} — เครื่องนี้ไม่มีชุด tile จึงไม่มีเวลา build ของชั้นใดเลย ` +
      `provenance ที่ได้จะมีแต่ datasetVersion/generatedAt/checksums (ตั้งใจ ไม่ใช่ข้อผิดพลาด)`,
  );
}

// เวลาเผยแพร่ที่ต้นทาง OSM ประกาศไว้เอง — อ่านจากหัวไฟล์ pbf ตอนรัน ไม่มีไฟล์
// (หรือไม่มี osmium) = null แล้วฟิลด์ publishedAt จะหายไป ไม่ใช่ถูกเดา
//
// สคริปต์นี้ **ไม่ดาวน์โหลด** extract เอง (ต่างจากเส้นทาง build): งานนี้คือการเติม
// ข้อมูลลง manifest ที่มีอยู่แล้ว การลาก 500 MB ลงมาเพื่ออ่าน timestamp บรรทัดเดียว
// ไม่คุ้ม และเครื่องที่ไม่มีไฟล์นี้ก็ควรได้ผลลัพธ์ "ไม่มี publishedAt" อย่างซื่อสัตย์
const OSM_PBF = path.resolve(import.meta.dirname, "../data/raw/thailand-latest.osm.pbf");
const osmPublishedAt = existsSync(OSM_PBF) ? await readOsmPublishedAt(OSM_PBF) : null;
console.log(`[refresh] OSM publishedAt = ${osmPublishedAt ?? "ไม่มี (จะไม่เขียนฟิลด์นี้)"}`);

const codes = readdirSync(OUT_ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(path.join(OUT_ROOT, d.name, "manifest.json")))
  .map((d) => d.name)
  .filter((code) => !only || only.includes(code))
  .sort();

let changed = 0;
let unchanged = 0;
const failures: string[] = [];

for (const code of codes) {
  const dir = path.join(OUT_ROOT, code);
  const manifestPath = path.join(dir, "manifest.json");
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as AoiManifest;
    const tilesDir = path.join(TILES_ROOT, code);
    const next = buildAoiProvenance({
      aoiDir: dir,
      tilesDir: existsSync(tilesDir) ? tilesDir : null,
      datasetVersion:
        datasetVersionOverride ?? manifest.provenance?.datasetVersion ?? manifest.version,
      generatedAt: isoUtc(Date.now()),
      osmPublishedAt,
    });

    if (sameContent(manifest.provenance, next)) {
      unchanged++;
      console.log(`  ${code} — ไม่เปลี่ยน (${describe(manifest.provenance!)})`);
      continue;
    }
    changed++;
    console.log(`  ${code} — ${manifest.provenance ? "อัปเดต" : "เพิ่ม"}: ${describe(next)}`);
    if (!dryRun) {
      manifest.provenance = next;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${code}: ${msg.slice(0, 160)}`);
    console.error(`  ${code} — FAILED: ${msg.slice(0, 200)}`);
  }
}

console.log(
  `\n=== ${dryRun ? "dry-run: " : ""}${changed} manifest ${dryRun ? "จะถูกเขียน" : "ถูกเขียน"}, ` +
    `${unchanged} ไม่เปลี่ยน, ล้มเหลว ${failures.length} ===`,
);
if (failures.length > 0) console.log(failures.join("\n"));
if (failures.length > 0) process.exitCode = 1;
