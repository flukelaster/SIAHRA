# `dwr-cameras.json` — DWR telemetry CCTV catalogue (E15)

**Source:** Department of Water Resources (กรมทรัพยากรน้ำ, DWR), public telemetry API
`https://telemetry.dwr.go.th/api`. DWR supplies the data; it neither built nor endorses this project.

**Licence:** DWR publishes no terms of use for this API (checked 2026-09-26). The layer is shown in
production **with attribution to DWR** (camera popup + the always-mounted credit line). Building the
web app with `VITE_FEATURE_CCTV=0` removes the whole layer, should DWR ask.

## How it is built

```
npm run build:cctv -w apps/etl        # apps/etl/src/build-cctv.ts
```

1. `POST public/reportCctv/listPaginate` with
   `{"paginate":{"page":1,"pageSize":200,"orders":[]},"search":{}}` (the `orders` array is required —
   without it DWR answers 400), page by page until `totalCount`.
2. `GET public/station/getByCode/{stationCode}` per station, sequentially, ~200 ms apart →
   `value.fullCon.entity.point.{lat,lon}`. Stations with no usable point are dropped and counted.
3. `provinceCode` by point-in-polygon against `apps/web/public/aoi/{code}/boundary.geojson`
   (two-digit directories only); `null` when a point falls in no boundary — never guessed from DWR's
   province name.

Each record is `{id, stationCode, nameTh, nameEn, lat, lon, provinceCode, amphoeTh}`; `builtAt` is
when the script fetched the list (it becomes the layer's `fetchedAt`). DWR publishes no timestamp for
the list itself, so the layer's `publishedAt` is `null`.

It is a **static-reference** layer: it says where cameras are, not what they see. Each snapshot is
fetched by the browser from DWR only when a user clicks a camera, and carries its own capture time
(parsed from DWR's snapshot path, `+07:00`) and fetch time in the popup.

## Credential-stripping rule (do not relax)

DWR's payloads for both endpoints also carry direct camera URLs (`cctvSnapshotLink`,
`cctvVideoLink`) that must never be copied, stored, logged or shipped — SIAHRA only ever talks to
DWR's own API routes. The build script therefore:

- parses every response through a `zod/mini` schema that does not declare those fields (unknown
  keys are dropped) and assembles each record field by field — it never spreads an upstream object;
- never prints or stores a raw upstream response — it logs counts, station codes and HTTP statuses
  only;
- refuses to write the file if the serialized output matches `/@|dyndns|:\/\/[^/]*:[^/]*@/`.

`apps/etl/src/build-cctv.test.ts` proves fake `user:pass@….dyndns…` links never reach the output.
Never add a camera link field to `CctvCamera` (`packages/shared-types/src/cctv.ts`).
