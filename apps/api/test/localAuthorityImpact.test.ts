import { exports as workerExports } from "cloudflare:workers";
import type { FloodExtentFeature, LocalAuthorityImpactResponse } from "@siahra/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getBoundaryGeometryById } from "../src/data/localAuthorityBoundaries.js";
import { getExposureByLocalAuthorityId } from "../src/data/localAuthorityExposure.js";
import { computeLocalAuthorityImpact } from "../src/geo/floodIntersection.js";

/**
 * E11.4 — real polygon intersection between GISTDA flood extent and อปท.
 * boundaries. Replaces the reverted `spatialJoin.ts`, which never read flood
 * geometry at all (matched by Thai-name substring, and had a fallback that
 * attributed a whole province's flood area to every authority in it).
 */
afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic fixture — hand-specified squares, expected numbers computed
// by hand. Tests the intersection math itself, independent of real-world
// data. Runs in the workerd pool (not a Node-side etl test) — this is the
// actual proof that polyclip-ts (turf/intersect's dependency) runs in
// workerd, not just that it bundles.
// ─────────────────────────────────────────────────────────────────────────────

/** 10x10 square, [0,0]-[10,10] — area = 10 * 10 * (km per degree)^2 at the equator, computed by turf.area(), not hand-derived (geodesic area is not a flat multiplication). */
const AUTHORITY_A = {
  type: "Polygon" as const,
  coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
};
// B sits entirely outside A (east of it) — no overlap possible.
const AUTHORITY_B = {
  type: "Polygon" as const,
  coordinates: [[[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]],
};
// C overlaps the eastern half of A exactly ([5,0]-[15,10] intersected with
// A's [0,0]-[10,10] gives exactly the [5,0]-[10,10] half of A).
const AUTHORITY_C = {
  type: "Polygon" as const,
  coordinates: [[[5, 0], [15, 0], [15, 10], [5, 10], [5, 0]]],
};

/** Flood polygon covering exactly the western half of AUTHORITY_A: [0,0]-[5,10]. */
const FLOOD_WEST_HALF: FloodExtentFeature = {
  type: "Feature",
  id: "flood-west-half",
  properties: {
    tambonTh: null,
    amphoeTh: null,
    provinceTh: null,
    provinceCode: "99",
    floodAreaRai: null,
    houses: null,
    lat: null,
    lon: null,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
  },
  geometry: { type: "Polygon", coordinates: [[[0, 0], [5, 0], [5, 10], [0, 10], [0, 0]]] },
};

const baselineFixture = (overrides: Partial<Parameters<typeof computeLocalAuthorityImpact>[0]["baseline"]> = {}) => ({
  localAuthorityId: "TEST",
  population: {
    estimate: 1000,
    datasetId: "worldpop_tha_2020_UNadj" as const,
    resolutionM: 100 as const,
    vintage: "2020" as const,
    descriptor: {
      id: "local-authority-population",
      epistemicClass: "static-reference" as const,
      liveOrStatic: "static" as const,
      publishedAt: "2020-01-01T00:00:00Z",
      fetchedAt: "2026-01-01T00:00:00Z",
      sourceIds: ["worldpop" as const],
    },
  },
  buildings: {
    count: 100,
    perThousandPop: 100,
    osmExtractDate: "2026-01-01T00:00:00Z",
    descriptor: {
      id: "local-authority-buildings",
      epistemicClass: "static-reference" as const,
      liveOrStatic: "static" as const,
      publishedAt: "2026-01-01T00:00:00Z",
      fetchedAt: "2026-01-01T00:00:00Z",
      sourceIds: ["osm" as const],
    },
  },
  roads: { totalKm: 0, byClass: {}, descriptor: { id: "local-authority-roads", epistemicClass: "static-reference" as const, liveOrStatic: "static" as const, fetchedAt: null, sourceIds: ["osm" as const] } },
  facilities: {
    hospitals: [{ osmId: "node/1", nameTh: "Test Hospital (west)", lat: 5, lon: 2 }],
    schools: [{ osmId: "node/2", nameTh: "Test School (east)", lat: 5, lon: 8 }],
    fireStations: [],
    descriptor: { id: "local-authority-facilities", epistemicClass: "static-reference" as const, liveOrStatic: "static" as const, fetchedAt: null, sourceIds: ["osm" as const] },
  },
  computedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("computeLocalAuthorityImpact — deterministic fixture", () => {
  it("flood polygon A vs authority A: half the area floods, hospital (west) exposed, school (east) not", () => {
    const impact = computeLocalAuthorityImpact({
      authorityId: "TEST-A",
      authorityGeometry: AUTHORITY_A,
      floodFeatures: [FLOOD_WEST_HALF],
      retrievedAt: "2026-01-01T00:00:00Z",
      baseline: baselineFixture(),
      computedAt: "2026-01-01T01:00:00Z",
    });
    // Absolute area, not just a ratio — pins areaKm2()'s unit conversion so a
    // regression (e.g. a dropped /1e6) can't cancel out in the ratio assertions
    // below the way it would if every check here were relative. Value from
    // @turf/area directly on AUTHORITY_A's geodesic geometry, not a flat
    // lat*lon*(km/deg)^2 approximation (which would be wrong at this extent).
    expect(impact.authorityAreaKm2).toBeCloseTo(1230166.82, 1);
    // Exactly half of authority A's own area, by construction of the fixture.
    expect(impact.floodedAreaKm2).not.toBeNull();
    expect(impact.floodedAreaKm2! / impact.authorityAreaKm2).toBeCloseTo(0.5, 2);
    expect(impact.floodedFraction).toBeCloseTo(0.5, 2);
    expect(impact.facilitiesExposed.hospitals).toHaveLength(1);
    expect(impact.facilitiesExposed.hospitals[0].osmId).toBe("node/1");
    expect(impact.facilitiesExposed.schools).toHaveLength(0);
    // Area-weighted, not observed: exactly half the baseline.
    expect(impact.populationExposed.estimate).toBeCloseTo(500, 0);
    expect(impact.buildingsExposed.estimate).toBeCloseTo(50, 0);
    expect(impact.populationExposed.method).toBe("area-weighted");
    expect(impact.populationExposed.descriptor.epistemicClass).toBe("illustrative");
    expect(impact.descriptor.epistemicClass).toBe("observed");
  });

  it("flood polygon A vs authority B: zero overlap is a real zero, not an error", () => {
    const impact = computeLocalAuthorityImpact({
      authorityId: "TEST-B",
      authorityGeometry: AUTHORITY_B,
      floodFeatures: [FLOOD_WEST_HALF],
      retrievedAt: "2026-01-01T00:00:00Z",
      baseline: baselineFixture(),
      computedAt: "2026-01-01T01:00:00Z",
    });
    expect(impact.floodedAreaKm2).toBe(0);
    expect(impact.floodedFraction).toBe(0);
    expect(impact.facilitiesExposed.hospitals).toHaveLength(0);
    expect(impact.facilitiesExposed.schools).toHaveLength(0);
    expect(impact.populationExposed.estimate).toBe(0);
    expect(impact.buildingsExposed.estimate).toBe(0);
  });

  it("flood polygon A vs authority C: partial overlap on the eastern edge, fraction < 1", () => {
    const impact = computeLocalAuthorityImpact({
      authorityId: "TEST-C",
      authorityGeometry: AUTHORITY_C,
      floodFeatures: [FLOOD_WEST_HALF],
      retrievedAt: "2026-01-01T00:00:00Z",
      baseline: baselineFixture(),
      computedAt: "2026-01-01T01:00:00Z",
    });
    // FLOOD_WEST_HALF is [0,0]-[5,10]; C is [5,0]-[15,10] — they share only
    // the boundary line lon=5, zero-width, so the real overlap area is 0.
    expect(impact.floodedAreaKm2).toBe(0);
    expect(impact.floodedFraction).toBe(0);
  });

  it("never fetched (retrievedAt null) reports null, not 0 — 'could not ask' is not 'quiet'", () => {
    const impact = computeLocalAuthorityImpact({
      authorityId: "TEST-A",
      authorityGeometry: AUTHORITY_A,
      floodFeatures: [],
      retrievedAt: null,
      baseline: baselineFixture(),
      computedAt: "2026-01-01T01:00:00Z",
    });
    expect(impact.floodedAreaKm2).toBeNull();
    expect(impact.floodedFraction).toBeNull();
    expect(impact.facilitiesExposed.hospitals).toHaveLength(0);
    expect(impact.populationExposed.estimate).toBeNull();
    expect(impact.buildingsExposed.estimate).toBeNull();
    expect(impact.descriptor.fetchedAt).toBeNull();
  });

  it("fetched successfully, zero flood features right now — a real 0, distinguishable from the null case above", () => {
    const impact = computeLocalAuthorityImpact({
      authorityId: "TEST-A",
      authorityGeometry: AUTHORITY_A,
      floodFeatures: [],
      retrievedAt: "2026-01-01T00:00:00Z",
      baseline: baselineFixture(),
      computedAt: "2026-01-01T01:00:00Z",
    });
    expect(impact.floodedAreaKm2).toBe(0);
    expect(impact.floodedFraction).toBe(0);
    expect(impact.descriptor.fetchedAt).not.toBeNull();
  });

  it("two overlapping flood features are summed per the task spec, not unioned — payload reflects the raw sum honestly", () => {
    // A second flood feature that also covers the western half of A, fully
    // overlapping FLOOD_WEST_HALF — summing (not unioning) double-counts it.
    const impact = computeLocalAuthorityImpact({
      authorityId: "TEST-A",
      authorityGeometry: AUTHORITY_A,
      floodFeatures: [FLOOD_WEST_HALF, { ...FLOOD_WEST_HALF, id: "flood-west-half-2" }],
      retrievedAt: "2026-01-01T00:00:00Z",
      baseline: baselineFixture(),
      computedAt: "2026-01-01T01:00:00Z",
    });
    // Double the single-feature area (~half of A each, summed = ~full A) —
    // exceeds authorityAreaKm2, reported as computed rather than silently capped.
    expect(impact.floodedAreaKm2! / impact.authorityAreaKm2).toBeCloseTo(1.0, 2);
    // floodedFraction is still clamped to [0,1].
    expect(impact.floodedFraction).toBeLessThanOrEqual(1);
    expect(impact.floodedFraction).toBeCloseTo(1, 2);
  });

  it("has no confidence field anywhere in the payload", () => {
    const impact = computeLocalAuthorityImpact({
      authorityId: "TEST-A",
      authorityGeometry: AUTHORITY_A,
      floodFeatures: [FLOOD_WEST_HALF],
      retrievedAt: "2026-01-01T00:00:00Z",
      baseline: baselineFixture(),
      computedAt: "2026-01-01T01:00:00Z",
    });
    expect(JSON.stringify(impact)).not.toContain("confidence");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Real-data integration check — real E11.2 boundary + real E11.3 baseline for
// TH-LAO-3300102 (Nakhon Ratchasima city municipality), a synthetic (mocked)
// GISTDA scene chosen to overlap roughly half of its real, non-trivial
// (54-vertex) polygon — proves the real production data path (registry,
// baked boundary, baked baseline) end to end, with a controlled flood input
// since GISTDA's live scene changes constantly.
// ─────────────────────────────────────────────────────────────────────────────

const call = (path: string) => workerExports.default.fetch(new Request(`https://siahra-radar.co${path}`));

/** Covers exactly the western half (lon < 102.08) of TH-LAO-3300102's real bbox
 *  (102.0263922-102.1377388, 14.9377794-15.0039869) — verified against the
 *  committed apps/web/public/aoi/30/local-authorities.geojson to give a real
 *  intersection ~50.6% of the authority's real area (18.69 / 36.91 km²). */
const WFS_SCENE = {
  type: "FeatureCollection",
  timeStamp: "2999-01-01T00:00:00.000Z",
  totalFeatures: 1,
  features: [
    {
      type: "Feature",
      id: "FloodArea_Poly.1",
      properties: { PV_IDN: 30, TB_IDN: 1, flood_area: 100, house: 1, lat: 14.97, long: 102.05 },
      geometry: {
        type: "Polygon",
        coordinates: [[[102.0, 14.9], [102.08, 14.9], [102.08, 15.05], [102.0, 15.05], [102.0, 14.9]]],
      },
    },
  ],
};

describe("GET /api/v1/local-authorities/:id/impact — real boundary + real baseline, controlled flood input", () => {
  it("TH-LAO-3300102: real ~50% overlap, real facility split, populationExposed <= baseline", async () => {
    const boundary = getBoundaryGeometryById("TH-LAO-3300102");
    const baseline = getExposureByLocalAuthorityId("TH-LAO-3300102");
    expect(boundary).not.toBeNull();
    expect(baseline).not.toBeNull();

    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify(WFS_SCENE), { headers: { "Content-Type": "application/json" } }),
    );
    const res = await call("/api/v1/local-authorities/TH-LAO-3300102/impact");
    expect(res.status).toBe(200);
    const body = (await res.json()) as LocalAuthorityImpactResponse;
    const { impact } = body;

    expect(impact.localAuthorityId).toBe("TH-LAO-3300102");
    expect(impact.descriptor.fetchedAt).not.toBeNull();
    expect(impact.descriptor.epistemicClass).toBe("observed");
    expect(impact.floodedAreaKm2).not.toBeNull();
    expect(impact.floodedFraction).not.toBeNull();
    expect(impact.floodedFraction!).toBeGreaterThan(0);
    expect(impact.floodedFraction!).toBeLessThan(1);
    // real bbox split gives ~50.6% — bounded, not pinned, since a refreshed
    // OSM extract could shift the real polygon's vertices slightly.
    expect(impact.floodedFraction!).toBeGreaterThan(0.4);
    expect(impact.floodedFraction!).toBeLessThan(0.6);

    // Real facility coordinates (apps/api/src/data/localAuthorityExposure.json):
    // exactly 2 of 10 hospitals and 5 of 16 schools sit west of lon 102.08,
    // 0 of 1 fire stations do.
    expect(impact.facilitiesExposed.hospitals.length).toBeGreaterThan(0);
    expect(impact.facilitiesExposed.hospitals.length).toBeLessThan(baseline!.facilities.hospitals.length);
    expect(impact.facilitiesExposed.fireStations).toHaveLength(0);

    expect(impact.populationExposed.estimate).not.toBeNull();
    expect(impact.populationExposed.estimate!).toBeGreaterThan(0);
    expect(impact.populationExposed.estimate!).toBeLessThanOrEqual(baseline!.population.estimate!);
    expect(impact.buildingsExposed.estimate).not.toBeNull();
    expect(impact.buildingsExposed.estimate!).toBeLessThanOrEqual(baseline!.buildings.count);

    expect(JSON.stringify(impact)).not.toContain("confidence");
  }, 20_000);

  it("404s for an authority with a registry record but no E11.2/E11.3 data (same discipline as /exposure)", async () => {
    const res = await call("/api/v1/local-authorities/TH-LAO-5380602/impact");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("No flood-impact data"),
    });
  });

  it("404s for an id that does not exist in the registry at all", async () => {
    const res = await call("/api/v1/local-authorities/TH-LAO-0000000/impact");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("No such local authority") });
  });
});
