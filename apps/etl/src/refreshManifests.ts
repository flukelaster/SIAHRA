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
 * `builtAt`/`checksums` เปลี่ยนไปจากที่เคยถูกบันทึกไว้ว่าเป็นรุ่นนั้น จะหยุดโดย
 * ไม่เขียน (`--allow-version-reuse` ข้ามได้ ใช้ได้เฉพาะตอนที่ prefix นั้นยังไม่
 * เคยอัปขึ้น R2)
 *
 * "เคยถูกบันทึกไว้ว่าเป็นรุ่นนั้น" ไม่ได้แปลว่าแค่รุ่น**ปัจจุบัน**ของ manifest —
 * `--dataset-version=` ที่ระบุอาจเป็นรุ่นเก่ากว่ารุ่นปัจจุบันของ manifest ก็ได้
 * (พิมพ์ผิด, สคริปต์เก่าค้างอยู่, ความพยายาม rollback ที่พลาด) การ์ดตัวนี้จึงเช็ค
 * กับ `dataset-version-ledger.json` — ประวัติลายเซ็นเนื้อหาของทุกรุ่นที่ AOI แต่
 * ละตัวเคยมี ไม่ใช่แค่รุ่นล่าสุดตัวเดียว (ดูเหตุผลยาว ๆ ที่ `isSafeVersionReuse`
 * ใน `datasetVersion.ts`, review round 6)
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
  isSafeVersionReuse,
  retargetTileTemplates,
  tileContentSignature,
  type VersionSignatureLedger,
} from "./datasetVersion.js";

const OUT_ROOT = path.resolve(import.meta.dirname, "../../web/public/aoi");
const TILES_ROOT = path.resolve(import.meta.dirname, "../data/tiles");
/**
 * ประวัติลายเซ็นเนื้อหาของทุกรุ่นที่ทุก AOI เคยมี (`isSafeVersionReuse` ใน
 * `datasetVersion.ts`) — เก็บเป็นไฟล์เดียว ไม่อยู่ใต้ `data/tiles`/`data/raw`/
 * `data/work` (สามโฟลเดอร์นั้นถูก gitignore เพราะเป็นข้อมูลดิบ/สร้างซ้ำได้) จึง
 * ถูก track ใน git ตามปกติ — ประวัติการปล่อยรุ่นต้องเดินทางไปกับ repo ไม่ใช่อยู่
 * แค่บนเครื่องที่รันครั้งล่าสุด ไม่งั้นคนละเครื่อง/CI จะไม่รู้ว่ารุ่นไหนเคยถูก
 * ปล่อยไปแล้วด้วยเนื้อหาอะไร
 */
const LEDGER_PATH = path.resolve(import.meta.dirname, "../data/dataset-version-ledger.json");

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

// AOI → ประวัติลายเซ็นเนื้อหาของทุกรุ่นที่เคยมี — ไม่มีไฟล์นี้ = ยังไม่เคยรัน
// ฟีเจอร์นี้มาก่อนบนเครื่องนี้ ถือเป็น ledger ว่างแล้วเติมจาก manifest ปัจจุบัน
// ของแต่ละ AOI ระหว่างลูปด้านล่าง (ไม่ใช่ error: การ bootstrap ครั้งแรกต้องไม่
// บล็อกใคร)
const ledger: Record<string, VersionSignatureLedger> = existsSync(LEDGER_PATH)
  ? (JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Record<string, VersionSignatureLedger>)
  : {};

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

    const nextSignature = tileContentSignature(next);
    const codeLedger = (ledger[code] ??= {});
    // Bootstrap: ledger ยังไม่รู้จักรุ่นปัจจุบันของ manifest นี้เลย (ไฟล์ ledger
    // เพิ่งถูกสร้าง หรือ manifest ถูกปล่อยรุ่นนี้มาก่อนฟีเจอร์นี้จะมีอยู่) — เชื่อ
    // manifest.json ว่าคือความจริงล่าสุดสำหรับรุ่นที่มันจำอยู่ (สคริปต์นี้ไม่คุย
    // กับ R2 จริง จึงไม่มีทางยืนยันได้มากกว่านี้) การ bootstrap นี้ทำเสมอ ไม่ว่า
    // รุ่นที่ขอในรอบนี้จะเป็นรุ่นไหน เพื่อให้ ledger สมบูรณ์สำหรับการตรวจครั้งถัดไป
    if (manifest.provenance && codeLedger[manifest.provenance.datasetVersion] === undefined) {
      codeLedger[manifest.provenance.datasetVersion] = tileContentSignature(manifest.provenance);
    }

    // การ์ดหลัก: รุ่นที่ขอ (`datasetVersion`) เคยถูกบันทึกใน ledger ไว้ด้วยลายเซ็น
    // อื่นหรือไม่ — ครอบคลุมทั้งกรณี "รุ่นปัจจุบันของ manifest เปลี่ยนเนื้อหา"
    // (เหมือนการ์ดเดิมก่อน review round 6) และกรณีที่การ์ดเดิมมองไม่เห็น: ขอรุ่น
    // ที่ **เก่ากว่า** รุ่นปัจจุบันของ manifest ซ้ำ ทั้งที่เนื้อหาบนดิสก์ขยับไปแล้ว
    if (!isSafeVersionReuse(codeLedger, datasetVersion, nextSignature)) {
      const recorded = codeLedger[datasetVersion];
      // มีรายละเอียดรายชั้น/checksum ให้ก็ต่อเมื่อ `datasetVersion` คือรุ่นปัจจุบัน
      // ของ manifest จริง ๆ (ledger เก็บแค่ลายเซ็น ไม่เก็บเนื้อหาเต็มของรุ่นเก่า
      // จึงบอกละเอียดกว่านี้ไม่ได้สำหรับรุ่นที่ไม่ใช่รุ่นปัจจุบัน)
      const detail =
        manifest.provenance?.datasetVersion === datasetVersion && delta.changed.length > 0
          ? delta.changed.join("; ")
          : `ลายเซ็นเนื้อหาเดิม ${recorded.slice(0, 12)}… ≠ ใหม่ ${nextSignature.slice(0, 12)}…`;
      if (!allowVersionReuse) {
        throw new Error(
          `รุ่น ${datasetVersion} เคยถูกปล่อยไปแล้วด้วยเนื้อหาอื่น (${detail}) — ห้ามทับไม่ว่าจะเป็นรุ่น` +
            `ปัจจุบันของ manifest หรือรุ่นเก่ากว่านั้นก็ตาม เพราะไฟล์ใต้ prefix นั้นเสิร์ฟแบบ immutable ` +
            `หนึ่งปีไปแล้ว ต้องตั้ง --dataset-version= เป็นรุ่นใหม่ก่อน (หรือ --allow-version-reuse ` +
            `ถ้ารุ่นนี้ยังไม่เคยอัปขึ้น R2)`,
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
      // บันทึกลายเซ็นของสิ่งที่เพิ่งเขียนจริงไว้ใน ledger ทันที ก่อนรุ่นนี้จะถูก
      // ขอเขียนซ้ำในรันครั้งถัดไป (ทั้งของ AOI นี้เองหรือของ AOI อื่นที่ปล่อยรุ่น
      // เดียวกันพร้อมกัน)
      codeLedger[datasetVersion] = nextSignature;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${code}: ${msg.slice(0, 160)}`);
    console.error(`  ${code} — FAILED: ${msg.slice(0, 200)}`);
  }
}

// เขียน ledger กลับลงดิสก์ **ครั้งเดียวหลังลูป** ไม่ใช่ทุกครั้งที่โค้ดข้างบนแก้
// `ledger`/`codeLedger` ในหน่วยความจำ (รวมการ bootstrap ที่เกิดแม้ AOI นั้นจะ
// พังในขั้นตอนถัดมา — ข้อมูลที่ bootstrap มาจาก manifest.json ที่มีอยู่แล้วเป็น
// จริงเสมอไม่ว่ารอบนี้ AOI นั้นจะเขียนสำเร็จหรือไม่) `--dry-run` ต้องไม่มีผลข้าง
// เคียงต่อดิสก์เลย ไม่ต่างจากที่มันไม่เขียน manifest.json
if (!dryRun) {
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n");
}

console.log(
  `\n=== ${dryRun ? "dry-run: " : ""}${changed} manifest ${dryRun ? "จะถูกเขียน" : "ถูกเขียน"}, ` +
    `${unchanged} ไม่เปลี่ยน, ล้มเหลว ${failures.length} ===`,
);
if (failures.length > 0) console.log(failures.join("\n"));
if (failures.length > 0) process.exitCode = 1;
