import { checkLimit, clientKey, originAllowed, type Limit } from "./rateLimit.js";
import type { AppEnv } from "./types.js";

/**
 * Tiny pattern router: keeps index.ts a declarative table instead of a
 * growing if-chain as endpoints are added. Patterns are RegExps matched
 * against the pathname; capture groups are passed to the handler.
 */
export type Handler = (
  request: Request,
  env: AppEnv,
  params: string[],
  ctx: ExecutionContext,
) => Promise<Response> | Response;

export interface Route {
  method?: "GET" | "POST";
  pattern: RegExp;
  handler: Handler;
  /** Per-client rate limit; defaults to DEFAULT_LIMIT. */
  limit?: Limit;
  /** Bucket name so several routes can share one budget. */
  limitScope?: string;
}

const DEFAULT_LIMIT: Limit = { perMinute: 300 };

export const json = (
  body: unknown,
  init: { status?: number; cacheControl?: string; headers?: Record<string, string> } = {},
): Response =>
  Response.json(body, {
    status: init.status ?? 200,
    headers: {
      "Cache-Control": init.cacheControl ?? "no-store",
      ...(init.headers ?? {}),
    },
  });

export function createRouter(routes: Route[]) {
  return async (request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (!originAllowed(request, env.ALLOWED_ORIGINS ?? "")) {
      return json({ error: "Cross-origin use of this API is not allowed" }, { status: 403 });
    }
    for (const route of routes) {
      if (route.method && request.method !== route.method) continue;
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      const wait = checkLimit(route.limitScope ?? route.pattern.source, clientKey(request), route.limit ?? DEFAULT_LIMIT);
      if (wait !== null) {
        return json(
          { error: "Too many requests", retryAfterSeconds: wait },
          { status: 429, headers: { "Retry-After": String(wait) } },
        );
      }
      try {
        return await route.handler(request, env, m.slice(1), ctx);
      } catch (err) {
        console.error(
          JSON.stringify({ level: "error", message: "unhandled route error", path: pathname, error: String(err) }),
        );
        return json({ error: "Internal error" }, { status: 500 });
      }
    }
    return json({ error: "Not found" }, { status: 404 });
  };
}
