# `region-outline.json` — regional country outlines for the Storm panel map

**Source:** Natural Earth, 1:50m Cultural Vectors, *Admin 0 – Countries*, release **v5.1.2**, read
from the project's GitHub mirror at a pinned tag:
`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson`
(project home: <https://www.naturalearthdata.com/downloads/50m-cultural-vectors/>).

**Licence:** public domain — "All versions of Natural Earth raster + vector map data found on this
website are in the public domain" (<https://www.naturalearthdata.com/about/terms-of-use/>). No
attribution is required; the Storm panel credits Natural Earth anyway.

**Fetched / verified:** 2026-09-26. The script refuses to write unless the download's sha256 is
`3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb` (the v5.1.2 file; `master` was
byte-identical on that date).

## How it is built

```
cd apps/etl
npx -y tsx@4 src/build-region-outline.ts                 # downloads the pinned file
npx -y tsx@4 src/build-region-outline.ts --input <path>  # or reads a copy you already have
# npm run build:region-outline -w apps/etl  — same script; the tsx-based npm scripts currently fail
#                                             with "tsx: command not found" (tsx missing from the lockfile)
```

1. Verify the sha256 above.
2. Clip every country to lon 80–150 °E, lat −5–35 °N (`@turf/turf` `bboxClip`) — the Bay of Bengal,
   Andaman Sea, South China Sea and the western North Pacific, i.e. the two basins the Storm panel
   shows (GDACS NIO + JMA WNP). Countries with nothing inside the box are dropped.
3. Simplify (`simplify`, tolerance 0.05°, Thailand 0.025°) and round coordinates to 2 decimals
   (≈ 1 km), then drop consecutive duplicate points and degenerate rings.
4. Keep only `{iso (ADM0_A3), name (NAME_EN), thailand}` of Natural Earth's ~170 properties.
5. Refuse to write above 150 KB or without Thailand. The 2026-09-26 build: 26 countries, 58,733 bytes.

Output: tracked `apps/web/public/geo/region-outline.json`, a GeoJSON `FeatureCollection` with a
`bbox` and a `source` block (`name`, `url`, `sha256`, `license`, `builtAt`).

## What it is — and is not

A **basemap for orientation only**. It is not a hazard layer and carries no
`HazardLayerDescriptor`; nothing about any storm is derived from it (storm-to-province distances are
computed by the API from `data/provinceRings.json`, not from these outlines). Natural Earth draws
*de facto* boundaries at 1:50m; they are not an authoritative statement about any border.
