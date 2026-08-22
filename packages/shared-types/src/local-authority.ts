import type { HazardLayerDescriptor } from "./hazard-layer.js";

/**
 * Administrative classification of Thai Local Administrative Organizations (อปท.).
 */
export type LocalAuthorityType =
  | "city_municipality"        // เทศบาลนคร
  | "town_municipality"        // เทศบาลเมือง
  | "subdistrict_municipality"   // เทศบาลตำบล
  | "subdistrict_admin_org"    // องค์การบริหารส่วนตำบล (อบต.)
  | "special_admin_area"       // กรุงเทพมหานคร / เมืองพัทยา
  | "provincial_admin_org";    // องค์การบริหารส่วนจังหวัด (อบจ.)

/**
 * Reference metadata for a canonical Local Administrative Organization (อปท.).
 */
export interface LocalAuthorityRef {
  /** Canonical DLA identifier e.g. "TH-LAO-500101" */
  id: string;
  /** Official Department of Local Administration (DLA) code */
  dlaCode: string;
  nameTh: string;
  nameEn: string;
  type: LocalAuthorityType;
  provinceCode: string;
  districtCode: string;
  centerLat: number;
  centerLon: number;
  areaKm2: number;
}

/**
 * Aggregate counts of critical infrastructure facilities in an area.
 */
export interface FacilityExposureCount {
  hospitals: number;
  schools: number;
  governmentOffices: number;
  emergencyStations: number;
}

/**
 * Point-level record for an individual critical facility.
 */
export interface CriticalFacility {
  id: string;
  name: string;
  type: "hospital" | "school" | "emergency" | "government";
  lat: number;
  lon: number;
  isExposed: boolean;
}

/**
 * Baseline and active exposure metrics aggregated to a local authority.
 */
export interface LocalAuthorityExposure {
  populationExposed: number;
  populationTotal: number;
  populationSource: "WorldPop-R2024B" | "GHSL-2025";

  buildingsExposed: number;
  buildingsTotal: number;
  buildingSource: "OSM" | "GHSL-BUILT";

  roadKmExposed: number;
  roadKmTotal: number;

  criticalFacilities: FacilityExposureCount;
  exposedFacilityList: CriticalFacility[];

  agriculturalHaExposed: number;
}

/**
 * Operational Impact Summary Response for a Local Administrative Organization.
 */
export interface LocalAuthorityImpactResponse {
  runId: string;
  localAuthority: LocalAuthorityRef;
  classification: "observed" | "threshold_scenario" | "forecast";
  severity: "low" | "elevated" | "high" | "severe";
  exposure: LocalAuthorityExposure;
  triggeredRules: string[];
  peakWindowStart?: string;
  peakWindowEnd?: string;
  confidence: "low" | "medium" | "high";
  layer: HazardLayerDescriptor;
  boundaryVersion: string;
}

/**
 * Response envelope for local authorities listing endpoint.
 */
export interface LocalAuthoritiesResponse {
  total: number;
  localAuthorities: LocalAuthorityRef[];
}
