<div align="center">

# 🛰️ SIAHRA

**S**patial **I**ntelligence **A**tlas for **H**azard & **R**esilience **A**nalytics

แผนที่ข้อมูลเชิงพื้นที่เพื่อการเฝ้าระวังภัยพิบัติของประเทศไทย
*A 3D geospatial hazard-intelligence platform for Thailand — real-time flood, rainfall, dam and earthquake monitoring rendered as an interactive provincial digital environment.*

[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Three.js](https://img.shields.io/badge/Three.js-0.185-000000?logo=three.js&logoColor=white)](https://threejs.org)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Status](https://img.shields.io/badge/status-active%20development-yellow)](#project-status)
[![License](https://img.shields.io/badge/license-unspecified-lightgrey)](#license)

`thailand` `disaster-response` `geospatial` `webgl` `three-js` `react` `typescript` `cloudflare-workers` `durable-objects` `flood-monitoring` `earthquake-monitoring` `digital-twin` `3d-visualization` `open-data`

</div>

<br/>

<p align="center">
  <img src="docs/images/hero-chiangmai.png" alt="SIAHRA 3D map of Chiang Mai province showing real terrain relief across the mountain valley, road networks, a live earthquake marker and the full data-layer legend" width="100%" />
</p>

<p align="center"><sub>Chiang Mai province in the live 3D viewport — real terrain relief, road networks, a live earthquake marker and the full data-layer legend.</sub></p>

<br/>

## Table of contents

- [About](#about)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Monorepo layout](#monorepo-layout)
- [Getting started](#getting-started)
- [API](#api)
- [Data sources & attribution](#data-sources--attribution)
- [Project status](#project-status)
- [Disclaimer](#disclaimer)
- [License](#license)

## About

SIAHRA renders Thailand's 77 provinces as navigable 3D terrain — real elevation, buildings, roads, rivers and land cover — and overlays it with live hazard intelligence: flood extents, river/rainfall telemetry, dam levels, weather radar and earthquake activity. It exists to make the question **"is my area at risk right now, and how did we get here?"** answerable in a single interactive view instead of scattered across a dozen agency dashboards.

The project follows a clean separation between three data classes: **base geospatial data** (terrain, buildings, land cover — slow-changing, pre-processed offline), **observation data** (rainfall, river levels, radar, seismic events — polled continuously from official sources), and **derived data** (flood extents, alerts, aggregates — computed by SIAHRA's own edge services). Every panel in the UI shows its data's age and source so nothing is presented as more current or more certain than it actually is.

## Features

- 🗺️ **Interactive 3D provincial terrain** — Three.js quadtree-tiled terrain with satellite imagery, building extrusions, vegetation and road networks, streamed progressively as you pan and zoom.
- 🌊 **Real-time flood intelligence** — GISTDA satellite-derived flood extent overlaid on the terrain, plus live water-level readings from ThaiWater (สสน.) gauge stations with 72-hour history.
- 🌧️ **Rainfall & weather radar** — TMD radar composites and rainfall telemetry with a scrubbable timeline.
- 🏔️ **Dam & reservoir monitoring** — storage levels and capacity for reservoirs reporting in the selected province.
- 🌏 **Earthquake feed** — near real-time seismic events cross-checked across USGS, EMSC and TMD.
- 📡 **Live source-health footer** — every panel discloses upstream freshness ("updated N minutes ago") and falls back to "unknown" instead of failing silently when a source is down.
- 🔗 **Shareable permalinks** — camera position, province and layer state are encoded into the URL.
- 📱 **Responsive layout** — a full desktop control-room view and a condensed mobile sheet for field use.

## Tech stack

| Layer | Technology |
|---|---|
| 3D rendering / client | [Three.js](https://threejs.org), [React 19](https://react.dev), TypeScript, [Vite](https://vite.dev), [Tailwind CSS 4](https://tailwindcss.com) |
| Edge API | [Cloudflare Workers](https://workers.cloudflare.com), [Durable Objects](https://developers.cloudflare.com/durable-objects/) (live state / fan-out), [R2](https://developers.cloudflare.com/r2/) (immutable geodata artifacts), [KV](https://developers.cloudflare.com/kv/) (slow-changing config) |
| ETL / geodata pipeline | [GDAL](https://gdal.org)-driven Node/TypeScript scripts ([`tsx`](https://github.com/privatenumber/tsx)), [Turf.js](https://turfjs.org), [Copernicus GLO-30 DEM](https://registry.opendata.aws/copernicus-dem/), [OpenStreetMap](https://www.openstreetmap.org) |
| Tooling | npm workspaces monorepo, [Wrangler](https://developers.cloudflare.com/workers/wrangler/), [oxlint](https://oxc.rs) |

## Architecture

```mermaid
flowchart LR
    subgraph Sources["Upstream sources"]
        TMD[TMD rainfall / radar / seismic]
        TW[ThaiWater สสน. gauges & dams]
        GISTDA[GISTDA flood extent]
        USGS[USGS / EMSC earthquakes]
        DEM[Copernicus DEM · OSM buildings]
    end

    subgraph ETL["apps/etl — offline pipeline"]
        A[Ingest + CRS normalize] --> B[Terrain / building / land-cover tiles]
    end

    subgraph Edge["apps/api — Cloudflare Worker"]
        R[Router] --> DO["Durable Objects<br/>observation cache · flood extent<br/>earthquake feed · radar"]
        DO --> KV[(KV config)]
    end

    subgraph Storage
        R2[(R2 — tile & geodata artifacts)]
    end

    subgraph Client["apps/web — React + Three.js"]
        UI[3D viewport, panels, timeline]
    end

    TMD --> Edge
    TW --> Edge
    GISTDA --> Edge
    USGS --> Edge
    DEM --> ETL --> R2
    R2 --> UI
    Edge --> UI
```

The Worker's `scheduled` handler polls upstream sources on a cron and keeps each Durable Object's cache warm, so the first browser request after a quiet period never pays a multi-megabyte upstream fetch inline.

## Monorepo layout

```
SIAHRA/
├── apps/
│   ├── web/     # React + Three.js client (Vite)
│   ├── api/     # Cloudflare Worker — routes, Durable Objects, ingestion
│   └── etl/     # Offline geodata pipeline (terrain/building/feature/land-cover tiles)
├── packages/
│   └── shared-types/   # Types shared between web and api
└── SIAHRA-implement-plan.md   # Research & architecture blueprint
```

## Getting started

**Prerequisites:** Node.js 20+, npm 10+.

```bash
# Install workspace dependencies
npm install

# Run the API (Wrangler, port 8787) and the web client (Vite, port 5173) together
npm run dev

# ...or independently
npm run dev:api
npm run dev:web
```

Terrain/building tile pyramids are generated by the ETL pipeline and served locally by a Vite middleware:

```bash
npm run build:aoi -w apps/etl        # build tiles for all provinces
```

```bash
npm run build:web                     # production client build → apps/web/dist
npm run deploy -w apps/api            # deploy the Worker (serves apps/web/dist as static assets)
```

## API

The Worker exposes a versioned JSON API under `/api/v1`:

| Endpoint | Description |
|---|---|
| `GET /api/v1/health` | Freshness/status of every upstream source |
| `GET /api/v1/observations` | Live rainfall/water-level observations |
| `GET /api/v1/earthquakes/recent` · `/live` | Recent and live-polled seismic events |
| `GET /api/v1/flood-extent/summary` | Nationwide flood-extent summary |
| `GET /api/v1/provinces/:code/flood-extent` | Flood extent for one province |
| `GET /api/v1/provinces/:code/hazards/latest` | Latest hazard snapshot for one province |
| `GET /api/v1/dams` | Reservoir storage levels |
| `GET /api/v1/radar/frames` · `/radar/frame/:ts.png` | Weather radar composite frames |
| `GET /api/v1/stations/:id/history` | Historical readings for one gauge station |

## Data sources & attribution

ข้อมูลจาก สสน. (ThaiWater), กรมอุตุนิยมวิทยา (TMD), USGS, EMSC, Copernicus DEM และ OpenStreetMap

| Layer | Source | License |
|---|---|---|
| Terrain (DEM) | Copernicus GLO-30 | Open, attribution required |
| Land cover | ESA WorldCover | CC BY 4.0 |
| Buildings / roads | OpenStreetMap / Geofabrik Thailand extract | ODbL |
| Rainfall / radar / seismic | Thai Meteorological Department (TMD) | Official API terms |
| River / rainfall telemetry, dams | Hydro-Informatics Institute / ThaiWater (สสน.) | Official API terms |
| Satellite flood extent | GISTDA | Open Data Commons |
| Earthquake cross-check | USGS, EMSC | Public data policy |

This is an attribution list, **not** a claim of authorship or endorsement — these agencies supply the data; they did not build or endorse this application. Several upstream layers referenced in [`SIAHRA-implement-plan.md`](SIAHRA-implement-plan.md) (e.g. some LDD soil datasets) carry non-commercial or share-alike terms and are deliberately **not** wired into the live product; verify licensing before adding any new source.

## Project status

Phases 1–9 of the implementation plan are complete in local development (terrain/building/flood/earthquake/radar pipelines, the full Worker API, and the 3D client). Production deployment via Cloudflare Workers + R2 is in progress. See [`SIAHRA-implement-plan.md`](SIAHRA-implement-plan.md) for the full research blueprint, data-source inventory and roadmap.

## Disclaimer

SIAHRA aggregates and visualizes official hazard data; it is **not** an early-warning system and does not predict earthquakes. Earthquake science can detect and rapidly characterize events after rupture begins — it cannot forecast the time, place or magnitude of a future quake. Flood extents and levels reflect the freshness and resolution of upstream sources (shown next to every panel) and should not be the sole basis for evacuation or safety decisions — always follow official guidance from TMD, DDPM and local authorities.

## License

No license has been declared for this repository yet — all rights reserved by default until a `LICENSE` file is added. Upstream data retains the licenses listed [above](#data-sources--attribution) regardless of this repository's own license.
