/**
 * The one parser for tile request paths (E9.2), shared by the two places that
 * turn a URL into bytes: `worker/index.ts` (R2 key, production) and the dev-only
 * middleware in `vite.config.ts` (filesystem path). One regex, so the two can
 * never drift into disagreeing about what a tile path is.
 *
 * Two accepted forms:
 *
 *   /aoi/{code}/v/{version}/{layer}/{z}/{x}_{y}.bin   version-addressed (E9.2)
 *   /aoi/{code}/{layer}/{z}/{x}_{y}.bin               legacy, still served
 *
 * The legacy form is **permanent**, not a migration window: every tile is
 * answered with `Cache-Control: immutable, max-age=1y`, so a client that cached
 * a legacy URL keeps asking for it for a year and nothing on the old prefix can
 * ever be deleted. See docs/dataset.md §7.
 *
 * A version-addressed path maps to a **version-addressed key** — the version is
 * never stripped to fall back on the legacy object. Two dataset versions must
 * not resolve to the same bytes; if the versioned object is not in the bucket,
 * that is an honest 404, not a silent substitution of an older tile.
 *
 * ## Path traversal
 *
 * `{version}`, `{code}` and `{layer}` all become part of an R2 key (prod) or a
 * `path.join` argument (dev), so they are constrained by shape, not merely
 * "sanitised": `{code}` is two digits, `{layer}` is one of four literals and
 * `{version}` is a release stamp `YYYY-MM-DD` with an optional `.N` serial.
 * No character class here admits `.` on its own, `/`, `%` or the empty string,
 * so `..`, `%2e%2e`, `%2f`, `a/b` and an empty segment cannot match — they are
 * rejected by construction rather than by a blacklist.
 *
 * **Which layer decodes what** (measured, not assumed — `tilePath.test.ts` pins
 * both halves):
 *
 * - The Worker parses with `new URL(request.url)`, and the WHATWG URL parser
 *   *does* resolve dot segments before `pathname` is read, including their
 *   percent-encoded spellings: `/aoi/11/v/%2e%2e/terrain/0/0_0.bin` arrives here
 *   as `/aoi/11/terrain/0/0_0.bin`. Dot-segment resolution only ever walks
 *   *up*, and `/aoi/…` is matched from the start of the string, so the result is
 *   either a plain legacy tile path (a legitimate key — this is exactly what a
 *   browser would have requested) or no match at all. It can never reach outside
 *   the `aoi/` prefix.
 * - `%2f` is **not** decoded by that parser: it stays inside one segment, where
 *   the character classes below reject it.
 * - The Vite dev middleware passes Node's raw `req.url`, which is *not*
 *   normalised, so `..` and `%2e%2e` reach this regex verbatim — and are
 *   rejected, because no group admits `.` alone or `%`.
 *
 * Either way the R2 key and the filesystem path are built *only* from captured
 * groups, so a string that is not a strict match never becomes a key at all.
 */

export const TILE_LAYERS = ["terrain", "buildings", "features", "landcover"] as const;
export type TileLayer = (typeof TILE_LAYERS)[number];

/**
 * A dataset release stamp: a UTC date, plus `.N` when more than one release is
 * cut on the same day. Kept in step with `DATASET_VERSION_RE` in
 * `apps/etl/src/datasetVersion.ts` — the ETL writes these into
 * `manifest.provenance.datasetVersion` and into every tile `urlTemplate`, and a
 * version this regex rejects would produce URLs this Worker cannot serve.
 */
const VERSION = "\\d{4}-\\d{2}-\\d{2}(?:\\.\\d{1,3})?";

/**
 * `/aoi/{code}/[v/{version}/]{layer}/{z}/{x}_{y}.bin`
 *
 * The version group is optional, which is the whole compatibility story: the
 * same expression accepts both forms and reports which one it saw.
 */
const TILE_PATH = new RegExp(
  `^/aoi/(\\d{2})/(?:v/(${VERSION})/)?(${TILE_LAYERS.join("|")})/(\\d+)/(\\d+)_(\\d+)\\.bin$`,
);

export interface TileRef {
  province: string;
  /** null = legacy (unversioned) path. */
  version: string | null;
  layer: TileLayer;
  z: string;
  x: string;
  y: string;
}

/**
 * Parse a request path. `input` may carry a query string (Node's `req.url`
 * does, `URL.pathname` does not) — it is cut off first so both callers see the
 * same string. Returns null for anything that is not a tile, which the callers
 * must treat as "not mine": in the Worker that means the asset layer, in dev
 * `next()`.
 */
export function parseTilePath(input: string): TileRef | null {
  const q = input.indexOf("?");
  const pathname = q === -1 ? input : input.slice(0, q);
  const m = TILE_PATH.exec(pathname);
  if (!m) return null;
  return { province: m[1], version: m[2] ?? null, layer: m[3] as TileLayer, z: m[4], x: m[5], y: m[6] };
}

/**
 * The R2 object key for a parsed path — `aoi/…` with no leading slash, exactly
 * mirroring the URL including its version segment (or its absence).
 */
export function tileKey(ref: TileRef): string {
  const version = ref.version ? `v/${ref.version}/` : "";
  return `aoi/${ref.province}/${version}${ref.layer}/${ref.z}/${ref.x}_${ref.y}.bin`;
}

/**
 * Path segments of the tile inside the **local, unversioned** tile tree
 * (`apps/etl/data/tiles`), for the dev middleware only: the version segment is
 * dropped because a developer's disk holds exactly one build of the dataset.
 * Never use this to build an R2 key — see the note in `vite.config.ts`.
 */
export function localTileSegments(ref: TileRef): string[] {
  return [ref.province, ref.layer, ref.z, `${ref.x}_${ref.y}.bin`];
}
