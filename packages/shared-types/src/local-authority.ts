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
