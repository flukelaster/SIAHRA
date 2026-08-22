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
 * Livestock heads statistics (Department of Livestock Development - DLD).
 */
export interface LivestockExposure {
  cattle: number;
  buffalo: number;
  pigs: number;
  poultry: number;
}

/**
 * Agricultural crop hectares statistics (Department of Agricultural Extension - DOAE).
 */
export interface CropExposure {
  paddyHa: number;
  fieldCropHa: number;
  fruitOrchardHa: number;
  rubberHa: number;
  totalCropHa: number;
}

/**
 * Structural and content damage estimation from stage-depth damage curves.
 */
export interface BuildingDamageEstimate {
  meanWaterDepthM: number;
  structuralDamagePct: number;
  contentDamagePct: number;
  estimatedEconomicLossThb: number;
}

/**
 * Flash flood risk index based on DEM slope and upstream catchment accumulation.
 */
export interface FlashFloodRisk {
  slopeDegree: number;
  upstreamCatchmentKm2: number;
  riskLevel: "low" | "moderate" | "high" | "critical";
  vulnerableTambons: string[];
  descriptor: HazardLayerDescriptor;
}

/**
 * Historical benchmark flood event for validation and comparative replay.
 */
export interface HistoricalFloodEvent {
  id: string;
  nameTh: string;
  nameEn: string;
  year: number;
  peakDate: string;
  basin: string;
  affectedProvinces: string[];
  peakFloodAreaKm2: number;
  estimatedTotalExposedPop: number;
  descriptionTh: string;
  descriptionEn: string;
}

/**
 * Baseline exposure statistics aggregated per Local Administrative Organization.
 */
export interface LocalAuthorityBaselineExposure {
  localAuthorityId: string;
  dlaCode: string;
  provinceCode: string;
  nameTh: string;
  nameEn: string;
  populationTotal: number;
  populationVulnerable: number;
  populationSource: "WorldPop-2020-UNadj" | "WorldPop-R2024B";
  buildingsTotal: number;
  buildingFootprintAreaM2: number;
  buildingSource: "OSM";
  roadsTotalKm: number;
  roadsPrimaryKm: number;
  roadsSecondaryKm: number;
  roadsLocalKm: number;
  criticalFacilities: FacilityExposureCount;
  facilityList: CriticalFacility[];
  livestock: LivestockExposure;
  crops: CropExposure;
  flashFloodRisk: FlashFloodRisk;
  computedAt: string;
  descriptor: HazardLayerDescriptor;
}

/**
 * Baseline and active exposure metrics aggregated to a local authority.
 */
export interface LocalAuthorityExposure {
  populationExposed: number;
  populationTotal: number;
  populationSource: "WorldPop-2020-UNadj" | "WorldPop-R2024B" | "GHSL-2025";

  buildingsExposed: number;
  buildingsTotal: number;
  buildingSource: "OSM" | "GHSL-BUILT";

  roadKmExposed: number;
  roadKmTotal: number;

  criticalFacilities: FacilityExposureCount;
  exposedFacilityList: CriticalFacility[];

  agriculturalHaExposed: number;
  livestockExposed: LivestockExposure;
  cropsExposed: CropExposure;
  buildingDamage?: BuildingDamageEstimate;
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

/**
 * Response envelope for baseline exposure detail endpoint.
 */
export interface LocalAuthorityExposureResponse {
  baseline: LocalAuthorityBaselineExposure;
}

/**
 * Response envelope for historical flood benchmark events listing.
 */
export interface HistoricalFloodResponse {
  total: number;
  events: HistoricalFloodEvent[];
}
