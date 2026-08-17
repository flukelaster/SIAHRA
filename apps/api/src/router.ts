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
}

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
    for (const route of routes) {
      if (route.method && request.method !== route.method) continue;
      const m = route.pattern.exec(pathname);
      if (!m) continue;
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
