/**
 * จังหวัดจาก point-in-polygon + ตัวกันข้อมูลรับรองรั่ว — ใช้ร่วมกันโดยสคริปต์บัญชีกล้อง
 * `build-cctv.ts` (DWR, E15) และ `build-itic-cctv.ts` (iTIC, E15.2)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { booleanPointInPolygon, point as turfPoint } from "@turf/turf";

/**
 * สิ่งที่ห้ามหลุดเข้าไปในไฟล์ผลลัพธ์: `@` (userinfo ของ URL), โดเมน dyndns ของกล้อง,
 * และรูป `scheme://user:pass@` — ชื่อสถานี/กล้องภาษาไทย/อังกฤษไม่มี `@` อยู่แล้ว
 */
export const CREDENTIAL_PATTERN = /@|dyndns|:\/\/[^/]*:[^/]*@/i;

export interface ProvincePolygon {
  code: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

/** อ่าน boundary.geojson ของทุกไดเรกทอรีรหัสจังหวัดสองหลัก (ข้าม AOI สาธิตอย่าง chiangmai-old-city) */
export function loadProvincePolygons(aoiRoot: string): ProvincePolygon[] {
  const out: ProvincePolygon[] = [];
  for (const dir of readdirSync(aoiRoot).sort()) {
    if (!/^\d{2}$/.test(dir)) continue;
    const file = path.join(aoiRoot, dir, "boundary.geojson");
    if (!existsSync(file)) continue;
    const fc = JSON.parse(readFileSync(file, "utf-8")) as GeoJSON.FeatureCollection;
    for (const f of fc.features) {
      const g = f.geometry;
      if (g && (g.type === "Polygon" || g.type === "MultiPolygon")) out.push({ code: dir, geometry: g });
    }
  }
  return out;
}

/** รหัสจังหวัดที่พิกัดนี้ตกอยู่ — null = ไม่ตกในขอบเขตใดเลย (ไม่เดา) */
export function assignProvince(lat: number, lon: number, provinces: readonly ProvincePolygon[]): string | null {
  const pt = turfPoint([lon, lat]);
  for (const p of provinces) {
    if (booleanPointInPolygon(pt, p.geometry)) return p.code;
  }
  return null;
}
