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
  | { type: "snapshot"; asOf: string; events: EarthquakeEvent[] }
  | { type: "event.created"; event: EarthquakeEvent }
  | { type: "event.updated"; event: EarthquakeEvent }
  | { type: "event.deleted"; id: string }
  | { type: "heartbeat"; ts: string };

/** Envelope of GET /api/v1/earthquakes/recent. */
export interface EarthquakeRecentResponse {
  asOf: string;
  events: EarthquakeEvent[];
}
