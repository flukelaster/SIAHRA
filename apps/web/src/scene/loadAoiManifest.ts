import type { AoiLayerProvenance, AoiManifest, AoiProvenanceLayer } from "@siahra/shared-types";

export class AoiNotBuiltError extends Error {
  constructor(aoiId: string) {
    super(`AOI "${aoiId}" has no generated terrain artifacts`);
    this.name = "AoiNotBuiltError";
  }
}

export async function loadAoiManifest(aoiId: string): Promise<AoiManifest> {
  const res = await fetch(`/aoi/${aoiId}/manifest.json`);
  if (res.status === 404) throw new AoiNotBuiltError(aoiId);
  if (!res.ok) {
    throw new Error(`Failed to load AOI manifest for "${aoiId}": ${res.status}`);
  }
  // A dev server may answer a missing static file with the SPA shell, so
  // confirm we actually parsed a manifest rather than HTML.
  const text = await res.text();
  try {
    return JSON.parse(text) as AoiManifest;
  } catch {
    throw new AoiNotBuiltError(aoiId);
  }
}

/**
 * ผลตรวจ sha256 ของ `terrain.bin` เทียบกับที่ manifest ประกาศไว้ (E9.1)
 *
 * - `verified` = ตรงกับลายเซ็นใน manifest
 * - `mismatch` = **ไม่ตรง** ไฟล์ที่โหลดมาไม่ใช่ไฟล์ที่ไปป์ไลน์สร้าง
 * - `unknown`  = manifest ไม่ได้ประกาศลายเซ็นไว้ หรือเบราว์เซอร์ไม่มี SubtleCrypto
 *
 * `unknown` **ห้ามปิดชั้นข้อมูลใด ๆ** — manifest ส่วนใหญ่ยังไม่มี checksum และ
 * "ยังไม่ได้ตรวจ" ไม่ใช่ "ตรวจแล้วไม่ผ่าน" มีแต่ `mismatch` เท่านั้นที่ปิดชั้น
 * ที่คำนวณจาก DEM (ดู scene/hazardOverlay.ts)
 */
export type TerrainIntegrity = "verified" | "mismatch" | "unknown";

/** ชื่อไฟล์ overview ตามที่ ETL ใส่ไว้ใน `provenance.checksums` */
export const TERRAIN_CHECKSUM_KEY = "terrain.bin";

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * ตรวจลายเซ็นจากบัฟเฟอร์ที่ **โหลดมาอยู่ในหน่วยความจำแล้ว** (ดู TerrainMesh.ts)
 * ห้ามเปิด fetch รอบสองเพื่อการนี้ — จังหวัดละ ~1 MB คูณทุกครั้งที่สลับจังหวัด
 */
export async function verifyTerrainIntegrity(
  manifest: AoiManifest,
  buffer: ArrayBuffer,
): Promise<TerrainIntegrity> {
  const expected = manifest.provenance?.checksums?.[TERRAIN_CHECKSUM_KEY];
  if (!expected) return "unknown";
  const subtle = globalThis.crypto?.subtle;
  // http:// ที่ไม่ใช่ localhost ไม่ใช่ secure context → ไม่มี SubtleCrypto
  // ตรวจไม่ได้ = "unknown" ไม่ใช่ "mismatch" (การกล่าวหาว่าไฟล์เสียทั้งที่ไม่ได้
  // ตรวจ จะปิดชั้นข้อมูลทิ้งโดยไม่มีหลักฐาน)
  if (!subtle) return "unknown";
  try {
    const digest = await subtle.digest("SHA-256", buffer);
    return toHex(digest) === expected.toLowerCase() ? "verified" : "mismatch";
  } catch (err) {
    console.warn("[siahra] terrain checksum could not be computed", err);
    return "unknown";
  }
}

/** ที่มาของชั้นข้อมูลหนึ่งชั้นจาก manifest — undefined เมื่อไม่ได้บันทึกไว้ */
export function layerProvenance(
  manifest: AoiManifest | null,
  layer: AoiProvenanceLayer,
): AoiLayerProvenance | undefined {
  return manifest?.provenance?.sources?.[layer];
}
