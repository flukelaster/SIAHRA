import type {
  DamObservation,
  RainfallObservation,
  SituationLevel,
  StationRef,
  WaterLevelHistoryPoint,
  WaterLevelObservation,
} from "@siahra/shared-types";

const BASE = "https://api-v3.thaiwater.net/api/v1/thaiwater30";
const RAIN_24H_URL = `${BASE}/public/rain_24h`;
const WATERLEVEL_URL = `${BASE}/public/waterlevel_load`;
const WATERLEVEL_GRAPH_URL = `${BASE}/public/waterlevel_graph`;
const DAM_URL = `${BASE}/analyst/dam`;
const UA = "siahra-api/0.0.0 (observation ingestion)";
/** ThaiWater's dam arrays mix live rows with years-old ones; only these count. */
const DAM_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/** Upstream shapes are loosely typed — every field is treated as possibly absent. */
interface LocalizedName {
  th?: string | null;
  en?: string | null;
}

interface UpstreamGeocode {
  province_code?: string | number | null;
  province_name?: LocalizedName | null;
  amphoe_name?: LocalizedName | null;
}

interface UpstreamStation {
  id?: number | null;
  tele_station_name?: LocalizedName | null;
  tele_station_lat?: number | string | null;
  tele_station_long?: number | string | null;
  min_bank?: number | string | null;
  ground_level?: number | string | null;
}

interface UpstreamRecord {
  id?: number | null;
  station?: UpstreamStation | null;
  geocode?: UpstreamGeocode | null;
  basin?: { basin_name?: LocalizedName | null } | null;
  agency?: { agency_shortname?: LocalizedName | null } | null;
}

interface UpstreamRainRecord extends UpstreamRecord {
  rain_24h?: number | string | null;
  rain_1h?: number | string | null;
  rainfall_datetime?: string | null;
}

interface UpstreamWaterRecord extends UpstreamRecord {
  waterlevel_datetime?: string | null;
  waterlevel_msl?: number | string | null;
  waterlevel_m?: number | string | null;
  storage_percent?: number | string | null;
  situation_level?: number | string | null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * ThaiWater timestamps are Bangkok local time ("2026-08-16 21:00") with no
 * offset. Pin +07:00 explicitly so the client isn't left guessing.
 */
function toIso(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const ms = Date.parse(`${raw.replace(" ", "T")}+07:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function provinceCodeOf(record: UpstreamRecord): string | null {
  const raw = record.geocode?.province_code;
  if (raw === null || raw === undefined || raw === "") return null;
  // Codes arrive as either "50" or 50; normalise to the 2-digit string form
  // the province selector and API query parameter both use.
  return String(raw).padStart(2, "0");
}

function toStationRef(record: UpstreamRecord): StationRef | null {
  const station = record.station;
  const lat = num(station?.tele_station_lat);
  const lon = num(station?.tele_station_long);
  // A station without coordinates cannot be mapped or trusted — drop it
  // rather than emitting a marker at (0,0).
  if (lat === null || lon === null) return null;

  return {
    id: num(station?.id) ?? num(record.id) ?? 0,
    nameTh: str(station?.tele_station_name?.th),
    nameEn: str(station?.tele_station_name?.en),
    lat,
    lon,
    provinceCode: provinceCodeOf(record),
    provinceNameTh: str(record.geocode?.province_name?.th),
    amphoeNameTh: str(record.geocode?.amphoe_name?.th),
    basinNameTh: str(record.basin?.basin_name?.th),
    agencyShortTh: str(record.agency?.agency_shortname?.th),
  };
}

function toSituationLevel(value: unknown): SituationLevel | null {
  const n = num(value);
  if (n === null) return null;
  const rounded = Math.round(n);
  return rounded >= 1 && rounded <= 5 ? (rounded as SituationLevel) : null;
}

export async function fetchRainfall(): Promise<RainfallObservation[]> {
  const res = await fetch(RAIN_24H_URL, {
    headers: { "User-Agent": "siahra-api/0.0.0 (observation ingestion)" },
  });
  if (!res.ok) throw new Error(`ThaiWater rain_24h failed: ${res.status} ${res.statusText}`);

  const body = (await res.json()) as { data?: UpstreamRainRecord[] | null };
  const records = Array.isArray(body.data) ? body.data : [];

  const observations: RainfallObservation[] = [];
  for (const record of records) {
    const station = toStationRef(record);
    if (!station) continue;
    observations.push({
      station,
      rain24h: num(record.rain_24h),
      rain1h: num(record.rain_1h),
      observedAt: toIso(record.rainfall_datetime),
    });
  }
  return observations;
}

export async function fetchWaterLevel(): Promise<WaterLevelObservation[]> {
  const res = await fetch(WATERLEVEL_URL, {
    headers: { "User-Agent": "siahra-api/0.0.0 (observation ingestion)" },
  });
  if (!res.ok) throw new Error(`ThaiWater waterlevel_load failed: ${res.status} ${res.statusText}`);

  const body = (await res.json()) as {
    waterlevel_data?: { data?: UpstreamWaterRecord[] | null } | null;
  };
  const records = Array.isArray(body.waterlevel_data?.data) ? body.waterlevel_data.data : [];

  const observations: WaterLevelObservation[] = [];
  for (const record of records) {
    const station = toStationRef(record);
    if (!station) continue;

    const waterlevelMsl = num(record.waterlevel_msl);
    const rawMinBank = num(record.station?.min_bank);
    // A bank elevation of exactly 0 (or below) is a missing-data placeholder
    // in this feed, not a real survey value. Treating it as real produced
    // false "above bank" readings — e.g. a station at 14.44 m MSL reported as
    // 14.44 m over its bank. Without a bank reference, publish no freeboard.
    const minBankMsl = rawMinBank !== null && rawMinBank > 0 ? rawMinBank : null;

    observations.push({
      station,
      waterlevelMsl,
      waterlevelLocalM: num(record.waterlevel_m),
      minBankMsl,
      groundLevelMsl: num(record.station?.ground_level),
      // Positive = metres of headroom left before the lowest bank overflows.
      freeboardM:
        waterlevelMsl !== null && minBankMsl !== null
          ? Math.round((minBankMsl - waterlevelMsl) * 1000) / 1000
          : null,
      situationLevel: toSituationLevel(record.situation_level),
      storagePercent: num(record.storage_percent),
      observedAt: toIso(record.waterlevel_datetime),
    });
  }
  return observations;
}

/** Bangkok-local "YYYY-MM-DD HH:MM" for ThaiWater query parameters. */
function bangkokStamp(ms: number, withTime: boolean): string {
  const d = new Date(ms + 7 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  return withTime ? `${date} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : date;
}

/**
 * Station water-level time series (public/waterlevel_graph, 10-minute cadence).
 * Guarded because the upstream returns 422 for a missing station_type and a
 * non-JSON Go panic when a canal station id is queried as tele_waterlevel.
 */
export async function fetchWaterLevelHistory(
  stationId: number,
  hours: number,
  nowMs = Date.now(),
): Promise<WaterLevelHistoryPoint[]> {
  const startMs = nowMs - hours * 60 * 60 * 1000;
  // Built by hand: URLSearchParams would encode the space in end_date as "+",
  // which the upstream does not decode (it silently returns an empty series).
  const url =
    `${WATERLEVEL_GRAPH_URL}?station_type=tele_waterlevel&station_id=${stationId}` +
    `&start_date=${encodeURIComponent(bangkokStamp(startMs, false))}` +
    `&end_date=${encodeURIComponent(bangkokStamp(nowMs, true))}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`ThaiWater waterlevel_graph ${stationId} failed: ${res.status}`);
  const text = await res.text();
  let body: { data?: { graph_data?: { datetime?: string; value?: unknown; discharge?: unknown }[] } };
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`ThaiWater waterlevel_graph ${stationId}: non-JSON response`);
  }
  const rows = Array.isArray(body.data?.graph_data) ? body.data.graph_data : [];
  const points: WaterLevelHistoryPoint[] = [];
  for (const r of rows) {
    const t = toIso(r.datetime);
    if (!t) continue;
    points.push({ t, value: num(r.value), discharge: num(r.discharge) });
  }
  points.sort((a, b) => (a.t < b.t ? -1 : 1));
  return points;
}

interface UpstreamDamRecord {
  dam_date?: string | null;
  dam_storage?: unknown;
  dam_storage_percent?: unknown;
  dam_inflow?: unknown;
  dam_released?: unknown;
  station_type?: string | null;
  dam?: {
    id?: number | null;
    dam_name?: LocalizedName | null;
    dam_lat?: unknown;
    dam_long?: unknown;
    max_storage?: unknown;
    normal_storage?: unknown;
  } | null;
  agency?: { agency_shortname?: LocalizedName | null } | null;
  basin?: { basin_name?: LocalizedName | null } | null;
  geocode?: UpstreamGeocode | null;
}

/**
 * Reservoir storage from ThaiWater's analyst/dam (covers RID and EGAT dams).
 * The arrays are not pruned upstream — dam_medium reaches back to 1970 — so
 * only rows within DAM_MAX_AGE_MS are kept, and one row per dam wins
 * (hourly over daily when both are current).
 */
export async function fetchDams(nowMs = Date.now()): Promise<DamObservation[]> {
  const res = await fetch(DAM_URL, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`ThaiWater analyst/dam failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as {
    data?: {
      dam_hourly?: UpstreamDamRecord[];
      dam_daily?: UpstreamDamRecord[];
      dam_medium?: UpstreamDamRecord[];
    };
  };
  const byId = new Map<number, DamObservation>();
  const ingest = (rows: UpstreamDamRecord[] | undefined, kind: "large" | "medium", priority: number) => {
    for (const r of rows ?? []) {
      const observedAt = toIso(r.dam_date);
      if (!observedAt || nowMs - Date.parse(observedAt) > DAM_MAX_AGE_MS) continue;
      const id = num(r.dam?.id);
      const lat = num(r.dam?.dam_lat);
      const lon = num(r.dam?.dam_long);
      if (id === null || lat === null || lon === null) continue;
      const existing = byId.get(id);
      const existingPriority = (existing as (DamObservation & { _p?: number }) | undefined)?._p ?? -1;
      if (existing && existingPriority > priority) continue;
      if (existing && existingPriority === priority && existing.observedAt && existing.observedAt > observedAt) continue;
      const geo = r.geocode;
      const rawPv = geo?.province_code;
      const provinceCode =
        rawPv === null || rawPv === undefined || rawPv === "" ? null : String(rawPv).padStart(2, "0");
      const dam: DamObservation & { _p?: number } = {
        id,
        nameTh: str(r.dam?.dam_name?.th),
        nameEn: str(r.dam?.dam_name?.en),
        lat,
        lon,
        provinceCode,
        provinceNameTh: str(geo?.province_name?.th),
        basinNameTh: str(r.basin?.basin_name?.th),
        agencyShortTh: str(r.agency?.agency_shortname?.th),
        kind,
        storageMcm: num(r.dam_storage),
        storagePercent: num(r.dam_storage_percent),
        maxStorageMcm: num(r.dam?.max_storage),
        normalStorageMcm: num(r.dam?.normal_storage),
        inflowMcm: num(r.dam_inflow),
        releasedMcm: num(r.dam_released),
        observedAt,
        _p: priority,
      };
      byId.set(id, dam);
    }
  };
  ingest(body.data?.dam_daily, "large", 1);
  ingest(body.data?.dam_hourly, "large", 2);
  ingest(body.data?.dam_medium, "medium", 0);
  return [...byId.values()].map((d) => {
    const { _p, ...rest } = d as DamObservation & { _p?: number };
    void _p;
    return rest;
  });
}
