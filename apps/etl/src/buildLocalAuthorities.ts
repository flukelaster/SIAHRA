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
