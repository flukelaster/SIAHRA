import type { EarthquakeEvent } from "@siahra/shared-types";
import { readUpstreamJson } from "./errors.js";
import { assertUsgsFeed } from "./schemas/usgs.js";

const USGS_FEED_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson";
const USGS_FDSN_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";

interface UsgsFeatureProperties {
  mag: number | null;
  place: string | null;
  time: number;
  updated: number;
  status: string;
  tsunami: number;
  magType: string | null;
  type: string;
  url: string | null;
}

interface UsgsFeature {
  id: string;
  properties: UsgsFeatureProperties;
  geometry: { type: "Point"; coordinates: [number, number, number] } | null;
}

interface UsgsFeedResponse {
  features: UsgsFeature[];
}

export interface Bbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

function inBbox(lat: number, lon: number, bbox: Bbox): boolean {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lon >= bbox.minLon && lon <= bbox.maxLon;
}

function toEvents(data: UsgsFeedResponse, bbox: Bbox): EarthquakeEvent[] {
  const events: EarthquakeEvent[] = [];
  for (const f of data.features) {
    if (f.properties.type !== "earthquake" || !f.geometry) continue;
    const [lon, lat, depthKm] = f.geometry.coordinates;
    if (!inBbox(lat, lon, bbox)) continue;

    events.push({
      id: `usgs:${f.id}`,
      clusterId: `usgs:${f.id}`,
      sources: ["usgs"],
      mag: f.properties.mag,
      magType: f.properties.magType,
      place: f.properties.place,
      lat,
      lon,
      depthKm,
      time: new Date(f.properties.time).toISOString(),
      updated: new Date(f.properties.updated).toISOString(),
      status: f.properties.status === "reviewed" ? "reviewed" : "automatic",
      tsunami: f.properties.tsunami === 1,
      url: f.properties.url,
    });
  }
  return events;
}

/** Rolling 1-hour summary feed — the per-minute steady-state poll. */
export async function fetchUsgsEvents(bbox: Bbox): Promise<EarthquakeEvent[]> {
  const res = await fetch(USGS_FEED_URL, {
    headers: { "User-Agent": "siahra-api/0.0.0 (earthquake ingestion)" },
  });
  if (!res.ok) {
    throw new Error(`USGS feed request failed: ${res.status} ${res.statusText}`);
  }
  return toEvents(assertUsgsFeed((await readUpstreamJson("usgs", res)) as UsgsFeedResponse), bbox);
}

/**
 * Historical backfill via FDSN. The 1-hour summary feed is usually empty for
 * a single region, so without this the UI shows nothing most of the time.
 * Run once on cold start to establish a useful recent-events window.
 */
export async function backfillUsgsEvents(
  bbox: Bbox,
  days: number,
  minMagnitude: number,
): Promise<EarthquakeEvent[]> {
  const start = new Date(Date.now() - days * 86400_000).toISOString();
  const url = new URL(USGS_FDSN_URL);
  url.searchParams.set("format", "geojson");
  url.searchParams.set("starttime", start);
  url.searchParams.set("minlatitude", String(bbox.minLat));
  url.searchParams.set("maxlatitude", String(bbox.maxLat));
  url.searchParams.set("minlongitude", String(bbox.minLon));
  url.searchParams.set("maxlongitude", String(bbox.maxLon));
  url.searchParams.set("minmagnitude", String(minMagnitude));
  url.searchParams.set("orderby", "time");
  url.searchParams.set("limit", "200");

  const res = await fetch(url, {
    headers: { "User-Agent": "siahra-api/0.0.0 (earthquake backfill)" },
  });
  if (!res.ok) {
    throw new Error(`USGS FDSN backfill failed: ${res.status} ${res.statusText}`);
  }
  return toEvents(
    assertUsgsFeed((await readUpstreamJson("usgs backfill", res)) as UsgsFeedResponse, "usgs backfill"),
    bbox,
  );
}
