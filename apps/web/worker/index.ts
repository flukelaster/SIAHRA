/**
 * siahra-web's only server-side job: serve the terrain/building/feature/landcover
 * tile pyramid out of R2.
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

/** `/aoi/{province}/{layer}/{z}/{x}_{y}.bin` — mirrors the dev-only Vite middleware in vite.config.ts. */
const TILE_PATH = /^\/aoi\/(\d{2})\/(terrain|buildings|features|landcover)\/(\d+)\/(\d+)_(\d+)\.bin$/;

/**
 * Tiles are content-addressed by path: a given {z}/{x}_{y} for a province never
 * changes without the ETL producing a new pyramid, so they can be cached
 * forever. This is also what keeps R2 read volume (and cost) near zero.
 */
const TILE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const tile = TILE_PATH.exec(url.pathname);

    // Not a tile: hand it back to the asset layer. There is deliberately no
    // `run_worker_first` in wrangler.jsonc — the asset layer answers first and
    // only what it does not have (a `.bin` tile that is not in the bundle)
    // reaches this Worker, so the tracked manifests and overviews under /aoi/
    // are usually served without ever getting here. This branch is the
    // fallthrough for the requests that do.
    if (!tile) return env.ASSETS.fetch(request);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    // `caches.default.put`/`match` only accept GET, so HEAD skips the cache and
    // goes straight to R2 (cheap: R2 HEAD reads no body).
    const cacheable = request.method === "GET";
    const cache = caches.default;
    if (cacheable) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }

    const [, province, layer, z, x, y] = tile;
    const key = `aoi/${province}/${layer}/${z}/${x}_${y}.bin`;
    const object = await env.HAZARD_BUCKET.get(key);

    // A miss must be a real 404. If this fell through to the asset layer the
    // SPA fallback would answer with index.html, and the tile loader would try
    // to parse an HTML page as binary and fail silently — which is exactly how
    // the missing-tiles bug presented in production.
    if (!object) return new Response("Tile not found", { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-type", "application/octet-stream");
    headers.set("cache-control", TILE_CACHE_CONTROL);
    headers.set("etag", object.httpEtag);

    const response = new Response(object.body, { headers });
    if (cacheable) ctx.waitUntil(cache.put(request, response.clone()));
    return response;
  },
} satisfies ExportedHandler<Env>;
