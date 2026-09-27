# `doh-cctv.json` — Department of Highways highway-camera catalogue (E15.3 PR C)

**Source:** the public camera page of the **Department of Highways** (กรมทางหลวง, DOH) at
`https://www.highwaytraffic.go.th/DOHWeb/home.aspx` — its site list, and its two ASP.NET page
methods `GetSiteInfo` / `GetCameraInfo`, which need the page's `ASP.NET_SessionId` cookie but no
login. The video is HLS served by the department's own Wowza hosts
`streaming1.highwaytraffic.go.th` and `streaming2.highwaytraffic.go.th`. The department did not build
and does not endorse this project.

**Licence:** the camera page publishes no terms of use (checked 2026-09-26). The layer ships in
production **with visible attribution** to the Department of Highways (camera sheet kicker + credit
link, and the always-mounted credit line, source id `doh-cctv`) under the owner's 2026-09-26 decision
for government CCTV sources in general (`docs/roadmap.md` §4). Building the web app with
`VITE_FEATURE_CCTV_DISABLE=doh-cctv` removes the markers, the catalogue fetch, the credit and every
request to the department's hosts, should it ask; `VITE_FEATURE_CCTV=0` removes the whole layer.

## How it is built

```
npm run build:cctv:doh -w apps/etl        # apps/etl/src/build-doh-cctv.ts
# while tsx is missing from the lockfile, from apps/etl:
NODE_EXTRA_CA_CERTS=$PWD/certs/sectigo-public-server-authentication-ca-dv-r36.pem npx -y tsx@4 src/build-doh-cctv.ts [--no-probe] [--vantage <label>]
```

Output: `apps/web/public/cctv/doh-cctv.json`, a `CameraCatalogue` (`packages/shared-types/src/cctv.ts`)
written through the shared `src/cameraCatalogue.ts` `writeCatalogue` — dedupe/sort by id, every stream
URL `https:` with no userinfo and on one of the two origins in `CAMERA_SOURCES["doh-cctv"].hosts`
(`connect` + `media`, the directives `hls` needs), and the serialized file refused outright on
`CREDENTIAL_PATTERN`. It is the only file the web reads for this source
(`apps/web/src/hooks/useCameraCatalogues.ts`).

1. `GET home.aspx` (≈ 227 KB) — the `ASP.NET_SessionId` cookie is taken from `set-cookie` and used
   for the page methods only (never logged, never written); the site ids come from every
   `onclick="MoveLocation(<id>);"` on the page (190 on 2026-09-27).
2. Per site, 8 in flight: `POST home.aspx/GetSiteInfo {siteID}` → `{d: [lat, lon, code, html]}`.
   The name is the cell after `ชื่อจุดติดตั้ง` in that html table and the description the cell after
   `รายละเอียด` (tag-tolerant regex; an empty cell is `null`, never the next label); **the html is not
   retained**. Then `POST home.aspx/GetCameraInfo {siteID}` → `{d: html}` with one `site_code="…"`
   per tab (ขาเข้า / ขาออก) and a direction text (`ctl01_TxtDirectIn/Out`) → `stream.label`
   (`ขาเข้า — ทิศทางมุ่งหน้ากรุงเทพ` when the playlist name ends in `_IN`/`_OUT`, the direction text
   alone otherwise).
3. A `site_code` URL is kept only when it parses, is `https:`, carries no userinfo, sits on exactly
   one of the two registered origins and ends in `.m3u8`. Everything else is refused **and counted by
   reason**: `raw-ip` (the `http://183.89.205.98:9980/…` group, 4 streams on 3 sites — checked before
   the scheme so it is not reported as "http"), `http`, `other-host`, `credential`, `not-playlist`.
   A site with no stream left is not emitted.
4. **Two tabs on the same playlist are one stream.** 130 of the 368 `site_code`s seen (103 of the
   137 kept sites) point both tabs at the same `…/PER_x_yyy.stream/playlist.m3u8` with no `_IN`/`_OUT`
   suffix but different direction texts. That is one camera stream, not two, so it is collapsed to one
   `hls` stream whose label joins the two direction texts with ` / ` — the build does not guess which
   direction the picture shows. Counted as `sameUrl`, not as refused.
5. `provinceCode` by point-in-polygon against `apps/web/public/aoi/{code}/boundary.geojson`
   (`src/provincePolygons.ts`, shared with the DWR and iTIC builds); `null` when it falls in no boundary
   (0 on 2026-09-27).
6. **Deduplicated against the built iTIC catalogue** (`apps/web/public/cctv/itic-cctv.json` — the build
   stops if it is missing, it does not skip the step). The department's cameras also reach iTIC, and
   the iTIC copy on `camerai1.iticfoundation.org` plays from every network probed, so a site whose
   code `PER-x-yyy` (separators and leading zeros ignored, `_IN`/`_OUT` ignored) appears in an iTIC
   HLS url or id is **not emitted here** — 50 sites on 2026-09-27. A site with no code match but an
   iTIC camera owned by กรมทางหลวง within 50 m is dropped too (0 on 2026-09-27). Both counts are
   logged.
7. **Probe** (unless `--no-probe`): every stream is requested once from the machine that runs the
   build (`src/cameraCatalogue.ts` `probeStreams`, 8 in flight, 15 s timeout, `Origin:
   https://siahra-radar.co`), master → first chunklist, classified from the chunklist; `captureTime`
   becomes `"program-date-time"` **only** when that chunklist carries `EXT-X-PROGRAM-DATE-TIME`
   (none did on 2026-09-27, so every stream stays `"none"` and the sheet says the stream carries no
   timestamp). The heartbeat line `probe progress: n/total streams` is printed every 25 streams or
   30 s (`progressHeartbeat`), because a host that times out for every stream is otherwise silent for
   minutes. With `--no-probe` every stream is `not-probed` and `probedAt`/`probeVantage` are `null` —
   `ok` is never a default.

Each record is `{id: "PER-x-yyy", sourceId: "doh-cctv", nameTh, nameEn: null, lat, lon, coordSource:
"upstream", provinceCode, owner: null, code: "PER-x-yyy", placeTh, streams}` — `owner` is `null`
because the camera belongs to the source agency itself and the credit comes from `SOURCES["doh-cctv"]`;
`placeTh` is the `อ.… จ.…` part of the site name when it has one. `builtAt` is when the site list was
fetched successfully (the layer's `fetchedAt`); the page publishes no timestamp, so `publishedAt` is
`null`.

## Why `certs/` exists

`streaming1` and `streaming2.highwaytraffic.go.th` send **only their leaf certificate** — no
intermediate. Browsers and `curl` recover the missing intermediate through the certificate's AIA URL,
so the streams play; Node's `fetch` (undici) does not, so every probe from the build failed with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE` and, before the `tls-chain` result existed, was written as
`unreachable` (the run probed 2026-09-26T22:38Z, before the same-playlist collapse: 270/270). That
was a statement about the tool, not the network and not the cameras.

The fix is to hand Node the intermediate: `apps/etl/certs/sectigo-public-server-authentication-ca-dv-r36.pem`,
loaded through `NODE_EXTRA_CA_CERTS` by the `build:cctv:doh` and `probe:cameras` npm scripts
(and by hand in the `npx` form above). It is a **public CA certificate**, safe to track:

| | |
|---|---|
| Subject | `C=GB, O=Sectigo Limited, CN=Sectigo Public Server Authentication CA DV R36` |
| Issuer | `C=GB, O=Sectigo Limited, CN=Sectigo Public Server Authentication Root R46` |
| SHA-256 fingerprint | `8C:54:C3:34:B6:6B:A4:E4:26:77:2A:F4:A3:F9:13:6C:19:A1:AE:C7:29:FD:B2:8C:53:5C:07:A5:A4:EF:22:E0` |
| Not after | 2036-03-21 23:59:59 UTC |
| Downloaded from | `http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt` (the AIA URL in the servers' leaf certificate), converted DER → PEM |

A browser needs nothing from this file — it is for the build's Node process only. If the department
ever renews with a different intermediate, the probe reports `tls-chain` again (never `unreachable`)
and this file has to be replaced; the CLI legend under the probe table says so.

`tls-chain` is a `ProbeResult` of its own (`packages/shared-types/src/cctv.ts`): "the probing tool could
not verify the server certificate because the server sent an incomplete chain — browsers usually
recover". The web dims such a stream like any non-`ok` result and labels it with that wording
(`popup.camera.unverified.tlsChain`), never as "could not be reached".

## Result of the 2026-09-27 run

Site list fetched 2026-09-27T01:59:59Z: **190 sites** → 368 `site_code`s seen, 4 refused (raw-IP host),
130 collapsed as the same playlist within a site, 3 sites without a usable stream, 0 duplicate codes →
**187 projected** → 50 already in iTIC by code, 0 within 50 m of an iTIC DOH camera → **137 cameras
kept, 167 streams** (`streaming1` 86, `streaming2` 81) in **61 provinces**, 0 outside every boundary.

Probe of that run — vantage `fortinet-lan`, a network behind a Fortinet TLS filter, with the
intermediate certificate loaded, 2026-09-27T02:01:56Z:

| kind | streams | https | cors yes/no/unknown | ok | empty | not-image | http-4xx | http-5xx | unreachable (could not be reached from this vantage) | tls-chain (certificate chain the tool could not verify) | not-probed | timestamp evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hls | 167 | 167/167 | 86/0/81 | 60 | 0 | 0 | 26 | 0 | 81 | 0 | 0 | EXT-X-PROGRAM-DATE-TIME on 0/60 ok |

Per host: `streaming1` ok 60, http-4xx 26 (all 86 with `Access-Control-Allow-Origin: *`);
`streaming2` unreachable 81 (connection timeout, so no CORS header to read). 49 cameras have at least
one `ok` stream; 68 cameras are on `streaming2` only and ship dimmed.

Reading it honestly:

- **`streaming2` `unreachable` ≠ dead.** It timed out from this network on 2026-09-26 and 2026-09-27,
  and from an off-network vantage on 2026-09-26. That says only that it could not be asked from
  there; the 81 streams **stay in the file**, the UI dims them and labels them with `probedAt` /
  `probeVantage`, and they can play from a network that reaches the host. Owner check still open
  (`docs/roadmap.md` E15.3): open
  `https://streaming2.highwaytraffic.go.th/Phase11/PER_11_006.stream/playlist.m3u8` on a phone on a
  Thai consumer network and record the result here under a vantage column.
- **The 26 `http-4xx` on `streaming1`** are playlists Wowza answered **404 at probe time** (checked by
  hand on one right after the run: the master playlist itself is 404, with the CORS header present) —
  the server is up and answering, that stream was simply not being published at that moment. The
  iTIC build saw the same come-and-go on the department's streams (3 of 5 back within minutes). It is
  a snapshot, kept dimmed, not a statement about the camera.
- **`tls-chain` 0** proves the certificate took; a rebuild that shows `tls-chain` instead of `ok` was run
  without `NODE_EXTRA_CA_CERTS` (Node only warns when the path is wrong) or the department changed
  its chain.

It is a **static-reference** layer: it says where the department's cameras are, not what they see.
The browser opens one HLS stream only when a user clicks a camera (native on Safari/iOS, hls.js with
`enableWorker: false` elsewhere, one player per page); a two-stream site offers an IN/OUT picker. No
playlist probed carries `EXT-X-PROGRAM-DATE-TIME`, so the sheet says the stream carries no timestamp —
it never shows the user's clock as a capture time.

## Guard rules (do not relax)

- both page-method answers go through a `zod/mini` schema that declares only the fields used
  (`GetSiteInfo`: `d: string[]`, `GetCameraInfo`: `d: string`), and each record is assembled field by
  field — no upstream object is spread, no html is stored;
- a stream URL must parse as a URL, be `https:`, carry no username/password, sit on exactly one of the
  two origins in `CAMERA_SOURCES["doh-cctv"].hosts` and end in `.m3u8`; the raw-IP group is refused
  on its host before its scheme is looked at;
- the session cookie is used for the page methods and dropped; the script logs counts only, never a
  raw record or a cookie (a page-method failure is counted as `fetchFailed`, its body never printed);
- the iTIC catalogue is mandatory input — dedupe is not optional;
- `writeCatalogue` refuses the whole file on any non-`https:` URL, userinfo, an origin outside the
  registry, an `ok` without a `probedAt`, or a serialized output matching `CREDENTIAL_PATTERN`.

`apps/etl/src/build-doh-cctv.test.ts` covers the site-id, site-info and camera-info parsers (html not
retained, raw-IP refusal, same-playlist collapse), code normalisation and both dedupe rules against an
iTIC fixture, and the projection with every drop counter; `apps/etl/src/cameraCatalogue.test.ts` covers
the probe classification including `tls-chain` versus `unreachable` and the heartbeat.
