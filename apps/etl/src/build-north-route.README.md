# `north-route.json` — northern-water route topology (E16)

Two files, written by **one** run of

```
npm run build:north-route -w apps/etl        # apps/etl/src/build-north-route.ts
```

| Output (tracked) | Who reads it | What it holds |
| --- | --- | --- |
| `apps/web/public/rivers/north-route.json` | the web `NorthWaterCard` (`/rivers/north-route.json`) | reaches with simplified polylines, gaps, confluences, provinces; stations with chainage; dams on the route |
| `apps/api/src/data/northRouteStations.json` | `GET /api/v1/rivers/north` and the hourly `pullRouteHistory()` in `ObservationCacheDO` | `{builtAt, stations: [{ridCode, thaiwaterId, reachId}]}` only — the polylines stay out of the Worker bundle |

Rebuild both together; never hand-edit either.

## Inputs — nothing numeric is typed by hand

1. **`src/northRoute.source.json`** (tracked, strings only — the script refuses the file if it finds a
   single JSON number anywhere in it): the five reaches (`ping`, `wang`, `yom`, `nan`,
   `chao-phraya`), which reach each one flows into (Wang → Ping, Yom → Nan, Ping + Nan → Chao Phraya
   at Nakhon Sawan), the RID station codes of each reach listed **upstream → downstream**, the dam
   names on the route, and citation URLs:
   - the confluences: the English Wikipedia articles on each river;
   - RID station codes: the RID Hydrology portal (`https://hydro.rid.go.th/`, owner of the codes) and
     ThaiWater's `public/waterlevel_load`, which publishes the code as `station.tele_station_oldcode`;
   - the upstream → downstream order is **not** taken on trust: step 4 below checks it against the
     river line and refuses to write if it disagrees.
2. **ThaiWater, live** — `public/waterlevel_load` resolves each RID code to ThaiWater's `station.id`
   and coordinates (exact string match on `tele_station_oldcode`; no spatial guessing), and
   `analyst/dam` resolves each dam name (exact `dam.dam_name.th`) to every dam id ThaiWater uses for
   it (its daily and hourly rows carry different ids — Bhumibol is `1` daily and `43` hourly) and its
   coordinates. `builtAt` is when both calls succeeded; it is the layer's `fetchedAt`.
3. **OpenStreetMap** — the national extract `apps/etl/data/raw/thailand-latest.osm.pbf`
   (`fetchOsm.ts`; downloaded if absent). `osmium tags-filter w/waterway=river` → `osmium export`
   (GeoJSON Sequence, linestrings), keeping ways whose `name` **or** `name:th` equals the reach's
   `osmName` exactly (`แม่น้ำปิง`, `แม่น้ำวัง`, `แม่น้ำยม`, `แม่น้ำน่าน`, `แม่น้ำเจ้าพระยา`). The PBF
   header's `osmosis_replication_timestamp` is recorded as `osmExtractAt` (2026-08-15T20:21:20Z at the
   2026-09-26 build).

## Steps

1. **Merge ways per reach**: a graph of shared OSM nodes; pieces that do not touch are joined
   end-to-end, nearest ends first, by a straight line of at most 120 km; the main line is the longest
   shortest-path between two ends (two Dijkstra sweeps), so short side arms and braids drop out. Any
   piece that still cannot be joined is dropped and counted — if that is more than 20 % of the reach's
   length the build refuses.
2. **Straight-line joins are declared, never hidden**: every such segment survives simplification and
   is written to the reach's `gaps[]` as a km range. At the 2026-09-26 build: Ping 164.7–167.3 km and
   453.7–486.6 km (OSM has no line named แม่น้ำปิง from below Bhumibol dam to past the Wang
   confluence; the Wang's `joinsAtKm` 469.9 falls inside that range), Wang 83.8–124.3 km. Yom, Nan
   and Chao Phraya are continuous.
3. **Direction** comes from the parent river, not from the station list: a tributary's downstream end
   is the end nearer the reach it flows into; the outlet (Chao Phraya) starts at the end nearer its
   tributaries' mouths. Then Douglas–Peucker simplification at 200 m, coordinates rounded to 5
   decimals.
4. **Stations**: each coordinate is projected onto its reach's simplified line → `chainageKm` (from
   the reach's upstream end) and `offsetKm`. The build **refuses to write** when
   - a code is missing from the live feed, or matches more than one station;
   - a station is more than **2 km** from its reach line (catches tributary gauges such as P.4A on
     the Mae Taeng or P.12C, which failed this check and is not on the list);
   - chainage does not strictly increase in the order the source lists.
5. **Dams**: projected onto their reach; up to 40 km off the line is accepted because a dam can sit on
   a tributary (Kwae Noi Bamrung Dan is 27.8 km off the Nan) — the card draws those as side nodes.
   The Chao Phraya diversion dam is **not** in ThaiWater's `analyst/dam`, so it is not listed; C.13
   (directly below it) carries its outflow.
6. **Provinces**: `upstreamProvinceCodes` = the provinces the reach's line passes through, in order,
   by point-in-polygon against `apps/web/public/aoi/{code}/boundary.geojson` (the `provincePolygons.ts`
   loader); each station's `provinceCode` likewise (null if it falls in none — never guessed).

## What this layer is

`static-reference`, `fetchedAt = builtAt`, `publishedAt: null`, sources `osm` + `thaiwater`. It says
where the rivers and gauges are and in what order water passes them. It contains no measured value:
water level, discharge and their 48 h history come live from `GET /api/v1/rivers/north`
(`observed`). Chainage is along our simplified OSM line — good for ordering and spacing on a
schematic, not a surveyed river distance.

The 2026-09-26 build: 26 stations — Ping P.67, P.1, P.2A, P.7A, P.17; Wang W.1C, W.3A, W.4A; Yom
Y.20, Y.1C, Y.3A, Y.4, Y.16, Y.17; Nan N.64, N.1, N.2B, N.5A, N.7A, N.67; Chao Phraya C.2, C.13, C.3,
C.7A, C.35, C.12 (C.29A does not exist in the live feed) — and dams Bhumibol, Sirikit, Kwae Noi Bamrung Dan.

C.12 is RID's Samsen gauge in Bangkok (กรมชลประทานสามเสน, ThaiWater `station.id` 2599, province 10) and
the route's terminal node: chainage 318.8 km of the 373.4 km OSM Chao Phraya line, 0.01 km off it —
the OSM reach already runs past Bangkok to the gulf, so no reach end was moved. It is a tidal gauge:
the live feed publishes its level and bank (`min_bank`) but no discharge and no `qmax`, so the card
shows no %-of-capacity for it, and the flow animation on the C.35 → C.12 segment takes its speed from
C.35 (the segment's upstream end), never from an invented number.

Unit tests for the pure parts (source parsing, code resolution, gap bridging, orientation, chainage,
the refusals) are in `build-north-route.test.ts`.
