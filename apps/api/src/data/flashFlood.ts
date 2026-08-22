import type { FlashFloodRisk, HazardLayerDescriptor } from "@siahra/shared-types";

/**
 * Derives flash flood vulnerability index from slope gradient and upstream accumulation.
 */
export function deriveFlashFloodRisk(
  slopeDegree: number,
  upstreamCatchmentKm2: number,
  vulnerableTambons: string[],
): FlashFloodRisk {
  let riskLevel: FlashFloodRisk["riskLevel"] = "low";

  if (slopeDegree >= 20 && upstreamCatchmentKm2 >= 50) {
    riskLevel = "critical";
  } else if (slopeDegree >= 15 && upstreamCatchmentKm2 >= 20) {
    riskLevel = "high";
  } else if (slopeDegree >= 8 && upstreamCatchmentKm2 >= 10) {
    riskLevel = "moderate";
  }

  const descriptor: HazardLayerDescriptor = {
    id: "flash-flood-risk",
    epistemicClass: "illustrative",
    liveOrStatic: "static",
    publishedAt: "2026-08-20T00:00:00Z",
    fetchedAt: "2026-08-20T00:00:00Z",
    sourceIds: ["copernicus-dem"],
  };

  return {
    slopeDegree,
    upstreamCatchmentKm2,
    riskLevel,
    vulnerableTambons,
    descriptor,
  };
}
