/**
 * The one parser for Copernicus GFM flood-scene request paths (E14.F3), shared
 * — exactly like `tilePath.ts` — by `worker/index.ts` (R2 key, production) and
 * the dev-only middleware in `vite.config.ts` (filesystem path under
 * `apps/etl/data/flood/aoi`). One regex, so the two can never disagree about
 * what a flood path is.
 *
 * Three accepted files, all under one province prefix (docs/dataset.md §8):
 *
 *   /aoi/{code}/flood/index.json                     the listing — R2 is never list()ed
 *   /aoi/{code}/flood/{sceneId}/field.bin            gzip'd cell field, immutable
 *   /aoi/{code}/flood/{sceneId}/meta.json            scene metadata, immutable
 *
 * `{sceneId}` is `\d{8}T\d{6}-[A-Z]{2}\d{3}M` (acquisition time + Equi7 tile
 * group, `packages/shared-types/src/flood.ts`): a satellite pass that already
 * happened never changes, which is what lets the two scene files be cached
 * for a year, while `index.json` is overwritten whenever a new scene lands and
 * so gets a short cache with serve-stale.
 *
 * ## Path traversal
 *
 * `{code}` and `{sceneId}` become part of an R2 key (prod) or a `path.join`
 * argument (dev), so they are constrained by shape, not "sanitised": two
 * digits, and the scene-id pattern above. No character class admits `.` on
 * its own, `/`, `%` or the empty string, so `..`, `%2e%2e`, `%2f`, `a/b` and an
 * empty segment cannot match — rejected by construction. The file name is one
 * of three literals. See the long note in `tilePath.ts` for what the WHATWG
 * URL parser does with dot segments before the Worker sees `pathname` (it
 * resolves them, which can only walk *up* and out of a match) and what it
 * leaves alone (`%2f`, which stays inside a segment and is rejected here).
 *
 * The key and the local path are built only from captured groups; a string
 * that is not a strict match never becomes a key at all.
 */

export const FLOOD_FILES = ["index.json", "field.bin", "meta.json"] as const;
export type FloodFile = (typeof FLOOD_FILES)[number];

/** `YYYYMMDDTHHMMSS-XX000M` — kept in step with `SCENE_ID_RE` in apps/etl/gfm/gfm/contract.py. */
const SCENE_ID = "\\d{8}T\\d{6}-[A-Z]{2}\\d{3}M";

/** `/aoi/{code}/flood/index.json` or `/aoi/{code}/flood/{sceneId}/(field.bin|meta.json)` */
const FLOOD_PATH = new RegExp(`^/aoi/(\\d{2})/flood/(?:(index\\.json)|(${SCENE_ID})/(field\\.bin|meta\\.json))$`);

export interface FloodRef {
  province: string;
  /** null for `index.json`, which lives directly under the province prefix. */
  sceneId: string | null;
  file: FloodFile;
}

/**
 * Parse a request path. `input` may carry a query string (Node's `req.url`
 * does, `URL.pathname` does not) — it is cut off first so both callers see the
 * same string. Returns null for anything that is not a flood file, which the
 * callers must treat as "not mine": in the Worker that means the asset layer,
 * in dev `next()`.
 */
export function parseFloodPath(input: string): FloodRef | null {
  const q = input.indexOf("?");
  const pathname = q === -1 ? input : input.slice(0, q);
  const m = FLOOD_PATH.exec(pathname);
  if (!m) return null;
  if (m[2]) return { province: m[1], sceneId: null, file: "index.json" };
  return { province: m[1], sceneId: m[3], file: m[4] as FloodFile };
}

/** The R2 object key for a parsed path — `aoi/…` with no leading slash, mirroring the URL exactly. */
export function floodKey(ref: FloodRef): string {
  return ref.sceneId === null
    ? `aoi/${ref.province}/flood/${ref.file}`
    : `aoi/${ref.province}/flood/${ref.sceneId}/${ref.file}`;
}

/**
 * Path segments of the file inside the local tree the pipeline writes
 * (`apps/etl/data/flood/aoi`, the same keys as R2 character for character),
 * for the dev middleware only.
 */
export function localFloodSegments(ref: FloodRef): string[] {
  return ref.sceneId === null
    ? [ref.province, "flood", ref.file]
    : [ref.province, "flood", ref.sceneId, ref.file];
}

export interface FloodFileHeaders {
  contentType: string;
  cacheControl: string;
  /**
   * `gzip` for `field.bin` only: the pipeline always writes it gzip'd
   * (encode.gzip_bytes, deterministic mtime=0) and the workflow uploads the
   * bytes as they are, so the header is the Worker's to set — the object's
   * own metadata never has to be right. The Response carrying it must be
   * constructed with `encodeBody: "manual"` so the runtime does not compress
   * the already-compressed body a second time.
   */
  contentEncoding: "gzip" | null;
}

/**
 * `index.json` is rewritten whenever a scene lands (~every 6 h at most):
 * 5 min fresh + 10 min serve-stale means a client sees a new scene at most a
 * few minutes late, never a wrong one — every scene an older index points at
 * is still there (immutable). The two scene files are content that already
 * happened and are cached for a year (docs/dataset.md §8).
 */
const INDEX_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=600";
const SCENE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function floodHeaders(ref: FloodRef): FloodFileHeaders {
  switch (ref.file) {
    case "index.json":
      return { contentType: "application/json", cacheControl: INDEX_CACHE_CONTROL, contentEncoding: null };
    case "meta.json":
      return { contentType: "application/json", cacheControl: SCENE_CACHE_CONTROL, contentEncoding: null };
    case "field.bin":
      return { contentType: "application/octet-stream", cacheControl: SCENE_CACHE_CONTROL, contentEncoding: "gzip" };
  }
}
