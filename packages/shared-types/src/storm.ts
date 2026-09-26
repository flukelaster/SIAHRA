import type { HazardLayerDescriptor } from "./hazard-layer.js";

/**
 * Tropical-cyclone tracks (storm layer, v1) — contract between the API
 * (`StormTrackDO`, `GET /api/v1/storms`) and the web Storm panel.
 *
 * Two upstreams, split by basin and never substituted for each other:
 * - `jma-typhoon`: JMA (RSMC Tokyo) for the western North Pacific + South China Sea
 * - `gdacs-tc`:    GDACS (JTWC data) for the North Indian Ocean only
 *
 * Every value here is what the upstream published, re-shaped. Nothing is
 * computed except `nearestKmByProvince`, which is plain geometry (distance),
 * never a likelihood. A field the upstream did not send is `null`, never `0`:
 * "0 kt" and "the source sent no wind" are different statements.
 */

export type StormSourceId = "jma-typhoon" | "gdacs-tc";

/** WNP = western North Pacific incl. the South China Sea (JMA) · NIO = North Indian Ocean (GDACS/JTWC) */
export type StormBasin = "WNP" | "NIO";

/** One position the upstream reports as already analysed (the past track). */
export interface StormPastPosition {
  /**
   * Analysis time of this fix (ISO). `null` when the upstream gives none — JMA's
   * past-track array is bare `[lat, lon]` pairs; only its latest analysis
   * position carries a time. Never interpolated.
   */
  observedAt: string | null;
  lat: number;
  lon: number;
  /** Maximum sustained wind (kt) as the upstream reports it — see `StormTrack.windAveraging` */
  windKt: number | null;
  pressureHpa: number | null;
}

/** One forecast position of a third-party advisory (deterministic track). */
export interface StormForecastPosition {
  /** Valid time of this position (ISO) — a future instant, not when anything ran */
  validAt: string;
  lat: number;
  lon: number;
  windKt: number | null;
  pressureHpa: number | null;
  /** Upstream category code at that time (JMA: TD/TS/STS/TY …) — null when not published */
  category: string | null;
  /**
   * Radius (km) of JMA's **70 % probability circle** for this valid time — the
   * area JMA says the centre falls inside with 70 % probability. JMA's own
   * number, published by JMA; `null` for GDACS points (GDACS publishes a cone,
   * see `StormTrack.gdacsCone`) and for any JMA point that carries none.
   */
  circleRadiusKm: number | null;
}

/** GDACS uncertainty cone, as GDACS's `Poly_Cones` feature published it (GeoJSON, lon/lat). */
export type StormConeGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export interface StormTrack {
  /** Stable id: `jma:TC2632`, `gdacs:1001326` */
  id: string;
  source: StormSourceId;
  /** Storm name as the upstream spells it (`Surigae`, `ONE-26`) — null for an unnamed depression */
  name: string | null;
  basin: StormBasin;
  /** Upstream category code at the latest analysis (JMA `STS`, …) — null when not published */
  category: string | null;
  /**
   * When the upstream **issued** this advisory (ISO) — JMA's `issue` time.
   * `null` when the upstream publishes no issue time (GDACS: neither its event
   * list nor its geometry carries one). Never filled in from `fetchedAt`, and
   * never from GDACS `datemodified` (a GDACS processing time) or `polygondate`
   * (the synoptic time of the latest fix) — those are different instants.
   */
  advisoryIssuedAt: string | null;
  /**
   * Averaging period of `windKt`: JMA reports a 10-minute mean, JTWC a 1-minute
   * mean — a 1-min mean reads higher than a 10-min mean for the same storm, so
   * the two must never be compared as if they were one scale. `null` when no wind is published.
   */
  windAveraging: "10-min" | "1-min" | null;
  /** Oldest → newest; the last entry is the latest analysed position */
  past: StormPastPosition[];
  /** Nearest → furthest valid time */
  forecast: StormForecastPosition[];
  /** GDACS uncertainty cone — absent/null for JMA storms (JMA publishes circles instead) */
  gdacsCone?: StormConeGeometry | null;
  /** GDACS-only facts about the event (its own alert level is about humanitarian impact) */
  gdacs?: {
    eventId: number;
    episodeId: number;
    /** GDACS alert level ("Green" | "Orange" | "Red") — GDACS's impact estimate, not a wind scale */
    alertLevel: string | null;
    /** GDACS's own severity sentence, verbatim */
    severityText: string | null;
    reportUrl: string | null;
  };
  /**
   * Distance (km, rounded) from each of the 77 provinces' boundary to the
   * closest of: the latest analysed position, every forecast position, and —
   * where JMA publishes one — the edge of that position's 70 % circle
   * (`max(0, d − radius)`). 0 = inside the province or inside a circle over it.
   *
   * Geometry only, computed once per ingest round; **not a probability** and
   * not a claim that the storm will reach anywhere. GDACS cones are not
   * included (points only). Equirectangular approximation, fine at this scale.
   */
  nearestKmByProvince: Record<string, number>;
  /** When our backend last received this storm's data successfully (ISO) */
  fetchedAt: string;
}

/** Per-upstream ingest state, so one dead upstream never reads as "no storm" for the other. */
export interface StormSourceState {
  id: StormSourceId;
  /** Last round in which this upstream answered usably — null = never (not "now") */
  lastSuccessAt: string | null;
  /** Last round in which this upstream was asked at all */
  lastAttemptAt: string | null;
  /** Why the last round failed or was partial — null = it succeeded fully */
  lastError: string | null;
}

/**
 * `GET /api/v1/storms`.
 *
 * `storms: []` means different things depending on `sources`: with a
 * `lastSuccessAt` it is "no active storm reported by the sources we reached";
 * with `lastSuccessAt: null` it is "never fetched" — the UI must say which,
 * and never render either as an all-clear.
 */
export interface StormsResponse {
  storms: StormTrack[];
  layers: {
    /** Forecast track — `epistemicClass: "forecast"` (third-party deterministic advisory) */
    track: HazardLayerDescriptor;
    /** JMA 70 % probability circles — `epistemicClass: "probabilistic"` */
    circle: HazardLayerDescriptor;
    /** Analysed past track — `epistemicClass: "observed"` */
    past: HazardLayerDescriptor;
  };
  sources: StormSourceState[];
}
