import { noStore, type CachePolicy } from "./cachePolicy.js";
import { checkLimit, clientKey, originAllowed, type Limit } from "./rateLimit.js";
import { withSecurityHeaders } from "./securityHeaders.js";
import type { AppEnv } from "./types.js";
import { errorText, logError } from "./log.js";

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
  /**
   * Method this route answers — required, so a new endpoint cannot silently
   * inherit "any method". A `GET` route also answers `HEAD` (served as GET
   * with the body stripped), which is what keeps `curl -I` honest.
   */
  method: "GET" | "POST";
  pattern: RegExp;
  handler: Handler;
  /** Per-client rate limit; defaults to DEFAULT_LIMIT. */
  limit?: Limit;
  /** Bucket name so several routes can share one budget. */
  limitScope?: string;
}

const DEFAULT_LIMIT: Limit = { perMinute: 300 };

/**
 * คำตอบ JSON ทุกอันของ API ออกทางนี้ทางเดียว — นโยบายแคชจึงเป็น "ชื่อ" จาก
 * cachePolicy.ts ไม่ใช่ string ที่พิมพ์ซ้ำในแต่ละ route (E4.6) ส่วนเฮดเดอร์ความปลอดภัย
 * ไม่ได้ใส่ที่นี่ แต่ใส่ที่ทางออกของ router ทีเดียว เพื่อให้คำตอบที่ไม่ใช่ JSON
 * (ภาพเรดาร์ PNG, 426 ของ WebSocket) ได้ชุดเดียวกันโดยไม่ต้องจำ
 */
export const json = (
  body: unknown,
  init: { status?: number; cache?: CachePolicy; headers?: Record<string, string> } = {},
): Response => {
  const status = init.status ?? 200;
  // 4xx/5xx เป็น no-store เสมอ แม้ route จะขอนโยบายอื่นมา: คำตอบที่ผิดพลาดถูก CDN
  // เก็บไว้แจกต่อ = ความล้มเหลวชั่วคราวกลายเป็นความล้มเหลวค้าง
  const cache = status >= 400 ? noStore : (init.cache ?? noStore);
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": cache.value,
      ...(init.headers ?? {}),
    },
  });
};

/**
 * The `Allow` value for a path: every method its routes declare, plus HEAD
 * whenever GET is one of them. Deterministic order (GET, HEAD, POST) so the
 * header is comparable across responses.
 */
export function allowHeader(matched: Route[]): string {
  const methods = new Set<string>();
  for (const route of matched) {
    methods.add(route.method);
    if (route.method === "GET") methods.add("HEAD");
  }
  return ["GET", "HEAD", "POST"].filter((m) => methods.has(m)).join(", ");
}

/**
 * RFC 9110: a HEAD response carries the headers of the GET response and no
 * body. Statuses that are defined as body-less already (and the 101 upgrade)
 * are passed through untouched — constructing a Response for those with an
 * explicit null body is either pointless or a RangeError.
 */
function withoutBody(res: Response): Response {
  if (res.status === 101 || res.status === 204 || res.status === 304) return res;
  const stripped = new Response(null, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
  // The GET body was produced but is never sent; release it rather than
  // leaving an R2/DO stream dangling for the GC. A locked or already-consumed
  // body throws synchronously — that is fine, there is nothing left to free.
  try {
    void res.body?.cancel().catch(() => {});
  } catch {
    // already consumed
  }
  return stripped;
}

export function createRouter(routes: Route[]) {
  const dispatch = async (request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (!originAllowed(request, env.ALLOWED_ORIGINS ?? "")) {
      return json({ error: "Cross-origin use of this API is not allowed" }, { status: 403 });
    }
    // HEAD is dispatched as GET; the body is dropped on the way out.
    const method = request.method === "HEAD" ? "GET" : request.method;
    // Path first, method second: a known path called with the wrong method has
    // to answer 405 + Allow, not 404. Rate limiting stays where it was —
    // after the same-origin guard, before the handler runs.
    const matched: Route[] = [];
    for (const route of routes) {
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      matched.push(route);
      if (route.method !== method) continue;
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
        logError("unhandled route error", { path: pathname, error: errorText(err) });
        return json({ error: "Internal error" }, { status: 500 });
      }
    }
    if (matched.length > 0) {
      const allow = allowHeader(matched);
      return json(
        { error: "Method not allowed", allow },
        { status: 405, headers: { Allow: allow } },
      );
    }
    return json({ error: "Not found" }, { status: 404 });
  };

  return async (request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> => {
    // เฮดเดอร์ความปลอดภัยใส่ที่ทางออกเดียวของ router — route ใหม่จึงลืมไม่ได้
    // (การ upgrade เป็น WebSocket ถูกส่งผ่านโดยไม่แตะ ดู securityHeaders.ts)
    const res = withSecurityHeaders(await dispatch(request, env, ctx));
    return request.method === "HEAD" ? withoutBody(res) : res;
  };
}
