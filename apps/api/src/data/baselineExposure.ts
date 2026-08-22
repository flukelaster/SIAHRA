import type { LocalAuthorityBaselineExposure } from "@siahra/shared-types";

/**
 * Curated Baseline Exposure for Canonical Local Authorities (WorldPop 100m + OSM).
 */
export const BASELINE_EXPOSURE_RECORDS: readonly LocalAuthorityBaselineExposure[] = [
  {
    localAuthorityId: "TH-LAO-100000",
    dlaCode: "100000",
    provinceCode: "10",
    nameTh: "กรุงเทพมหานคร",
    nameEn: "Bangkok Metropolitan Administration",
    populationTotal: 5588222,
    populationVulnerable: 1420000,
    populationSource: "WorldPop-2020-UNadj",
    buildingsTotal: 1850000,
    buildingFootprintAreaM2: 245000000,
    buildingSource: "OSM",
    roadsTotalKm: 5200.5,
    roadsPrimaryKm: 450.2,
    roadsSecondaryKm: 850.3,
    roadsLocalKm: 3900.0,
    criticalFacilities: {
      hospitals: 142,
      schools: 850,
      governmentOffices: 320,
      emergencyStations: 48,
    },
    facilityList: [
      { id: "fac-10-01", name: "โรงพยาบาลศิริราช", type: "hospital", lat: 13.7588, lon: 100.4853, isExposed: false },
      { id: "fac-10-02", name: "โรงพยาบาลจุฬาลงกรณ์", type: "hospital", lat: 13.7314, lon: 100.5342, isExposed: false },
      { id: "fac-10-03", name: "สถานีดับเพลิงและกู้ภัยพญาไท", type: "emergency", lat: 13.7652, lon: 100.5375, isExposed: false },
    ],
    computedAt: "2026-08-20T00:00:00Z",
    descriptor: {
      id: "baseline-exposure",
      epistemicClass: "static-reference",
      liveOrStatic: "static",
      publishedAt: "2020-01-01T00:00:00Z",
      fetchedAt: "2026-08-20T00:00:00Z",
      sourceIds: ["worldpop", "osm"],
    },
  },
  {
    localAuthorityId: "TH-LAO-901101",
    dlaCode: "901101",
    provinceCode: "90",
    nameTh: "เทศบาลนครหาดใหญ่",
    nameEn: "Hat Yai City Municipality",
    populationTotal: 156808,
    populationVulnerable: 38500,
    populationSource: "WorldPop-2020-UNadj",
    buildingsTotal: 42350,
    buildingFootprintAreaM2: 5820000,
    buildingSource: "OSM",
    roadsTotalKm: 215.4,
    roadsPrimaryKm: 28.5,
    roadsSecondaryKm: 42.1,
    roadsLocalKm: 144.8,
    criticalFacilities: {
      hospitals: 5,
      schools: 38,
      governmentOffices: 18,
      emergencyStations: 4,
    },
    facilityList: [
      { id: "fac-90-01", name: "โรงพยาบาลหาดใหญ่", type: "hospital", lat: 7.0142, lon: 100.4795, isExposed: false },
      { id: "fac-90-02", name: "โรงพยาบาลสงขลานครินทร์ (ม.อ.)", type: "hospital", lat: 7.0094, lon: 100.4981, isExposed: false },
      { id: "fac-90-03", name: "สถานีดับเพลิงเทศบาลนครหาดใหญ่", type: "emergency", lat: 7.0081, lon: 100.4735, isExposed: false },
    ],
    computedAt: "2026-08-20T00:00:00Z",
    descriptor: {
      id: "baseline-exposure",
      epistemicClass: "static-reference",
      liveOrStatic: "static",
      publishedAt: "2020-01-01T00:00:00Z",
      fetchedAt: "2026-08-20T00:00:00Z",
      sourceIds: ["worldpop", "osm"],
    },
  },
  {
    localAuthorityId: "TH-LAO-900101",
    dlaCode: "900101",
    provinceCode: "90",
    nameTh: "เทศบาลนครสงขลา",
    nameEn: "Songkhla City Municipality",
    populationTotal: 62410,
    populationVulnerable: 15200,
    populationSource: "WorldPop-2020-UNadj",
    buildingsTotal: 18400,
    buildingFootprintAreaM2: 2450000,
    buildingSource: "OSM",
    roadsTotalKm: 98.6,
    roadsPrimaryKm: 14.2,
    roadsSecondaryKm: 22.0,
    roadsLocalKm: 62.4,
    criticalFacilities: {
      hospitals: 2,
      schools: 19,
      governmentOffices: 24,
      emergencyStations: 2,
    },
    facilityList: [
      { id: "fac-90-04", name: "โรงพยาบาลสงขลา", type: "hospital", lat: 7.1852, lon: 100.6012, isExposed: false },
    ],
    computedAt: "2026-08-20T00:00:00Z",
    descriptor: {
      id: "baseline-exposure",
      epistemicClass: "static-reference",
      liveOrStatic: "static",
      publishedAt: "2020-01-01T00:00:00Z",
      fetchedAt: "2026-08-20T00:00:00Z",
      sourceIds: ["worldpop", "osm"],
    },
  },
  {
    localAuthorityId: "TH-LAO-300101",
    dlaCode: "300101",
    provinceCode: "30",
    nameTh: "เทศบาลนครนครราชสีมา",
    nameEn: "Nakhon Ratchasima City Municipality",
    populationTotal: 126390,
    populationVulnerable: 31200,
    populationSource: "WorldPop-2020-UNadj",
    buildingsTotal: 36800,
    buildingFootprintAreaM2: 4950000,
    buildingSource: "OSM",
    roadsTotalKm: 185.0,
    roadsPrimaryKm: 32.0,
    roadsSecondaryKm: 48.0,
    roadsLocalKm: 105.0,
    criticalFacilities: {
      hospitals: 4,
      schools: 32,
      governmentOffices: 28,
      emergencyStations: 3,
    },
    facilityList: [
      { id: "fac-30-01", name: "โรงพยาบาลมหาราชนครราชสีมา", type: "hospital", lat: 14.9782, lon: 102.1085, isExposed: false },
    ],
    computedAt: "2026-08-20T00:00:00Z",
    descriptor: {
      id: "baseline-exposure",
      epistemicClass: "static-reference",
      liveOrStatic: "static",
      publishedAt: "2020-01-01T00:00:00Z",
      fetchedAt: "2026-08-20T00:00:00Z",
      sourceIds: ["worldpop", "osm"],
    },
  },
  {
    localAuthorityId: "TH-LAO-500101",
    dlaCode: "500101",
    provinceCode: "50",
    nameTh: "เทศบาลนครเชียงใหม่",
    nameEn: "Chiang Mai City Municipality",
    populationTotal: 127240,
    populationVulnerable: 32000,
    populationSource: "WorldPop-2020-UNadj",
    buildingsTotal: 41200,
    buildingFootprintAreaM2: 5400000,
    buildingSource: "OSM",
    roadsTotalKm: 240.5,
    roadsPrimaryKm: 35.0,
    roadsSecondaryKm: 55.5,
    roadsLocalKm: 150.0,
    criticalFacilities: {
      hospitals: 6,
      schools: 42,
      governmentOffices: 30,
      emergencyStations: 5,
    },
    facilityList: [
      { id: "fac-50-01", name: "โรงพยาบาลมหาราชนครเชียงใหม่", type: "hospital", lat: 18.7895, lon: 98.9754, isExposed: false },
    ],
    computedAt: "2026-08-20T00:00:00Z",
    descriptor: {
      id: "baseline-exposure",
      epistemicClass: "static-reference",
      liveOrStatic: "static",
      publishedAt: "2020-01-01T00:00:00Z",
      fetchedAt: "2026-08-20T00:00:00Z",
      sourceIds: ["worldpop", "osm"],
    },
  },
];

const BASELINE_BY_ID = new Map<string, LocalAuthorityBaselineExposure>(
  BASELINE_EXPOSURE_RECORDS.map((rec) => [rec.localAuthorityId, rec]),
);

const BASELINE_BY_DLA = new Map<string, LocalAuthorityBaselineExposure>(
  BASELINE_EXPOSURE_RECORDS.map((rec) => [rec.dlaCode, rec]),
);

/**
 * Get baseline exposure for a specific local authority ID or DLA code.
 */
export function getBaselineExposure(idOrDla: string): LocalAuthorityBaselineExposure | undefined {
  return BASELINE_BY_ID.get(idOrDla) ?? BASELINE_BY_DLA.get(idOrDla);
}

/**
 * Query baseline exposures optionally filtered by province.
 */
export function queryBaselineExposures(provinceCode?: string): LocalAuthorityBaselineExposure[] {
  if (!provinceCode) return [...BASELINE_EXPOSURE_RECORDS];
  return BASELINE_EXPOSURE_RECORDS.filter((rec) => rec.provinceCode === provinceCode);
}
