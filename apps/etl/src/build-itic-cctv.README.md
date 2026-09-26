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
2. Keep an entry only when `hls_url` starts with `https://camerai1.iticfoundation.org/` and does not
   contain `tempsus` (iTIC's "temporarily suspended" placeholder playlist). Measured 2026-09-26:
   playlists on `camerai1` answer (164/184 with 200, `Access-Control-Allow-Origin: *`, H.264 720p
   MPEG-TS segments); every URL on `camera1.iticfoundation.org` timed out, so those — and the
   `link`/`vdourl`/`imgurl` MJPEG/JPEG fields, which all live there — are never stored.
3. Coordinates come from the feed's `latitude`/`longitude` (strings); `(0,0)` or non-numeric → the
   entry is dropped and counted.
4. `provinceCode` by point-in-polygon against `apps/web/public/aoi/{code}/boundary.geojson`
   (shared with `build-cctv.ts` in `src/provincePolygons.ts`); `null` when it falls in no boundary.

Each record is `{id, name, lat, lon, organization, hlsUrl, provinceCode}`; `builtAt` is when the
feed was fetched successfully (the layer's `fetchedAt`). The feed's `lastupdate` is a placeholder
(2030/2099 dates) and says nothing about freshness, so it is not kept; the layer's `publishedAt` is
`null`.

Result of the 2026-09-26 run: 294 entries → **164 cameras** (กรมทางหลวง 105, iTIC Motion 59) in 47
provinces; dropped: 27 without `hls_url`, 20 on another host (19 `camera1`, 1 raw IP), 83
`tempsus`, 0 without coordinates, 0 outside every boundary.

The Department of Highways playlists have the shape
`https://camerai1.iticfoundation.org/pass/180.180.242.207:1935/…/playlist.m3u8`: iTIC's proxy path
embeds the upstream Wowza `IP:port`. That address is already public in the Longdo feed, carries no
credential, and this is the only path that plays — so it is kept as is.

It is a **static-reference** layer: it says where cameras are, not what they see. The browser opens
a stream only when a user clicks a camera, one at a time. The popup shows the stream's own
`EXT-X-PROGRAM-DATE-TIME` when the playlist carries one; none of the playlists probed on 2026-09-26
does, and then the popup says the stream carries no timestamp — it never shows the user's clock as a
capture time.

## Guard rules (do not relax)

- every entry goes through a `zod/mini` schema that declares only
  `camid, title, latitude, longitude, organization, hls_url` (unknown keys are dropped), and each
  record is assembled field by field — no upstream object is spread;
- `hlsUrl` must parse as a URL on exactly the `camerai1` origin with no username/password;
- the script logs counts only, never a raw entry;
- it refuses to write the file if the serialized output matches the shared `CREDENTIAL_PATTERN`
  (`/@|dyndns|:\/\/[^/]*:[^/]*@/`).

`apps/etl/src/build-itic-cctv.test.ts` covers the filter, the drop counts, the allowlist and the
credential refusal.
