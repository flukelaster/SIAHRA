import { DurableObject } from "cloudflare:workers";
import type {
  DamObservation,
  DamsResponse,
  HazardLayerDescriptor,
  ObservationsResponse,
  RainfallObservation,
  SourceStatus,
  WaterLevelHistoryPoint,
  WaterLevelHistoryResponse,
  WaterLevelObservation,
} from "@siahra/shared-types";
import {
  THAIWATER_ATTRIBUTION,
  fetchDams,
  fetchRainfall,
  fetchWaterLevel,
  fetchWaterLevelHistory,
} from "../ingestion/thaiwater.js";

/**
 * Upstream responses are 2-4 MB covering ~5,500 stations nationwide, so they
 * must never be fetched per browser request. One cached nationwide copy backs
 * every province query.
 */
const TTL_MS = 5 * 60 * 1000;
/** After this long without a successful pull the data is flagged stale. */
const STALE_AFTER_MS = 15 * 60 * 1000;
/** Failed refreshes back off: 1 min, 2, 4 … capped at 10 min. */
const RETRY_MIN_MS = 60 * 1000;
const RETRY_MAX_MS = 10 * 60 * 1000;
/** Station history is re-pulled at most this often, kept this long. */
const HISTORY_TTL_MS = 10 * 60 * 1000;
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_HOURS = 72;
const HISTORY_CONCURRENCY = 4;
/** Snapshot lookups accept a reading this far before the requested time. */
const SNAPSHOT_TOLERANCE_MS = 3 * 60 * 60 * 1000;
const DAMS_TTL_MS = 30 * 60 * 1000;

/**
 * Durable Object SQLite caps bound parameters per statement (100), and each
 * row here binds 5 columns — so keep chunks at 16 rows (80 params) to stay
 * comfortably under it.
 */
const INSERT_CHUNK = 16;

interface StationRow extends Record<string, SqlStorageValue> {
  payload: string;
}

interface MetaRow extends Record<string, SqlStorageValue> {
  value: string;
}

export class ObservationCacheDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS rainfall (
          station_id INTEGER PRIMARY KEY,
          province_code TEXT,
          rain_24h REAL,
          observed_at TEXT,
          payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rainfall_province ON rainfall(province_code);
        CREATE TABLE IF NOT EXISTS waterlevel (
          station_id INTEGER PRIMARY KEY,
          province_code TEXT,
          situation_level INTEGER,
          observed_at TEXT,
          payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_waterlevel_province ON waterlevel(province_code);
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS waterlevel_history (
          station_id INTEGER NOT NULL,
          ts_ms INTEGER NOT NULL,
          value REAL,
          discharge REAL,
          PRIMARY KEY (station_id, ts_ms)
        );
        CREATE TABLE IF NOT EXISTS history_meta (
          station_id INTEGER PRIMARY KEY,
          fetched_ms INTEGER NOT NULL,
          datum TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS dams (
          dam_id INTEGER PRIMARY KEY,
          province_code TEXT,
          observed_at TEXT,
          payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dams_province ON dams(province_code);
      `);
    });
  }

  private readMeta(key: string): string | null {
    return (
      this.ctx.storage.sql.exec<MetaRow>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]
        ?.value ?? null
    );
  }

  private writeMeta(key: string, value: string | null): void {
    if (value === null) {
      this.ctx.storage.sql.exec("DELETE FROM meta WHERE key = ?", key);
      return;
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  private isFresh(nowMs: number): boolean {
    const fetchedAt = this.readMeta("fetchedAt");
    if (!fetchedAt) return false;
    const fetchedMs = Date.parse(fetchedAt);
    return Number.isFinite(fetchedMs) && nowMs - fetchedMs < TTL_MS;
  }

  /**
   * Refresh runs on an alarm so the cache is warm before anyone asks; the
   * lazy path in getObservations() only fires on a cold start (or after a
   * dev restart) and, while a refresh is already in flight, callers share it
   * instead of stampeding the upstream.
   */
  private inflight: Promise<void> | null = null;

  private refreshOnce(nowMs: number): Promise<void> {
    if (!this.inflight) {
      this.inflight = this.refresh(nowMs).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** Cron/alarm entry point: refresh if due, and (re)arm the alarm. */
  async ensureFresh(): Promise<void> {
    const nowMs = Date.now();
    if (!this.isFresh(nowMs)) await this.refreshOnce(nowMs);
    await this.armAlarm();
  }

  private async armAlarm(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== null && existing > Date.now()) return;
    const failures = Number(this.readMeta("consecutiveFailures") ?? "0");
    const delay =
      failures > 0
        ? Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.min(6, failures - 1))
        : TTL_MS;
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }

  async alarm(): Promise<void> {
    await this.refreshOnce(Date.now());
    // The alarm just fired, so getAlarm() is null and armAlarm() sets the next one.
    await this.armAlarm();
  }

  private async refresh(nowMs: number): Promise<void> {
    this.writeMeta("lastAttemptAt", new Date(nowMs).toISOString());
    // Partial failure must not wipe the good half of the cache, so each feed
    // is only rewritten when its own fetch succeeded.
    const [rainfall, waterlevel] = await Promise.all([
      fetchRainfall().catch((err: unknown) => {
        console.error(
          JSON.stringify({ level: "error", message: "thaiwater rain fetch failed", error: String(err) }),
        );
        return null;
      }),
      fetchWaterLevel().catch((err: unknown) => {
        console.error(
          JSON.stringify({ level: "error", message: "thaiwater waterlevel fetch failed", error: String(err) }),
        );
        return null;
      }),
    ]);

    if (rainfall) this.replaceRainfall(rainfall);
    if (waterlevel) this.replaceWaterLevel(waterlevel);

    if (rainfall && waterlevel) {
      this.writeMeta("fetchedAt", new Date(nowMs).toISOString());
      this.writeMeta("lastError", null);
      this.writeMeta("consecutiveFailures", "0");
    } else {
      // Partial success still refreshes fetchedAt (the good half is new), but
      // the failure is recorded so /health can say "degraded".
      if (rainfall || waterlevel) this.writeMeta("fetchedAt", new Date(nowMs).toISOString());
      const which = [!rainfall && "rain_24h", !waterlevel && "waterlevel_load"].filter(Boolean).join(", ");
      this.writeMeta("lastError", `ThaiWater ${which} fetch failed`);
      const failures = Number(this.readMeta("consecutiveFailures") ?? "0") + 1;
      this.writeMeta("consecutiveFailures", String(failures));
    }
    console.log(
      JSON.stringify({
        level: "info",
        message: "observation cache refreshed",
        rainfall: rainfall?.length ?? "failed",
        waterlevel: waterlevel?.length ?? "failed",
      }),
    );
  }

  private replaceRainfall(rows: RainfallObservation[]): void {
    this.ctx.storage.sql.exec("DELETE FROM rainfall");
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?)").join(",");
      const binds: SqlStorageValue[] = [];
      for (const row of chunk) {
        binds.push(
          row.station.id,
          row.station.provinceCode,
          row.rain24h,
          row.observedAt,
          JSON.stringify(row),
        );
      }
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO rainfall (station_id, province_code, rain_24h, observed_at, payload) VALUES ${placeholders}`,
        ...binds,
      );
    }
  }

  private replaceWaterLevel(rows: WaterLevelObservation[]): void {
    this.ctx.storage.sql.exec("DELETE FROM waterlevel");
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?)").join(",");
      const binds: SqlStorageValue[] = [];
      for (const row of chunk) {
        binds.push(
          row.station.id,
          row.station.provinceCode,
          row.situationLevel,
          row.observedAt,
          JSON.stringify(row),
        );
      }
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO waterlevel (station_id, province_code, situation_level, observed_at, payload) VALUES ${placeholders}`,
        ...binds,
      );
    }
  }

  /**
   * Which reference the graph values are on: compare the newest history point
   * with the station's live MSL / local readings and pick the closer one.
   */
  private detectDatum(stationId: number, points: WaterLevelHistoryPoint[]): "msl" | "local" | "unknown" {
    const latest = [...points].reverse().find((p) => p.value !== null);
    const row = this.ctx.storage.sql
      .exec<StationRow>("SELECT payload FROM waterlevel WHERE station_id = ?", stationId)
      .toArray()[0];
    if (!latest || !row) return "unknown";
    const live = JSON.parse(row.payload) as WaterLevelObservation;
    const dMsl = live.waterlevelMsl === null ? Infinity : Math.abs(live.waterlevelMsl - (latest.value as number));
    const dLocal =
      live.waterlevelLocalM === null ? Infinity : Math.abs(live.waterlevelLocalM - (latest.value as number));
    if (!Number.isFinite(Math.min(dMsl, dLocal))) return "unknown";
    return dMsl <= dLocal ? "msl" : "local";
  }

  private async pullHistory(stationId: number, nowMs: number): Promise<void> {
    const points = await fetchWaterLevelHistory(stationId, HISTORY_HOURS, nowMs);
    // 4 bound params per row; 24 rows = 96, under SQLite's 100-parameter cap.
    const HISTORY_CHUNK = 24;
    for (let i = 0; i < points.length; i += HISTORY_CHUNK) {
      const chunk = points.slice(i, i + HISTORY_CHUNK);
      const placeholders = chunk.map(() => "(?, ?, ?, ?)").join(",");
      const binds: SqlStorageValue[] = [];
      for (const p of chunk) binds.push(stationId, Date.parse(p.t), p.value, p.discharge);
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO waterlevel_history (station_id, ts_ms, value, discharge) VALUES ${placeholders}`,
        ...binds,
      );
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO history_meta (station_id, fetched_ms, datum) VALUES (?, ?, ?) ON CONFLICT(station_id) DO UPDATE SET fetched_ms = excluded.fetched_ms, datum = excluded.datum",
      stationId,
      nowMs,
      this.detectDatum(stationId, points),
    );
    this.ctx.storage.sql.exec("DELETE FROM waterlevel_history WHERE ts_ms < ?", nowMs - HISTORY_RETENTION_MS);
  }

  private historyFresh(stationId: number, nowMs: number): boolean {
    const row = this.ctx.storage.sql
      .exec<{ fetched_ms: number }>("SELECT fetched_ms FROM history_meta WHERE station_id = ?", stationId)
      .toArray()[0];
    return !!row && nowMs - row.fetched_ms < HISTORY_TTL_MS;
  }

  private warming = new Set<string>();

  /** Pull 72 h history for every water-level station of a province (throttled). */
  async warmProvinceHistory(province: string): Promise<void> {
    if (this.warming.has(province)) return;
    this.warming.add(province);
    try {
      const nowMs = Date.now();
      const ids = this.ctx.storage.sql
        .exec<{ station_id: number }>("SELECT station_id FROM waterlevel WHERE province_code = ?", province)
        .toArray()
        .map((r) => r.station_id)
        .filter((id) => !this.historyFresh(id, nowMs));
      let next = 0;
      const worker = async () => {
        while (next < ids.length) {
          const id = ids[next++];
          try {
            await this.pullHistory(id, nowMs);
          } catch (err) {
            console.error(JSON.stringify({ level: "warn", message: "history pull failed", stationId: id, error: String(err) }));
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(HISTORY_CONCURRENCY, ids.length) }, worker));
    } finally {
      this.warming.delete(province);
    }
  }

  /** Backs GET /api/v1/stations/{id}/history. */
  async getHistory(stationId: number, hours: number): Promise<WaterLevelHistoryResponse> {
    const nowMs = Date.now();
    if (!this.historyFresh(stationId, nowMs)) {
      await this.pullHistory(stationId, nowMs);
    }
    const meta = this.ctx.storage.sql
      .exec<{ fetched_ms: number; datum: string }>("SELECT fetched_ms, datum FROM history_meta WHERE station_id = ?", stationId)
      .toArray()[0];
    const points = this.ctx.storage.sql
      .exec<{ ts_ms: number; value: number | null; discharge: number | null }>(
        "SELECT ts_ms, value, discharge FROM waterlevel_history WHERE station_id = ? AND ts_ms >= ? ORDER BY ts_ms ASC",
        stationId,
        nowMs - hours * 60 * 60 * 1000,
      )
      .toArray()
      .map((r) => ({ t: new Date(r.ts_ms).toISOString(), value: r.value, discharge: r.discharge }));
    return {
      layer: {
        id: "thaiwater-waterlevel-history",
        epistemicClass: "observed",
        liveOrStatic: "live",
        observedAt: points.length ? points[points.length - 1].t : undefined,
        fetchedAt: meta ? new Date(meta.fetched_ms).toISOString() : new Date(nowMs).toISOString(),
        staleAfterSeconds: STALE_AFTER_MS / 1000,
        sourceIds: ["thaiwater"],
      },
      stationId,
      datum: (meta?.datum as "msl" | "local" | "unknown") ?? "unknown",
      hours,
      fetchedAt: meta ? new Date(meta.fetched_ms).toISOString() : null,
      points,
    };
  }

  private damsInflight: Promise<void> | null = null;

  private async refreshDams(nowMs: number): Promise<void> {
    if (!this.damsInflight) {
      this.damsInflight = (async () => {
        try {
          const dams = await fetchDams(nowMs);
          this.ctx.storage.sql.exec("DELETE FROM dams");
          for (const d of dams) {
            this.ctx.storage.sql.exec(
              "INSERT OR REPLACE INTO dams (dam_id, province_code, observed_at, payload) VALUES (?, ?, ?, ?)",
              d.id,
              d.provinceCode,
              d.observedAt,
              JSON.stringify(d),
            );
          }
          this.writeMeta("damsFetchedAt", new Date(nowMs).toISOString());
          this.writeMeta("damsError", null);
        } catch (err) {
          this.writeMeta("damsError", String(err).slice(0, 200));
          console.error(JSON.stringify({ level: "error", message: "thaiwater dams fetch failed", error: String(err) }));
        }
      })().finally(() => {
        this.damsInflight = null;
      });
    }
    return this.damsInflight;
  }

  /** Backs GET /api/v1/dams[?province=NN]. */
  async getDams(province?: string | null): Promise<DamsResponse> {
    const nowMs = Date.now();
    const fetchedAt = this.readMeta("damsFetchedAt");
    if (!fetchedAt || nowMs - Date.parse(fetchedAt) > DAMS_TTL_MS) await this.refreshDams(nowMs);
    const rows = (
      province
        ? this.ctx.storage.sql.exec<StationRow>("SELECT payload FROM dams WHERE province_code = ?", province)
        : this.ctx.storage.sql.exec<StationRow>("SELECT payload FROM dams")
    ).toArray();
    const dams = rows.map((r) => JSON.parse(r.payload) as DamObservation);
    const newest = dams.map((d) => d.observedAt).filter((v): v is string => !!v).sort().at(-1);
    return {
      layer: {
        id: "thaiwater-dams",
        epistemicClass: "observed",
        liveOrStatic: "live",
        observedAt: newest,
        fetchedAt: this.readMeta("damsFetchedAt") ?? new Date(nowMs).toISOString(),
        staleAfterSeconds: 3 * 60 * 60,
        sourceIds: ["thaiwater"],
      },
      fetchedAt: this.readMeta("damsFetchedAt"),
      dams,
    };
  }

  /** Backs GET /api/v1/health. */
  async status(): Promise<SourceStatus> {
    const nowMs = Date.now();
    const fetchedAt = this.readMeta("fetchedAt");
    const lastError = this.readMeta("lastError");
    const rainCount =
      this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM rainfall").toArray()[0]?.n ?? 0;
    const waterCount =
      this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM waterlevel").toArray()[0]?.n ?? 0;
    const latest =
      this.ctx.storage.sql
        .exec<{ t: string | null }>(
          "SELECT MAX(observed_at) AS t FROM (SELECT observed_at FROM rainfall UNION ALL SELECT observed_at FROM waterlevel)",
        )
        .toArray()[0]?.t ?? null;
    const age = fetchedAt ? nowMs - Date.parse(fetchedAt) : Infinity;
    const health = !fetchedAt
      ? lastError
        ? "down"
        : "unknown"
      : age > STALE_AFTER_MS
        ? "stale"
        : lastError
          ? "degraded"
          : "ok";
    return {
      id: "thaiwater",
      labelTh: "สถานีตรวจวัดน้ำ/ฝน (ThaiWater สสน.)",
      health,
      fetchedAt,
      latestObservedAt: latest,
      lastAttemptAt: this.readMeta("lastAttemptAt"),
      lastError,
      detail: {
        rainfallStations: rainCount,
        waterlevelStations: waterCount,
        consecutiveFailures: Number(this.readMeta("consecutiveFailures") ?? "0"),
      },
      staleAfterSeconds: STALE_AFTER_MS / 1000,
    };
  }

  /**
   * Backs GET /api/v1/observations. `province` omitted = nationwide.
   * With `atIso`, water-level readings are replaced by the stored history
   * point at/before that time (rainfall has no history feed and is omitted);
   * `situationLevel` is left null because ThaiWater's classification is only
   * published for the live reading — the client colours by freeboard instead.
   */
  async getObservations(province?: string | null, atIso?: string | null): Promise<ObservationsResponse> {
    const nowMs = Date.now();
    if (!this.isFresh(nowMs)) {
      await this.refreshOnce(nowMs);
      void this.armAlarm();
    }
    // Viewing a province: make sure its stations' history is warm for the
    // timeline. Runs in the background; never blocks the response.
    if (province) this.ctx.waitUntil(this.warmProvinceHistory(province).catch(() => undefined));
    const atMs = atIso ? Date.parse(atIso) : NaN;
    const historical = Number.isFinite(atMs) && atMs < nowMs - 60 * 1000;

    const rainfall = (
      province
        ? this.ctx.storage.sql.exec<StationRow>(
            "SELECT payload FROM rainfall WHERE province_code = ?",
            province,
          )
        : this.ctx.storage.sql.exec<StationRow>("SELECT payload FROM rainfall")
    )
      .toArray()
      .map((r) => JSON.parse(r.payload) as RainfallObservation);

    let waterlevel = (
      province
        ? this.ctx.storage.sql.exec<StationRow>(
            "SELECT payload FROM waterlevel WHERE province_code = ?",
            province,
          )
        : this.ctx.storage.sql.exec<StationRow>("SELECT payload FROM waterlevel")
    )
      .toArray()
      .map((r) => JSON.parse(r.payload) as WaterLevelObservation);

    if (historical) {
      rainfall.length = 0;
      waterlevel = waterlevel.flatMap((w) => {
        const point = this.ctx.storage.sql
          .exec<{ ts_ms: number; value: number | null }>(
            "SELECT ts_ms, value FROM waterlevel_history WHERE station_id = ? AND ts_ms <= ? AND ts_ms >= ? ORDER BY ts_ms DESC LIMIT 1",
            w.station.id,
            atMs,
            atMs - SNAPSHOT_TOLERANCE_MS,
          )
          .toArray()[0];
        if (!point || point.value === null) return [];
        const datum =
          this.ctx.storage.sql
            .exec<{ datum: string }>("SELECT datum FROM history_meta WHERE station_id = ?", w.station.id)
            .toArray()[0]?.datum ?? "unknown";
        // Only when the series is on MSL can freeboard against the bank be formed.
        const msl = datum === "msl" ? point.value : null;
        return [
          {
            ...w,
            waterlevelMsl: msl,
            waterlevelLocalM: datum === "local" ? point.value : null,
            freeboardM:
              msl !== null && w.minBankMsl !== null ? Math.round((w.minBankMsl - msl) * 1000) / 1000 : null,
            situationLevel: null,
            storagePercent: null,
            observedAt: new Date(point.ts_ms).toISOString(),
          },
        ];
      });
    }

    const reportedRain = rainfall
      .map((r) => r.rain24h)
      .filter((v): v is number => v !== null);
    const observedTimes = [...rainfall, ...waterlevel]
      .map((o) => o.observedAt)
      .filter((v): v is string => v !== null)
      .sort();

    const fetchedAt = this.readMeta("fetchedAt");
    const layer: HazardLayerDescriptor = {
      id: "thaiwater-observations",
      epistemicClass: "observed",
      liveOrStatic: "live",
      observedAt: observedTimes.length ? observedTimes[observedTimes.length - 1] : undefined,
      fetchedAt: fetchedAt ?? new Date(nowMs).toISOString(),
      staleAfterSeconds: STALE_AFTER_MS / 1000,
      sourceIds: ["thaiwater"],
    };

    return {
      layer,
      summary: {
        provinceCode: province ?? null,
        rainfallStationCount: rainfall.length,
        waterlevelStationCount: waterlevel.length,
        maxRain24h: reportedRain.length ? Math.max(...reportedRain) : null,
        meanRain24h: reportedRain.length
          ? Math.round((reportedRain.reduce((a, b) => a + b, 0) / reportedRain.length) * 100) / 100
          : null,
        stationsAboveWarning: waterlevel.filter(
          (w) => w.situationLevel !== null && w.situationLevel >= 4,
        ).length,
        latestObservedAt: observedTimes.length ? observedTimes[observedTimes.length - 1] : null,
        // Null when we have never pulled successfully — never faked as "now".
        fetchedAt,
        sourceAttribution: THAIWATER_ATTRIBUTION,
      },
      rainfall,
      waterlevel,
    };
  }
}
