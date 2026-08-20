/**
 * ที่มาของชุดข้อมูลรายชั้น (E9.1) — โมดูลเดียวที่ทั้งสองเส้นทางเขียน manifest ใช้
 * ร่วมกัน (`writeManifest.ts` / `buildAllProvinces.ts` ตอน build และ
 * `refreshManifests.ts` ตอนเติมย้อนหลัง) เพื่อไม่ให้สองทางค่อย ๆ ต่างกัน
 *
 * ## กฎความซื่อสัตย์ที่ไฟล์นี้เป็นคนบังคับ
 *
 * 1. **ห้ามใช้ mtime ของไฟล์ใน `apps/web/public/aoi/**` เป็นเวลา build**
 *    โฟลเดอร์นั้นถูก track ใน git ทุกไฟล์จึงมี mtime เท่ากับตอน `git checkout`
 *    ไม่ใช่ตอนสร้าง artefact — เขียนลง manifest คือการ ship เวลาที่แต่งขึ้น
 *    เวลาจริงอยู่ที่ tile pyramid ใน `apps/etl/data/tiles/{code}/{layer}/`
 *    ซึ่งไม่ถูก track และ checkout ไม่แตะ
 *
 * 2. **ไม่มี artefact = ไม่มี entry** เครื่องที่ไม่ได้ symlink ชุดข้อมูล 5.6 GB
 *    จะไม่มีโฟลเดอร์ tile เลย ชั้นนั้นต้องหายไปทั้ง entry ห้ามแทนด้วย
 *    `generatedAt`, `manifest.version` หรือเวลาปัจจุบัน — ฝั่ง web จะแสดงว่า
 *    "ไม่ได้บันทึกเวลาที่ดึงข้อมูล" ซึ่งตรงกับความจริง
 *
 * 3. **`publishedAt` มีเฉพาะแหล่งที่ประกาศเวลาไว้เอง** ตอนนี้มีแหล่งเดียวคือ OSM
 *    (`osmosis_replication_timestamp` ในหัวไฟล์ pbf) และต้องอ่านจากหัวไฟล์
 *    ตอนรันเสมอ ห้าม hardcode: extract รุ่นถัดไปจะทำให้ค่าที่ฝังไว้ผิดเงียบ ๆ
 *    WorldCover กับ Copernicus DEM บอกแค่ "ยุค" ของผลิตภัณฑ์ จึงไม่มีฟิลด์นี้
 *
 * 4. **`hillshade.png`, `boundary.geojson` ไม่มี provenance** — ถูก track เหมือน
 *    กัน เวลาสร้างจริงหายไปแล้ว ส่วน `terrain.bin` (overview) ยืม builtAt ของ
 *    โฟลเดอร์ tile ภูมิประเทศได้ เพราะออกมาจาก build run เดียวกัน (ดู
 *    `TERRAIN_OVERVIEW_NOTE` ด้านล่าง) — แต่ค่านั้นคือเวลาของ **run** ไม่ใช่
 *    timestamp ของตัวไฟล์ overview
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { AoiLayerProvenance, AoiProvenance, AoiProvenanceLayer, SourceId } from "@siahra/shared-types";

/**
 * โฟลเดอร์ tile ที่เป็น artefact ของแต่ละชั้น (roads กับ water มาจาก build
 * เดียวกันคือ `features` จึงชี้ที่เดียวกัน — เป็นความจริง ไม่ใช่การยืมเวลา)
 */
export const LAYER_TILE_DIR: Record<AoiProvenanceLayer, string> = {
  terrain: "terrain",
  roads: "features",
  water: "features",
  buildings: "buildings",
  trees: "landcover",
};

/** แหล่งข้อมูลต้นทางของแต่ละชั้น — ผูกกับทะเบียนกลาง `SOURCES` ผ่านชนิด */
export const LAYER_SOURCE_IDS: Record<AoiProvenanceLayer, SourceId[]> = {
  terrain: ["copernicus-dem"],
  roads: ["osm"],
  water: ["osm"],
  buildings: ["osm"],
  trees: ["worldcover"],
};

/** ชั้นที่ `publishedAt` ของ OSM extract ใช้ได้จริง */
const OSM_LAYERS: readonly AoiProvenanceLayer[] = ["roads", "water", "buildings"];

export const PROVENANCE_LAYERS = Object.keys(LAYER_TILE_DIR) as AoiProvenanceLayer[];

/**
 * `terrain.bin` เป็น overview ที่ถูก track ใน git จึงไม่มี mtime จริงเหลืออยู่
 * builtAt ของชั้น terrain ที่ manifest ประกาศ = เวลาของ **build run** ที่ผลิต
 * tile pyramid ชุดนั้น ไม่ใช่ timestamp ของไฟล์ overview เอง
 */
export const TERRAIN_OVERVIEW_NOTE =
  "terrain.builtAt = build run ของ tile pyramid (terrain.bin ถูก track จึงไม่มี mtime จริง)";

/** ไฟล์ใน AOI ที่คำนวณ sha256 ให้ — ฝั่ง web ตรวจ `terrain.bin` ก้อนเดียว */
export const CHECKSUM_FILES = ["terrain.bin"];

/** mtime ล่าสุดในต้นไม้โฟลเดอร์ (ms) หรือ null เมื่อโฟลเดอร์ไม่มี/ว่าง */
export function newestMtimeMs(dir: string): number | null {
  if (!existsSync(dir)) return null;
  let newest: number | null = null;
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) {
        const ms = statSync(p).mtimeMs;
        if (newest === null || ms > newest) newest = ms;
      }
    }
  };
  walk(dir);
  return newest;
}

/** ตัดเศษมิลลิวินาทีทิ้งเพื่อให้ค่าที่เขียนซ้ำแล้วเท่าเดิมทุกครั้ง (idempotent) */
export function isoUtc(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString();
}

export function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * อ่าน `osmosis_replication_timestamp` จากหัวไฟล์ pbf ด้วย `osmium fileinfo -j`
 *
 * เป็น async แยกออกมาต่างหากโดยตั้งใจ: `buildAoiProvenance` ต้องเป็น sync และ
 * ต้องรันได้บนเครื่องที่ไม่มี osmium และไม่มีไฟล์ pbf (เช่น CI) — ที่นั่นค่าจะเป็น
 * null และฟิลด์ `publishedAt` จะหายไป ซึ่งถูกต้องกว่าการเดา
 */
export async function readOsmPublishedAt(pbfPath: string | null | undefined): Promise<string | null> {
  if (!pbfPath || !existsSync(pbfPath)) return null;
  try {
    const { stdout } = await execa("osmium", ["fileinfo", "-j", pbfPath]);
    const info = JSON.parse(stdout) as { header?: { option?: Record<string, string> } };
    const raw = info.header?.option?.osmosis_replication_timestamp;
    if (!raw) return null;
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) return null;
    return isoUtc(ms);
  } catch (err) {
    // ไม่กลืนเงียบ ๆ: บอกว่าอ่านไม่ได้แล้วปล่อยให้ฟิลด์หายไป ห้ามเดาเป็นวันอื่น
    console.warn(`[provenance] อ่าน osmosis_replication_timestamp ไม่ได้: ${String(err).slice(0, 160)}`);
    return null;
  }
}

export interface ProvenanceInput {
  /** โฟลเดอร์ AOI ที่ ship จริง (ใช้คำนวณ checksum เท่านั้น ไม่ใช้ mtime) */
  aoiDir: string;
  /** `apps/etl/data/tiles/{code}` — null เมื่อเครื่องนี้ไม่มีชุด tile */
  tilesDir: string | null;
  datasetVersion: string;
  /** เวลาที่เขียน manifest — ค่าเริ่มต้นคือตอนนี้ */
  generatedAt?: string;
  /** จาก `readOsmPublishedAt()` — null = ต้นทางไม่ได้บอก/อ่านไม่ได้ */
  osmPublishedAt?: string | null;
  /**
   * เวลาที่ artefact ถูกผลิต "ตอนนี้" จากเส้นทาง build — ใช้แทน mtime ของ
   * โฟลเดอร์ tile สำหรับชั้นที่เพิ่งสร้างเสร็จในรันนั้น
   */
  builtAt?: Partial<Record<AoiProvenanceLayer, string>>;
}

/**
 * ประกอบ `AoiProvenance` — sync ล้วน ไม่แตะเครือข่ายและไม่ spawn process
 *
 * ลำดับที่มาของ `builtAt`: ค่าที่เส้นทาง build ส่งเข้ามา → mtime ล่าสุดของ
 * โฟลเดอร์ tile ของชั้นนั้น → **ไม่มี entry**
 */
export function buildAoiProvenance(input: ProvenanceInput): AoiProvenance {
  const { aoiDir, tilesDir, datasetVersion, osmPublishedAt } = input;
  const generatedAt = input.generatedAt ?? isoUtc(Date.now());

  const sources: Partial<Record<AoiProvenanceLayer, AoiLayerProvenance>> = {};
  for (const layer of PROVENANCE_LAYERS) {
    const override = input.builtAt?.[layer];
    const dir = tilesDir ? path.join(tilesDir, LAYER_TILE_DIR[layer]) : null;
    const mtime = override ? null : dir ? newestMtimeMs(dir) : null;
    const builtAt = override ?? (mtime === null ? null : isoUtc(mtime));
    // ไม่รู้เวลา = ไม่เขียน entry (ห้าม fallback เป็น generatedAt/version/now)
    if (!builtAt) continue;
    const entry: AoiLayerProvenance = { builtAt, sourceIds: [...LAYER_SOURCE_IDS[layer]] };
    if (osmPublishedAt && OSM_LAYERS.includes(layer)) entry.publishedAt = osmPublishedAt;
    sources[layer] = entry;
  }

  return { datasetVersion, generatedAt, sources, checksums: checksumsFor(aoiDir) };
}

/**
 * sha256 ของไฟล์ที่ ship จริงในโฟลเดอร์ AOI — ไฟล์ที่ไม่มีจะไม่มีคีย์ (ไม่ใช่
 * hash ของสตริงว่าง ซึ่งจะกลายเป็น "mismatch" ปลอมทันทีที่ไฟล์กลับมา)
 */
export function checksumsFor(aoiDir: string): Record<string, string> {
  const checksums: Record<string, string> = {};
  for (const name of CHECKSUM_FILES) {
    const file = path.join(aoiDir, name);
    if (existsSync(file)) checksums[name] = sha256File(file);
  }
  return checksums;
}

/**
 * อัปเดต `builtAt` ของชั้นที่เพิ่ง rebuild เสร็จ โดยไม่แตะชั้นอื่น
 *
 * สคริปต์ tile รายชั้น (`buildTerrainTiles`, `buildBuildingTiles`,
 * `buildFeatureTiles`, `buildLandcoverTiles`) เขียน manifest ทับหลัง build —
 * ถ้าไม่เรียกอันนี้ manifest จะยังประกาศเวลาเก่าของชั้นที่เพิ่งสร้างใหม่
 * manifest ที่ยังไม่มี provenance จะถูกปล่อยไว้เหมือนเดิม (ให้ `refresh:manifests`
 * เป็นคนเติมทีเดียว) เพราะที่นี่ไม่รู้ค่า checksum/datasetVersion ที่ถูกต้อง
 */
export function touchLayerProvenance(
  provenance: AoiProvenance | undefined,
  layers: readonly AoiProvenanceLayer[],
  builtAt: string,
  aoiDir: string,
): AoiProvenance | undefined {
  if (!provenance) return provenance;
  const sources = { ...provenance.sources };
  for (const layer of layers) {
    sources[layer] = {
      ...(sources[layer] ?? { sourceIds: [...LAYER_SOURCE_IDS[layer]] }),
      builtAt,
      sourceIds: sources[layer]?.sourceIds ?? [...LAYER_SOURCE_IDS[layer]],
    };
  }
  // คำนวณ checksum ใหม่จากไฟล์ที่ ship อยู่ ณ ตอนนี้เสมอ ไม่ใช่หิ้วค่าเก่ามาต่อ:
  // วันไหนที่สคริปต์ tile เผลอเขียน `terrain.bin` ทับ ลายเซ็นเก่าจะกลายเป็น
  // "mismatch" ที่ผิด แล้วชั้นพื้นที่ลุ่มต่ำจะถูกปิดทั้งที่ build ถูกต้อง — คือ
  // ความผิดพลาดชนิดเดียวกับที่งานนี้ตั้งใจจะกันไว้ แค่มาจากอีกทาง
  return {
    ...provenance,
    sources,
    checksums: checksumsFor(aoiDir),
    generatedAt: isoUtc(Date.now()),
  };
}
