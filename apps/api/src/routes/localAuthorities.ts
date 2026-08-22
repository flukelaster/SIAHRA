import {
  isProvinceCode,
  type LocalAuthoritiesResponse,
  type LocalAuthorityBaselineExposure,
  type LocalAuthorityExposureResponse,
  type LocalAuthorityType,
} from "@siahra/shared-types";
import { getLocalAuthorityById, queryLocalAuthorities } from "../data/localAuthorities.js";
import { getBaselineExposure, queryBaselineExposures } from "../data/baselineExposure.js";
import { computeLocalAuthorityImpact, computeProvinceImpacts } from "../data/spatialJoin.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import * as cachePolicy from "../cachePolicy.js";

const VALID_TYPES: Set<string> = new Set([
  "city_municipality",
  "town_municipality",
  "subdistrict_municipality",
  "subdistrict_admin_org",
  "special_admin_area",
  "provincial_admin_org",
]);

/**
 * GET /api/v1/local-authorities
 * Query parameters:
 * - province: 2-digit province code (e.g. "90")
 * - type: LocalAuthorityType
 * - q: text search (Thai or English name, or DLA code)
 */
export async function handleLocalAuthoritiesList(req: Request, _env: AppEnv): Promise<Response> {
  const url = new URL(req.url);
  const province = url.searchParams.get("province");
  const typeParam = url.searchParams.get("type");
  const query = url.searchParams.get("q") || undefined;

  if (province !== null && !isProvinceCode(province)) {
    return json({ error: `Invalid province code "${province}"` }, { status: 400 });
  }

  let type: LocalAuthorityType | undefined;
  if (typeParam !== null) {
    if (!VALID_TYPES.has(typeParam)) {
      return json({ error: `Invalid local authority type "${typeParam}"` }, { status: 400 });
    }
    type = typeParam as LocalAuthorityType;
  }

  const results = queryLocalAuthorities({
    provinceCode: province ?? undefined,
    type,
    query,
  });

  const response: LocalAuthoritiesResponse = {
    total: results.length,
    localAuthorities: results,
  };

  return json(response, {
    cache: cachePolicy.slowMoving,
  });
}

/**
 * GET /api/v1/local-authorities/:id
 */
export async function handleLocalAuthorityDetail(id: string, _env: AppEnv): Promise<Response> {
  const lao = getLocalAuthorityById(id);
  if (!lao) {
    return json({ error: `Local authority "${id}" not found` }, { status: 404 });
  }

  return json(lao, {
    cache: cachePolicy.slowMoving,
  });
}

/**
 * GET /api/v1/local-authorities/:id/exposure
 */
export async function handleLocalAuthorityExposure(id: string, _env: AppEnv): Promise<Response> {
  const baseline = getBaselineExposure(id);
  if (!baseline) {
    return json({ error: `Baseline exposure for local authority "${id}" not found` }, { status: 404 });
  }

  const response: LocalAuthorityExposureResponse = {
    baseline,
  };

  return json(response, {
    cache: cachePolicy.slowMoving,
  });
}

/**
 * GET /api/v1/local-authorities/exposure[?province=NN]
 */
export async function handleLocalAuthoritiesExposureList(req: Request, _env: AppEnv): Promise<Response> {
  const url = new URL(req.url);
  const province = url.searchParams.get("province");

  if (province !== null && !isProvinceCode(province)) {
    return json({ error: `Invalid province code "${province}"` }, { status: 400 });
  }

  const results: LocalAuthorityBaselineExposure[] = queryBaselineExposures(province ?? undefined);

  return json(
    {
      total: results.length,
      exposures: results,
    },
    {
      cache: cachePolicy.slowMoving,
    },
  );
}

/**
 * GET /api/v1/local-authorities/:id/impact
 */
export async function handleLocalAuthorityImpact(id: string, env: AppEnv): Promise<Response> {
  const lao = getLocalAuthorityById(id);
  if (!lao) {
    return json({ error: `Local authority "${id}" not found` }, { status: 404 });
  }

  const baseline = getBaselineExposure(id);
  if (!baseline) {
    return json({ error: `Baseline exposure for local authority "${id}" not found` }, { status: 404 });
  }

  const floodStub = env.FLOOD_EXTENT.getByName("gistda");
  const floodData = await floodStub.getProvince(lao.provinceCode);

  const impact = computeLocalAuthorityImpact(
    lao,
    baseline,
    floodData.features,
    floodData.retrievedAt,
  );

  return json(impact, {
    cache: cachePolicy.floodExtent(floodData.retrievedAt),
  });
}

/**
 * GET /api/v1/local-authorities/impact[?province=NN]
 */
export async function handleLocalAuthoritiesImpactList(req: Request, env: AppEnv): Promise<Response> {
  const url = new URL(req.url);
  const province = url.searchParams.get("province");

  if (!province) {
    return json({ error: "Missing required query parameter: province" }, { status: 400 });
  }

  if (!isProvinceCode(province)) {
    return json({ error: `Invalid province code "${province}"` }, { status: 400 });
  }

  const floodStub = env.FLOOD_EXTENT.getByName("gistda");
  const floodData = await floodStub.getProvince(province);

  const impacts = computeProvinceImpacts(province, floodData.features, floodData.retrievedAt);

  return json(
    {
      total: impacts.length,
      provinceCode: province,
      retrievedAt: floodData.retrievedAt,
      impacts,
    },
    {
      cache: cachePolicy.floodExtent(floodData.retrievedAt),
    },
  );
}
