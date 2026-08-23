import type { HazardLayerDescriptor } from "./hazard-layer.js";

/**
 * Canonical registry of Thai local administrative organizations (อปท.) —
 * E11.1. Source: DLA's own open-data coverage table (see
 * `apps/etl/data/sources/dla/SOURCE.md`), baked into the API bundle at build
 * time by `apps/etl/src/buildLocalAuthorities.ts`.
 *
 * The six types below are exactly the six strings the source data contains —
 * nothing invented, nothing defaulted. Anything the source does not carry
 * for a given record (English name, district code, coordinates, area) is
 * `null`, never a fabricated placeholder.
 */
export type LocalAuthorityType =
  | "provincial_admin_org" // อบจ.
  | "city_municipality" // เทศบาลนคร
  | "town_municipality" // เทศบาลเมือง
  | "subdistrict_municipality" // เทศบาลตำบล
  | "subdistrict_admin_org" // อบต.
  | "special_admin_area"; // ท้องถิ่นรูปแบบพิเศษ

export interface LocalAuthorityRef {
  /** `TH-LAO-${dlaCode}` */
  id: string;
  /** รหัส อปท. — verbatim from source. */
  dlaCode: string;
  nameTh: string;
  /** The source carries no English names — always null, never invented. */
  nameEn: string | null;
  type: LocalAuthorityType;
  /** Mapped via `apps/etl/src/provinceBoundaries.ts`'s `readProvinceList()`. */
  provinceCode: string;
  /** อำเภอ, verbatim — the source has no district *code*, only a name. */
  districtNameTh: string | null;
  centerLat: number | null;
  centerLon: number | null;
  areaKm2: number | null;
}

/** The registry artefact written to `apps/api/src/data/localAuthorities.json`. */
export interface LocalAuthoritiesRegistry {
  descriptor: HazardLayerDescriptor;
  /** sha256 of the source CSV this registry was built from. */
  sourceSha256: string;
  recordCount: number;
  localAuthorities: LocalAuthorityRef[];
}

/** `GET /api/v1/local-authorities[?province=NN][&type=...][&q=...]` */
export interface LocalAuthoritiesResponse {
  layer: HazardLayerDescriptor;
  total: number;
  localAuthorities: LocalAuthorityRef[];
}

/** `GET /api/v1/local-authorities/:id` */
export interface LocalAuthorityDetailResponse {
  layer: HazardLayerDescriptor;
  localAuthority: LocalAuthorityRef;
}

/** Every registered `LocalAuthorityType`, for input validation. */
export const LOCAL_AUTHORITY_TYPES: readonly LocalAuthorityType[] = [
  "provincial_admin_org",
  "city_municipality",
  "town_municipality",
  "subdistrict_municipality",
  "subdistrict_admin_org",
  "special_admin_area",
];

export function isLocalAuthorityType(value: string): value is LocalAuthorityType {
  return (LOCAL_AUTHORITY_TYPES as readonly string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// E11.3 — baseline exposure (population, buildings, roads, facilities)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Baseline exposure for one local authority — E11.3. Computed by
 * `apps/etl/src/buildLocalAuthorityExposure.ts` against the real boundary
 * polygon E11.2 produced (`apps/web/public/aoi/{code}/local-authorities.geojson`)
 * and baked into `apps/api/src/data/localAuthorityExposure.json`.
 *
 * Only the 431 authorities with a real E11.2 boundary get a record — there is
 * no polygon to compute zonal statistics against for the other ~7,418, and
 * inventing one (a buffer around a point, a borrowed tambon shape) would be
 * exactly the fabrication this epic exists to eliminate. See
 * `apps/etl/data/sources/worldpop/COVERAGE.md` for the real coverage numbers.
 *
 * Deliberately absent: livestock, crops, damage curves, flash-flood index —
 * none of that data exists anywhere in this repo, so none of it is invented
 * here either.
 */
export interface LocalAuthorityBaselineExposure {
  /** `TH-LAO-{dlaCode}` — joins back to `LocalAuthorityRef.id`. */
  localAuthorityId: string;
  population: {
    /** Sum of WorldPop pixel values (people/pixel) over the polygon. `null`
     *  when the zonal crop failed (gdalwarp/gdal_translate error, or no valid
     *  pixel in the crop) — never a fabricated 0 indistinguishable from a
     *  real zero-population result. */
    estimate: number | null;
    datasetId: "worldpop_tha_2020_UNadj";
    resolutionM: 100;
    vintage: "2020";
    descriptor: HazardLayerDescriptor;
  };
  buildings: {
    /** Footprints (`building=*` polygons) whose centroid falls inside the polygon. */
    count: number;
    /** null only when `population.estimate` is 0 — never a fabricated ratio. */
    perThousandPop: number | null;
    /** OSM replication timestamp of the extract this count came from. */
    osmExtractDate: string | null;
    descriptor: HazardLayerDescriptor;
  };
  roads: {
    totalKm: number;
    /** Keyed by whatever raw `highway=*` value was actually found — not a
     *  fixed enum promising categories that might not occur in this authority. */
    byClass: Record<string, number>;
    descriptor: HazardLayerDescriptor;
  };
  facilities: {
    hospitals: LocalAuthorityFacility[];
    schools: LocalAuthorityFacility[];
    fireStations: LocalAuthorityFacility[];
    descriptor: HazardLayerDescriptor;
  };
  /** When this ETL run produced the record — real, not a fabricated stamp. */
  computedAt: string;
}

/** A single OSM point/polygon-centroid facility — no invented names. */
export interface LocalAuthorityFacility {
  osmId: string;
  /** `name:th` → `name` → null — many OSM facility nodes carry no name at all. */
  nameTh: string | null;
  lat: number;
  lon: number;
}

/** The artefact written to `apps/api/src/data/localAuthorityExposure.json`. */
export interface LocalAuthorityExposureArtefact {
  generatedAt: string;
  recordCount: number;
  exposures: LocalAuthorityBaselineExposure[];
}

/** `GET /api/v1/local-authorities/:id/exposure` */
export interface LocalAuthorityExposureResponse {
  exposure: LocalAuthorityBaselineExposure;
}

// ─────────────────────────────────────────────────────────────────────────────
// E11.4 — real flood-extent intersection (replaces the reverted name-matching
// version, which never read flood geometry at all)
// ─────────────────────────────────────────────────────────────────────────────

/** A `Polygon`/`MultiPolygon` in WGS84 lon/lat — same shape GISTDA's flood
 *  features use, so the two can be intersected with no reprojection. */
export type LocalAuthorityBoundaryGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

/** One authority's real boundary polygon, repackaged for the API bundle —
 *  see `apps/api/src/data/localAuthorityBoundaries.json`. */
export interface LocalAuthorityBoundaryRecord {
  /** `TH-LAO-{dlaCode}` — joins to `LocalAuthorityRef.id`. */
  id: string;
  geometry: LocalAuthorityBoundaryGeometry;
}

/** The artefact written to `apps/api/src/data/localAuthorityBoundaries.json` —
 *  a Worker-bundle-friendly repackaging of the real E11.2 geometry already
 *  committed under `apps/web/public/aoi/{code}/local-authorities.geojson`.
 *  Purely a repackaging step: geometry is copied verbatim, never recomputed. */
export interface LocalAuthorityBoundariesArtefact {
  generatedAt: string;
  recordCount: number;
  boundaries: LocalAuthorityBoundaryRecord[];
}

/** An area-weighted derived number — `illustrative`, not `observed`: a
 *  proportional share of a static baseline, not a directly measured value
 *  and not a density-adjusted or otherwise modeled estimate. `estimate` is
 *  null exactly when the underlying E11.3 baseline itself is null (e.g. a
 *  failed WorldPop zonal crop) — never coerced to 0. */
export interface LocalAuthorityImpactEstimate {
  estimate: number | null;
  method: "area-weighted";
  descriptor: HazardLayerDescriptor;
}

/**
 * Real polygon intersection between the current GISTDA flood-extent scene
 * and one local authority's real E11.2 boundary — E11.4. Computed by
 * `apps/api/src/geo/floodIntersection.ts` on every request (cheap: turf
 * against at most a few dozen tambon polygons per province), only for
 * authorities that have both a real E11.2 boundary and a real E11.3
 * baseline exposure record — everything else is 404, never a fabricated
 * record (see `LocalAuthorityImpactResponse`'s route doc).
 *
 * `floodedAreaKm2` / `floodedFraction` / `facilitiesExposed` are genuinely
 * `observed`: `turf.intersect()` against real geometry and
 * `turf.booleanPointInPolygon()` against real facility coordinates — not an
 * interpretation, a direct computation on two real polygons.
 *
 * `floodedAreaKm2` and `floodedFraction` are `null` — not `0` — when GISTDA
 * has never been fetched successfully (`descriptor.fetchedAt === null`):
 * "never fetched" and "fetched, no overlap" are different facts and must
 * stay visibly different, same rule as everywhere else in this codebase.
 * `0` is a real, valid answer for "fetched, but this authority has no
 * overlap right now."
 *
 * Scope limitation, stated rather than silently absorbed: flood features are
 * looked up by the authority's own province only (`FloodExtentDO.getProvince`
 * has no cross-province accessor) — a flood polygon GISTDA attributed to a
 * neighbouring province that physically overlaps a boundary-adjacent
 * authority is not counted here.
 */
export interface LocalAuthorityImpact {
  localAuthorityId: string;
  /** Real area of the authority's own polygon, `turf.area()` in km². */
  authorityAreaKm2: number;
  /** Sum of `turf.area(intersection)` over every flood feature (in the
   *  authority's own province) that overlaps it, in km². Zero when there is
   *  no overlap right now — a real answer, not an error. Not clamped to
   *  `authorityAreaKm2`: adjacent flood polygons can each contribute area
   *  along a shared edge, so the raw sum is reported as computed rather than
   *  silently capped. Null — never 0 — when GISTDA has never been fetched
   *  successfully. */
  floodedAreaKm2: number | null;
  /** `floodedAreaKm2 / authorityAreaKm2`, clamped to `[0, 1]`. Null under
   *  the same never-fetched condition as `floodedAreaKm2`. */
  floodedFraction: number | null;
  /** Real facility points (from the E11.3 baseline's own facility list) that
   *  fall inside the flooded intersection geometry — not merely inside the
   *  authority's boundary. Empty (not null) both when GISTDA has never been
   *  fetched and when nothing is currently flooded — `descriptor.fetchedAt`
   *  is what distinguishes those two cases. */
  facilitiesExposed: {
    hospitals: LocalAuthorityFacility[];
    schools: LocalAuthorityFacility[];
    fireStations: LocalAuthorityFacility[];
  };
  /** Area-weighted share of the E11.3 population baseline. */
  populationExposed: LocalAuthorityImpactEstimate;
  /** Area-weighted share of the E11.3 building-count baseline. */
  buildingsExposed: LocalAuthorityImpactEstimate;
  /** Covers `floodedAreaKm2` / `floodedFraction` / `facilitiesExposed`.
   *  `fetchedAt` mirrors `FloodExtentResponse.retrievedAt` honestly — null
   *  when GISTDA has never been fetched successfully, never substituted with
   *  "now". No `confidence` field anywhere in this type: nothing in this
   *  computation produces a calibrated confidence value. */
  descriptor: HazardLayerDescriptor;
  /** When this computation ran — real, not a fabricated stamp. */
  computedAt: string;
}

/** `GET /api/v1/local-authorities/:id/impact` */
export interface LocalAuthorityImpactResponse {
  impact: LocalAuthorityImpact;
}
