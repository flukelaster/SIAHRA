# `itic-cameras.json` — iTIC road-camera catalogue (E15.2)

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
npm run build:itic-cctv -w apps/etl        # apps/etl/src/build-itic-cctv.ts
```

1. `GET https://camera.longdo.com/feed/?command=json` → a bare JSON array (294 entries on
   2026-09-26).
2. Keep an entry as **live video** (`stream: {kind: "hls", url}`) when `hls_url` starts with
   `https://camerai1.iticfoundation.org/` and does not contain `tempsus` (iTIC's "temporarily
   suspended" placeholder playlist). Measured 2026-09-26: playlists on `camerai1` answer (164/184
   with 200, `Access-Control-Allow-Origin: *`, H.264 720p MPEG-TS segments); the HLS and MJPEG URLs
   on `camera1.iticfoundation.org` timed out, so `link`/`vdourl` are never stored.
3. An entry with no usable HLS is kept as a **still image** (`stream: {kind: "jpeg", url}`) only
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
   (shared with `build-cctv.ts` in `src/provincePolygons.ts`); `null` when it falls in no boundary.

Each record is `{id, name, lat, lon, organization, stream, provinceCode}`; `builtAt` is when the
feed was fetched successfully (the layer's `fetchedAt`). The feed's `lastupdate` is a placeholder
(2030/2099 dates) and says nothing about freshness, so it is not kept; the layer's `publishedAt` is
`null`.

Result of the 2026-09-26 run (04:21 UTC): 291 entries → **170 cameras** — 161 HLS + 9 JPEG
(กรมทางหลวง 102, iTIC Motion 68) in 46 provinces. 130 entries have no usable HLS (27 without
`hls_url`, 20 on another host, 83 `tempsus`); of those, 9 are kept as still images and 121 are
dropped (93 placeholder `X.X.X.X` camid, 28 other image links — 21 `CAMPK…`, 6 `61.91.182.114`,
1 `jpeg.cgi`); 0 without coordinates, 0 outside every boundary. (The first run earlier that day saw
294 entries → 164 HLS cameras in 47 provinces; the feed itself changed between the two runs.)

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
- the script logs counts only, never a raw entry;
- it refuses to write the file if the serialized output matches the shared `CREDENTIAL_PATTERN`
  (`/@|dyndns|:\/\/[^/]*:[^/]*@/`).

`apps/etl/src/build-itic-cctv.test.ts` covers the filter, the drop counts, the allowlist and the
credential refusal.
