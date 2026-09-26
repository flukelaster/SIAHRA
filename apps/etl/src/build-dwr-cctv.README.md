# `dwr-cctv.json` — DWR telemetry CCTV catalogue (E15)

**Source:** Department of Water Resources (กรมทรัพยากรน้ำ, DWR), public telemetry API
`https://telemetry.dwr.go.th/api`. DWR supplies the data; it neither built nor endorses this project.

**Licence:** DWR publishes no terms of use for this API (checked 2026-09-26). The layer is shown in
production **with attribution to DWR** (camera popup + the always-mounted credit line). Building the
web app with `VITE_FEATURE_CCTV=0` removes the whole layer, should DWR ask.

## How it is built

```
npm run build:cctv:dwr -w apps/etl        # apps/etl/src/build-dwr-cctv.ts
npx -y tsx@4 src/build-dwr-cctv.ts [--no-probe] [--vantage <label>]   # from apps/etl, while tsx is missing from the lockfile
```

Output: `apps/web/public/cctv/dwr-cctv.json`, a `CameraCatalogue` (`packages/shared-types/src/cctv.ts`)
written through the shared `src/cameraCatalogue.ts` `writeCatalogue` (dedupe/sort by id, allowlisted
origins only, refused outright on `CREDENTIAL_PATTERN`). This is the only file the web reads for this
source (`apps/web/src/hooks/useCameraCatalogues.ts`, since E15.3 PR B); the per-source legacy file of
E15 was deleted in that PR.

1. `POST public/reportCctv/listPaginate` with
   `{"paginate":{"page":1,"pageSize":200,"orders":[]},"search":{}}` (the `orders` array is required —
   without it DWR answers 400), page by page until `totalCount`.
2. `GET public/station/getByCode/{stationCode}` per station, sequentially, ~200 ms apart →
   `value.fullCon.entity.point.{lat,lon}`. Stations with no usable point are dropped and counted.
3. `provinceCode` by point-in-polygon against `apps/web/public/aoi/{code}/boundary.geojson`
   (two-digit directories only); `null` when a point falls in no boundary — never guessed from DWR's
   province name.
4. Each camera gets **two streams, neither with a URL** — the web derives both from the record:
   - `{kind: "dwr-snapshot", captureTime: "path"}` — the latest still, fetched by
     `GET public/reportCctv/snapshot/{id}` → `POST file/image/cctv` (`apps/web/src/lib/cctv.ts`);
     its capture time is parsed from DWR's snapshot path at `+07:00`;
   - `{kind: "dwr-mjpeg", stationCode, captureTime: "none"}` — the live MJPEG
     `public/cctv/mjpegStream?stnCode={stationCode}`, shown as `<img src>`; it carries no timestamp.
5. **Probe** (unless `--no-probe`): every stream is requested once from the machine that runs the
   build (`src/cameraCatalogue.ts` `probeStreams`; at most 4 requests in flight against
   `telemetry.dwr.go.th`, because a DWR MJPEG takes 4–6 s to its first frame; 15 s timeout;
   `Origin: https://siahra-radar.co` on every request, since DWR reflects the origin in
   `Access-Control-Allow-Origin` and would otherwise show none). `dwr-snapshot` repeats the web's
   two-step fetch read-only and classifies the JPEG; a `404` on either step, or an empty `value`, is
   `empty` — "DWR answered: no image", the web's `no-image` — not an API fault. `dwr-mjpeg` reads the
   first chunk of the multipart stream and disconnects; a 200 with no bytes is `empty`. Per stream
   the file keeps `probe: {result, cors}`; `probedAt` and `probeVantage` (the `--vantage`
   label only, `unlabelled` when none is given — never the build machine's hostname) are stored **once per catalogue**. With `--no-probe` every stream is `not-probed` and both
   fields are `null` — `ok` is never a default.

Each record is `{id, sourceId: "dwr-cctv", nameTh, nameEn, lat, lon, coordSource: "upstream",
provinceCode, owner: null, code, placeTh, streams}` with `code` = DWR's station code and `placeTh` =
the amphoe DWR names; `owner` is `null` because DWR names no owner apart from itself (the credit
comes from `SOURCES["dwr-cctv"]`). `builtAt` is when the script fetched the list (it becomes the
layer's `fetchedAt`). DWR publishes no timestamp for the list itself, so the layer's `publishedAt` is
`null`.

Result of the 2026-09-26 run (13:30 UTC, the first run on the generic contract): 126 cameras in 58
provinces, 0 without coordinates, 0 outside every boundary, 252 streams. Probe of that run — vantage
`fortinet-lan`, a network behind a Fortinet TLS filter,
2026-09-26T13:40:52Z (~10 min: at most 4 requests at a time against DWR):

| kind | streams | https | cors yes/no/unknown | ok | empty | not-image | http-4xx | http-5xx | unreachable (could not be reached from this vantage) | not-probed | timestamp evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dwr-snapshot | 126 | 126/126 | 122/0/4 | 122 | 0 | 0 | 0 | 0 | 4 | 0 | capture time from the snapshot path (+07:00) |
| dwr-mjpeg | 126 | 126/126 | 107/0/19 | 61 | 45 | 0 | 1 | 0 | 19 | 0 | none |

Reading it honestly: every request that got an answer carried `Access-Control-Allow-Origin:
https://siahra-radar.co` (DWR reflects the origin), so `cors` is `true` wherever there is a verdict
and `null` only where nothing answered. The 45 `empty` live streams answered 200 and closed the body
with no bytes (DWR's own "no live picture" — seen at ~5 s in a hand check), not broken. The 19 + 4
`unreachable` delivered no first byte within 15 s from this vantage; the probe does **not** record
whether headers came back before the timeout, so a stream that sent 200 and then stalled is counted
here alongside a host that could not be reached at all (a DWR MJPEG takes 4–6 s to its first frame
when it works, so some of these may simply be slower stations). Either way it is a statement about
this network and this 15 s budget, not about the camera. Everything stays in the file; the UI dims a stream whose probe is not `ok` and
labels it with `probedAt`/`probeVantage`. `src/probe-cameras.ts dwr-cctv --vantage <label>` re-probes
the built file without writing anything.

It is a **static-reference** layer: it says where cameras are, not what they see. Each snapshot is
fetched by the browser from DWR only when a user clicks a camera, and carries its own capture time
(parsed from DWR's snapshot path, `+07:00`) and fetch time in the popup.

## Credential-stripping rule (do not relax)

DWR's payloads for both endpoints also carry direct camera URLs (`cctvSnapshotLink`,
`cctvVideoLink`) that must never be copied, stored, logged or shipped — SIAHRA only ever talks to
DWR's own API routes. The build script therefore:

- parses every response through a `zod/mini` schema that does not declare those fields (unknown
  keys are dropped) and assembles each record field by field — it never spreads an upstream object;
- emits no stream URL at all for this source (both kinds are derived from `id`/`stationCode`), so
  there is nothing for a link field to leak into;
- never prints or stores a raw upstream response — it logs counts, station codes and HTTP statuses
  only, and the probe prints a count table per kind and result;
- refuses to write the file if the serialized output matches `/@|dyndns|:\/\/[^/]*:[^/]*@/`.
  (`CREDENTIAL_PATTERN` and the point-in-polygon helpers live in `src/provincePolygons.ts`, shared
  with `build-itic-cctv.ts`; the refusal itself is in `src/cameraCatalogue.ts` `writeCatalogue`.)

`apps/etl/src/build-dwr-cctv.test.ts` proves fake `user:pass@….dyndns…` links never reach the
output; `apps/etl/src/cameraCatalogue.test.ts` covers the probe classification, the DWR two-step
snapshot probe, the `not-probed` default and every write-time refusal. Never add a camera link field
to the DWR streams in `packages/shared-types/src/cctv.ts`.
