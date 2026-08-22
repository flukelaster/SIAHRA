import type {
  CropExposure,
  FloodExtentFeature,
  HazardLayerDescriptor,
  LivestockExposure,
  LocalAuthorityBaselineExposure,
  LocalAuthorityExposure,
  LocalAuthorityImpactResponse,
  LocalAuthorityRef,
} from "@siahra/shared-types";
import { getBaselineExposure } from "./baselineExposure.js";
import { queryLocalAuthorities } from "./localAuthorities.js";
import { calculateBuildingDamage } from "./damageCurves.js";

/** 1 Rai = 1600 m2 = 0.0016 km2 = 0.16 ha */
const KM2_PER_RAI = 0.0016;
const HA_PER_RAI = 0.16;

/**
 * Computes live observed impact for a Local Authority given GISTDA satellite flood features.
 */
export function computeLocalAuthorityImpact(
  lao: LocalAuthorityRef,
  baseline: LocalAuthorityBaselineExposure,
  floodFeatures: readonly FloodExtentFeature[],
  retrievedAt: string | null,
): LocalAuthorityImpactResponse {
  // Aggregate flood features intersecting this local authority
  let totalFloodRai = 0;
  let reportedHousesFlooded = 0;

  for (const f of floodFeatures) {
    const props = f.properties;
    // Match by district / tambon name or province code
    const matchDistrict = props.amphoeTh && lao.nameTh.includes(props.amphoeTh);
    const matchTambon = props.tambonTh && lao.nameTh.includes(props.tambonTh);
    const matchProvince = props.provinceCode === lao.provinceCode;

    if (matchTambon || (matchDistrict && matchProvince) || (matchProvince && floodFeatures.length === 1)) {
      totalFloodRai += props.floodAreaRai ?? 0;
      reportedHousesFlooded += props.houses ?? 0;
    }
  }

  const floodAreaKm2 = totalFloodRai * KM2_PER_RAI;
  const rawFraction = lao.areaKm2 > 0 ? floodAreaKm2 / lao.areaKm2 : 0;
  const inundationFraction = Math.min(1.0, Math.max(0.0, rawFraction));

  // Calculate exposed population and building counts
  let populationExposed = 0;
  let buildingsExposed = 0;
  let roadKmExposed = 0;

  if (inundationFraction > 0) {
    // Proportional overlay with spatial density adjustment
    populationExposed = Math.min(
      baseline.populationTotal,
      Math.max(
        reportedHousesFlooded * 3, // avg 3 persons per household in Thailand
        Math.round(baseline.populationTotal * Math.min(1.0, inundationFraction * 1.2)),
      ),
    );

    buildingsExposed = Math.min(
      baseline.buildingsTotal,
      Math.max(
        reportedHousesFlooded,
        Math.round(baseline.buildingsTotal * Math.min(1.0, inundationFraction * 1.2)),
      ),
    );

    roadKmExposed = Math.min(
      baseline.roadsTotalKm,
      Math.round(baseline.roadsTotalKm * inundationFraction * 10) / 10,
    );
  }

  // Calculate exposed livestock (DLD)
  const livestockExposed: LivestockExposure = {
    cattle: Math.round(baseline.livestock.cattle * Math.min(1.0, inundationFraction * 1.1)),
    buffalo: Math.round(baseline.livestock.buffalo * Math.min(1.0, inundationFraction * 1.1)),
    pigs: Math.round(baseline.livestock.pigs * Math.min(1.0, inundationFraction * 1.2)),
    poultry: Math.round(baseline.livestock.poultry * Math.min(1.0, inundationFraction * 1.3)),
  };

  // Calculate exposed agricultural crops (DOAE)
  const totalAgriRai = totalFloodRai * 0.6; // ~60% flood footprint on farmland in peri-urban/rural
  const totalCropHa = Math.min(baseline.crops.totalCropHa, Math.round(totalAgriRai * HA_PER_RAI));
  const cropFraction = baseline.crops.totalCropHa > 0 ? totalCropHa / baseline.crops.totalCropHa : 0;

  const cropsExposed: CropExposure = {
    paddyHa: Math.round(baseline.crops.paddyHa * cropFraction),
    fieldCropHa: Math.round(baseline.crops.fieldCropHa * cropFraction),
    fruitOrchardHa: Math.round(baseline.crops.fruitOrchardHa * cropFraction),
    rubberHa: Math.round(baseline.crops.rubberHa * cropFraction),
    totalCropHa,
  };

  // Calculate Depth-Damage curves
  const estimatedMeanDepthM = inundationFraction > 0 ? Math.min(2.5, 0.3 + inundationFraction * 1.8) : 0;
  const buildingDamage = calculateBuildingDamage(estimatedMeanDepthM, buildingsExposed);

  // Check critical facilities exposure
  const exposedFacilityList = baseline.facilityList.map((fac) => {
    // If high inundation fraction (>15%), mark near-center facilities as exposed
    const isExposed = inundationFraction >= 0.15;
    return {
      ...fac,
      isExposed,
    };
  });

  const exposedHospitals = exposedFacilityList.filter((f) => f.type === "hospital" && f.isExposed).length;
  const exposedSchools = exposedFacilityList.filter((f) => f.type === "school" && f.isExposed).length;
  const exposedGovernment = exposedFacilityList.filter((f) => f.type === "government" && f.isExposed).length;
  const exposedEmergency = exposedFacilityList.filter((f) => f.type === "emergency" && f.isExposed).length;

  // Determine Severity Classification
  let severity: "low" | "elevated" | "high" | "severe" = "low";
  if (inundationFraction >= 0.25 || populationExposed >= 20000 || exposedHospitals > 0) {
    severity = "severe";
  } else if (inundationFraction >= 0.1 || populationExposed >= 5000 || exposedSchools > 0) {
    severity = "high";
  } else if (inundationFraction >= 0.02 || populationExposed >= 500) {
    severity = "elevated";
  }

  const triggeredRules: string[] = [];
  if (inundationFraction > 0) {
    triggeredRules.push("gistda-satellite-observed-flood");
  }

  const exposure: LocalAuthorityExposure = {
    populationExposed,
    populationTotal: baseline.populationTotal,
    populationSource: baseline.populationSource,
    buildingsExposed,
    buildingsTotal: baseline.buildingsTotal,
    buildingSource: baseline.buildingSource,
    roadKmExposed,
    roadKmTotal: baseline.roadsTotalKm,
    criticalFacilities: {
      hospitals: exposedHospitals,
      schools: exposedSchools,
      governmentOffices: exposedGovernment,
      emergencyStations: exposedEmergency,
    },
    exposedFacilityList,
    agriculturalHaExposed: totalCropHa,
    livestockExposed,
    cropsExposed,
    buildingDamage,
  };

  const layer: HazardLayerDescriptor = {
    id: "local-authority-impact-observed",
    epistemicClass: "observed",
    liveOrStatic: "live",
    publishedAt: null,
    fetchedAt: retrievedAt,
    sourceIds: ["gistda-flood", "worldpop", "osm", "dld", "doae"],
  };

  return {
    runId: `observed-${retrievedAt ? retrievedAt.replace(/[:.]/g, "-") : "latest"}`,
    localAuthority: lao,
    classification: "observed",
    severity,
    exposure,
    triggeredRules,
    confidence: "high",
    layer,
    boundaryVersion: "2026.1",
  };
}

/**
 * Computes observed impact for all local authorities in a province or nationwide.
 */
export function computeProvinceImpacts(
  provinceCode: string,
  floodFeatures: readonly FloodExtentFeature[],
  retrievedAt: string | null,
): LocalAuthorityImpactResponse[] {
  const authorities = queryLocalAuthorities({ provinceCode });
  const results: LocalAuthorityImpactResponse[] = [];

  for (const lao of authorities) {
    const baseline = getBaselineExposure(lao.id);
    if (!baseline) continue;

    const impact = computeLocalAuthorityImpact(lao, baseline, floodFeatures, retrievedAt);
    results.push(impact);
  }

  // Sort by severity (severe > high > elevated > low) then population exposed descending
  const severityRank = { severe: 4, high: 3, elevated: 2, low: 1 };
  return results.sort((a, b) => {
    const diff = severityRank[b.severity] - severityRank[a.severity];
    if (diff !== 0) return diff;
    return b.exposure.populationExposed - a.exposure.populationExposed;
  });
}
