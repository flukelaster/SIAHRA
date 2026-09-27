# `bma-cctv.json` — Bangkok traffic-camera **locations** (E15.3 PR D)

**Source:** the open dataset
[`bma-cctv`](https://data.bangkok.go.th/dataset/bma-cctv) on the Bangkok Metropolitan
Administration's CKAN portal `data.bangkok.go.th` — "ข้อมูลกล้องโทรทัศน์วงจรปิด (cctv)
ที่ได้รับการติดตั้งในพื้นที่กรุงเทพมหานคร", organisation กองยุทธศาสตร์ดิจิทัล, one CSV resource. The
Bangkok Metropolitan Administration did not build and does not endorse this project.

**Licence:** the dataset says **"License not specified"** (checked 2026-09-27). The layer ships with
visible attribution to the Bangkok Metropolitan Administration (camera sheet kicker + credit link, and the
always-mounted credit line, source id `bma-cctv`) under the owner's 2026-09-26 decision for government
CCTV sources in general (`docs/roadmap.md` §4). Building the web app with
`VITE_FEATURE_CCTV_DISABLE=bma-cctv` removes the markers, the catalogue fetch and the credit;
`VITE_FEATURE_CCTV=0` removes the whole layer.

## SIAHRA shows no image from these cameras

The pictures live on BMA Traffic (`https://cpudapp.bangkok.go.th/bmatraffic/`, legacy
`www.bmatraffic.com`), which was unreachable from our networks, and third-party reports say its
streaming server serves only its own origin (an Origin/Referer check, no CORS). **Owner decision
(2026-09-27): no proxy and no header spoofing — show the locations and link out to the official
viewer.** So every camera carries exactly one stream of kind `external-link`:

```json
{ "kind": "external-link", "url": "https://cpudapp.bangkok.go.th/bmatraffic/", "label": null,
  "captureTime": "none", "probe": { "result": "not-probed", "cors": null } }
```

- The link is the BMA Traffic **home page**, not a page for that camera — the dataset carries no
  per-camera link, and we do not construct one.
- Nothing is probed: `probedAt`/`probeVantage` are `null` and every stream is `not-probed`. The camera
  sheet says SIAHRA shows no image, offers the link (new tab, `noopener noreferrer`, only when the origin
  is in `CAMERA_SOURCES["bma-cctv"].hosts.link`), and says we could not check from our network whether
  the official site is reachable and that the link says nothing about this camera.
- The marker is a map pin ("location only") and is **not dimmed** — there is nothing on our side to
  verify, so dimming would read as "checked and failed". Water-level popups do not offer these cameras as
  "nearest camera", because that button leads to a picture.
- `cpudapp.bangkok.go.th` is in **no** CSP directive: a new-tab navigation needs none, and SIAHRA fetches
  nothing from it.

**Whose cameras are these? (an inference, not a claim).** The `project` column names three BMA
traffic-CCTV maintenance/installation projects ("…เพื่อการบริหารจัดการจราจรของกรุงเทพมหานคร", "…บน
เส้นทางยกระดับคู่ขนานลอยฟ้า ถนนบรมราชชนนี", "…เพื่อตรวจสอบ และสั่งการแก้ไขปัญหาการจราจร"), and the row count
(238) matches the Department of Traffic and Transportation (สำนักการจราจรและขนส่ง) KPI dataset `cctv`
("total-camera-238"). That makes them very likely the department's traffic cameras — but the dataset
does not say so, so `owner` is `null`, the source name says "กรุงเทพมหานคร — ตำแหน่งกล้องจราจร", and no
camera is claimed to be viewable anywhere.

## How it is built

```
npm run build:cctv:bma -w apps/etl        # apps/etl/src/build-bma-cctv.ts
# while tsx is missing from the lockfile, from apps/etl:
npx -y tsx@4 src/build-bma-cctv.ts
```

No options: there is no probe, so no `--no-probe`/`--vantage`. Output: `apps/web/public/cctv/bma-cctv.json`,
a `CameraCatalogue` written through the shared `src/cameraCatalogue.ts` `writeCatalogue` — dedupe/sort by
id, every link `https:` with no userinfo and on an origin in `hosts.link` (`streamDirective("external-link")`
is empty, so that check is explicit, never a vacuous pass), `not-probed` enforced, and the serialized
file refused outright on `CREDENTIAL_PATTERN`. `sourceUrl` is the `package_show` URL.

1. `GET https://data.bangkok.go.th/api/3/action/package_show?id=bma-cctv` → the resources whose
   `format` is `CSV`; **exactly one** is required (zero or two stop the build — it does not guess which
   file is the list). The resource URL must be plain `https:`.
2. Download the CSV (UTF-8 with a BOM) and parse it as RFC 4180 (quoted fields may hold commas and line
   breaks, `""` is a quote, CRLF or LF). Header on 2026-09-27:
   `ID,District,location,Code DVR, ID Camera,project,lat,long` — note the leading space in ` ID Camera`;
   header names are trimmed before use.
3. Allowlist through `zod/mini`: `ID`, `ID Camera`, `District`, `location`, `lat`, `long`. **`Code DVR`
   and `project` are dropped by the allowlist before projection** — internal infrastructure identifiers and
   contract names the map does not need; a test asserts neither appears in the serialized output.
4. Coordinates must be plain decimals (`^-?\d+(\.\d+)?$` after trimming), within range and not `0,0`.
   Anything else is **dropped and counted, never repaired** — e.g. `" 100.468.312"`: choosing which dot is
   the decimal point would be inventing a coordinate.
5. `id` = the dataset's `ID` column (unique per row), `code` = ` ID Camera` (trimmed — the code a user can
   quote). ` ID Camera` is **not** the id because two codes each appear on two rows at **different
   intersections** (e.g. one code at แยกแบริ่ง and at ถ.ศรีนครินทร์ ตัด ถ.บางนา ตราด); deduplicating on it would
   silently drop a real location, and we cannot tell which row is wrong. The collision count is logged.
6. `nameTh` = `location`; `placeTh` = `District` prefixed with `เขต` unless it already starts with it
   (spelling kept as given, e.g. `จตจักร`); `nameEn` `null`; `owner` `null` (see above); `coordSource`
   `"upstream"`.
7. `provinceCode` by point-in-polygon against `apps/web/public/aoi/{code}/boundary.geojson`
   (`src/provincePolygons.ts`). All are expected in Bangkok (`10`); any other result is counted and kept
   as computed — never forced to `10`.

Logs are counts only (no rows, no URLs from the payload). `builtAt` is when the CSV was fetched
successfully (the layer's `fetchedAt`); the dataset's own dates are recorded below, not in the catalogue
(the contract has no field for them and does not need one — `publishedAt` stays `null`).

## Build of 2026-09-27 (07:35Z)

| | |
|---|---|
| dataset `metadata_modified` | 2024-06-07T21:00:34.054497 |
| CSV resource `created` / `last_modified` | 2023-10-05T08:42:30.262365 / 2023-10-05T08:42:30.238248 |
| CSV resource | `0d5af6a8-5747-4b16-913a-8e0455e37280` (`bma-cctv.csv`) |
| rows | 238 (59 distinct `District` values as written) |
| malformed rows | 0 |
| unusable coordinates (dropped) | 4 — longitudes with two decimal points (`ID` 33, 34, 57, 58) |
| empty/duplicate `ID` | 0 |
| ` ID Camera` codes shared by two rows | 2 (all four rows kept) |
| **cameras written** | **234**, one `external-link` stream each (all `not-probed`) |
| outside every province boundary | 0 |
| in a province other than `10` | 1 — `ID` 133 "ถ.ลำลูกกา ตัด ถ.พหลโยธิน" (District ดอนเมือง), which falls just inside Pathum Thani (`13`) by our boundary; kept as computed |

## Rebuilding

Run it again when the dataset changes (`metadata_modified` above moves) — the build is one CKAN call and
one CSV download, a few seconds, no probe. Commit the regenerated `bma-cctv.json` and update the table
above with the new counts.
