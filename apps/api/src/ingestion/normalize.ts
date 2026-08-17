import type { EarthquakeEvent } from "@siahra/shared-types";

const TIME_WINDOW_MS = 120_000; // ±120s
const DISTANCE_KM = 100; // <100km
const MAG_TOLERANCE = 0.5; // ±0.5

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface StoredEventRow {
  id: string;
  clusterId: string;
  source: string;
  lat: number;
  lon: number;
  mag: number | null;
  timeMs: number;
}

/**
 * Find an existing cluster this candidate corroborates: within ±120s,
 * <100km haversine distance, ±0.5 magnitude, reported by a different source
 * than the candidate. See plan Workstream B §3.4 — thresholds must stay in
 * sync with docs/roadmap.md if changed.
 */
export function findCorroboratingCluster(
  candidate: EarthquakeEvent,
  existingRows: StoredEventRow[],
): string | null {
  const candidateTimeMs = Date.parse(candidate.time);
  const candidateSource = candidate.sources[0];

  for (const row of existingRows) {
    if (row.source === candidateSource) continue;
    if (Math.abs(row.timeMs - candidateTimeMs) > TIME_WINDOW_MS) continue;
    if (candidate.mag != null && row.mag != null) {
      if (Math.abs(row.mag - candidate.mag) > MAG_TOLERANCE) continue;
    }
    const distanceKm = haversineKm(row.lat, row.lon, candidate.lat, candidate.lon);
    if (distanceKm >= DISTANCE_KM) continue;
    return row.clusterId;
  }
  return null;
}
