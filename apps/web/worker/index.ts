/**
 * siahra-web's only server-side job: serve the terrain/building/feature/landcover
 * tile pyramid and the Copernicus GFM flood scenes (E14.F3) out of R2.
 *
 * Everything else on this Worker is a static asset from `dist`, including the
 * small tracked files that share the `/aoi/` prefix (manifest.json,
 * boundary.geojson, hillshade.png, the low-res terrain.bin overview). A
 * Cloudflare route cannot split one prefix by file extension, which is why the
 * big tiles live here rather than on siahra-api — see docs/deploy.md §2.
 *
 * The tiles themselves are ~5.6 GB / ~300k objects (apps/etl/data/tiles), far
 * past the 20,000-file asset-bundle limit, so they are uploaded to R2 instead
 * and read back through this handler.
 */

import { floodHeaders, floodKey, parseFloodPath } from "./floodPath.ts";
import { parseTilePath, tileKey } from "./tilePath.ts";

/**
 * Tiles are content-addressed by path: a given {z}/{x}_{y} for a province never
 * changes without the ETL producing a new pyramid, so they can be cached
 * forever. This is also what keeps R2 read volume (and cost) near zero.
 */
const TILE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * The host-level half of public/_headers, for the responses this Worker
 * produces itself (E4.2). `_headers` is applied by the static-asset layer, and
 * a tile read out of R2 never goes through it — without this a `.bin` tile
 * would come back with no HSTS and no nosniff. The values are duplicated on
 * purpose: one file is configuration read by Cloudflare, the other is code, and
 * no import can span the two. Keep them in step (docs/security.md).
 */
const SHARED_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  // max-age only — no includeSubDomains, no preload (docs/roadmap.md §4).
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy":
    "accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=()",
};

/**
 * A tile or an error string is never a document, so nothing may be loaded from
 * it at all.
 */
const NON_DOCUMENT_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * `set`, never `append`: two Content-Security-Policy headers on one response
 * are *intersected* by the browser, so a duplicate is not cosmetic — it
 * silently narrows the policy.
 *
 * Only responses this Worker constructed itself are passed in (the R2 tile and
 * its 404/405), so their headers are still mutable and nothing has to be
 * rebuilt. Asset-layer responses are deliberately *not* passed through here:
 * they already carry public/_headers, and a second CSP is exactly the
 * intersection problem above.
 */
function withSecurityHeaders(res: Response): Response {
  for (const [name, value] of Object.entries(SHARED_SECURITY_HEADERS)) res.headers.set(name, value);
  res.headers.set("Content-Security-Policy", NON_DOCUMENT_CSP);
  return res;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // Both the version-addressed and the legacy path shapes; the parser is
    // shared with the dev middleware in vite.config.ts so the two can never
    // disagree about what a tile path is (worker/tilePath.ts).
    const tile = parseTilePath(url.pathname);
    // Flood scenes share the `/aoi/{code}/` prefix but live under their own
    // `flood/` segment, which no tile layer name can match — the two parsers
    // are disjoint by construction (worker/floodPath.ts).
    const flood = tile ? null : parseFloodPath(url.pathname);

    // Not a tile or a flood file: hand it back to the asset layer. There is
    // deliberately no `run_worker_first` in wrangler.jsonc — the asset layer
    // answers first and only what it does not have (a `.bin` tile or a flood
    // scene that is not in the bundle) reaches this Worker, so the tracked
    // manifests and overviews under /aoi/ are usually served without ever
    // getting here. This branch is the fallthrough for the requests that do.
    // Handed back untouched on purpose: asset responses already carry the
    // headers from public/_headers, and stamping a second
    // Content-Security-Policy here would make the browser *intersect* the two —
    // a silently narrower policy, plus a second copy of the policy string free
    // to drift from the one Cloudflare actually reads.
    if (!tile && !flood) return env.ASSETS.fetch(request);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return withSecurityHeaders(
        new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } }),
      );
    }

    // `caches.default.put`/`match` only accept GET, so HEAD skips the cache and
    // goes straight to R2 (cheap: R2 HEAD reads no body).
    const cacheable = request.method === "GET";
    const cache = caches.default;
    if (cacheable) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }

    // A versioned URL resolves to a versioned key — the version is never
    // stripped to fall back on the legacy object, or two dataset versions would
    // silently share one set of bytes (docs/dataset.md §7). A flood key is
    // assembled from the parsed captures the same way. One R2 `get` per miss,
    // never a `list()` — `index.json` *is* the listing (docs/dataset.md §8).
    const object = await env.HAZARD_BUCKET.get(tile ? tileKey(tile) : floodKey(flood!));

    // A miss must be a real 404. If this fell through to the asset layer the
    // SPA fallback would answer with index.html, and the tile loader would try
    // to parse an HTML page as binary and fail silently — which is exactly how
    // the missing-tiles bug presented in production. For a flood file the same
    // holds: a province with no scene yet must read as "no index", not as an
    // HTML page the field loader chokes on.
    if (!object) {
      return withSecurityHeaders(new Response(tile ? "Tile not found" : "Flood scene not found", { status: 404 }));
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    const meta = tile
      ? { contentType: "application/octet-stream", cacheControl: TILE_CACHE_CONTROL, contentEncoding: null }
      : floodHeaders(flood!);
    headers.set("content-type", meta.contentType);
    headers.set("cache-control", meta.cacheControl);
    headers.set("etag", object.httpEtag);
    // `field.bin` is stored gzip'd and served as-is: the header comes from the
    // path, not from object metadata, and `encodeBody: "manual"` tells the
    // runtime the body is already encoded so it is not compressed twice.
    if (meta.contentEncoding) headers.set("content-encoding", meta.contentEncoding);
    else headers.delete("content-encoding");

    const response = withSecurityHeaders(
      new Response(object.body, { headers, encodeBody: meta.contentEncoding ? "manual" : "automatic" }),
    );
    if (cacheable) ctx.waitUntil(cache.put(request, response.clone()));
    return response;
  },
} satisfies ExportedHandler<Env>;
