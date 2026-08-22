import type { BuildingDamageEstimate } from "@siahra/shared-types";

/** Average replacement cost per building (THB) in Thailand residential/commercial mix */
const AVG_BUILDING_VALUE_THB = 1_200_000;
/** Average content / asset value per building (THB) */
const AVG_CONTENT_VALUE_THB = 450_000;

/**
 * Calculates structural and content damage percentages and estimated economic loss
 * from flood inundation depth using standard empirical stage-depth damage curves.
 */
export function calculateBuildingDamage(
  meanDepthM: number,
  buildingsExposed: number,
): BuildingDamageEstimate {
  if (buildingsExposed <= 0 || meanDepthM <= 0) {
    return {
      meanWaterDepthM: 0,
      structuralDamagePct: 0,
      contentDamagePct: 0,
      estimatedEconomicLossThb: 0,
    };
  }

  let structuralDamagePct = 0;
  let contentDamagePct = 0;

  if (meanDepthM < 0.2) {
    structuralDamagePct = 5;
    contentDamagePct = 10;
  } else if (meanDepthM < 0.5) {
    structuralDamagePct = 15;
    contentDamagePct = 30;
  } else if (meanDepthM < 1.0) {
    structuralDamagePct = 35;
    contentDamagePct = 60;
  } else if (meanDepthM < 2.0) {
    structuralDamagePct = 65;
    contentDamagePct = 85;
  } else {
    structuralDamagePct = 90;
    contentDamagePct = 100;
  }

  const structuralLoss = (structuralDamagePct / 100) * AVG_BUILDING_VALUE_THB * buildingsExposed;
  const contentLoss = (contentDamagePct / 100) * AVG_CONTENT_VALUE_THB * buildingsExposed;
  const estimatedEconomicLossThb = Math.round(structuralLoss + contentLoss);

  return {
    meanWaterDepthM: Math.round(meanDepthM * 100) / 100,
    structuralDamagePct,
    contentDamagePct,
    estimatedEconomicLossThb,
  };
}
