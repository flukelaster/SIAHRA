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
