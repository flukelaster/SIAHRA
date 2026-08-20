/**
 * เติม `manifest.provenance` (E9.1) ลง manifest ที่ build ไปแล้ว โดยไม่ต้อง
 * rebuild ชุดข้อมูลทั้ง 5.6 GB ใหม่
 *
 *   npm run refresh:manifests -w apps/etl -- --dry-run
 *   npm run refresh:manifests -w apps/etl
 *   npm run refresh:manifests -w apps/etl -- --dataset-version=2026-08-21
 *
 * ตั้งแต่ E9.2 สคริปต์นี้ยังชี้ `urlTemplate` ของ tile ทุก pyramid ไปที่ prefix
 * ของรุ่น (`/aoi/{code}/v/{ver}/…`) ด้วย และบังคับกฎของ `datasetVersion` ตาม
 * `datasetVersion.ts`: ไม่เดารุ่นจาก `manifest.version` อีกต่อไป และถ้า
 * `builtAt`/`checksums` เปลี่ยนไปจากที่ manifest ประกาศไว้ขณะที่รุ่นยังชื่อเดิม
 * จะหยุดโดยไม่เขียน (`--allow-version-reuse` ข้ามได้ ใช้ได้เฉพาะตอนที่ prefix
 * นั้นยังไม่เคยอัปขึ้น R2)
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
import {
  assertDatasetVersion,
  diffTileContent,
  retargetTileTemplates,
  tileContentSignature,
} from "./datasetVersion.js";

const OUT_ROOT = path.resolve(import.meta.dirname, "../../web/public/aoi");
const TILES_ROOT = path.resolve(import.meta.dirname, "../data/tiles");

const dryRun = process.argv.includes("--dry-run");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;
const versionArg = process.argv.find((a) => a.startsWith("--dataset-version="));
const datasetVersionOverride = versionArg ? versionArg.slice("--dataset-version=".length) : null;
/** ยอมให้ทับรุ่นเดิมทั้งที่เนื้อหาเปลี่ยน — ใช้ได้เฉพาะก่อนที่ prefix นั้นจะถูกอัปขึ้น R2 */
const allowVersionReuse = process.argv.includes("--allow-version-reuse");

if (datasetVersionOverride !== null) assertDatasetVersion(datasetVersionOverride);

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

    // ไม่มี `manifest.version` เป็นตัวสำรองอีกแล้ว (ดูเหตุผลใน datasetVersion.ts):
    // รุ่นคือ prefix ของ URL การเดามันคือการชี้ชุดข้อมูลใหม่ไปที่ prefix เก่า
    const datasetVersion = datasetVersionOverride ?? manifest.provenance?.datasetVersion;
    if (!datasetVersion) {
      throw new Error(
        "manifest ยังไม่มี provenance.datasetVersion — ต้องระบุ --dataset-version=YYYY-MM-DD " +
          "(ไม่หยิบ manifest.version มาใช้แทน: มันขยับทุกครั้งที่ rebuild ชั้นเดียว)",
      );
    }
    assertDatasetVersion(datasetVersion);

    const next = buildAoiProvenance({
      aoiDir: dir,
      tilesDir: existsSync(tilesDir) ? tilesDir : null,
      datasetVersion,
      generatedAt: isoUtc(Date.now()),
      osmPublishedAt,
    });

    // ไบต์ใต้ prefix เปลี่ยนแต่ชื่อรุ่นเท่าเดิม = client ที่แคช immutable ไว้จะได้
    // ของเก่าต่อไปอีกหนึ่งปีโดยแก้ไม่ได้ — หยุดตรงนี้ ไม่เขียนไฟล์
    const delta = diffTileContent(manifest.provenance, next);
    for (const line of delta.removed) console.warn(`  ${code} — เตือน: ${line}`);
    if (delta.changed.length > 0 && manifest.provenance?.datasetVersion === datasetVersion) {
      const detail = delta.changed.join("; ");
      if (!allowVersionReuse) {
        throw new Error(
          `tile ใต้รุ่น ${datasetVersion} เปลี่ยนไปแล้ว (${detail}) — ต้องตั้ง --dataset-version= ` +
            `เป็นรุ่นใหม่ก่อน (หรือ --allow-version-reuse ถ้ารุ่นนี้ยังไม่เคยอัปขึ้น R2)`,
        );
      }
      console.warn(`  ${code} — ทับรุ่น ${datasetVersion} ทั้งที่เนื้อหาเปลี่ยน (${detail}) [--allow-version-reuse]`);
    }

    // urlTemplate ถูกเขียนก่อนเทียบ เพราะมันไม่ได้อยู่ใน provenance — sameContent()
    // มองไม่เห็น ถ้าไม่นับรวมตรงนี้ การรีเฟรชครั้งแรกของ E9.2 จะรายงาน "ไม่เปลี่ยน"
    // แล้วปล่อยให้ manifest ทั้ง 78 ไฟล์ชี้ prefix เดิมอยู่เงียบ ๆ
    const templateChanges = retargetTileTemplates(manifest, datasetVersion);
    const provenanceChanged = !sameContent(manifest.provenance, next);

    if (!provenanceChanged && templateChanges.length === 0) {
      unchanged++;
      console.log(`  ${code} — ไม่เปลี่ยน (${describe(manifest.provenance!)})`);
      continue;
    }
    changed++;
    const what = [
      provenanceChanged ? (manifest.provenance ? "provenance อัปเดต" : "provenance เพิ่ม") : null,
      templateChanges.length > 0 ? `urlTemplate ${templateChanges.length} ชั้น → v/${datasetVersion}` : null,
    ]
      .filter(Boolean)
      .join(" + ");
    console.log(`  ${code} — ${what}: ${describe(next)} [${tileContentSignature(next)}]`);
    if (!dryRun) {
      // generatedAt = "เนื้อหา provenance นี้ถูกเขียนเมื่อไหร่" — ถ้าเปลี่ยนแค่
      // urlTemplate ก็ไม่ใช่การเขียน provenance ใหม่ จึงคงค่าเดิมไว้
      manifest.provenance = provenanceChanged
        ? next
        : { ...next, generatedAt: manifest.provenance?.generatedAt ?? next.generatedAt };
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
