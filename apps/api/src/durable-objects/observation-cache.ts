import { DurableObject } from "cloudflare:workers";
import {
  SOURCES,
  type DamObservation,
  type DamsResponse,
  type HazardLayerDescriptor,
  type ObservationsResponse,
  type RainfallObservation,
  type SourceStatus,
  type WaterLevelHistoryPoint,
  type WaterLevelHistoryResponse,
  type WaterLevelObservation,
} from "@siahra/shared-types";
import {
  fetchDams,
  fetchRainfall,
  fetchWaterLevel,
  fetchWaterLevelHistory,
} from "../ingestion/thaiwater.js";
import { shortReason } from "../ingestion/errors.js";
import { DEFAULT_EXPOSURE_THRESHOLDS, computeExposure } from "../exposure/compute.js";
import type { StationHourlyLevels } from "../exposure/compute.js";
import {
  EXPOSURE_POINTER_NAME,
  exposureRunKey,
  runContentHash,
} from "../exposure/publish.js";
import { deriveSourceHealth } from "../sourceHealth.js";
import { UpstreamQueue } from "../upstream/limiter.js";
import {
  addDays,
  bangkokDay,
  bangkokHour,
  dayStartMs,
  getJson,
  getJsonGz,
  keys as archiveKeys,
  putJson,
  putJsonGz,
  type ArchiveDayIndex,
  type WaterlevelDayFile,
} from "../archive.js";
import { errorText, logError, logInfo, logWarn } from "../log.js";

/**
 * Upstream responses are 2-4 MB covering ~5,500 stations nationwide, so they
 * must never be fetched per browser request. One cached nationwide copy backs
 * every province query.
 */
const TTL_MS = 5 * 60 * 1000;
/** After this long without a successful pull the data is flagged stale. */
const STALE_AFTER_MS = 15 * 60 * 1000;
/**
 * เพดานอายุของ "ค่าตรวจวัดใหม่สุด" ก่อนถือว่า `delayed` (ดึงสำเร็จ แต่ต้นทางยัง
 * ไม่ปล่อยรอบใหม่) — วัดจริงจาก /api/v1/observations ทั่วประเทศ 2026-08-19:
 * ฝนตกกริดรายชั่วโมงเป็นหลัก (สถานี 2,413 ตัวอยู่ที่ 00:00 และ 1,581 ตัวที่ 01:00)
 * ระดับน้ำส่วนใหญ่รายชั่วโมง มีบางส่วนรายงานทุก 10 นาที และหน่วงการเผยแพร่ ~17 นาที
 * → 2 ชม. = สองรอบรายชั่วโมง เผื่อพลาดการเผยแพร่หนึ่งรอบโดยยังไม่ตีว่าผิดปกติ
 *
 * ค่านี้เทียบกับ MAX(observed_at) ของสถานีทั้งหมด (~5,900 ตัว) จึงถูกครอบด้วย
 * สถานีที่สดที่สุด — `delayed` ของ thaiwater จะจุดก็ต่อเมื่อต้นทางเงียบเกือบทั้งระบบ
 * ไม่ใช่เมื่อสถานีบางส่วนค้าง
 */
const OBSERVED_LAG_MS = 2 * 60 * 60 * 1000;
/** Failed refreshes back off: 1 min, 2, 4 … capped at 10 min. */
const RETRY_MIN_MS = 60 * 1000;
const RETRY_MAX_MS = 10 * 60 * 1000;
/** Station history is re-pulled at most this often, kept this long. */
const HISTORY_TTL_MS = 10 * 60 * 1000;
const HISTORY_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;
/** Hot window served from SQLite; older requests go to the R2 archive. */
const HOT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HISTORY_HOURS = 30 * 24;
const ARCHIVE_CACHE_TTL_MS = 60 * 60 * 1000;
const HISTORY_HOURS = 72;
/** Stations warmed eagerly per province view; the rest load on demand. */
const WARM_MAX_STATIONS = 24;
/** Snapshot lookups accept a reading this far before the requested time. */
const SNAPSHOT_TOLERANCE_MS = 3 * 60 * 60 * 1000;
const DAMS_TTL_MS = 30 * 60 * 1000;
/**
 * รอบที่ฟีดเขื่อนล้มเหลวจะไม่ประทับ `damsFetchedAt` (ไม่มีข้อมูลใหม่ให้ประทับ)
 * ทุกคำขอถัดไปจึงเข้าเงื่อนไข "หมดอายุ" แล้วยิงต้นทางซ้ำทุกครั้ง — ต้นทางที่ส่ง
 * payload ผิดรูปไม่ใช่อาการชั่วคราว การยิงรัวจึงได้แต่รูปเดิม เว้นระยะไว้ 5 นาที
 */
const DAMS_RETRY_MS = 5 * 60 * 1000;
/**
 * งบเวลาของแหล่ง `exposure-illustrative` บน /health — 30 นาทีตาม E10.3
 *
 * `staleAfterSeconds` วัดจาก **การดึง ThaiWater** (ไม่มีอินพุตใหม่ = ไม่มีอะไรให้
 * คำนวณ) ส่วน `observedLagSeconds` วัดจาก **เวลาที่คำนวณ run ล่าสุด** ที่เผยแพร่ไป
 * — ครบ 30 นาทีแล้วยังไม่มี run ใหม่ = `delayed`
 *
 * **งบสองตัวนี้เท่ากันไม่ได้** และนี่คือเหตุผลที่ `staleAfterSeconds` เป็นหนึ่งชั่วโมง
 * ไม่ใช่ครึ่งชั่วโมง: `deriveSourceHealth` ตัดสิน `stale` (ดึงไม่ทันงบ) **ก่อน**
 * `delayed` เสมอ และในทางปฏิบัติ "ไม่มี run ใหม่ 30 นาที" กับ "ไม่มีรอบดึงสำเร็จ
 * 30 นาที" คือเหตุการณ์เดียวกัน (เพราะ `fetchedAt` อยู่ในเนื้อหาที่ใช้คิด `runId`
 * รอบที่ดึงสำเร็จจึงได้ run ใหม่เสมอ) ถ้าตั้งงบเท่ากัน สาขา `delayed` จะไม่มีวัน
 * ถูกใช้เลย เส้นแบ่งที่ตั้งใจจึงเป็น: เงียบ 30 นาที = "ยังไม่มีอะไรใหม่ให้จัดอันดับ"
 * (`delayed`) เงียบเกินหนึ่งชั่วโมง = "ฝั่งเราหยุดดึงไปแล้วจริง ๆ" (`stale`)
 *
 * ทำไม `latestObservedAt` ของแหล่งนี้จึงเป็น `run.computedAt` ไม่ใช่เวลาตรวจวัด
 * ใหม่สุดในตัว run: เวลาตรวจวัดของ ThaiWater แกว่งอยู่ราว 17–77 นาทีตามปกติ
 * (ดูตาราง `observedLagSeconds` ใน docs/api.md) ถ้าเอาค่านั้นมาเทียบกับงบ 30 นาที
 * แหล่งนี้จะขึ้น `delayed` เกือบตลอดทุกชั่วโมงทั้งที่ทุกอย่างทำงานปกติ — เตือนหมาป่า
 * จนไม่มีใครเชื่อแถบสถานะอีก สิ่งที่งบ 30 นาทีนี้ตั้งใจวัดคือ "ยังมี run ใหม่ออกมา
 * อยู่ไหม" ดังนั้นตัวเลขที่ต้องเทียบคือเวลาของ run เอง ส่วนเวลาตรวจวัดรายสถานี
 * ยังอยู่ครบใน artefact ทุกก้อน (`stations[].observedAt` และ `layer.observedAt`)
 */
const EXPOSURE_STALE_AFTER_MS = 60 * 60 * 1000;
const EXPOSURE_RUN_LAG_MS = 30 * 60 * 1000;

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
  /**
   * Every ThaiWater call goes through this queue: 3 at a time, ≥250 ms apart,
   * ≤120 starts/min, and a 5-minute pause after 3 consecutive 429/5xx.
   */
  private readonly upstream = new UpstreamQueue({
    concurrency: 3,
    minGapMs: 250,
    perMinute: 120,
    tripAfter: 3,
    pauseMs: 5 * 60 * 1000,
  });

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
        CREATE TABLE IF NOT EXISTS hourly_levels (
          station_id INTEGER NOT NULL,
          ts_ms INTEGER NOT NULL,
          value_msl REAL,
          PRIMARY KEY (station_id, ts_ms)
        );
        CREATE TABLE IF NOT EXISTS archive_cache (
          key TEXT PRIMARY KEY,
          body TEXT NOT NULL,
          fetched_ms INTEGER NOT NULL
        );
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
      /**
       * exposure run ถูกคำนวณ "ต่อท้ายรอบ refresh" ที่ผู้เรียกทุกคนใช้ร่วมกัน —
       * ผู้เรียกหลายรายในรอบเดียวจึงได้ promise ก้อนเดียวกัน = **เขียน R2
       * ได้ไม่เกินหนึ่งครั้งต่อหนึ่งรอบ refresh** (AC ของ E10.3)
       *
       * `publishExposure` ถูกออกแบบให้ **ไม่มีวัน reject** (ดูตัวมันเอง) ดังนั้น
       * การเขียน R2 ที่ล้มเหลวจะไม่ลาก refresh ลงไปด้วย และไม่มีทางกิน
       * `armAlarm()` ของผู้เรียก — แต่ผู้เรียกทั้งสามจุดก็ยังเรียก `armAlarm()`
       * จาก `finally` อยู่ดี เพราะการมี alarm ค้างไว้สำคัญกว่าเหตุผลที่รอบนี้พัง
       */
      this.inflight = this.refresh(nowMs)
        .then(() => this.publishExposure(nowMs))
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.inflight;
  }

  /** Cron/alarm entry point: refresh if due, and (re)arm the alarm. */
  async ensureFresh(): Promise<void> {
    const nowMs = Date.now();
    // นัดครั้งถัดไปต้องถูกตั้งเสมอ แม้รอบนี้จะพัง — ถ้า refresh (หรือการเผยแพร่
    // exposure ที่ต่อท้ายมัน) โยนออกมาแล้วข้าม armAlarm() ไป DO จะไม่มีนัด
    // เหลืออยู่เลย และค่าตรวจวัดทั้งชุดจะหยุดอัปเดต ไม่ใช่แค่ exposure
    try {
      if (!this.isFresh(nowMs)) await this.refreshOnce(nowMs);
    } finally {
      await this.armAlarm();
    }
    this.ctx.waitUntil(this.archiveTick().catch((err: unknown) => {
      this.writeMeta("archiveError", String(err).slice(0, 200));
    }));
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
    try {
      await this.refreshOnce(Date.now());
    } finally {
      // The alarm just fired, so getAlarm() is null and armAlarm() sets the next
      // one — from `finally`, so a failed refresh or a rejected R2 publish can
      // never leave this DO with no alarm scheduled (E10.3).
      await this.armAlarm();
    }
    // Archive work never blocks the refresh cadence.
    this.ctx.waitUntil(this.archiveTick().catch((err: unknown) => {
      this.writeMeta("archiveError", String(err).slice(0, 200));
      logError("archive tick failed", { error: errorText(err) });
    }));
  }

  // ---------------------------------------------------------------------------
  // Archive: hourly nationwide snapshot + daily per-province water-level files.
  // ---------------------------------------------------------------------------

  private async archiveTick(): Promise<void> {
    const nowMs = Date.now();
    if (!this.readMeta("fetchedAt")) return;
    const day = bangkokDay(nowMs);
    const hour = bangkokHour(nowMs);
    const hourKey = `${day}/${hour}`;
    if (this.readMeta("lastSnapshotKey") !== hourKey) {
      await this.writeHourlySnapshot(nowMs, day, hour);
      this.writeMeta("lastSnapshotKey", hourKey);
    }
    const lastArchived = this.readMeta("lastArchivedDay");
    const yesterday = addDays(day, -1);
    if (lastArchived !== yesterday && nowMs - dayStartMs(day) > 20 * 60 * 1000) {
      await this.archiveDay(yesterday);
      this.writeMeta("lastArchivedDay", yesterday);
    }
    this.writeMeta("archiveError", null);
  }

  private async writeHourlySnapshot(nowMs: number, day: string, hour: string): Promise<void> {
    const snapshot = await this.getObservations(null);
    await putJsonGz(this.env.HAZARD_BUCKET, archiveKeys.snapshot(day, hour), snapshot);
    // Also keep hourly MSL levels for every station in SQLite so the daily
    // file has at least hourly coverage for stations nobody warmed.
    //
    // `ts_ms` must be a real observation time: `exposureHistory()` feeds this
    // table straight into `freeboardTrend()`, which treats `ts_ms` as elapsed
    // wall-clock time between two real readings. A station whose
    // `observedAt` is missing or unparsable has no real observation time to
    // record here — stamping it with `nowMs` (the snapshot's own clock, not
    // an upstream measurement) would let an unrelated value change between
    // two snapshots read as a rate of change, i.e. a fabricated trend. Such
    // rows are skipped entirely rather than given a synthetic timestamp; the
    // station just has one fewer archived/trend point for that hour, same as
    // any other station that failed to report.
    const rows = snapshot.waterlevel;
    for (let i = 0; i < rows.length; i += 30) {
      const chunk = rows.slice(i, i + 30);
      const binds: SqlStorageValue[] = [];
      let n = 0;
      for (const w of chunk) {
        const ts = w.observedAt ? Date.parse(w.observedAt) : NaN;
        if (!Number.isFinite(ts)) continue;
        binds.push(w.station.id, ts, w.waterlevelMsl);
        n++;
      }
      if (n === 0) continue;
      const placeholders = Array.from({ length: n }, () => "(?, ?, ?)").join(",");
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO hourly_levels (station_id, ts_ms, value_msl) VALUES ${placeholders}`,
        ...binds,
      );
    }
    this.ctx.storage.sql.exec("DELETE FROM hourly_levels WHERE ts_ms < ?", nowMs - HISTORY_RETENTION_MS);
    // Index bookkeeping.
    const idx = (await getJson<ArchiveDayIndex>(this.env.HAZARD_BUCKET, archiveKeys.index(day))) ?? {
      day,
      waterlevelProvinces: [],
      snapshotHours: [],
      dams: false,
      generatedAt: new Date(nowMs).toISOString(),
    };
    if (!idx.snapshotHours.includes(hour)) idx.snapshotHours.push(hour);
    idx.generatedAt = new Date(nowMs).toISOString();
    await putJson(this.env.HAZARD_BUCKET, archiveKeys.index(day), idx);
  }

  /** Writes archive/waterlevel/{day}/{province}.json.gz for every province + the day's dams. */
  private async archiveDay(day: string): Promise<void> {
    const start = dayStartMs(day);
    const end = start + 86400000;
    const stations = this.ctx.storage.sql
      .exec<{ station_id: number; province_code: string | null }>("SELECT station_id, province_code FROM waterlevel")
      .toArray();
    const byProvince = new Map<string, number[]>();
    for (const s of stations) {
      const p = s.province_code ?? "00";
      const arr = byProvince.get(p) ?? [];
      arr.push(s.station_id);
      byProvince.set(p, arr);
    }
    const written: string[] = [];
    for (const [province, ids] of byProvince) {
      const file: WaterlevelDayFile = { day, provinceCode: province, generatedAt: new Date().toISOString(), stations: [] };
      for (const id of ids) {
        const fine = this.ctx.storage.sql
          .exec<{ ts_ms: number; value: number | null; discharge: number | null }>(
            "SELECT ts_ms, value, discharge FROM waterlevel_history WHERE station_id = ? AND ts_ms >= ? AND ts_ms < ? ORDER BY ts_ms",
            id,
            start,
            end,
          )
          .toArray();
        const datum =
          this.ctx.storage.sql.exec<{ datum: string }>("SELECT datum FROM history_meta WHERE station_id = ?", id).toArray()[0]
            ?.datum ?? "unknown";
        let points: [number, number | null, number | null][];
        let d: "msl" | "local" | "unknown" = datum as "msl" | "local" | "unknown";
        if (fine.length > 0) {
          points = fine.map((r) => [r.ts_ms, r.value, r.discharge]);
        } else {
          const hourly = this.ctx.storage.sql
            .exec<{ ts_ms: number; value_msl: number | null }>(
              "SELECT ts_ms, value_msl FROM hourly_levels WHERE station_id = ? AND ts_ms >= ? AND ts_ms < ? ORDER BY ts_ms",
              id,
              start,
              end,
            )
            .toArray();
          if (hourly.length === 0) continue;
          points = hourly.map((r) => [r.ts_ms, r.value_msl, null]);
          d = "msl";
        }
        file.stations.push({ stationId: id, datum: d, points });
      }
      if (file.stations.length === 0) continue;
      await putJsonGz(this.env.HAZARD_BUCKET, archiveKeys.waterlevelDay(day, province), file);
      written.push(province);
    }
    // Dams: whatever we hold that was observed on that day.
    const dams = this.ctx.storage.sql.exec<StationRow>("SELECT payload FROM dams").toArray().map((r) => JSON.parse(r.payload) as DamObservation);
    const dayDams = dams.filter((d) => d.observedAt && bangkokDay(Date.parse(d.observedAt)) === day);
    if (dayDams.length) await putJsonGz(this.env.HAZARD_BUCKET, archiveKeys.dams(day), { day, dams: dayDams });
    const idx = (await getJson<ArchiveDayIndex>(this.env.HAZARD_BUCKET, archiveKeys.index(day))) ?? {
      day,
      waterlevelProvinces: [],
      snapshotHours: [],
      dams: false,
      generatedAt: new Date().toISOString(),
    };
    idx.waterlevelProvinces = written;
    idx.dams = dayDams.length > 0;
    idx.generatedAt = new Date().toISOString();
    await putJson(this.env.HAZARD_BUCKET, archiveKeys.index(day), idx);
    logInfo("archived day", { day, provinces: written.length, dams: dayDams.length });
  }

  /** Province-day archive file with a 1 h SQLite cache (null when absent). */
  private async archivedDay(day: string, province: string): Promise<WaterlevelDayFile | null> {
    const key = archiveKeys.waterlevelDay(day, province);
    const cached = this.ctx.storage.sql
      .exec<{ body: string; fetched_ms: number }>("SELECT body, fetched_ms FROM archive_cache WHERE key = ?", key)
      .toArray()[0];
    if (cached && Date.now() - cached.fetched_ms < ARCHIVE_CACHE_TTL_MS) {
      return cached.body === "" ? null : (JSON.parse(cached.body) as WaterlevelDayFile);
    }
    const file = await getJsonGz<WaterlevelDayFile>(this.env.HAZARD_BUCKET, key);
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO archive_cache (key, body, fetched_ms) VALUES (?, ?, ?)",
      key,
      file ? JSON.stringify(file) : "",
      Date.now(),
    );
    this.ctx.storage.sql.exec("DELETE FROM archive_cache WHERE fetched_ms < ?", Date.now() - 6 * ARCHIVE_CACHE_TTL_MS);
    return file;
  }

  /** Days (Bangkok) covering [fromMs, toMs], oldest first, capped to the archive horizon. */
  private daysBetween(fromMs: number, toMs: number): string[] {
    const out: string[] = [];
    let d = bangkokDay(fromMs);
    const last = bangkokDay(toMs);
    for (let i = 0; i < 40 && d <= last; i++) {
      out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }

  /** Backs GET /api/v1/archive/days. */
  async archiveDays(limit = 60): Promise<ArchiveDayIndex[]> {
    const list = await this.env.HAZARD_BUCKET.list({ prefix: "archive/index/", limit: 1000 });
    const keysSorted = list.objects.map((o) => o.key).sort().slice(-limit);
    const out: ArchiveDayIndex[] = [];
    for (const k of keysSorted) {
      const idx = await getJson<ArchiveDayIndex>(this.env.HAZARD_BUCKET, k);
      if (idx) out.push(idx);
    }
    return out;
  }

  /** Nearest hourly nationwide snapshot at/before `atMs` (within 2 h), optionally filtered. */
  async archivedSnapshot(atMs: number, province: string | null): Promise<ObservationsResponse | null> {
    for (let back = 0; back < 3; back++) {
      const t = atMs - back * 3600000;
      const snap = await getJsonGz<ObservationsResponse>(
        this.env.HAZARD_BUCKET,
        archiveKeys.snapshot(bangkokDay(t), bangkokHour(t)),
      );
      if (!snap) continue;
      if (!province) return snap;
      const rainfall = snap.rainfall.filter((r) => r.station.provinceCode === province);
      const waterlevel = snap.waterlevel.filter((w) => w.station.provinceCode === province);
      return { ...snap, rainfall, waterlevel, summary: { ...snap.summary, provinceCode: province, rainfallStationCount: rainfall.length, waterlevelStationCount: waterlevel.length } };
    }
    return null;
  }

  private async refresh(nowMs: number): Promise<void> {
    this.writeMeta("lastAttemptAt", new Date(nowMs).toISOString());
    // Partial failure must not wipe the good half of the cache, so each feed
    // is only rewritten when its own fetch succeeded.
    const errors: string[] = [];
    const [rainfall, waterlevel] = await Promise.all([
      this.upstream.run(() => fetchRainfall(), 0).catch((err: unknown) => {
        errors.push(shortReason(err));
        logError("thaiwater rain fetch failed", { error: errorText(err) });
        return null;
      }),
      this.upstream.run(() => fetchWaterLevel(), 0).catch((err: unknown) => {
        errors.push(shortReason(err));
        logError("thaiwater waterlevel fetch failed", { error: errorText(err) });
        return null;
      }),
    ]);

    /**
     * **ตรวจรูปร่างเสร็จก่อนถึงบรรทัดนี้เสมอ** — adapter จะโยน `UpstreamShapeError`
     * ตั้งแต่ตอนแปลง payload จึงคืนค่าเป็น null และไม่มี SQL สักคำสั่งถูกรัน
     * ผลคือรอบที่ payload ผิดรูปจะไม่มีวัน "เขียนไปได้ครึ่งทาง": แถวเดิมอยู่ครบ
     * แล้วความล้มเหลวไปโผล่ที่ lastError/health แทน (E4.4 AC 4)
     */
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
      // เก็บข้อความจริงของต้นทางไว้ ไม่ใช่แค่ "fetch failed" — ผู้ใช้ที่เห็น
      // แถบสถานะต้องแยกออกว่าต้นทางล่ม (HTTP 5xx) กับต้นทางเปลี่ยนรูปร่าง
      // (UpstreamShapeError พร้อม path) คนละเรื่องกัน
      // ไม่ใส่คำนำหน้า "ThaiWater" ซ้ำ: shortReason() คืนข้อความที่ขึ้นต้นด้วยชื่อ
      // ต้นทางและ path อยู่แล้ว การซ้ำจะกินโควตา 200 ตัวอักษรจน path ของฟีดที่สอง
      // ถูกตัดทิ้ง ทั้งที่มันคือชิ้นเดียวที่บอกว่าต้นทางเปลี่ยนรูปตรงไหน
      this.writeMeta("lastError", errors.join("; ").slice(0, 200));
      const failures = Number(this.readMeta("consecutiveFailures") ?? "0") + 1;
      this.writeMeta("consecutiveFailures", String(failures));
    }
    logInfo("observation cache refreshed", {
      rainfall: rainfall?.length ?? "failed",
      waterlevel: waterlevel?.length ?? "failed",
    });
  }

  /**
   * Rewriting every station on every poll is what blew the DO rows_written
   * quota (a full delete+insert of ~5,500 stations every 5 min). Most
   * stations haven't published a new reading since the last poll, so only
   * rows whose observedAt actually changed are written; the rest are
   * skipped entirely (not deleted — a station missing from one fetch keeps
   * its last known reading instead of vanishing from the map, and will read
   * as stale via fetchedAt once it truly stops reporting).
   */
  private replaceRainfall(rows: RainfallObservation[]): void {
    const existing = new Map(
      this.ctx.storage.sql
        .exec<{ station_id: number; observed_at: string | null }>("SELECT station_id, observed_at FROM rainfall")
        .toArray()
        .map((r) => [r.station_id, r.observed_at]),
    );
    const changed = rows.filter((row) => existing.get(row.station.id) !== row.observedAt);
    for (let i = 0; i < changed.length; i += INSERT_CHUNK) {
      const chunk = changed.slice(i, i + INSERT_CHUNK);
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
    const existing = new Map(
      this.ctx.storage.sql
        .exec<{ station_id: number; observed_at: string | null }>("SELECT station_id, observed_at FROM waterlevel")
        .toArray()
        .map((r) => [r.station_id, r.observed_at]),
    );
    const changed = rows.filter((row) => existing.get(row.station.id) !== row.observedAt);
    for (let i = 0; i < changed.length; i += INSERT_CHUNK) {
      const chunk = changed.slice(i, i + INSERT_CHUNK);
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

  private async pullHistory(stationId: number, nowMs: number, priority = 5): Promise<void> {
    const points = await this.upstream.run(() => fetchWaterLevelHistory(stationId, HISTORY_HOURS, nowMs), priority);
    // Re-inserting the full 72 h window every 10 min was the other big
    // rows_written source. Past readings don't change, so only points past
    // the last stored timestamp are written (minus a small buffer in case
    // the most recent stored point was still provisional upstream).
    const lastTs =
      this.ctx.storage.sql
        .exec<{ t: number | null }>("SELECT MAX(ts_ms) AS t FROM waterlevel_history WHERE station_id = ?", stationId)
        .toArray()[0]?.t ?? null;
    const cutoffMs = lastTs === null ? -Infinity : lastTs - 20 * 60 * 1000;
    const fresh = points.filter((p) => Date.parse(p.t) > cutoffMs);
    // 4 bound params per row; 24 rows = 96, under SQLite's 100-parameter cap.
    const HISTORY_CHUNK = 24;
    for (let i = 0; i < fresh.length; i += HISTORY_CHUNK) {
      const chunk = fresh.slice(i, i + HISTORY_CHUNK);
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

  /**
   * Warm 72 h history for a province being viewed — but politely: stations at
   * warning level first, at most WARM_MAX_STATIONS per view, everything else
   * on demand (getHistory) or from the hourly snapshot archive.
   */
  async warmProvinceHistory(province: string): Promise<void> {
    if (this.warming.has(province)) return;
    this.warming.add(province);
    try {
      const nowMs = Date.now();
      const rows = this.ctx.storage.sql
        .exec<{ station_id: number; situation_level: number | null }>(
          "SELECT station_id, situation_level FROM waterlevel WHERE province_code = ? ORDER BY situation_level DESC",
          province,
        )
        .toArray()
        .filter((r) => !this.historyFresh(r.station_id, nowMs))
        .slice(0, WARM_MAX_STATIONS);
      await Promise.all(
        rows.map((r) =>
          this.pullHistory(r.station_id, nowMs, (r.situation_level ?? 0) >= 4 ? 2 : 6).catch((err: unknown) => {
            logWarn("history pull failed", { stationId: r.station_id, error: errorText(err) });
          }),
        ),
      );
    } finally {
      this.warming.delete(province);
    }
  }

  /** Backs GET /api/v1/stations/{id}/history (≤ 30 days; >7 days read from the R2 archive). */
  async getHistory(stationId: number, hours: number): Promise<WaterLevelHistoryResponse> {
    const nowMs = Date.now();
    hours = Math.min(MAX_HISTORY_HOURS, hours);
    if (!this.historyFresh(stationId, nowMs)) {
      // User-driven: highest priority in the queue.
      await this.pullHistory(stationId, nowMs, 1);
    }
    const meta = this.ctx.storage.sql
      .exec<{ fetched_ms: number; datum: string }>("SELECT fetched_ms, datum FROM history_meta WHERE station_id = ?", stationId)
      .toArray()[0];
    const fromMs = nowMs - hours * 60 * 60 * 1000;
    const hot = this.ctx.storage.sql
      .exec<{ ts_ms: number; value: number | null; discharge: number | null }>(
        "SELECT ts_ms, value, discharge FROM waterlevel_history WHERE station_id = ? AND ts_ms >= ? ORDER BY ts_ms ASC",
        stationId,
        Math.max(fromMs, nowMs - HOT_WINDOW_MS),
      )
      .toArray()
      .map((r) => ({ t: new Date(r.ts_ms).toISOString(), value: r.value, discharge: r.discharge }));
    let archived: WaterLevelHistoryPoint[] = [];
    let fromArchive = false;
    if (fromMs < nowMs - HOT_WINDOW_MS) {
      const province =
        this.ctx.storage.sql
          .exec<{ province_code: string | null }>("SELECT province_code FROM waterlevel WHERE station_id = ?", stationId)
          .toArray()[0]?.province_code ?? null;
      if (province) {
        const days = this.daysBetween(fromMs, nowMs - HOT_WINDOW_MS);
        const files = await Promise.all(days.map((d) => this.archivedDay(d, province)));
        for (const f of files) {
          const st = f?.stations.find((x) => x.stationId === stationId);
          if (!st) continue;
          fromArchive = true;
          for (const [t, v, q] of st.points) {
            if (t >= fromMs && t < nowMs - HOT_WINDOW_MS) archived.push({ t: new Date(t).toISOString(), value: v, discharge: q });
          }
        }
      }
    }
    // De-duplicate on the boundary and keep chronological order.
    const seen = new Set(hot.map((p) => p.t));
    archived = archived.filter((p) => !seen.has(p.t));
    const points = [...archived, ...hot].sort((a, b) => (a.t < b.t ? -1 : 1));
    return {
      layer: {
        id: "thaiwater-waterlevel-history",
        epistemicClass: "observed",
        liveOrStatic: "live",
        observedAt: points.length ? points[points.length - 1].t : undefined,
        publishedAt: null,
        fetchedAt: meta ? new Date(meta.fetched_ms).toISOString() : null,
        staleAfterSeconds: STALE_AFTER_MS / 1000,
        sourceIds: ["thaiwater"],
      },
      stationId,
      datum: (meta?.datum as "msl" | "local" | "unknown") ?? "unknown",
      hours,
      fetchedAt: meta ? new Date(meta.fetched_ms).toISOString() : null,
      fromArchive,
      points,
    };
  }

  private damsInflight: Promise<void> | null = null;

  private async refreshDams(nowMs: number): Promise<void> {
    if (!this.damsInflight) {
      this.damsInflight = (async () => {
        const lastAttemptMs = Number(this.readMeta("damsAttemptAt") ?? "0");
        if (this.readMeta("damsError") && nowMs - lastAttemptMs < DAMS_RETRY_MS) return;
        this.writeMeta("damsAttemptAt", String(nowMs));
        try {
          const dams = await this.upstream.run(() => fetchDams(nowMs), 3);
          // ล้างตารางเฉพาะเมื่อมีของใหม่มาแทนจริง ๆ — payload ที่แปลงแล้วเหลือศูนย์
          // แถวไม่ควรมีสิทธิ์ลบเขื่อนทั้งประเทศทิ้ง (การตรวจซองจดหมายใน adapter
          // ดักกรณีนี้ไปแล้ว บรรทัดนี้คือกันชนชั้นสุดท้าย)
          if (dams.length === 0) throw new Error("ThaiWater analyst/dam returned no usable rows");
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
          // แถวเขื่อนเดิมยังอยู่ครบ (ไม่มีคำสั่ง DELETE ถูกรัน) และความล้มเหลว
          // ไปโผล่ที่ lastError ของ /health ด้านล่าง แทนที่จะหายไปใน log เฉย ๆ
          logError("thaiwater dams fetch failed", { error: errorText(err) });
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
        publishedAt: null,
        fetchedAt: this.readMeta("damsFetchedAt"),
        staleAfterSeconds: 3 * 60 * 60,
        sourceIds: ["thaiwater"],
      },
      fetchedAt: this.readMeta("damsFetchedAt"),
      dams,
    };
  }

  // ---------------------------------------------------------------------------
  // Illustrative flood exposure (E10.3)
  // ---------------------------------------------------------------------------

  /**
   * ประวัติระดับน้ำรายชั่วโมงในหน้าต่างย้อนหลังของ run — ใช้ตาราง `hourly_levels`
   * ตารางเดียว **โดยตั้งใจ** เพราะมันเก็บค่าเป็น MSL เสมอ ส่วน `waterlevel_history`
   * เก็บค่าตามที่ต้นทางส่งมา ซึ่งบางสถานีเป็นระดับท้องถิ่น (ดู `history_meta.datum`)
   * การเอาสองหน่วยมาต่อกันในสถานีเดียวจะได้ "อัตราการเปลี่ยน" ที่ไม่มีความหมาย
   */
  private exposureHistory(nowMs: number, windowH: number): StationHourlyLevels[] {
    const rows = this.ctx.storage.sql
      .exec<{ station_id: number; ts_ms: number; value_msl: number | null }>(
        "SELECT station_id, ts_ms, value_msl FROM hourly_levels WHERE ts_ms >= ? ORDER BY station_id, ts_ms",
        nowMs - windowH * 60 * 60 * 1000,
      )
      .toArray();
    const byStation = new Map<number, WaterLevelHistoryPoint[]>();
    for (const r of rows) {
      const points = byStation.get(r.station_id) ?? [];
      points.push({ t: new Date(r.ts_ms).toISOString(), value: r.value_msl, discharge: null });
      byStation.set(r.station_id, points);
    }
    return [...byStation.entries()].map(([stationId, points]) => ({ stationId, points }));
  }

  /**
   * คำนวณ run ทั่วประเทศหนึ่งชุดแล้วเผยแพร่ ถ้า **อะไรก็ตามที่เปิดเผยเปลี่ยน**
   *
   * เมธอดนี้ **ไม่มีวัน reject** — ทุกความล้มเหลวถูกเก็บลง `exposureError` แล้ว
   * ไปโผล่ที่ /api/v1/health (แหล่ง `exposure-illustrative`) เพราะมันวิ่งอยู่บน
   * เส้นทางเดียวกับการ refresh ค่าตรวจวัด: ถ้ามันโยนออกไป การตั้งนัด alarm
   * ครั้งถัดไปจะถูกข้าม แล้ว "การเขียน R2 พลาดครั้งเดียว" จะหยุดการดึงค่าตรวจวัด
   * ทั้งระบบ (cron ใน production กลบอาการนี้ไว้ แต่ `wrangler dev` ไม่มี cron)
   */
  private async publishExposure(nowMs: number): Promise<void> {
    try {
      this.writeMeta("exposureLastAttemptAt", new Date(nowMs).toISOString());
      const rainfall = this.ctx.storage.sql
        .exec<StationRow>("SELECT payload FROM rainfall")
        .toArray()
        .map((r) => JSON.parse(r.payload) as RainfallObservation);
      const waterlevel = this.ctx.storage.sql
        .exec<StationRow>("SELECT payload FROM waterlevel")
        .toArray()
        .map((r) => JSON.parse(r.payload) as WaterLevelObservation);
      const run = computeExposure(
        // `fetchedAt` คง null ไว้ตามจริง — run ที่ยังไม่เคยดึงต้นทางสำเร็จก็บอกว่าไม่เคย
        { rainfall, waterlevel, fetchedAt: this.readMeta("fetchedAt") },
        this.exposureHistory(nowMs, DEFAULT_EXPOSURE_THRESHOLDS.historyWindowH),
        DEFAULT_EXPOSURE_THRESHOLDS,
        new Date(nowMs),
      );
      const hash = runContentHash(run.runId);
      // เนื้อหาเท่าเดิมทุกไบต์ = ไม่มีอะไรใหม่ให้เผยแพร่ ไม่เขียน R2 ไม่ขยับตัวชี้
      if (hash !== null && hash === this.readMeta("exposureContentHash")) {
        this.writeMeta("exposureError", null);
        return;
      }
      const key = exposureRunKey(run.runId);
      /**
       * `exposure/runs/{runId}.json.gz` เขียนครั้งเดียวตลอดกาล: ถ้าคีย์นี้มีอยู่แล้ว
       * (เนื้อหาเปลี่ยนภายในวินาทีเดียวกันจนได้ `runId` ซ้ำ) เราปล่อยของเดิมไว้
       * ไม่เขียนทับ เพราะมันถูกเสิร์ฟแบบ immutable ไปแล้ว — ตัวชี้ยังถูกอัปเดต
       * ให้ชี้ไปที่ run นั้นตามปกติ
       *
       * เก็บเป็น gzip ด้วย `putJsonGz` เหมือนคลังถาวรก้อนอื่น: run ทั้งประเทศ
       * (5,454 สถานี) วัดผ่านเส้นทางเขียนจริงได้ 1,289,810 ไบต์ → 102,609 ไบต์
       * (7.96% เล็กลง 12.6 เท่า) การเก็บดิบคือจ่ายค่า R2 สิบสองเท่าโดยไม่ได้อะไรคืน
       * (`putJsonGz` log `bytes` ของไบต์ที่เขียนจริงให้เอง)
       */
      const existing = await this.env.HAZARD_BUCKET.head(key);
      if (!existing) {
        await putJsonGz(this.env.HAZARD_BUCKET, key, run);
        logInfo("exposure run published", { key, stations: run.stations.length });
      } else {
        logWarn("exposure run key already exists — not overwritten", { key });
      }
      await this.env.FORECAST_POINTER.getByName(EXPOSURE_POINTER_NAME).setLatest(run.runId, key);
      this.writeMeta("exposureContentHash", hash);
      this.writeMeta("exposureRunId", run.runId);
      this.writeMeta("exposureRunAt", run.computedAt);
      this.writeMeta("exposureObservedAt", run.layer.observedAt ?? null);
      this.writeMeta("exposureStationCount", String(run.stations.length));
      this.writeMeta("exposureError", null);
    } catch (err) {
      // `exposureContentHash` ถูกปล่อยไว้เท่าเดิมโดยตั้งใจ รอบถัดไปจึงเห็นว่า
      // เนื้อหาต่างจากที่เผยแพร่สำเร็จล่าสุด แล้วลองใหม่เอง
      this.writeMeta("exposureError", errorText(err, 200));
      logError("exposure publish failed", { error: errorText(err) });
    }
  }

  /**
   * Backs the `exposure-illustrative` entry in GET /api/v1/health
   *
   * เป็นแหล่งที่ **เราคำนวณเอง** ไม่ใช่ฟีดที่ไปดึงมา บันไดสุขภาพจึงถูกป้อนแบบนี้:
   * - `fetchedAt` = เวลาที่ดึง ThaiWater สำเร็จล่าสุด (อินพุตของการคำนวณ) —
   *   ไม่มีอินพุตใหม่ ก็ไม่มีทางมี run ใหม่
   * - `latestObservedAt` = **`computedAt` ของ run ที่เผยแพร่ล่าสุด ไม่ใช่เวลาตรวจวัด**
   *   ครบ 30 นาทีแล้วยังไม่ขยับ = `delayed` ซึ่งอ่านว่า "รอบคำนวณฝั่งเราหยุดเดิน"
   *   ไม่ใช่ "ต้นทางเงียบ" — เพราะ `inputs.thaiwaterFetchedAt` อยู่ในเนื้อหาที่เอาไป
   *   แฮช ทุกรอบที่ดึง ThaiWater สำเร็จจึงได้ run ใหม่เสมอ
   *
   *   เวลาตรวจวัดจริงของ run อยู่ที่ `detail.runObservedAt` ต่างหาก และมันเก่ากว่า
   *   `computedAt` เป็นปกติ (วัดได้ ~19 นาทีในชั่วโมงที่ปกติดี) การเอามันมาเป็น
   *   `latestObservedAt` จึงถูกปฏิเสธ — อายุค่าตรวจวัดของ ThaiWater แกว่ง 17–77 นาที
   *   อยู่แล้ว ซึ่งจะทำให้แหล่งนี้ขึ้น `delayed` เกือบตลอดทุกชั่วโมงโดยไม่มีอะไรผิด
   * - `lastError` = ความล้มเหลวของการเผยแพร่ครั้งล่าสุด (R2 หรือตัวชี้) ซึ่งทำให้
   *   เป็น `degraded`/`down` และทำให้ `/health` ตอบ `ok: false` — ไม่ใช่ความเงียบ
   */
  async exposureStatus(): Promise<SourceStatus> {
    const nowMs = Date.now();
    const fetchedAt = this.readMeta("fetchedAt");
    const lastError = this.readMeta("exposureError");
    // = `computedAt` ของ run ล่าสุดที่เผยแพร่สำเร็จ (เหตุผลอยู่ที่ EXPOSURE_RUN_LAG_MS)
    const latestObservedAt = this.readMeta("exposureRunAt");
    const health = deriveSourceHealth({
      nowMs,
      fetchedAt,
      lastError,
      latestObservedAt,
      staleAfterSeconds: EXPOSURE_STALE_AFTER_MS / 1000,
      observedLagSeconds: EXPOSURE_RUN_LAG_MS / 1000,
    });
    const alarmAtMs = await this.ctx.storage.getAlarm();
    return {
      id: "exposure-illustrative",
      labelTh: SOURCES["exposure-illustrative"].nameTh,
      labelEn: SOURCES["exposure-illustrative"].nameEn,
      health,
      fetchedAt,
      latestObservedAt,
      lastAttemptAt: this.readMeta("exposureLastAttemptAt"),
      lastError,
      detail: {
        runId: this.readMeta("exposureRunId"),
        // เวลาตรวจวัดใหม่สุดที่อยู่ใน run นั้น — แยกจาก latestObservedAt ข้างบน
        // ซึ่งเป็นเวลาที่คำนวณ run
        runObservedAt: this.readMeta("exposureObservedAt"),
        stations: Number(this.readMeta("exposureStationCount") ?? "0"),
        historyWindowH: DEFAULT_EXPOSURE_THRESHOLDS.historyWindowH,
      },
      staleAfterSeconds: EXPOSURE_STALE_AFTER_MS / 1000,
      observedLagSeconds: EXPOSURE_RUN_LAG_MS / 1000,
      nextAttemptAt: alarmAtMs === null ? null : new Date(alarmAtMs).toISOString(),
    };
  }

  /** Backs GET /api/v1/health. */
  async status(): Promise<SourceStatus> {
    const nowMs = Date.now();
    const fetchedAt = this.readMeta("fetchedAt");
    /**
     * `damsError` ต้องถูกรวมเข้ากับ `lastError` ไม่ใช่ซ่อนไว้ใน `detail`:
     * SourceStatusBar แสดงแค่ `health` กับ `lastError` ฟีดเขื่อนที่พังจึงจะ
     * มองไม่เห็นเลยถ้าปล่อยไว้ใน detail อย่างเดียว
     */
    const lastError =
      [this.readMeta("lastError"), this.readMeta("damsError") && `dams: ${this.readMeta("damsError")}`]
        .filter(Boolean)
        .join("; ")
        .slice(0, 300) || null;
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
    const health = deriveSourceHealth({
      nowMs,
      fetchedAt,
      lastError,
      latestObservedAt: latest,
      staleAfterSeconds: STALE_AFTER_MS / 1000,
      observedLagSeconds: OBSERVED_LAG_MS / 1000,
      // pausedUntilMs คืน 0 เมื่อไม่ได้ถูกพัก (ไม่ใช่ null)
      extraDegraded: this.upstream.pausedUntilMs > 0,
    });
    const alarmAtMs = await this.ctx.storage.getAlarm();
    return {
      id: "thaiwater",
      labelTh: SOURCES.thaiwater.nameTh,
      labelEn: SOURCES.thaiwater.nameEn,
      health,
      fetchedAt,
      latestObservedAt: latest,
      lastAttemptAt: this.readMeta("lastAttemptAt"),
      lastError,
      detail: {
        rainfallStations: rainCount,
        waterlevelStations: waterCount,
        consecutiveFailures: Number(this.readMeta("consecutiveFailures") ?? "0"),
        upstreamQueue: this.upstream.length,
        upstreamInflight: this.upstream.inflight,
        upstreamStartsLastMinute: this.upstream.startsLastMinute(),
        upstreamStartsLastHour: this.upstream.startsLastHour(),
        upstreamPausedUntil: this.upstream.pausedUntilMs ? new Date(this.upstream.pausedUntilMs).toISOString() : null,
        archiveLastDay: this.readMeta("lastArchivedDay"),
        snapshotLastHour: this.readMeta("lastSnapshotKey"),
        archiveError: this.readMeta("archiveError"),
        damsError: this.readMeta("damsError"),
      },
      staleAfterSeconds: STALE_AFTER_MS / 1000,
      observedLagSeconds: OBSERVED_LAG_MS / 1000,
      nextAttemptAt: alarmAtMs === null ? null : new Date(alarmAtMs).toISOString(),
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
      // เช่นเดียวกับอีกสองจุด: `armAlarm()` อยู่ใน finally และถูก await จริง
      // (เดิมเป็น `void` ลอย ๆ ข้อผิดพลาดของมันจึงหายไปเงียบ ๆ)
      try {
        await this.refreshOnce(nowMs);
      } finally {
        await this.armAlarm();
      }
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

    if (historical && atMs < nowMs - HOT_WINDOW_MS) {
      // Beyond the hot window: read the province-day archive file(s).
      rainfall.length = 0;
      const day = bangkokDay(atMs);
      const files = province
        ? [await this.archivedDay(day, province), atMs - dayStartMs(day) < SNAPSHOT_TOLERANCE_MS ? await this.archivedDay(addDays(day, -1), province) : null]
        : [];
      const latest = new Map<number, { t: number; v: number | null; datum: string }>();
      for (const f of files) {
        if (!f) continue;
        for (const st of f.stations) {
          for (const [t, v] of st.points) {
            if (t <= atMs && t >= atMs - SNAPSHOT_TOLERANCE_MS) {
              const cur = latest.get(st.stationId);
              if (!cur || t > cur.t) latest.set(st.stationId, { t, v, datum: st.datum });
            }
          }
        }
      }
      waterlevel = waterlevel.flatMap((w) => {
        const p = latest.get(w.station.id);
        if (!p || p.v === null) return [];
        const msl = p.datum === "msl" ? p.v : null;
        return [
          {
            ...w,
            waterlevelMsl: msl,
            waterlevelLocalM: p.datum === "local" ? p.v : null,
            freeboardM: msl !== null && w.minBankMsl !== null ? Math.round((w.minBankMsl - msl) * 1000) / 1000 : null,
            situationLevel: null,
            storagePercent: null,
            observedAt: new Date(p.t).toISOString(),
          },
        ];
      });
    } else if (historical) {
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
      // ThaiWater ส่งมาแต่เวลาที่ตรวจวัด ไม่มีเวลาเผยแพร่ของชุดข้อมูล → null ตามจริง
      publishedAt: null,
      fetchedAt,
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
        sourceAttribution: SOURCES.thaiwater.attributionText,
      },
      rainfall,
      waterlevel,
    };
  }
}
