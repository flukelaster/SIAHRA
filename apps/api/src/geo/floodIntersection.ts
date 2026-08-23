import turfArea from "@turf/area";
import turfBooleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { feature as turfFeature, featureCollection as turfFeatureCollection, point as turfPoint } from "@turf/helpers";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import turfIntersect from "@turf/intersect";
import type {
  FloodExtentFeature,
  HazardLayerDescriptor,
  LocalAuthorityBaselineExposure,
  LocalAuthorityBoundaryGeometry,
  LocalAuthorityFacility,
  LocalAuthorityImpact,
  LocalAuthorityImpactEstimate,
  SourceId,
} from "@siahra/shared-types";

/**
 * Real polygon intersection between the GISTDA flood-extent scene and one
 * local authority's real E11.2 boundary (E11.4) — replaces the reverted
 * `spatialJoin.ts`, which matched by Thai-name substring and never read
 * flood geometry at all. Pure functions only: no fs/network here, so the
 * whole module runs and is testable both in Node and in the workerd pool.
 *
 * Mirrors `FloodExtentDO`'s `STALE_AFTER_MS` (3h) — not imported because it
 * is a private module constant of the DO, not part of its public surface.
 */
const STALE_AFTER_SECONDS = 3 * 60 * 60;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Wraps a raw `Polygon`/`MultiPolygon` geometry in a turf Feature — no properties needed. */
function toTurfFeature(geometry: Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> {
  return turfFeature(geometry);
}

/**
 * Real area of a `Polygon`/`MultiPolygon` in km² — `turf.area()` returns m².
 */
export function areaKm2(geometry: Polygon | MultiPolygon): number {
  return turfArea(toTurfFeature(geometry)) / 1_000_000;
}

/**
 * Real intersection geometries between one authority polygon and every flood
 * feature that overlaps it — `turf.intersect()` per pair (GISTDA's tambon
 * polygons are not expected to overlap each other, so no union is needed to
 * get the per-facility "is this point in the flooded area" test right: a
 * point inside *any* one of these polygons is inside the flooded area).
 */
export function intersectFloodFeatures(
  authorityGeometry: Polygon | MultiPolygon,
  floodFeatures: readonly Pick<FloodExtentFeature, "geometry">[],
): Feature<Polygon | MultiPolygon>[] {
  const authorityFeature = toTurfFeature(authorityGeometry);
  const results: Feature<Polygon | MultiPolygon>[] = [];
  for (const f of floodFeatures) {
    const floodFeature = toTurfFeature(f.geometry as Polygon | MultiPolygon);
    const intersection = turfIntersect(turfFeatureCollection([authorityFeature, floodFeature]));
    if (intersection) results.push(intersection);
  }
  return results;
}

/** Sum of `turf.area()` over a list of intersection geometries, in km². */
export function summedAreaKm2(intersections: readonly Feature<Polygon | MultiPolygon>[]): number {
  return intersections.reduce((sum, geom) => sum + turfArea(geom) / 1_000_000, 0);
}

/** True when the point falls inside at least one of the intersection geometries. */
export function pointInAnyIntersection(
  lon: number,
  lat: number,
  intersections: readonly Feature<Polygon | MultiPolygon>[],
): boolean {
  const pt = turfPoint([lon, lat]);
  return intersections.some((geom) => turfBooleanPointInPolygon(pt, geom));
}

function facilitiesInFlood(
  facilities: readonly LocalAuthorityFacility[],
  intersections: readonly Feature<Polygon | MultiPolygon>[],
): LocalAuthorityFacility[] {
  return facilities.filter((f) => pointInAnyIntersection(f.lon, f.lat, intersections));
}

/** `estimate * fraction`, rounded — null when either input is null (never coerced to 0). */
function areaWeighted(estimate: number | null, fraction: number | null): number | null {
  if (estimate === null || fraction === null) return null;
  return Math.round(estimate * fraction * 100) / 100;
}

function observedDescriptor(retrievedAt: string | null): HazardLayerDescriptor {
  return {
    id: "local-authority-flood-impact",
    epistemicClass: "observed",
    liveOrStatic: "live",
    fetchedAt: retrievedAt,
    staleAfterSeconds: STALE_AFTER_SECONDS,
    methodologyUrl: "https://opendata.gistda.or.th/dataset/floodcheck",
    sourceIds: ["gistda-flood", "osm-admin"],
  };
}

function illustrativeEstimateDescriptor(
  id: string,
  retrievedAt: string | null,
  baselineDescriptor: HazardLayerDescriptor,
): HazardLayerDescriptor {
  // fetchedAt tracks GISTDA's retrievedAt (the input that changes on every
  // refresh and drives the endpoint's cache policy), not the static
  // WorldPop/OSM baseline's own fetchedAt — the number this descriptor
  // covers is only as fresh as the flood scene it is weighted against.
  return {
    id,
    epistemicClass: "illustrative",
    liveOrStatic: "live",
    fetchedAt: retrievedAt,
    staleAfterSeconds: STALE_AFTER_SECONDS,
    sourceIds: [...new Set<SourceId>(["gistda-flood", ...baselineDescriptor.sourceIds])],
  };
}

export interface ComputeImpactInput {
  authorityId: string;
  authorityGeometry: LocalAuthorityBoundaryGeometry;
  /** Flood features already scoped to this authority's own province — see
   *  the scope-limitation note on `LocalAuthorityImpact`. */
  floodFeatures: readonly FloodExtentFeature[];
  /** `FloodExtentResponse.retrievedAt` — null propagated honestly. */
  retrievedAt: string | null;
  baseline: LocalAuthorityBaselineExposure;
  computedAt: string;
}

/**
 * Computes the full E11.4 impact record. `floodedAreaKm2` / `floodedFraction`
 * are `null` (never `0`) when `retrievedAt` is null — GISTDA has never been
 * fetched successfully, so "no overlap" cannot be distinguished from "we
 * could not ask" and must not be reported as the former.
 */
export function computeLocalAuthorityImpact(input: ComputeImpactInput): LocalAuthorityImpact {
  const { authorityId, authorityGeometry, floodFeatures, retrievedAt, baseline, computedAt } = input;
  const authorityGeom = authorityGeometry as Polygon | MultiPolygon;
  const authorityAreaKm2 = areaKm2(authorityGeom);

  const neverFetched = retrievedAt === null;
  const intersections = neverFetched ? [] : intersectFloodFeatures(authorityGeom, floodFeatures);
  const floodedAreaKm2 = neverFetched ? null : summedAreaKm2(intersections);
  const floodedFraction =
    floodedAreaKm2 === null ? null : authorityAreaKm2 > 0 ? clamp01(floodedAreaKm2 / authorityAreaKm2) : 0;

  const facilitiesExposed = {
    hospitals: facilitiesInFlood(baseline.facilities.hospitals, intersections),
    schools: facilitiesInFlood(baseline.facilities.schools, intersections),
    fireStations: facilitiesInFlood(baseline.facilities.fireStations, intersections),
  };

  const populationExposed: LocalAuthorityImpactEstimate = {
    estimate: areaWeighted(baseline.population.estimate, floodedFraction),
    method: "area-weighted",
    descriptor: illustrativeEstimateDescriptor(
      "local-authority-population-exposed",
      retrievedAt,
      baseline.population.descriptor,
    ),
  };
  const buildingsExposed: LocalAuthorityImpactEstimate = {
    estimate: areaWeighted(baseline.buildings.count, floodedFraction),
    method: "area-weighted",
    descriptor: illustrativeEstimateDescriptor(
      "local-authority-buildings-exposed",
      retrievedAt,
      baseline.buildings.descriptor,
    ),
  };

  return {
    localAuthorityId: authorityId,
    authorityAreaKm2: Math.round(authorityAreaKm2 * 1000) / 1000,
    floodedAreaKm2: floodedAreaKm2 === null ? null : Math.round(floodedAreaKm2 * 1000) / 1000,
    floodedFraction: floodedFraction === null ? null : Math.round(floodedFraction * 10000) / 10000,
    facilitiesExposed,
    populationExposed,
    buildingsExposed,
    descriptor: observedDescriptor(retrievedAt),
    computedAt,
  };
}
