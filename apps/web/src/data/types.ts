export interface Province {
  code: string;
  nameTh: string;
  nameEn: string;
}

/**
 * Terrain is generated per province by apps/etl, keyed by province code,
 * so the AOI id is simply the province code. If a province's artifacts are
 * missing the map surfaces that state rather than falling back to another
 * province's terrain.
 */
export function aoiIdForProvince(provinceCode: string): string {
  return provinceCode;
}
