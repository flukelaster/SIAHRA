import type { HazardLayerDescriptor } from "./hazard-layer.js";

export interface EarthquakeEvent {
  id: string;
  clusterId: string;
  sources: Array<"usgs" | "emsc" | "tmd">;
  mag: number | null;
  magType: string | null;
  place: string | null;
  lat: number;
  lon: number;
  depthKm: number | null;
  time: string;
  updated: string;
  status: "automatic" | "reviewed" | "deleted";
  tsunami: boolean;
  url: string | null;
}

export type EqWsMessage =
  // `layer` is emitted by the server today but stays OPTIONAL for one release
  // so a client shipped before E3.1 keeps parsing snapshots.
  | { type: "snapshot"; asOf: string; events: EarthquakeEvent[]; layer?: HazardLayerDescriptor }
  | { type: "event.created"; event: EarthquakeEvent }
  | { type: "event.updated"; event: EarthquakeEvent }
  | { type: "event.deleted"; id: string }
  | { type: "heartbeat"; ts: string };

/** Envelope of GET /api/v1/earthquakes/recent. */
export interface EarthquakeRecentResponse {
  asOf: string;
  layer: HazardLayerDescriptor;
  events: EarthquakeEvent[];
}
