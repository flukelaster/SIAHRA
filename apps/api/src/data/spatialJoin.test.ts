import { describe, expect, it } from "vitest";
import type { FloodExtentFeature, LocalAuthorityBaselineExposure, LocalAuthorityRef } from "@siahra/shared-types";
import { computeLocalAuthorityImpact, computeProvinceImpacts } from "./spatialJoin.js";

const MOCK_LAO: LocalAuthorityRef = {
  id: "TH-LAO-901101",
  dlaCode: "901101",
  nameTh: "เทศบาลนครหาดใหญ่",
  nameEn: "Hat Yai City Municipality",
  type: "city_municipality",
  provinceCode: "90",
  districtCode: "9011",
  centerLat: 7.0084,
  centerLon: 100.4767,
  areaKm2: 21.0,
};

const MOCK_BASELINE: LocalAuthorityBaselineExposure = {
  localAuthorityId: "TH-LAO-901101",
  dlaCode: "901101",
  provinceCode: "90",
  nameTh: "เทศบาลนครหาดใหญ่",
  nameEn: "Hat Yai City Municipality",
  populationTotal: 150000,
  populationVulnerable: 35000,
  populationSource: "WorldPop-2020-UNadj",
  buildingsTotal: 40000,
  buildingFootprintAreaM2: 5000000,
  buildingSource: "OSM",
  roadsTotalKm: 200,
  roadsPrimaryKm: 25,
  roadsSecondaryKm: 40,
  roadsLocalKm: 135,
  criticalFacilities: {
    hospitals: 4,
    schools: 30,
    governmentOffices: 15,
    emergencyStations: 3,
  },
  facilityList: [
    { id: "fac-1", name: "โรงพยาบาลหาดใหญ่", type: "hospital", lat: 7.0142, lon: 100.4795, isExposed: false },
    { id: "fac-2", name: "โรงเรียนหาดใหญ่วิทยาลัย", type: "school", lat: 7.0081, lon: 100.4735, isExposed: false },
  ],
  livestock: {
    cattle: 450,
    buffalo: 20,
    pigs: 1800,
    poultry: 45000,
  },
  crops: {
    paddyHa: 450,
    fieldCropHa: 120,
    fruitOrchardHa: 380,
    rubberHa: 1250,
    totalCropHa: 2200,
  },
  flashFloodRisk: {
    slopeDegree: 8.5,
    upstreamCatchmentKm2: 35.0,
    riskLevel: "moderate",
    vulnerableTambons: ["คอหงส์"],
    descriptor: {
      id: "flash-flood-risk",
      epistemicClass: "illustrative",
      liveOrStatic: "static",
      publishedAt: "2026-08-20T00:00:00Z",
      fetchedAt: "2026-08-20T00:00:00Z",
      sourceIds: ["copernicus-dem"],
    },
  },
  computedAt: "2026-08-20T00:00:00Z",
  descriptor: {
    id: "baseline-exposure",
    epistemicClass: "static-reference",
    liveOrStatic: "static",
    publishedAt: "2020-01-01T00:00:00Z",
    fetchedAt: "2026-08-20T00:00:00Z",
    sourceIds: ["worldpop", "osm"],
  },
};

describe("spatialJoin and Local Authority Impact", () => {
  it("returns low severity when no flood features intersect", () => {
    const result = computeLocalAuthorityImpact(MOCK_LAO, MOCK_BASELINE, [], "2026-08-22T12:00:00Z");

    expect(result.classification).toBe("observed");
    expect(result.severity).toBe("low");
    expect(result.exposure.populationExposed).toBe(0);
    expect(result.exposure.buildingsExposed).toBe(0);
    expect(result.triggeredRules).toHaveLength(0);
    expect(result.layer.epistemicClass).toBe("observed");
  });

  it("calculates elevated/high impact when moderate flood detected", () => {
    const feature: FloodExtentFeature = {
      type: "Feature",
      id: "f-1",
      properties: {
        provinceCode: "90",
        provinceTh: "สงขลา",
        amphoeTh: "หาดใหญ่",
        tambonTh: "หาดใหญ่",
        lat: 7.0084,
        lon: 100.4767,
        floodAreaRai: 2000, // 2000 * 0.0016 = 3.2 km2 (~15% of 21 km2)
        houses: 1200,
        firstSeenAt: "2026-08-22T10:00:00Z",
        lastSeenAt: "2026-08-22T12:00:00Z",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[[100.45, 7.00], [100.50, 7.00], [100.50, 7.05], [100.45, 7.05], [100.45, 7.00]]],
      },
    };

    const result = computeLocalAuthorityImpact(MOCK_LAO, MOCK_BASELINE, [feature], "2026-08-22T12:00:00Z");

    expect(result.severity).toBe("severe"); // > 15% inundation and hospital exposed
    expect(result.exposure.populationExposed).toBeGreaterThan(10000);
    expect(result.exposure.buildingsExposed).toBeGreaterThan(1200);
    expect(result.triggeredRules).toContain("gistda-satellite-observed-flood");
  });

  it("computes province-wide impact rankings", () => {
    const feature: FloodExtentFeature = {
      type: "Feature",
      id: "f-1",
      properties: {
        provinceCode: "90",
        provinceTh: "สงขลา",
        amphoeTh: "หาดใหญ่",
        tambonTh: "หาดใหญ่",
        lat: 7.0084,
        lon: 100.4767,
        floodAreaRai: 1500,
        houses: 800,
        firstSeenAt: "2026-08-22T10:00:00Z",
        lastSeenAt: "2026-08-22T12:00:00Z",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[[100.45, 7.00], [100.50, 7.00], [100.50, 7.05], [100.45, 7.05], [100.45, 7.00]]],
      },
    };

    const impacts = computeProvinceImpacts("90", [feature], "2026-08-22T12:00:00Z");
    expect(impacts.length).toBeGreaterThan(0);
    // Most impacted should rank first
    expect(impacts[0].localAuthority.id).toBe("TH-LAO-901101");
  });
});
