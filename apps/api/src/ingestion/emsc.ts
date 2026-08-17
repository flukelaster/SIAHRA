import type { EarthquakeEvent } from "@siahra/shared-types";
import type { Bbox } from "./usgs.js";

interface EmscFeatureProperties {
  time: string;
  lastupdate: string;
  flynn_region: string | null;
  lat: number;
  lon: number;
  depth: number;
  mag: number | null;
  magtype: string | null;
  unid: string;
}

interface EmscFeature {
  id: string;
  properties: EmscFeatureProperties;
}

interface EmscFeedResponse {
  features: EmscFeature[];
}

/**
 * Poll the trailing window rather than holding a WebSocket open — an
 * always-connected outbound socket would keep the calling Durable Object
 * from hibernating and bill duration continuously. See plan Workstream B §3.1.
 */
export async function fetchEmscEvents(bbox: Bbox, sinceMs: number): Promise<EarthquakeEvent[]> {
  const start = new Date(sinceMs).toISOString().replace(/\.\d+Z$/, "");
  const url = new URL("https://www.seismicportal.eu/fdsnws/event/1/query");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "200");
  url.searchParams.set("minlat", String(bbox.minLat));
  url.searchParams.set("maxlat", String(bbox.maxLat));
  url.searchParams.set("minlon", String(bbox.minLon));
  url.searchParams.set("maxlon", String(bbox.maxLon));
  url.searchParams.set("start", start);

  const res = await fetch(url, {
    headers: { "User-Agent": "siahra-api/0.0.0 (earthquake ingestion)" },
  });

  // EMSC returns 204 No Content (empty body) when the query matches zero events.
  if (res.status === 204) return [];
  if (!res.ok) {
    throw new Error(`EMSC feed request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as EmscFeedResponse;

  return data.features.map((f): EarthquakeEvent => ({
    id: `emsc:${f.properties.unid}`,
    clusterId: `emsc:${f.properties.unid}`,
    sources: ["emsc"],
    mag: f.properties.mag,
    magType: f.properties.magtype,
    place: f.properties.flynn_region,
    lat: f.properties.lat,
    lon: f.properties.lon,
    depthKm: f.properties.depth,
    time: new Date(f.properties.time).toISOString(),
    updated: new Date(f.properties.lastupdate).toISOString(),
    // EMSC's near-real-time feed does not expose a reviewed/automatic flag —
    // default conservatively rather than fabricating a review status.
    status: "automatic",
    tsunami: false,
    url: `https://www.seismicportal.eu/eventdetails.html?unid=${f.properties.unid}`,
  }));
}
