# SIAHRA — security headers (audit checklist)

Both Workers answer on one host, `siahra-radar.co`: `siahra-web` owns the Custom Domain (every
path), `siahra-api` is bound to the narrower route `/api/*` and therefore runs first for that
prefix. So a browser can see responses from either Worker on the same origin, and the header story
has to be coherent across the two.

**The rule this file records:** the host-level headers are *identical* on both Workers, and only the
Content-Security-Policy differs — because CSP binds the *document* that loads resources, and an API
response is never a document.

Headers are **additive** to the same-origin guard and the rate limiter in `apps/api/src/router.ts`
and `apps/api/src/rateLimit.ts`. They do not replace either, and neither was touched.

## Where each header is set

| Surface | Set in | Covers |
|---|---|---|
| `siahra-web` static assets (`index.html`, `/assets/*`, `/fonts/*`, `/aoi/**` tracked files) | `apps/web/public/_headers` → copied into `dist/`, read as configuration by Cloudflare's asset layer | every asset response |
| `siahra-web` Worker responses (R2 tiles, tile 404/405) | `apps/web/worker/index.ts` (`withSecurityHeaders`) | only what the Worker constructs itself |
| `siahra-api` responses (JSON, radar PNG, 4xx/5xx) | `apps/api/src/securityHeaders.ts`, applied at the single exit of `createRouter()` | every response except the WebSocket `101` |

`siahra-web` deliberately has **no `run_worker_first`** (see the comment in
`apps/web/wrangler.jsonc`): navigation requests are answered by the asset layer and never reach
`worker/index.ts`. That is exactly why `_headers` is load-bearing for the page policy and cannot be
replaced by Worker code.

The Worker hands the asset-layer fallthrough back **untouched**. Adding a second
`Content-Security-Policy` on top of the one `_headers` already applied would make the browser
*intersect* the two policies — a silently narrower policy than either — and would leave a second copy
of the policy string free to drift from the file Cloudflare actually reads.

## The headers

| Header | Value | Status | Note |
|---|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000` | **on**, both Workers | `max-age` only — no `includeSubDomains`, no `preload`. Decided by the repository owner (`docs/roadmap.md` §4): other hostnames under the zone are not ours to speak for, and `preload` is effectively irreversible |
| `X-Content-Type-Options` | `nosniff` | **on**, both | |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | **on**, both | |
| `X-Frame-Options` | `DENY` | **on**, both | Redundant with `frame-ancestors` on modern browsers; kept for old ones |
| `Permissions-Policy` | `accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=()` | **on**, both | The app asks for none of these |
| `Content-Security-Policy` (web, documents) | see below | **on, enforcing** | |
| `Content-Security-Policy` (web Worker responses, api) | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` | **on, enforcing** | A tile or a JSON body is never a document |
| `Cross-Origin-Resource-Policy` | — | **deliberately not set** | `same-origin` would block a browser from rendering `og-image.jpg` inside a third-party link preview, which is the image's entire purpose |
| CSP `report-uri`/`report-to` | — | **not set** | There is no endpoint to receive reports; adding one is a separate task |

## The page policy, directive by directive

```
default-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none';
form-action 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://server.arcgisonline.com https://tiles.maps.eox.at https://telemetry.dwr.go.th
  https://camera1.iticfoundation.org;
font-src 'self'; connect-src 'self' wss://siahra-radar.co https://telemetry.dwr.go.th https://camerai1.iticfoundation.org;
worker-src 'self'; manifest-src 'self'; media-src blob: https://camerai1.iticfoundation.org
```

- `script-src 'self'` — the built `index.html` has exactly one `<script src>` and no inline script.
  **No `'unsafe-eval'`**: three.js compiles GLSL on the GPU, it does not `eval`.
- `style-src` needs **`'unsafe-inline'`**, and this is the one relaxation in the policy. React writes
  inline `style` attributes in `TopBar`, `MapLegend`, `AppShell`, `SideDrawer`, `TimelineBar`,
  `ForecastStrip`, `BottomDock`, `AlertToast`, `MapViewport` and `MobileSheet` — every value that
  depends on live data (bar widths,
  marker offsets, colour ramps) is a `style={{…}}` prop, so removing it means moving hundreds of
  computed values into CSS custom properties, which is a UI refactor, not a header change. A nonce
  does not help: nonces cover `<style>` elements, not `style` attributes. Splitting it as
  `style-src 'self'` + `style-src-attr 'unsafe-inline'` was rejected because Safari does not
  implement `style-src-attr` and falls back to `style-src`, which would break the layout there while
  looking clean in Chrome.
- `img-src` — `data:`/`blob:` for the share-image download (`App.tsx`) and the stitched basemap
  canvas; the two hosts are the basemap providers loaded as `<img>` by `scene/SatelliteImagery.ts`
  (Esri World Imagery and EOX Sentinel-2 cloudless). The camera hosts are listed below.
- `connect-src 'self' wss://siahra-radar.co …` — same-origin `/api/*` plus the earthquake WebSocket.
  CSP3 says `'self'` already matches `wss:` on the same origin; the explicit host is belt and braces.
  The camera hosts are listed below.
- `media-src blob: …` — was `'none'` until E15.2, the first `<video>` in the app. hls.js feeds the
  `<video>` through Media Source Extensions, which the element loads from a `blob:` URL; Safari/iOS
  play the same playlist natively, which is a media load of the playlist host itself. Nothing else is
  allowed as media.
- **Camera hosts (E15 / E15.2 / E15.3)** — one bullet per host in `CAMERA_SOURCES[id].hosts`
  (`packages/shared-types/src/cctv.ts`). `streamDirective(kind)` says which directive a stream kind
  needs; `apps/web/src/lib/cameraSources.test.ts` reads `public/_headers` and asserts every registry
  host appears under each of those directives, and `lib/cameraSources.ts` refuses any stream URL
  whose origin is not in the registry (plus `https:` only, no userinfo, the source's `urlPattern`).
  The browser contacts a host only after the user opens that camera's sheet, one camera at a time;
  the API never does, so none of these sources has a row in `/api/v1/health` (kind `"browser"`). A
  source removed at build time — `VITE_FEATURE_CCTV=0` for the whole layer, or
  `VITE_FEATURE_CCTV_DISABLE=<id,…>` per source (`VITE_FEATURE_ITIC=0` stays one release as an alias
  for `itic-cctv`) — fetches no catalogue, draws no marker, prints no credit and leaves its entries
  here inert.
  - `https://telemetry.dwr.go.th` — `dwr-cctv`, in **`connect-src`** (snapshot: the browser asks for
    one snapshot per click, `GET /api/public/reportCctv/snapshot/{id}` then `POST
    /api/file/image/cctv` for the JPEG — DWR reflects our origin in CORS, checked 2026-09-26; shown
    from a `blob:` URL) and **`img-src`** (live view: `GET /api/public/cctv/mjpegStream?stnCode=…`
    answers `multipart/x-mixed-replace`, rendered as a plain `<img src>`, re-set every ~15 s because
    DWR closes the stream after ~11–24 s, stopped after 5 min, `src = ""` on close; the pixel-hash
    frame check reads the image back with `crossOrigin="anonymous"` only because the build-time
    probe recorded `cors: true`).
  - `https://camerai1.iticfoundation.org` — `itic-cctv`, in **`connect-src`** and **`media-src`**:
    the iTIC Foundation's HLS server for the road cameras (Department of Highways and partners; the
    camera list from Longdo is baked into `public/cctv/itic-cctv.json` at ETL time, so the Longdo
    host itself is never contacted by the browser). hls.js loads the playlist and `.ts` segments by
    XHR (`Access-Control-Allow-Origin: *`, checked 2026-09-26), one camera per click, one player per
    page; Safari/iOS load the playlist natively as media.
  - `https://camera1.iticfoundation.org` — `itic-cctv`, in **`img-src` only**: still images for the
    few iTIC road cameras that have no usable HLS stream, `GET /jpeg2.php?camid=10.8.0.{n}:{port}`
    (the source's `urlPattern` — the only `jpeg2.php` group that returned a real frame when probed on
    2026-09-26; the placeholder, `CAMPK…`, `61.91.182.114` and `jpeg.cgi` groups return "not found",
    "No signal" or nothing and are never stored, `apps/etl/src/build-itic-cctv.README.md`). One
    camera, only after a click; re-requested every ~5 s with a cache-busting parameter while open,
    a request is given up after 15 s, the loop stops after 5 min, `src = ""` on close. The image is
    only displayed — no `crossOrigin`, never drawn to a canvas — so nothing on `camera1` is fetched
    by XHR or loaded as media.
- `worker-src 'self'` — `src/workers/*.worker.ts` are bundled to same-origin URLs, not blobs. hls.js is
  created with `enableWorker: false` (`src/lib/streams.ts`), so its transmuxer runs on the main thread
  and never asks for a `blob:` worker; this directive did not change for E15.2.
- `font-src 'self'` — this is only possible because E4.1 moved Sarabun and IBM Plex Mono into
  `public/fonts/`. Re-adding a Google Fonts `<link>` would force `font-src`/`style-src` back open.

## Verification performed (2026-08-19)

The policy was verified **enforcing**, in Chromium, against the production bundle: `apps/web/dist`
served through a Playwright route handler that applies the parsed `public/_headers` verbatim, on top
of the running dev server, so `/aoi/**`, `/api/**` and the WebSocket still went to the real backend.

- three.js map renders (terrain, buildings, satellite imagery, flood/low-lying overlays) — checked on
  provinces 10 and 50
- both web workers run (`buildingTiles`, `featureTiles`) — building and feature geometry is on screen
- WebSocket `/api/v1/earthquakes/live` reaches `readyState === 1` (`OPEN`) with the policy on
- `/methodology` renders in full
- province switch and a radar layer toggle produce **zero** console messages
- control: `fetch('https://example.com/')` from the page *is* refused by `connect-src`, proving the
  policy is enforced rather than ignored

The 2026-08-19 run predates the E15.2 changes (`img-src` + `https://telemetry.dwr.go.th`, `connect-src` +
`https://camerai1.iticfoundation.org`, `media-src` from `'none'` to `blob: https://camerai1.iticfoundation.org`).
QA on 2026-09-26 ran the production `dist` under the enforcing CSP: iTIC played through hls.js/MSE
(`blob:`), the DWR MJPEG live view ran with its canvas read, the WebSocket opened, and the app raised
zero violations. The later `img-src` addition of `https://camera1.iticfoundation.org` (iTIC still
images) has **not** been verified under the enforcing policy: that host times out from the network
the change was made on, so no frame could be loaded either way.

Known gap: whether Cloudflare's asset layer honours `_headers` in production could not be exercised
here (Vite ignores it, and there is no `wrangler dev` for the web Worker in this environment). It was
checked syntactically and through `wrangler deploy --dry-run`; confirm with `curl -I https://siahra-radar.co/`
after the next deploy.

Deviation from roadmap E4.2 AC 3: the CSP ships **enforcing**, not report-only for one release.
Report-only was the safety net for "we cannot tell whether it breaks the app"; the harness above
answers that question directly, and a report-only header would have been a security header that
secures nothing while claiming the task is done.
