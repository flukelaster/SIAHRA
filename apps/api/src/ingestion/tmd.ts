import type { EarthquakeEvent } from "@siahra/shared-types";
import type { Bbox } from "./usgs.js";

const TMD_SEISMIC_BASE = "https://data.tmd.go.th/api/DailySeismicEvent/v1/";

/**
 * TMD's open-data API is keyed. The credentials come from the environment
 * (wrangler `vars` / `.dev.vars`) — the shipped defaults are TMD's own
 * published public-access pair, so replace them with a registered key for
 * anything beyond development.
 */
function tmdSeismicUrl(env: { TMD_UID?: string; TMD_UKEY?: string }): string {
  const uid = env.TMD_UID?.trim() || "api";
  const ukey = env.TMD_UKEY?.trim() || "api12345";
  return `${TMD_SEISMIC_BASE}?uid=${encodeURIComponent(uid)}&ukey=${encodeURIComponent(ukey)}`;
}

/**
 * TMD publishes ~7 months of history in one document, but the feed DO prunes
 * at 30 days, so anything older would be inserted then immediately deleted.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * TMD returns XML with Thai text encoded as numeric character references
 * (`&#xE1B;`). Workers has no XML/DOM parser, so decode the entities we can
 * actually receive from this feed rather than pulling in a full parser.
 */
function decodeXmlText(raw: string): string {
  return raw
    .replace(/&#x([0-9A-Fa-f]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Reads one element's text, tolerating attributes (e.g. `<Depth unit="km.">`). */
function tagText(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXmlText(match[1]) : null;
}

function toNumberOrNull(value: string | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * TMD's DateTimeUTC has no timezone marker ("2026-08-16 14:50:37.000") but is
 * documented as UTC, so pin it explicitly instead of letting the runtime guess.
 */
function parseTmdUtc(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(`${value.trim().replace(" ", "T").replace(/\.\d+$/, "")}Z`);
  return Number.isFinite(ms) ? ms : null;
}

function inBbox(lat: number, lon: number, bbox: Bbox): boolean {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lon >= bbox.minLon && lon <= bbox.maxLon;
}

/**
 * Thai Meteorological Department seismic network — the authoritative local
 * source for events inside Thailand (plan: "TMD should remain the primary
 * local context rather than allowing USGS or EMSC to become the sole
 * authoritative Thai display").
 */
export async function fetchTmdEvents(
  bbox: Bbox,
  env: { TMD_UID?: string; TMD_UKEY?: string },
  nowMs = Date.now(),
): Promise<EarthquakeEvent[]> {
  const res = await fetch(tmdSeismicUrl(env), {
    headers: { "User-Agent": "siahra-api/0.0.0 (earthquake ingestion)" },
  });
  if (!res.ok) {
    throw new Error(`TMD seismic request failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();

  const events: EarthquakeEvent[] = [];
  const blocks = xml.match(/<DailyEarthquakes>[\s\S]*?<\/DailyEarthquakes>/g) ?? [];

  for (const block of blocks) {
    const lat = toNumberOrNull(tagText(block, "Latitude"));
    const lon = toNumberOrNull(tagText(block, "Longitude"));
    const timeMs = parseTmdUtc(tagText(block, "DateTimeUTC"));
    if (lat === null || lon === null || timeMs === null) continue;
    if (!inBbox(lat, lon, bbox)) continue;
    if (nowMs - timeMs > MAX_AGE_MS) continue;

    const time = new Date(timeMs).toISOString();
    // TMD exposes no event identifier, so derive a stable one from the origin
    // solution; re-polling the same event must not create a duplicate row.
    const id = `tmd:${timeMs}_${lat.toFixed(3)}_${lon.toFixed(3)}`;

    events.push({
      id,
      clusterId: id,
      sources: ["tmd"],
      mag: toNumberOrNull(tagText(block, "Magnitude")),
      // TMD does not publish a magnitude scale on this feed; leaving it null
      // is honest, and the UI already renders "ไม่ระบุมาตรา" for that case.
      magType: null,
      place: tagText(block, "OriginThai"),
      lat,
      lon,
      depthKm: toNumberOrNull(tagText(block, "Depth")),
      time,
      // No revision timestamp in the feed — origin time is the only stamp,
      // so last-write-wins can never spuriously overwrite a newer solution.
      updated: time,
      // No review flag published; default conservatively rather than
      // implying a human-reviewed solution we cannot verify.
      status: "automatic",
      tsunami: false,
      url: null,
    });
  }

  return events;
}
