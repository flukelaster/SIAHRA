import type { AoiManifest, LocalAuthorityType } from "@siahra/shared-types";
import { extractRings, type Ring } from "./boundaryMask";

/**
 * ขอบเขต อปท. หนึ่งรายการ พร้อมตัวตน (E11.2) — ต่างจาก `loadBoundaryRings` ของ
 * จังหวัด (ที่ทิ้งความเป็นรายชิ้นทิ้งไปโดยตั้งใจ) ชั้นนี้เก็บ id/ชื่อ/ประเภทไว้
 * เพราะงานถัดไปจะต้องเลือกทีละ อปท. ได้
 */
export interface LocalAuthorityFeature {
  id: string;
  nameTh: string;
  type: LocalAuthorityType;
  rings: Ring[];
}

export interface LocalAuthorityGeoJson {
  features?: {
    properties?: { id?: unknown; nameTh?: unknown; type?: unknown };
    geometry: { type: string; coordinates: unknown } | null;
  }[];
}

/** แปลง GeoJSON ดิบเป็นรายการที่มีตัวตน — ทิ้ง feature ที่ property หายหรือไม่มีวง */
export function parseLocalAuthorityFeatures(data: LocalAuthorityGeoJson): LocalAuthorityFeature[] {
  const out: LocalAuthorityFeature[] = [];
  for (const f of data.features ?? []) {
    if (!f.geometry) continue;
    const props = f.properties ?? {};
    if (typeof props.id !== "string" || typeof props.nameTh !== "string" || typeof props.type !== "string") {
      continue;
    }
    const rings = extractRings({ geometry: f.geometry });
    if (rings.length === 0) continue;
    out.push({ id: props.id, nameTh: props.nameTh, type: props.type as LocalAuthorityType, rings });
  }
  return out;
}

/**
 * ดึง `manifest.localAuthorities.url` — คืน `null` เสมอเมื่อจังหวัดนี้ไม่มีชั้นนี้
 * (ไม่มี key ใน manifest, fetch พลาด, หรือ parse ไม่ได้อะไรเลย) ไม่ throw ทั้งฉาก:
 * ชั้นนี้เป็น static-reference เสริมที่ครอบคลุมไม่ครบทุกจังหวัดโดยตั้งใจ (ดู
 * apps/etl/data/sources/osm-admin/COVERAGE.md) การหายไปของมันไม่ใช่ความล้มเหลว
 */
export async function loadLocalAuthorityBoundaries(
  manifest: AoiManifest,
): Promise<LocalAuthorityFeature[] | null> {
  if (!manifest.localAuthorities) return null;
  try {
    const res = await fetch(manifest.localAuthorities.url);
    if (!res.ok) return null;
    const data = (await res.json()) as LocalAuthorityGeoJson;
    const features = parseLocalAuthorityFeatures(data);
    return features.length > 0 ? features : null;
  } catch {
    return null;
  }
}
