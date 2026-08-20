import type { th } from "./th";

/**
 * English catalog. `th.ts` owns the key set: this is typed as
 * `Record<keyof typeof th, string>`, so a missing or extra key is a tsc error,
 * and `catalog.test.ts` re-checks keys, empty values and `{placeholder}` sets.
 *
 * ความซื่อสัตย์ต่อข้อมูล (ห้ามแปลให้อ่อนลง):
 * - `time.neverReceived` = "never received", ไม่ใช่ "no data" ที่อ่านได้ว่าไม่มีภัย
 * - `freshness.missing.staticReference` = "retrieval time not recorded"
 *   (ไม่เคยจดเวลา) ไม่ใช่ "unknown"/"unavailable" ที่ฟังเหมือนดึงพลาด
 * - `health.delayed` = การดึง **สำเร็จ** แต่ต้นทางยังไม่ปล่อยค่าใหม่ ต้องอ่านต่าง
 *   จาก `health.stale` ที่แปลว่าฝั่งเราดึงไม่สำเร็จมานาน
 * - "ไม่ใช่การพยากรณ์" → "not a forecast" ทุกจุด และห้ามมีคำว่า probability /
 *   chance / risk score ที่ไม่ได้อยู่ในประโยคปฏิเสธ
 *
 * ข้อความที่ **ไม่แปล** โดยตั้งใจ: `attributionText` / `licenseName` / `agency`
 * ใน `SOURCES` (เป็นข้อความเครดิตตามเงื่อนไขของต้นทาง ไม่ใช่ข้อความ UI),
 * `summary.sourceAttribution` และ `SourceStatus.lastError` ที่มาจาก API,
 * และเนื้อหาของ `docs/methodology/*.md` (ดู `methodology.thaiOnly`)
 */
export const en: Record<keyof typeof th, string> = {
  // ── Language ───────────────────────────────────────────────────────────
  "lang.switch": "Language",
  "lang.option.th": "ไทย",
  "lang.option.en": "EN",
  "lang.name.th": "ภาษาไทย",
  "lang.name.en": "English",

  // ── Brand ──────────────────────────────────────────────────────────────
  "brand.tagline": "Spatial data atlas for hazard monitoring in Thailand",

  // ── Common ─────────────────────────────────────────────────────────────
  "common.loading": "Loading…",
  "common.close": "Close",
  "common.reconnecting": "Reconnecting automatically…",
  "common.province": "Province",

  // ── Units ──────────────────────────────────────────────────────────────
  "unit.mm": "mm",
  "unit.m": "m",
  "unit.km": "km",
  "unit.msl": "m MSL",
  "unit.mcm": "million m³",
  "unit.mcmPerDay": "million m³/day",
  "unit.rai": "rai",
  "unit.stations": "stations",
  "unit.sites": "sites",
  "unit.percent": "%",
  "unit.hours": "h",
  "unit.days": "d",

  // ── Time (lib/time.ts) ────────────────────────────────────────────────
  /** fetchedAt/observedAt = null. "Never received", never "no data". */
  "time.neverReceived": "Never received any data",
  "time.soon": "in a moment",
  "time.justNow": "just now",
  "time.minutesAgo": "{n} min ago",
  "time.hoursAgo": "{n} h ago",
  "time.daysAgo": "{n} d ago",
  "time.absolute": "{time}",

  // ── Epistemic badges ──────────────────────────────────────────────────
  "badge.observed": "Measured",
  "badge.observed.title": "Reported directly by an instrument or satellite",
  "badge.staticReference": "Static reference data",
  "badge.staticReference.title":
    "A reference dataset shipped with the map; it is not updated in real time",
  "badge.illustrative": "Illustrative",
  "badge.illustrative.title":
    "Computed by us from the terrain to aid map reading — not measured, and not a forecast",
  "badge.probabilistic": "Cited external model",
  "badge.probabilistic.title":
    "Output of an external agency's model with a citable source, not computed by this project",
  "badge.unknown": "Unknown data kind",
  "badge.unknown.title": "This build of the app does not recognise this layer's data kind",

  // ── Layer freshness (lib/layerFreshness.ts) ───────────────────────────
  "freshness.observedAt": "observed {time}",
  "freshness.fetchedAt": "retrieved {age}",
  "freshness.missing.observed": "Never received any data",
  "freshness.missing.staticReference": "Retrieval time not recorded",
  "freshness.missing.illustrative": "Computed from terrain; nothing is retrieved per refresh",
  "freshness.missing.probabilistic": "No model output has ever been received",
  "freshness.missing.unknown": "Retrieval time unknown",
  "freshness.status.unknown": "Source status not known",
  "freshness.publishedAt": "published {time}",
  "freshness.methodology": "Methodology",

  // ── Source health (/api/v1/health) ────────────────────────────────────
  "health.ok": "OK",
  /** The fetch SUCCEEDED; the upstream has not published a new reading yet. */
  "health.delayed": "Source has not published a new reading",
  /** No successful fetch on our side for longer than this source's budget. */
  "health.stale": "Data stale — no successful fetch",
  "health.degraded": "Some upstreams failed",
  "health.down": "Cannot retrieve data",
  "health.unknown": "Not known yet",
  "health.downNeverFetched": "Source not responding (no data ever received)",
  "health.delayedWithAge": "{label} (latest reading {age})",
  /**
   * For a source we COMPUTE rather than fetch (`exposure-illustrative`),
   * `latestObservedAt` is when we last produced a run — not when a station was
   * read. Calling that a "reading" would understate the true observation age.
   */
  "health.delayedNoRun": "No new computed run",
  "health.delayedWithRunAge": "{label} (last run {age})",
  "health.tooltip.fetched": " · retrieved successfully {age}",
  "health.tooltip.line": "{source}: {status}{fetched}",
  "status.apiDown": "Cannot reach the API",
  "status.apiDown.detail": "— the map still works, but there is no live measured data",
  "status.sources": "Sources",
  "status.updated": "updated {age}",
  "status.lastSuccess": " · last success {age}",

  // ── Top bar ───────────────────────────────────────────────────────────
  "topbar.searchPlaceholder": "Search province, district, station, dam…",
  "topbar.searchAria": "Search for a province, district, station or dam",
  "topbar.kind.province": "Province",
  "topbar.kind.amphoe": "District",
  "topbar.kind.station": "Monitoring station",
  "topbar.kind.dam": "Dam / reservoir",
  "topbar.share": "Share",
  "topbar.copied": "Copied",
  "topbar.shareTitle": "Copy a link to this view",
  "topbar.snapshotTitle": "Save a map image",
  "topbar.sources": "Data sources",

  // ── Province picker ───────────────────────────────────────────────────
  "province.select": "Select a province",
  "province.count": "{n} provinces",
  "province.searchPlaceholder": "Search provinces…",
  "province.searchAria": "Filter the province list",
  "province.notFound": "No province matches that search",
  /** Administrative prefix in the search box (Bangkok uses "Khet", others "Amphoe"). */
  "province.prefix.khet": "Khet ",
  "province.prefix.amphoe": "Amphoe ",

  // ── Legend / layers ───────────────────────────────────────────────────
  "legend.title": "Layers and symbols",
  "legend.layer.imagery": "Satellite imagery",
  "legend.layer.imagery.note": "The real surface, from satellite photography",
  "legend.layer.radar": "Rain radar (Thai Meteorological Department)",
  "legend.layer.radar.note": "Last 3 h of radar reflectivity, looping · measured",
  "legend.layer.floodExtent": "Satellite flood extent (GISTDA)",
  "legend.layer.floodExtent.note": "Detected in the latest satellite scene · not a forecast",
  "legend.layer.lowland": "Low-lying areas",
  "legend.layer.lowland.note": "Estimated from terrain elevation; not a flood forecast",

  "legend.layer.exposure": "Low-lying ground with heavy rain / high water reported nearby right now (illustrative)",
  "legend.layer.exposure.note":
    "Computed here from terrain plus real measurements — not a forecast, not a probability",
  "legend.layer.exposure.inputs":
    "Measurements from ThaiWater: rain over 1 h · rain over 24 h · freeboard below the bank · change in freeboard · the situation level ThaiWater publishes itself — laid over low-lying ground derived from the terrain (DEM)",
  "legend.exposure.historyWindow": "The change is measured over the last {h} h; it is a rate that already happened",
  "legend.exposure.computedAt": "Last computed {age}",
  "legend.exposure.noRunSince": "Nothing new has been computed since {time} — this is the earlier run",
  "legend.exposure.noRunEver": "No computed run has ever been received, so nothing is drawn on the map",
  "legend.exposure.layerOff": "This layer is off — no computed run has been requested",
  "legend.exposure.apiDownSince": "Cannot reach the API — this is the run from {time}; whether a newer one exists is unknown",
  "legend.exposure.apiDownNoRun": "Cannot reach the API, so no computed run has been received",
  "legend.exposure.scale": "Ordering of the measured values",
  "legend.exposure.level.low": "In the lowest band (and measured)",
  "legend.exposure.level.elevated": "Above the lowest band",
  "legend.exposure.level.high": "High",
  "legend.exposure.level.severe": "Top band of the published table",
  "legend.exposure.level.noData": "Nothing measurable came in — cannot be ranked, which is not the same as safe",
  "legend.exposure.stationCount": "{n} stations",
  "legend.exposure.stationCount.one": "1 station",
  "legend.exposure.integrity.mismatch":
    "terrain integrity check failed — this layer is off, because it sits on the low-lying ground derived from that same terrain",
  "exposure.noData.label": "Nothing to rank",
  "exposure.noData.sub": "This station sent no readings at all; that is not the same as safe",
  "legend.integrity.mismatch": "terrain integrity check failed — low-lying layer unavailable",
  "legend.integrity.unknown": "terrain integrity unknown (no checksum in the manifest)",
  "legend.layer.hazard": "Alerting station areas",
  "legend.layer.hazard.note": "Radius around stations reporting heavy rain / high water (measured)",
  "legend.layer.stations": "Monitoring stations",
  "legend.layer.stations.note": "Circle = water level · diamond = rainfall",
  "legend.layer.water": "Rivers / canals / water bodies (OSM)",
  "legend.layer.water.note": "3D water surfaces laid on the terrain · off above {km} km",
  "legend.layer.roads": "Main roads (OSM)",
  "legend.layer.roads.note": "Motorways / highways / secondary roads · off above {km} km",
  "legend.layer.dams": "Dams / reservoirs",
  "legend.layer.dams.note": "% of capacity as reported (ThaiWater)",
  "legend.layer.sunlight": "Sunlight at the real time of day",
  "legend.layer.sunlight.note": "Sun and sky position for the current or timeline time",
  "legend.layer.trees": "Trees (ESA WorldCover)",
  "legend.layer.trees.note": "Forest/plantation from 10 m land cover; shown when zoomed in",
  "legend.layer.buildings": "3D buildings (OSM)",
  "legend.layer.buildings.note": "Whole province · only large/tall buildings from far away · off above {km} km",
  "legend.waterlevelScale": "Water-level stations (ThaiWater bands)",
  "legend.rainScale": "24 h accumulated rainfall",
  "legend.rain.band1": "< 10 mm",
  "legend.rain.band2": "10–35 mm",
  "legend.rain.band3": "35–90 mm",
  "legend.rain.band4": "> 90 mm",
  "legend.provinceBoundary": "Province boundary",
  "legend.earthquakes": "Detected earthquakes (30 days)",

  // ── ThaiWater situation bands ─────────────────────────────────────────
  "situation.1": "Critically low",
  "situation.2": "Low",
  "situation.3": "Normal",
  "situation.4": "High",
  "situation.5": "Overflowing the bank",

  // ── Render quality ────────────────────────────────────────────────────
  "quality.label": "Render quality",
  "quality.auto": "Auto",
  "quality.high": "High",
  "quality.balanced": "Balanced",
  "quality.low": "Economy",
  "quality.autoWith": "(auto: {level})",

  // ── Vertical exaggeration ─────────────────────────────────────────────
  "exaggeration.label": "Vertical scale",
  "exaggeration.real": "True elevation, 1:1",
  "exaggeration.factor": "Heights exaggerated {n}× (not true proportions)",

  // ── Timeline ──────────────────────────────────────────────────────────
  "timeline.title": "Water level history",
  "timeline.rangeLabel": "History window",
  "timeline.range.72h": "72 h",
  "timeline.range.7d": "7 days",
  "timeline.range.30d": "30 days",
  "timeline.notForecast": "Measured values · not a forecast",
  "timeline.fromArchive": "From the permanent archive · hourly",
  "timeline.live": "Live · latest values",
  "timeline.play": "Play history",
  "timeline.pause": "Pause",
  "timeline.backToLive": "Back to live",
  "timeline.slider": "Scrub time",
  "timeline.tick.now": "now",
  "timeline.tick.days": "-{n} d",
  "timeline.tick.hours": "-{n} h",

  // ── Stat tiles ────────────────────────────────────────────────────────
  "stats.none": "No measured data",
  "stats.rainStations": "Rain gauges",
  "stats.maxRain24h": "Max 24 h rain",
  "stats.waterStations": "Water stations",
  "stats.aboveWarning": "Above warning",

  // ── Map attribution ───────────────────────────────────────────────────
  "attribution.terrain": "Terrain Copernicus GLO-30 ({demType}) · {cell}",
  "attribution.cellLod": "{m} m/cell (LOD by camera distance)",
  "attribution.cell": "{m} m/cell",
  "attribution.verticalScale": "Vertical scale {scale}",
  "attribution.scaleReal": "1:1 (true)",
  "attribution.scaleExaggerated": "{n}:1 (exaggerated)",
  "attribution.buildings": "{n} OSM buildings{urban}",
  "attribution.urbanCore": " (urban core only)",
  "attribution.stations": "{n} monitoring stations",
  "attribution.imagery": "Satellite imagery © {text}",
  "attribution.dataset": "dataset {version}",
  "attribution.sources": "Sources:",
  "attribution.noEndorsement":
    "The agencies above publish the data; they do not endorse this project",
  "attribution.imageryEsri": "Satellite imagery Esri",
  "attribution.snapshotHistorical": "historical values {time}",

  // ── Data status footer ────────────────────────────────────────────────
  "footer.dataStatus": "Data status",
  "footer.notConnected": "Not connected yet",
  "footer.stale": "Data stale",
  "footer.ok": "OK",

  // ── Viewport controls ─────────────────────────────────────────────────
  "viewport.province": "{name} Province",
  "viewport.subtitle": "3D view · real terrain",
  "viewport.radarFrame": "TMD rain radar {time}",
  "viewport.north": "Face north",
  "viewport.orbit": "Orbit / tilt the view",
  "viewport.pan": "Pan the map",
  "viewport.zoomIn": "Zoom in",
  "viewport.zoomOut": "Zoom out",
  "viewport.fullscreen": "Full screen",
  "viewport.exitFullscreen": "Exit full screen",

  // ── Mobile sheet ──────────────────────────────────────────────────────
  "sheet.collapse": "Collapse panel",
  "sheet.expand": "Expand panel",
  "sheet.tab.province": "Province",
  "sheet.tab.layers": "Layers",
  "sheet.tab.flood": "Flood",
  "sheet.tab.water": "Water level",
  "sheet.tab.rain": "Rain",
  "sheet.tab.dams": "Dams",
  "sheet.tab.quake": "Earthquakes",

  // ── Satellite flood card ──────────────────────────────────────────────
  "flood.title": "Satellite flood extent",
  "flood.observedChip": "Observed",
  "flood.loadError": "Could not load the flood layer: {error}",
  "flood.noScene":
    "The latest GISTDA scene has not been retrieved yet (retrying) — this does not mean there is no flooding",
  "flood.none": "No flooded area found in this province in the latest scene",
  "flood.noneFetched": " (retrieved {age})",
  "flood.tambonCount": "Flooded subdistricts",
  "flood.areaRai": "Area (rai)",
  "flood.households": "Households",
  "flood.unknownTambon": "Subdistrict not stated",
  "flood.firstSeen": "first seen {time}",
  "flood.note":
    "Flood outlines are interpreted from satellite imagery by GISTDA (flooding_vis dataset) — they are what has already been detected, not a forecast · the scene carries no acquisition date, so the retrieval time is shown instead",
  "flood.noteEarliest": " and when each area was first seen (earliest {time})",

  // ── Water level card ──────────────────────────────────────────────────
  "water.title": "Measured water levels",
  "water.historicalNote":
    "Viewing history — dot colour comes from the distance below bank level (ThaiWater does not publish historical situation bands)",
  "water.overflowing": "{n} stations are in the high-water or overflowing band",
  "water.none": "No water-level station in this province",
  "water.note": "These are measured values from telemetry stations, not a forecast",
  "water.observedAt": " · data {time}",
  "water.stationFallback": "Station {id}",
  "water.aboveBank": "{n} {unit} above the bank",
  "water.belowBank": "{n} {unit} below the bank",
  "water.historicalChip": "historical",
  "water.sparkline.aria": "72-hour water level chart",
  "water.sparkline.bank": "lowest bank",
  "water.sparkline.none": "Not enough history",
  "water.history.caption": "Last 72 h · {datum} · measured every 10 minutes",
  "water.datum.msl": "m MSL",
  "water.datum.local": "m (station datum)",
  "water.datum.unknown": "m",

  // ── Rainfall card ─────────────────────────────────────────────────────
  "rain.title": "24-hour rainfall",
  "rain.reporting": "{n} stations",
  "rain.wetSummary": "{wet} of {total} reporting stations recorded rain",
  "rain.none": "No rain gauge in this province",
  "rain.note": "Accumulated rainfall measured by telemetry stations, not a forecast",

  // ── Dam card ──────────────────────────────────────────────────────────
  "dam.title": "Dams and reservoirs",
  "dam.count": "{n} sites",
  "dam.none": "No dam or reservoir reported in this province",
  "dam.prefix": "Dam ",
  "dam.reservoir": "Reservoir",
  "dam.inflow": " · inflow {n}",
  "dam.released": " · released {n}",
  "dam.note":
    "Storage as reported by the Royal Irrigation Department / EGAT via ThaiWater (HII) — only values reported within the last 48 h",

  // ── Earthquake card ───────────────────────────────────────────────────
  "quake.title": "Measured earthquakes",
  "quake.conn.connecting": "Connecting",
  "quake.conn.live": "Live",
  "quake.conn.polling": "Polling",
  "quake.conn.reconnecting": "Connection lost, reconnecting",
  "quake.conn.error": "Cannot connect",
  "quake.events30d": "Events in the last 30 days",
  "quake.maxMag": "Largest magnitude",
  "quake.parseErrors": "{n} feed messages could not be read — some events may be missing",
  "quake.none": "No event in the monitored area for this period",
  "quake.unknownPlace": "Location not stated",
  "quake.unknownMagType": "Magnitude scale not stated",
  "quake.depth": "depth {n} {unit}",
  "quake.unreviewed": "not reviewed",
  "quake.reviewed": "reviewed",
  "quake.note":
    "Measured data from USGS and EMSC — events that have already been detected, not a forecast",
  "quake.asOf": " · data as of {time}",
  "quake.nearest.inside": "within {province}",
  "quake.nearest.distance": "≈ {n} km from {province}",
  "quake.nearest.unknown": "nearest province not computed yet",
  "quake.nearest.note": "Geometric distance to the province boundary (OpenStreetMap admin boundaries, which include territorial waters — so an offshore point can fall \"within\" a coastal province) — not a shaking model",
  "quake.eventPage": "Event page at the source",
  "quake.asOfWithAge": "{time} ({age})",

  // ── Map popup ─────────────────────────────────────────────────────────
  "popup.situationThaiwater": "Situation (ThaiWater)",
  "popup.situation": "Situation",
  "popup.situationHistorical": "Historical value — not stated",
  "popup.waterlevel": "Water level",
  "popup.minBank": "Lowest bank",
  "popup.aboveBank": "Above the bank",
  "popup.belowBank": "Below the bank",
  "popup.observedAt": "Observed at",
  "popup.realObserved": "Measured values",
  "popup.partlyArchive": " · partly from the permanent archive",
  "popup.noHistory": "No history",
  "popup.rain24h": "24 h rainfall",
  "popup.rain1h": "1 h rainfall",
  "popup.damStorage": "Storage",
  "popup.damVolume": "Volume",
  "popup.damMax": "Maximum capacity",
  "popup.damInflow": "Inflow",
  "popup.damReleased": "Released",
  "popup.reportedAt": "Reported at",
  "popup.quakeTitle": "Earthquake M{mag}",
  "popup.depth": "Depth",
  "popup.localTime": "Time (local)",
  "popup.nearestProvinces": "Nearest provinces",
  "popup.source": "Source",
  "popup.status": "Status",
  "popup.statusAutomatic": "Detected automatically, not reviewed",
  "popup.statusReviewed": "Reviewed",
  "popup.floodTitle": "Tambon {tambon} — flooded area",
  "popup.mapPoint": "Point on the map",
  "popup.coords": "Coordinates",
  "popup.elevation": "Terrain elevation (DSM)",
  "popup.amphoe": "District",
  "popup.floodArea": "Flooded area",
  "popup.firstSeen": "First seen",
  "popup.lastSeen": "Last seen",
  "popup.floodNote":
    "Interpreted from satellite imagery (GISTDA) — already detected, not a forecast",

  // ── 3D scene labels ───────────────────────────────────────────────────
  "scene.loadingTerrain": "Loading terrain data…",
  "scene.buildingBuild": "Building the 3D buildings…",
  "scene.loadingHiRes": "Loading high-resolution terrain…",
  "scene.loadError": "Could not load the 3D map",
  "scene.loadingImagery": "Loading satellite imagery",
  "scene.notBuiltTitle": "The terrain for this province has not been processed yet",
  "scene.notBuiltBody": "Measured data still shows as usual in the side panels",
  "scene.station": "Station {id}",
  "scene.aboveBankHistorical": "{n} m above the bank (historical)",
  "scene.belowBankHistorical": "{n} m below the bank (historical)",
  "scene.overflowObserved": "Overflowing the bank (measured)",
  "scene.highWaterObserved": "High water (measured)",
  "scene.rain24h": "24 h rain {n} mm",
  "scene.floodArea": "Flooded area",
  "scene.floodAreaRai": "Flooded {n} rai (satellite)",
  "scene.floodPlain": "Flooded (satellite)",
  "scene.quakeLabel": "Earthquake M{mag}",
  "scene.quakeAutomatic": "Detected · not reviewed",
  "scene.quakeReviewed": "Detected · reviewed",
  "scene.damCapacity": "{n}% of capacity (measured)",
  "scene.damNoCapacity": "No capacity data",

  // ── Hook error strings ────────────────────────────────────────────────
  "error.loadFailed": "Could not load",
  "error.observationsFailed": "Could not load the measured data",
  "error.apiUnreachable": "Cannot reach the API — check that the API server is running (npm run dev)",
  "error.networkUnreachable": "Network unreachable, retrying…",
  "error.earthquakeFeed": "Cannot connect to the earthquake feed",

  // ── Methodology page ──────────────────────────────────────────────────
  "methodology.loading": "Loading the document…",
  "methodology.back": "Back to the {brand} map",
  "methodology.doc.lowland": "Low-lying areas (illustrative)",
  "methodology.doc.floodExposure": "Flood exposure (illustrative)",
  "methodology.notFoundTitle": "No such document",
  "methodology.notFound": "Document not found",
  "methodology.notFoundBody": "There is no methodology document called",
  "methodology.available": "Documents available now:",
  /**
   * The source documents in `docs/methodology/` are written in Thai and have no
   * translation yet. Say so plainly instead of letting an English reader assume
   * the Thai prose below is a translation.
   */
  "methodology.thaiOnly":
    "This methodology document is available in Thai only; there is no English translation yet.",
};
