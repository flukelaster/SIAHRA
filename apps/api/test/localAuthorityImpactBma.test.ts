import { exports as workerExports } from "cloudflare:workers";
import type { LocalAuthorityImpactResponse } from "@siahra/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getExposureByLocalAuthorityId } from "../src/data/localAuthorityExposure.js";

/**
 * Bangkok districts (`bma_district`, owner decision 2026-09-26) run through
 * the exact same `/impact` path as DLA อปท.: real OSM admin_level=6 boundary
 * + real WorldPop/OSM baseline, intersected with a controlled GISTDA scene.
 * Own file for the same reason as `localAuthorityImpactZeroFlood.test.ts`:
 * `FloodExtentDO` caches its last pull per DO instance and storage is shared
 * within a test file.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

const call = (path: string) => workerExports.default.fetch(new Request(`https://siahra-radar.co${path}`));

/** Covers TH-BMA-osm92053 (เขตพระนคร) whole — its real bbox is
 *  100.4875804–100.5092356, 13.7386948–13.7728868 in the baked boundary. */
const WFS_SCENE = {
  type: "FeatureCollection",
  timeStamp: "2999-01-01T00:00:00.000Z",
  totalFeatures: 1,
  features: [
    {
      type: "Feature",
      id: "FloodArea_Poly.1",
      properties: { PV_IDN: 10, TB_IDN: 1, flood_area: 100, house: 1, lat: 13.75, long: 100.5 },
      geometry: {
        type: "Polygon",
        coordinates: [[[100.48, 13.73], [100.52, 13.73], [100.52, 13.78], [100.48, 13.78], [100.48, 13.73]]],
      },
    },
  ],
};

describe("GET /api/v1/local-authorities/:id/impact — Bangkok district", () => {
  it("TH-BMA-osm92053: fully covered → fraction ~1, every baseline facility exposed, estimates bounded by baseline", async () => {
    const baseline = getExposureByLocalAuthorityId("TH-BMA-osm92053");
    expect(baseline).not.toBeNull();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify(WFS_SCENE), { headers: { "Content-Type": "application/json" } }),
    );

    const res = await call("/api/v1/local-authorities/TH-BMA-osm92053/impact");
    expect(res.status).toBe(200);
    const { impact } = (await res.json()) as LocalAuthorityImpactResponse;
    expect(impact.localAuthorityId).toBe("TH-BMA-osm92053");
    expect(impact.descriptor.epistemicClass).toBe("observed");
    expect(impact.descriptor.fetchedAt).not.toBeNull();
    expect(impact.floodedFraction).toBeGreaterThan(0.99);
    expect(impact.facilitiesExposed.schools).toHaveLength(baseline!.facilities.schools.length);
    expect(impact.populationExposed.descriptor.epistemicClass).toBe("illustrative");
    expect(impact.populationExposed.estimate!).toBeLessThanOrEqual(baseline!.population.estimate!);
    expect(impact.buildingsExposed.estimate!).toBeLessThanOrEqual(baseline!.buildings.count);
  }, 20_000);
});
