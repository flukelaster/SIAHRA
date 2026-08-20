/**
 * รุ่นของชุดข้อมูล (`provenance.datasetVersion`) และ prefix ของ tile URL ที่ผูก
 * กับมัน (E9.2)
 *
 * ## กฎ: อะไรทำให้ `datasetVersion` เปลี่ยน
 *
 * `datasetVersion` เป็น **รหัสรุ่นที่คนตั้งเอง** ตอนปล่อยชุดข้อมูล รูปแบบ
 * `YYYY-MM-DD` (เติม `.N` ได้เมื่อปล่อยมากกว่าหนึ่งครั้งในวันเดียว) และมันคือ
 * segment `v/{ver}` ใน URL ของ tile ทุกไฟล์ กฎมีข้อเดียว:
 *
 * > **ไบต์ใต้ `aoi/{code}/v/{ver}/` เปลี่ยนเมื่อไหร่ `{ver}` ต้องเปลี่ยนด้วย**
 *
 * เหตุผล: tile ทุกไฟล์ถูกส่งด้วย `Cache-Control: immutable, max-age=1y` การตอบ
 * ผิดหนึ่งครั้งจึงแก้ไม่ได้อีกหนึ่งปี — prefix ที่ยังเดิมทั้งที่ rebuild ชั้นใด
 * ชั้นหนึ่งไปแล้ว คือความล้มเหลวที่งานนี้ออกแบบมากันโดยตรง
 *
 * ก่อนหน้านี้ค่านี้ derive มาจาก `manifest.version` ได้ ซึ่งใช้ไม่ได้กับ URL:
 * สคริปต์ tile รายชั้นเขียน `manifest.version` เป็นวันที่ปัจจุบันทุกครั้งที่
 * rebuild ชั้นเดียว แต่ `refresh:manifests` ไม่ลาก `datasetVersion` ตาม (ลำดับ
 * เดิมคือ `--dataset-version=` → ของเดิม → `manifest.version` ซึ่งข้อสุดท้าย
 * ทำงานเฉพาะครั้งแรก) ผลคือ prefix นิ่งอยู่กับที่ขณะที่ไบต์ข้างใต้เปลี่ยนไปแล้ว
 *
 * จึงบังคับสองอย่างแทน:
 *
 * 1. **ไม่เดารุ่นอีกต่อไป** — `refresh:manifests` เอาค่าจาก `--dataset-version=`
 *    หรือค่าเดิมใน manifest เท่านั้น ไม่มีทั้งสองอย่าง = error ไม่ใช่หยิบ
 *    `manifest.version` มาใช้
 * 2. **ห้ามใช้รุ่นเดิมซ้ำเมื่อเนื้อหาเปลี่ยน** — `diffTileContent()` เทียบ
 *    `builtAt` รายชั้นกับ `checksums` ของ manifest เดิมกับที่คำนวณได้ใหม่ ถ้ามี
 *    อะไรเปลี่ยนหรือเพิ่ม แต่รุ่นยังชื่อเดิม สคริปต์จะหยุดโดยไม่เขียนไฟล์ และ
 *    บอกให้ตั้ง `--dataset-version=` ใหม่
 *
 * (ดู docs/dataset.md §7 สำหรับนโยบายเก็บ prefix เก่าและขั้นตอนปล่อยรุ่น)
 */
import { createHash } from "node:crypto";
import type { AoiManifest, AoiProvenance, AoiProvenanceLayer } from "@siahra/shared-types";

/**
 * รูปแบบรหัสรุ่น — ต้องตรงกับ `VERSION` ใน `apps/web/worker/tilePath.ts`
 * รุ่นที่ฝั่งนั้นไม่รับ = URL ที่ Worker เสิร์ฟไม่ได้ (404 ทั้ง prefix)
 */
export const DATASET_VERSION_RE = /^\d{4}-\d{2}-\d{2}(?:\.\d{1,3})?$/;

export function assertDatasetVersion(version: string): string {
  if (!DATASET_VERSION_RE.test(version)) {
    throw new Error(
      `datasetVersion "${version}" ผิดรูปแบบ — ต้องเป็น YYYY-MM-DD หรือ YYYY-MM-DD.N ` +
        `(รูปแบบเดียวกับที่ apps/web/worker/tilePath.ts ยอมรับ)`,
    );
  }
  return version;
}

/** ชั้นที่มี tile pyramid จริง (คนละชุดกับ AoiProvenanceLayer: roads/water รวมเป็น features) */
export const TILE_PYRAMID_LAYERS = ["terrain", "buildings", "features", "landcover"] as const;
export type TilePyramidLayer = (typeof TILE_PYRAMID_LAYERS)[number];

/**
 * รหัส AOI ที่ `apps/web/worker/tilePath.ts` เสิร์ฟได้ — สองหลักเท่านั้น
 *
 * AOI สาธิต (`buildAoi.ts` เช่น `chiangmai-old-city`) ไม่เข้าเงื่อนไขนี้ วันนี้มัน
 * ไม่มี tile pyramid เลยจึงไม่มีอะไรให้เสิร์ฟ แต่ถ้าวันหนึ่งมันมีขึ้นมา การเขียน
 * prefix แบบมีรุ่นให้มันคือการชี้ client ไปที่ URL ที่ Worker ไม่รู้จัก = 404 ทุก
 * ไทล์บน prod ขณะที่ dev (ซึ่งอ่านจากดิสก์) ยังเขียวอยู่
 */
const WORKER_SERVED_AOI_ID = /^\d{2}$/;

/** `/aoi/{code}/v/{ver}` — prefix ของ tile ทุกไฟล์ในรุ่นนั้น */
export function versionedTilePrefix(aoiId: string, version: string): string {
  return `/aoi/${aoiId}/v/${assertDatasetVersion(version)}`;
}

export function tileUrlTemplate(aoiId: string, version: string, layer: TilePyramidLayer): string {
  return `${versionedTilePrefix(aoiId, version)}/${layer}/{z}/{x}_{y}.bin`;
}

export interface TemplateChange {
  layer: TilePyramidLayer;
  from: string;
  to: string;
}

/**
 * ชี้ `urlTemplate` ของทุก pyramid ใน manifest ไปที่ prefix ของรุ่นที่ระบุ
 * (เขียนทับใน object ที่ส่งเข้ามา) คืนรายการที่เปลี่ยนจริง — ว่าง = ตรงอยู่แล้ว
 *
 * เส้นทาง build (`build:tiles`, `build:feature-tiles`, …) ยังเขียน prefix แบบ
 * เดิมอยู่ เพราะที่นั่นไม่รู้รหัสรุ่นที่ถูกต้อง (เหตุผลเดียวกับที่ E9.1 ไม่ให้มัน
 * เติม provenance) — `refresh:manifests --dataset-version=` คือขั้นที่เปลี่ยนให้
 * ระหว่างนั้น manifest ชี้ prefix เดิมซึ่งยังเสิร์ฟได้ตลอดไป จึงไม่มีช่วงพัง
 */
export function retargetTileTemplates(manifest: AoiManifest, version: string): TemplateChange[] {
  const pyramids: Partial<Record<TilePyramidLayer, { urlTemplate: string } | undefined>> = {
    terrain: manifest.terrain?.tiles,
    buildings: manifest.buildings?.tiles,
    features: manifest.features,
    landcover: manifest.landcover,
  };

  if (!WORKER_SERVED_AOI_ID.test(manifest.aoiId)) {
    if (TILE_PYRAMID_LAYERS.some((l) => pyramids[l])) {
      console.warn(
        `[datasetVersion] ${manifest.aoiId}: คง urlTemplate ไว้ที่ prefix เดิม — ` +
          `apps/web/worker/tilePath.ts เสิร์ฟเฉพาะรหัสจังหวัดสองหลัก prefix แบบมีรุ่นของ AOI นี้จะ 404 บน prod`,
      );
    }
    return [];
  }

  const changes: TemplateChange[] = [];
  for (const layer of TILE_PYRAMID_LAYERS) {
    const pyramid = pyramids[layer];
    if (!pyramid) continue;
    const to = tileUrlTemplate(manifest.aoiId, version, layer);
    if (pyramid.urlTemplate === to) continue;
    changes.push({ layer, from: pyramid.urlTemplate, to });
    pyramid.urlTemplate = to;
  }
  return changes;
}

export interface TileContentDelta {
  /** เนื้อหาเปลี่ยนหรือเพิ่ม — ห้ามอยู่ใต้รุ่นเดิม */
  changed: string[];
  /**
   * หายไปจากที่เคยประกาศ — เกือบทุกครั้งแปลว่า "เครื่องนี้ไม่มีโฟลเดอร์ tile"
   * (clone ใหม่ / CI) ไม่ใช่ไบต์เปลี่ยน จึงไม่บล็อก แต่ต้องพูดออกมาให้เห็น
   */
  removed: string[];
}

function builtAtOf(p: AoiProvenance | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [layer, entry] of Object.entries(p?.sources ?? {})) {
    if (entry?.builtAt) out[layer as AoiProvenanceLayer] = entry.builtAt;
  }
  return out;
}

/**
 * เทียบ "เนื้อหาที่อยู่ใต้ prefix" ของ provenance สองก้อน — ดูเฉพาะ `builtAt`
 * รายชั้นกับ `checksums` เท่านั้น
 *
 * จงใจไม่เทียบทั้งก้อน: `publishedAt` มี/ไม่มีตามว่าเครื่องนั้นมี osmium และไฟล์
 * pbf ไหม และ `generatedAt` ขยับทุกครั้งที่เขียน — สองอย่างนี้ไม่ได้แปลว่า tile
 * เปลี่ยน การเอามาคิดด้วยจะทำให้ guard เตือนผิดบนเครื่องที่ไม่มี extract
 */
export function diffTileContent(prev: AoiProvenance | undefined, next: AoiProvenance): TileContentDelta {
  const delta: TileContentDelta = { changed: [], removed: [] };
  if (!prev) return delta;

  const before = builtAtOf(prev);
  const after = builtAtOf(next);
  for (const layer of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!after[layer]) delta.removed.push(`${layer}: ไม่มีโฟลเดอร์ tile บนเครื่องนี้ (เคยเป็น ${before[layer]})`);
    else if (!before[layer]) delta.changed.push(`${layer}: builtAt เพิ่มเข้ามา = ${after[layer]}`);
    else if (before[layer] !== after[layer]) delta.changed.push(`${layer}: builtAt ${before[layer]} → ${after[layer]}`);
  }

  for (const file of new Set([...Object.keys(prev.checksums), ...Object.keys(next.checksums)])) {
    const a = prev.checksums[file];
    const b = next.checksums[file];
    if (!b) delta.removed.push(`checksums[${file}]: ไฟล์หายไปจากโฟลเดอร์ AOI`);
    else if (!a) delta.changed.push(`checksums[${file}]: เพิ่มเข้ามา`);
    else if (a !== b) delta.changed.push(`checksums[${file}]: ${a.slice(0, 8)}… → ${b.slice(0, 8)}…`);
  }
  return delta;
}

/** ลายเซ็นสั้น ๆ ของเนื้อหาใต้ prefix — ใช้ในบรรทัด log เท่านั้น ไม่ใช่ตัวตัดสิน */
export function tileContentSignature(p: AoiProvenance): string {
  const payload = JSON.stringify([
    Object.entries(builtAtOf(p)).sort(),
    Object.entries(p.checksums).sort(),
  ]);
  return createHash("sha256").update(payload).digest("hex").slice(0, 12);
}
