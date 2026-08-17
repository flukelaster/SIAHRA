import type { HazardLayerDescriptor } from "./hazard-layer.js";

/**
 * Observation types — direct sensor readings from Thai government networks.
 * Everything here is epistemicClass "observed": a station reported this value
 * at this time. No modelling, no forecasting, no interpolation.
 */

export interface StationRef {
  id: number;
  nameTh: string | null;
  nameEn: string | null;
  lat: number;
  lon: number;
  provinceCode: string | null;
  provinceNameTh: string | null;
  amphoeNameTh: string | null;
  basinNameTh: string | null;
  agencyShortTh: string | null;
}

export interface RainfallObservation {
  station: StationRef;
  /** Accumulated rainfall in the last 24 h, millimetres. */
  rain24h: number | null;
  rain1h: number | null;
  observedAt: string | null;
}

/**
 * ThaiWater's official situation level for a water-level station.
 * 1 = little water … 5 = overflowing bank. Published by the source; this
 * app does not compute or reinterpret it.
 */
export type SituationLevel = 1 | 2 | 3 | 4 | 5;

export interface WaterLevelObservation {
  station: StationRef;
  /** Water surface elevation above mean sea level, metres. */
  waterlevelMsl: number | null;
  /** Water level on the station's own gauge datum, metres (upstream `waterlevel_m`). */
  waterlevelLocalM: number | null;
  /** Lowest bank elevation, metres MSL — overflow reference. */
  minBankMsl: number | null;
  groundLevelMsl: number | null;
  /** Metres of freeboard remaining before the lowest bank overflows. */
  freeboardM: number | null;
  situationLevel: SituationLevel | null;
  storagePercent: number | null;
  observedAt: string | null;
}

export interface ObservationSummary {
  provinceCode: string | null;
  rainfallStationCount: number;
  waterlevelStationCount: number;
  /** Highest 24 h rainfall across reporting stations, millimetres. */
  maxRain24h: number | null;
  meanRain24h: number | null;
  /** Count of water stations at situation level 4 or 5. */
  stationsAboveWarning: number;
  /** Most recent observation timestamp across all included stations. */
  latestObservedAt: string | null;
  /**
   * When the backend last pulled successfully from ThaiWater. Null when it
   * has never succeeded — never substituted with "now", so an empty cache is
   * distinguishable from a fresh one that simply has nothing to report.
   */
  fetchedAt: string | null;
  sourceAttribution: string;
}

export interface ObservationsResponse {
  /** Epistemic declaration for everything in this payload. */
  layer: HazardLayerDescriptor;
  summary: ObservationSummary;
  rainfall: RainfallObservation[];
  waterlevel: WaterLevelObservation[];
}

/** One point of a station's water-level time series (10-minute cadence upstream). */
export interface WaterLevelHistoryPoint {
  /** ISO-8601 UTC. */
  t: string;
  /** Metres — see `datum` on the response for which reference it uses. */
  value: number | null;
  discharge: number | null;
}

export interface WaterLevelHistoryResponse {
  layer: HazardLayerDescriptor;
  stationId: number;
  /** Which reference the values match: MSL, the gauge's local datum, or unknown. */
  datum: "msl" | "local" | "unknown";
  hours: number;
  fetchedAt: string | null;
  /** True when part of the series came from the long-term R2 archive (>7 days). */
  fromArchive?: boolean;
  points: WaterLevelHistoryPoint[];
}

/** One archived Bangkok day (GET /api/v1/archive/days). */
export interface ArchiveDaySummary {
  day: string;
  waterlevelProvinces: string[];
  snapshotHours: string[];
  dams: boolean;
  generatedAt: string;
}

/** Reservoir storage as published by ThaiWater (RID/EGAT feeds). */
export interface DamObservation {
  id: number;
  nameTh: string | null;
  nameEn: string | null;
  lat: number;
  lon: number;
  provinceCode: string | null;
  provinceNameTh: string | null;
  basinNameTh: string | null;
  agencyShortTh: string | null;
  /** Large dams report hourly/daily; medium reservoirs daily. */
  kind: "large" | "medium";
  storageMcm: number | null;
  storagePercent: number | null;
  maxStorageMcm: number | null;
  normalStorageMcm: number | null;
  inflowMcm: number | null;
  releasedMcm: number | null;
  observedAt: string | null;
}

export interface DamsResponse {
  layer: HazardLayerDescriptor;
  fetchedAt: string | null;
  dams: DamObservation[];
}
