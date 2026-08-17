/**
 * Per-client token buckets kept in isolate memory. First line of defence for
 * the public API (the Cloudflare WAF rate-limiting rules in docs/deploy.md are
 * the second); good enough because abuse we care about is "one client
 * hammering /history", not a distributed flood.
 *
 * Buckets live per isolate, so limits are approximate across PoPs — that is
 * fine: the goal is to protect upstream sources and DO CPU, not accounting.
 */
export interface Limit {
  /** Requests allowed per minute per client. */
  perMinute: number;
  /** Burst headroom above the sustained rate. */
  burst?: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;
let rejected = 0;
let rejectedWindowStart = Date.now();

export function clientKey(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}

/** Returns null when allowed, or seconds to wait when the client is over its limit. */
export function checkLimit(scope: string, key: string, limit: Limit, now = Date.now()): number | null {
  const capacity = limit.perMinute + (limit.burst ?? Math.ceil(limit.perMinute * 0.5));
  const refillPerMs = limit.perMinute / 60000;
  const id = `${scope}:${key}`;
  let b = buckets.get(id);
  if (!b) {
    if (buckets.size >= MAX_KEYS) sweep(now);
    b = { tokens: capacity, updatedAt: now };
    buckets.set(id, b);
  }
  b.tokens = Math.min(capacity, b.tokens + (now - b.updatedAt) * refillPerMs);
  b.updatedAt = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return null;
  }
  countRejection(now);
  return Math.max(1, Math.ceil((1 - b.tokens) / refillPerMs / 1000));
}

function sweep(now: number) {
  for (const [k, b] of buckets) {
    if (now - b.updatedAt > 5 * 60000) buckets.delete(k);
  }
  if (buckets.size >= MAX_KEYS) buckets.clear();
}

function countRejection(now: number) {
  if (now - rejectedWindowStart > 3600000) {
    rejected = 0;
    rejectedWindowStart = now;
  }
  rejected++;
}

/** 429s issued by this isolate in the current hour (for /health). */
export function rejectedLastHour(): number {
  return Date.now() - rejectedWindowStart > 3600000 ? 0 : rejected;
}

/**
 * Same-origin guard: browsers announce cross-site calls via Origin /
 * Sec-Fetch-Site. Anything not from our own host (or ALLOWED_ORIGINS) is
 * refused so third-party pages cannot embed our API for free.
 */
export function originAllowed(request: Request, allowedOrigins: string): boolean {
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (!origin && (!site || site === "same-origin" || site === "none")) return true;
  const self = new URL(request.url).host;
  // Behind the Vite dev proxy the Worker sees 127.0.0.1:8787 while the page is
  // localhost:5173 — accept the forwarded host and any loopback pairing.
  const forwardedHost = request.headers.get("X-Forwarded-Host");
  const isLoopback = (h: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h);
  const allowed = new Set(
    allowedOrigins
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.host === self || o.host === forwardedHost || allowed.has(o.origin)) return true;
      if (isLoopback(o.host) && isLoopback(self)) return true;
    } catch {
      return false;
    }
    return false;
  }
  // No Origin but Sec-Fetch-Site says cross-site (rare: some fetches strip Origin).
  return site !== "cross-site";
}
