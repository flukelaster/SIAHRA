import type { HazardLayerDescriptor } from "./hazard-layer.js";
import type { SituationLevel } from "./observations.js";

/**
 * Illustrative flood exposure (E10) — the contract for one computed run.
 *
 * WHAT THIS IS: a ranking of what stations are *reporting right now*. Every
 * number in a run is either an observation copied verbatim from ThaiWater or a
 * band that observation falls into, using the published threshold table in
 * `docs/methodology/flood-exposure.md`.
 *
 * WHAT THIS IS NOT — and what must never be added to these types:
 * - **No probability field.** No `probability`, `chance`, `likelihood`,
 *   `returnPeriod`, `confidence` or `riskScore`, in any spelling, on any type
 *   in this file. No model produces such a number here, so there is nothing
 *   honest to put in the field, and an empty-but-present field invites a
 *   consumer to fill it. `epistemicClass` cannot be `"probabilistic"` for this
 *   layer: that class is reserved for a named, citable third-party model.
 * - **No forecast.** Nothing here says what will happen, or when. A run
 *   describes measurements already taken, with the instant they were taken.
 * - **No depth, no hydraulics.** `ExposureLevel` is an ordering, not a water
 *   depth, not a flooded area, not a warning issued by any authority.
 *
 * These types are deliberately closed: no index signature, no `extra`/`meta`
 * bag. A field that could carry a self-invented number is a field somebody will
 * eventually fill with one.
 */

/**
 * How far the observed inputs at one station have moved, ordered
 * `low < elevated < high < severe`.
 *
 * It is an ORDERING OF MEASUREMENTS, not a probability and not a severity
 * forecast: `severe` means "the readings this station is sending are in the
 * top band of the published threshold table", never "this place will flood".
 * Bands are comparable between stations only in the sense that the same table
 * was applied to both.
 */
export type ExposureLevel = "low" | "elevated" | "high" | "severe";

/**
 * The observed inputs a station's level was derived from, so a reader can
 * always check the band against the measurement that produced it.
 *
 * Every field is nullable and `null` means EXACTLY ONE THING: that input was
 * not available for this station in this run (the station does not measure it,
 * or the upstream record carried no value). It is never a zero, never an
 * imputed value, never interpolated from a neighbouring station.
 */
export interface ExposureFactors {
  /** Rainfall in the last hour, millimetres, as reported. */
  rain1hMm: number | null;
  /** Accumulated rainfall in the last 24 h, millimetres, as reported. */
  rain24hMm: number | null;
  /** Metres of freeboard left below the lowest bank, as reported. */
  freeboardM: number | null;
  /**
   * Change in freeboard per hour over the run's history window, metres/hour.
   * NEGATIVE = the water is rising towards the bank; positive = falling.
   * Measured between the first and last point in the window — it is a past
   * rate, not an extrapolation, and nothing here projects it forward.
   */
  freeboardTrendMPerH: number | null;
  /** ThaiWater's own published situation level, passed through unchanged. */
  situationLevel: SituationLevel | null;
}

/** One station's contribution to a run. */
export interface StationExposure {
  /** ThaiWater telemetering station id within the declared measurement namespace. */
  stationId: number;
  /**
   * ThaiWater assigns rainfall and water-level identifiers independently. A
   * matching number is not evidence that two records describe one instrument,
   * so exposure runs keep their namespaces separate unless a citable mapping
   * is introduced in a future contract revision.
   */
  stationKind: "rainfall" | "waterlevel";
  /**
   * The station's province, **copied verbatim from `StationRef.provinceCode`
   * at compute time**, and `null`-preserving.
   *
   * `null` means the upstream station record carried no province code — a real
   * state, not a gap to be filled. Such a station belongs to no province
   * endpoint and appears only in the nationwide run.
   *
   * Three things this field must never become:
   * - **Never guessed from geometry.** Boundary rings are not the source of
   *   truth for administrative membership, and they do not exist here anyway.
   * - **Never resolved at request time** against the live station table. That
   *   would scope a historical run by today's stations: a retired station would
   *   silently drop out of a run it was part of, and the same run id would
   *   answer differently on different days.
   * - **Never back-filled into an already-published run.** A published run is
   *   immutable; a station that gains a province code upstream gains it in the
   *   next run, and older runs keep the attribution they were computed with.
   */
  provinceCode: string | null;
  lat: number;
  lon: number;
  level: ExposureLevel;
  factors: ExposureFactors;
  /**
   * The OLDEST observation instant among the factors present, so the record is
   * guaranteed to be no fresher than this. `null` when no contributing
   * observation carried a timestamp — never substituted with the compute time.
   */
  observedAt: string | null;
}

/** What a run was computed from — enough to reproduce it. */
export interface FloodExposureRunInputs {
  /**
   * When the backend last pulled ThaiWater successfully. `null` = never
   * succeeded, and it stays `null` here and on `layer.fetchedAt`; it is never
   * replaced by the compute time.
   */
  thaiwaterFetchedAt: string | null;
  /** Hours of water-level history the freeboard trend was measured over. */
  historyWindowH: number;
}

/**
 * One immutable, citable exposure run. Published under its own `runId` and
 * never rewritten — that is what makes a run quotable after the fact.
 */
export interface FloodExposureRun {
  /**
   * `YYYYMMDDTHHMMSSZ-<16 hex>` — the compute instant in compact UTC, then a
   * 64-bit FNV-1a hash of the run's content (inputs, layer and the sorted
   * stations, excluding the id itself). Same content at the same instant → same
   * id, so a caller can tell "nothing changed" from "not published yet".
   */
  runId: string;
  /** When this run was computed. Distinct from `inputs.thaiwaterFetchedAt`. */
  computedAt: string;
  inputs: FloodExposureRunInputs;
  /** Always `epistemicClass: "illustrative"` with a non-empty `methodologyUrl`. */
  layer: HazardLayerDescriptor;
  /** Sorted by `stationKind`, then `stationId`. Empty is a valid run, not an error. */
  stations: StationExposure[];
}

/**
 * One published run, scoped to a single province for
 * `GET /api/v1/provinces/{NN}/exposure/latest` (E10.3).
 *
 * Everything except `stations` and `layer.observedAt` is copied verbatim from
 * the nationwide run the province view was cut out of — `runId` above all, so
 * the same artefact can be re-read whole through `/api/v1/exposure/runs/{runId}`
 * and the scoping checked by anyone.
 *
 * The membership test is `StationExposure.provinceCode === scopedToProvinceCode`
 * AND NOTHING ELSE: not the live station table (that would scope a historical
 * run by today's stations) and not geometry. Stations whose `provinceCode` is
 * `null` are in no province view at all; they are only in the nationwide run.
 */
export interface ProvinceExposureResponse extends FloodExposureRun {
  /** The province code the stations were filtered on. */
  scopedToProvinceCode: string;
  /**
   * How many stations the nationwide run held, so a reader can see that this
   * view is a subset and how large a subset — never a hidden filter.
   */
  nationwideStationCount: number;
}
