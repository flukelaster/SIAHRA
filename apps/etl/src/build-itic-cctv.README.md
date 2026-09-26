# `itic-cctv.json` — iTIC road-camera catalogue (E15.2)

**Source:** the camera list Longdo publishes at `https://camera.longdo.com/feed/?command=json`
(Metamedia Technology). The video itself is served by the **iTIC Foundation**
(มูลนิธิสถาบันส่งเสริมการจัดการความรู้เพื่อความปลอดภัยในการเดินทาง) from
`https://camerai1.iticfoundation.org`; the cameras belong to the organisation each record names in
`organization` — today the Department of Highways (กรมทางหลวง) and iTIC's partner cameras
("iTIC Motion"). None of them built or endorses this project.

**Licence:** no licence has been granted to us, and none is published for the feed or the streams
(checked 2026-09-26). The layer ships in production **with visible attribution** to iTIC, the
camera owner and Longdo (camera popup + the always-mounted credit line, source id `itic-cctv`).
Building the web app with `VITE_FEATURE_ITIC=0` removes the markers, the catalogue fetch, the
credit and every request to iTIC, should any of them ask.

## How it is built

```
npm run build:cctv:itic -w apps/etl        # apps/etl/src/build-itic-cctv.ts
npx -y tsx@4 src/build-itic-cctv.ts [--no-probe] [--vantage <label>]   # from apps/etl, while tsx is missing from the lockfile
```

Output: `apps/web/public/cctv/itic-cctv.json`, a `CameraCatalogue` (`packages/shared-types/src/cctv.ts`)
written through the shared `src/cameraCatalogue.ts` `writeCatalogue` — dedupe/sort by id, every stream
URL `https:` with no userinfo and on an origin listed in `CAMERA_SOURCES["itic-cctv"].hosts` for the
CSP directive its kind needs, `jpeg` URLs matching the source's `urlPattern`, and the serialized file
refused outright on `CREDENTIAL_PATTERN`. This is the only file the web reads for this source
(`apps/web/src/hooks/useCameraCatalogues.ts`, since E15.3 PR B); the per-source legacy file of E15.2
was deleted in that PR.

1. `GET https://camera.longdo.com/feed/?command=json` → a bare JSON array (294 entries on
   2026-09-26).
2. Keep an entry as **live video** (`streams: [{kind: "hls", url, …}]`) when `hls_url` starts with
   `https://camerai1.iticfoundation.org/` and does not contain `tempsus` (iTIC's "temporarily
   suspended" placeholder playlist). Measured 2026-09-26: playlists on `camerai1` answer (164/184
   with 200, `Access-Control-Allow-Origin: *`, H.264 720p MPEG-TS segments); the HLS and MJPEG URLs
   on `camera1.iticfoundation.org` timed out, so `link`/`vdourl` are never stored.
3. An entry with no usable HLS is kept as a **still image** (`streams: [{kind: "jpeg", url, captureTime:
   "burned-in", …}]`) only
   when its `imgurl` matches, in full,
   `^https://camera1\.iticfoundation\.org/jpeg2\.php\?camid=10\.8\.0\.\d+:\d+$` (anchored, so no
   userinfo or extra parameter fits; the URL is re-parsed and must be on exactly that origin). The
   rule is evidence, not taste — the image-only entries fall into groups, and when probed on
   2026-09-26 (from outside this network) only one of them returned a picture of a road:

   | `imgurl` group | entries (2026-09-26 run) | probe result |
   |---|---|---|
   | `jpeg2.php?camid=10.8.0.{n}:{port}` | 9 (all "iTIC Motion", Bangkok) | a real ~50 KB 480×384 JPEG of the road, timestamp burned into the image — **kept** |
   | `jpeg2.php?camid=X.X.X.X:YYYY` | 93 | placeholder camid — no camera to ask |
   | `jpeg2.php?camid=CAMPK…` | 21 | `Camera (jpeg) not found` (39 bytes, not an image) |
   | `jpeg2.php?camid=61.91.182.114:111x` | 6 | a 320×240 "No signal" JPEG |
   | `jpeg.cgi?camid=PER-3-008_2` | 1 | 0 bytes |

   A new group only joins after it has been probed and returns a real frame — never on the shape of
   its link. `camera1.iticfoundation.org` times out from some networks (including the one this
   catalogue was built on), so the popup must — and does — degrade to "unreachable".
4. Coordinates come from the feed's `latitude`/`longitude` (strings); `(0,0)` or non-numeric → the
   entry is dropped and counted.
5. `provinceCode` by point-in-polygon against `apps/web/public/aoi/{code}/boundary.geojson`
   (shared with `build-dwr-cctv.ts` in `src/provincePolygons.ts`); `null` when it falls in no boundary.
6. **Probe** (unless `--no-probe`): every stream is requested once from the machine that runs the
   build (`src/cameraCatalogue.ts` `probeStreams`, 6 in flight, 15 s timeout, `Origin:
   https://siahra-radar.co` on every request). An `hls` stream is followed from the master playlist
   to its first chunklist and classified from the chunklist — a master that answers 200 with a
   chunklist that answers 404 is `http-4xx`, never `ok` — and `captureTime` becomes
   `"program-date-time"` **only** when that chunklist carries `EXT-X-PROGRAM-DATE-TIME` (none did
   on 2026-09-26, so every HLS stream stays `"none"` and the popup says the stream carries no
   timestamp). A `jpeg` stream is fetched for its first bytes and classified by `image/*` or the
   JPEG magic. Per stream the file keeps `probe: {result, cors}`; `probedAt` and `probeVantage`
   (the `--vantage` label only, `unlabelled` when none is given — never the build machine's hostname) are stored **once per catalogue**. With `--no-probe` every stream is
   `not-probed` and both fields are `null` — `ok` is never a default.

Each record is `{id, sourceId, nameTh, nameEn: null, lat, lon, coordSource: "upstream", provinceCode,
owner, code: null, placeTh: null, streams}` with `owner` = the feed's `organization`; `builtAt` is when
the feed was fetched successfully (the layer's `fetchedAt`). The feed's `lastupdate` is a placeholder
(2030/2099 dates) and says nothing about freshness, so it is not kept; the layer's `publishedAt` is
`null`.

Result of the 2026-09-26 run (13:25 UTC, the first run on the generic contract): 293 entries →
**172 cameras** — 163 HLS + 9 JPEG (กรมทางหลวง 104, iTIC Motion 68) in 46 provinces. 130 entries have
no usable HLS (27 without `hls_url`, 20 on another host, 83 `tempsus`); of those, 9 are kept as still
images and 121 are dropped (93 placeholder `X.X.X.X` camid, 28 other image links); 0 without
coordinates, 0 outside every boundary. (Earlier that day the feed gave 294 → 164 and 291 → 170; it
changes between runs.)

Probe of that run — vantage `fortinet-lan`, a network behind a
Fortinet TLS filter, 2026-09-26T13:25:43Z:

| kind | streams | https | cors yes/no/unknown | ok | empty | not-image | http-4xx | http-5xx | unreachable (could not be reached from this vantage) | not-probed | timestamp evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| hls | 163 | 163/163 | 163/0/0 | 158 | 0 | 0 | 5 | 0 | 0 | 0 | EXT-X-PROGRAM-DATE-TIME on 0/158 ok |
| jpeg | 9 | 9/9 | 0/0/9 | 0 | 0 | 0 | 0 | 0 | 9 | 0 | burned into the image, not data |

Reading it honestly: the 5 `http-4xx` are Department of Highways playlists whose master answered
200 but whose chunklist answered 404 **at probe time** — re-checked by hand a few minutes later, 3 of
the 5 chunklists answered 200 again, so this is a snapshot of a chain that comes and goes, not a
statement about the camera; the 9 `unreachable` stills are all on `camera1.iticfoundation.org`, which this network cannot
reach at all (connection timeout) — that says nothing about the cameras, and the same group returned
real frames when probed from outside this network earlier the same day. Both groups **stay in the
file**; the UI dims a stream whose probe is not `ok` and labels it with `probedAt`/`probeVantage`
rather than dropping it. Re-run the build from a Thai consumer network (or have the owner open one
of the `camera1` URLs on a phone) before treating any `unreachable` as anything more than "could not
ask from here". `src/probe-cameras.ts itic-cctv --vantage <label>` re-probes the built file without
writing anything.

The Department of Highways playlists have the shape
`https://camerai1.iticfoundation.org/pass/180.180.242.207:1935/…/playlist.m3u8`: iTIC's proxy path
embeds the upstream Wowza `IP:port`. That address is already public in the Longdo feed, carries no
credential, and this is the only path that plays — so it is kept as is.

It is a **static-reference** layer: it says where cameras are, not what they see. The browser opens
a stream — or starts asking for still images — only when a user clicks a camera, one at a time. A
still-image camera is re-asked every ~5 s (cache-busting parameter) while its popup is open, stops
after 5 minutes unless the user resumes, and drops the request (`src = ""`) on close; the popup
labels it "still image, refreshed automatically", never "live", shows when the last frame arrived,
and says the capture time is burned into the picture by the camera and is not available as data. The popup shows the stream's own
`EXT-X-PROGRAM-DATE-TIME` when the playlist carries one; none of the playlists probed on 2026-09-26
does, and then the popup says the stream carries no timestamp — it never shows the user's clock as a
capture time.

## Guard rules (do not relax)

- every entry goes through a `zod/mini` schema that declares only
  `camid, title, latitude, longitude, organization, hls_url, imgurl` (unknown keys are dropped;
  `imgurl` is only written when it is in the probed group), and each
  record is assembled field by field — no upstream object is spread;
- a `hls` URL must parse as a URL on exactly the `camerai1` origin with no username/password; a
  `jpeg` URL must match the anchored pattern above and parse on exactly the `camera1` origin;
- the script logs counts only, never a raw entry (probe output is a count table per kind/result);
- `writeCatalogue` refuses the whole file if any stream URL is not `https:`, carries userinfo, sits on
  an origin outside `CAMERA_SOURCES["itic-cctv"].hosts` for its directive, or (for `jpeg`) misses the
  `urlPattern`, or if the serialized output matches the shared `CREDENTIAL_PATTERN`
  (`/@|dyndns|:\/\/[^/]*:[^/]*@/`).

`apps/etl/src/build-itic-cctv.test.ts` covers the filter, the drop counts and the allowlist;
`apps/etl/src/cameraCatalogue.test.ts` covers the probe classification (including
chunklist-404-is-not-ok), CORS detection, the `not-probed` default and every write-time refusal.
