import { isProvinceCode } from "@siahra/shared-types";
import { getHistoricalEventById, queryHistoricalEvents } from "../data/historicalEvents.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import * as cachePolicy from "../cachePolicy.js";

/**
 * GET /api/v1/historical/events[?province=NN]
 */
export async function handleHistoricalEvents(req: Request, _env: AppEnv): Promise<Response> {
  const url = new URL(req.url);
  const province = url.searchParams.get("province");

  if (province !== null && !isProvinceCode(province)) {
    return json({ error: `Invalid province code "${province}"` }, { status: 400 });
  }

  const result = queryHistoricalEvents(province ?? undefined);

  return json(result, {
    cache: cachePolicy.slowMoving,
  });
}

/**
 * GET /api/v1/historical/events/:id
 */
export async function handleHistoricalEventDetail(id: string, _env: AppEnv): Promise<Response> {
  const event = getHistoricalEventById(id);
  if (!event) {
    return json({ error: `Historical flood event "${id}" not found` }, { status: 404 });
  }

  return json(event, {
    cache: cachePolicy.slowMoving,
  });
}
