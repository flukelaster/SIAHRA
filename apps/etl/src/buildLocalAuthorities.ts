import { isProvinceCode, type LocalAuthorityRef, type LocalAuthorityType } from "@siahra/shared-types";

export interface RawDlaRecord {
  dla_code: string;
  name_th: string;
  name_en?: string;
  type: string;
  province_code: string;
  district_code?: string;
  lat?: number;
  lon?: number;
  area_km2?: number;
}

export type Coordinate = [number, number];

export interface TopologyQAResult {
  valid: boolean;
  reason?: string;
  vertexCount: number;
  areaApproxKm2?: number;
}

const TYPE_MAP: Record<string, LocalAuthorityType> = {
  "เทศบาลนคร": "city_municipality",
  "เทศบาลเมือง": "town_municipality",
  "เทศบาลตำบล": "subdistrict_municipality",
  "องค์การบริหารส่วนตำบล": "subdistrict_admin_org",
  "อบต.": "subdistrict_admin_org",
  "กรุงเทพมหานคร": "special_admin_area",
  "เมืองพัทยา": "special_admin_area",
  "องค์การบริหารส่วนจังหวัด": "provincial_admin_org",
  "อบจ.": "provincial_admin_org",
};

/**
 * Normalise and validate a raw DLA record into a canonical LocalAuthorityRef.
 */
export function normaliseDlaRecord(raw: RawDlaRecord): LocalAuthorityRef | null {
  if (!raw.dla_code || !raw.name_th || !raw.province_code) {
    return null;
  }

  const provinceCode = raw.province_code.padStart(2, "0");
  if (!isProvinceCode(provinceCode)) {
    return null;
  }

  const type: LocalAuthorityType =
    TYPE_MAP[raw.type] || (raw.type as LocalAuthorityType) || "subdistrict_admin_org";

  const dlaCode = raw.dla_code.trim();
  const id = `TH-LAO-${dlaCode}`;

  return {
    id,
    dlaCode,
    nameTh: raw.name_th.trim(),
    nameEn: raw.name_en?.trim() || raw.name_th.trim(),
    type,
    provinceCode,
    districtCode: raw.district_code?.trim() || `${provinceCode}01`,
    centerLat: typeof raw.lat === "number" && Number.isFinite(raw.lat) ? raw.lat : 0,
    centerLon: typeof raw.lon === "number" && Number.isFinite(raw.lon) ? raw.lon : 0,
    areaKm2: typeof raw.area_km2 === "number" && Number.isFinite(raw.area_km2) ? raw.area_km2 : 0,
  };
}

/**
 * Validate and filter an array of raw DLA records into unique canonical references.
 */
export function validateDlaMasterList(records: readonly RawDlaRecord[]): LocalAuthorityRef[] {
  const result: LocalAuthorityRef[] = [];
  const seen = new Set<string>();

  for (const raw of records) {
    const normalised = normaliseDlaRecord(raw);
    if (!normalised) continue;
    if (seen.has(normalised.id)) continue;

    seen.add(normalised.id);
    result.push(normalised);
  }

  return result.sort((a, b) => a.dlaCode.localeCompare(b.dlaCode));
}

/**
 * Validates topology of a boundary polygon ring.
 */
export function validatePolygonRingTopology(ring: readonly Coordinate[]): TopologyQAResult {
  if (!ring || ring.length < 4) {
    return { valid: false, reason: "Ring must have at least 4 coordinates (3 distinct + closure)", vertexCount: ring ? ring.length : 0 };
  }

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (Math.abs(first[0] - last[0]) > 1e-7 || Math.abs(first[1] - last[1]) > 1e-7) {
    return { valid: false, reason: "Ring is not closed (first != last)", vertexCount: ring.length };
  }

  // Check Thailand bounding box
  for (const [lon, lat] of ring) {
    if (lon < 95.0 || lon > 108.0 || lat < 4.0 || lat > 22.0) {
      return { valid: false, reason: `Coordinate [${lon}, ${lat}] out of Thailand bounding box`, vertexCount: ring.length };
    }
  }

  // Calculate Shoelace formula area
  let doubleArea = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    doubleArea += x1 * y2 - x2 * y1;
  }

  if (Math.abs(doubleArea) < 1e-10) {
    return { valid: false, reason: "Degenerate zero-area polygon", vertexCount: ring.length };
  }

  // Approximate km2 (1 deg ~ 111.32 km at equator)
  const approxKm2 = (Math.abs(doubleArea) / 2) * 111.32 * (111.32 * Math.cos((ring[0][1] * Math.PI) / 180));

  return {
    valid: true,
    vertexCount: ring.length,
    areaApproxKm2: Math.round(approxKm2 * 100) / 100,
  };
}

/**
 * Cleans a polygon ring by removing consecutive duplicates and ensuring proper closure.
 */
export function cleanPolygonRing(ring: readonly Coordinate[]): Coordinate[] {
  if (!ring || ring.length === 0) return [];

  const cleaned: Coordinate[] = [];
  for (let i = 0; i < ring.length; i++) {
    const pt = ring[i];
    if (cleaned.length === 0) {
      cleaned.push(pt);
      continue;
    }
    const prev = cleaned[cleaned.length - 1];
    if (Math.abs(pt[0] - prev[0]) > 1e-7 || Math.abs(pt[1] - prev[1]) > 1e-7) {
      cleaned.push(pt);
    }
  }

  if (cleaned.length >= 3) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.abs(first[0] - last[0]) > 1e-7 || Math.abs(first[1] - last[1]) > 1e-7) {
      cleaned.push([first[0], first[1]]);
    }
  }

  return cleaned;
}
