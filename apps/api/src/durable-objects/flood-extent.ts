import { DurableObject } from "cloudflare:workers";
import type {
  FloodExtentFeature,
  FloodExtentProvinceSummary,
  FloodExtentResponse,
  FloodExtentSummaryResponse,
  HazardLayerDescriptor,
  SourceStatus,
} from "@siahra/shared-types";
import { fetchGistdaFloodExtent } from "../ingestion/gistda.js";

/** GISTDA re-interprets scenes irregularly; half-hourly polling is plenty. */
const REFRESH_MS = 30 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
/** No successful pull for this long => stale (the scene itself may be older). */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
/** Polygons that vanish from the scene are kept this long as history. */
const HISTORY_MS = 30 * 24 * 60 * 60 * 1000;

interface FeatureRow extends Record<string, SqlStorageValue> {
  id: string;
  province_code: string | null;
  geom: string;
  props: string;
  first_seen_ms: number;
  last_seen_ms: number;
}

interface MetaRow extends Record<string, SqlStorageValue> {
  value: string;
}

/**
 * Cache + change tracker for the GISTDA flood-extent scene. Because the
 * upstream features carry no timestamp, this DO records when each polygon
 * was first and last observed in a successful pull; a scene that fails to
 * load keeps the previous set and marks the source stale rather than
 * showing an empty map that could be misread as "no flooding".
 */
export class FloodExtentDO extends DurableObject<Env> {
  private inflight: Promise<boolean> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS flood_features (
          id TEXT PRIMARY KEY,
          province_code TEXT,
          geom TEXT NOT NULL,
          props TEXT NOT NULL,
          first_seen_ms INTEGER NOT NULL,
          last_seen_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_flood_province ON flood_features(province_code);
        CREATE INDEX IF NOT EXISTS idx_flood_last_seen ON flood_features(last_seen_ms);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
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
    if (value === null) this.ctx.storage.sql.exec("DELETE FROM meta WHERE key = ?", key);
    else
      this.ctx.storage.sql.exec(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        key,
        value,
      );
  }

  private retrievedMs(): number | null {
    const v = this.readMeta("retrievedAt");
    return v ? Date.parse(v) : null;
  }

  private async armAlarm(delay = REFRESH_MS): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== null && existing > Date.now()) return;
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }

  async alarm(): Promise<void> {
    const ok = await this.refreshOnce();
    await this.armAlarm(ok ? REFRESH_MS : RETRY_MS);
  }

  /** Refresh if never fetched or older than REFRESH_MS; arms the alarm. */
  async ensureFresh(): Promise<void> {
    const r = this.retrievedMs();
    if (r === null || Date.now() - r > REFRESH_MS) await this.refreshOnce();
    await this.armAlarm();
  }

  private refreshOnce(): Promise<boolean> {
    if (!this.inflight) {
      this.inflight = this.refresh().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async refresh(): Promise<boolean> {
    const nowMs = Date.now();
    this.writeMeta("lastAttemptAt", new Date(nowMs).toISOString());
    let features;
    try {
      features = await fetchGistdaFloodExtent();
    } catch (err) {
      this.writeMeta("lastError", String(err).slice(0, 300));
      console.error(
        JSON.stringify({ level: "error", message: "gistda flood fetch failed", error: String(err) }),
      );
      return false;
    }
    // Upsert: new ids get first_seen = now, known ids just bump last_seen.
    for (const f of features) {
      this.ctx.storage.sql.exec(
        `INSERT INTO flood_features (id, province_code, geom, props, first_seen_ms, last_seen_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_seen_ms = excluded.last_seen_ms, props = excluded.props`,
        f.id,
        f.provinceCode,
        JSON.stringify(f.geometry),
        JSON.stringify(f.props),
        nowMs,
        nowMs,
      );
    }
    this.ctx.storage.sql.exec("DELETE FROM flood_features WHERE last_seen_ms < ?", nowMs - HISTORY_MS);
    this.writeMeta("retrievedAt", new Date(nowMs).toISOString());
    this.writeMeta("lastError", null);
    this.writeMeta("featureCount", String(features.length));
    console.log(
      JSON.stringify({ level: "info", message: "gistda flood refreshed", features: features.length }),
    );
    return true;
  }

  private layer(retrievedAt: string | null): HazardLayerDescriptor {
    return {
      id: "gistda-flood-extent",
      epistemicClass: "observed",
      liveOrStatic: "live",
      fetchedAt: retrievedAt ?? new Date().toISOString(),
      staleAfterSeconds: STALE_AFTER_MS / 1000,
      methodologyUrl: "https://opendata.gistda.or.th/dataset/floodcheck",
      sourceIds: ["gistda-wfs-flooding_vis"],
    };
  }

  private rowToFeature(r: FeatureRow): FloodExtentFeature {
    return {
      type: "Feature",
      id: r.id,
      properties: {
        ...(JSON.parse(r.props) as Omit<FloodExtentFeature["properties"], "firstSeenAt" | "lastSeenAt">),
        firstSeenAt: new Date(r.first_seen_ms).toISOString(),
        lastSeenAt: new Date(r.last_seen_ms).toISOString(),
      },
      geometry: JSON.parse(r.geom) as FloodExtentFeature["geometry"],
    };
  }

  /** Features present in the most recent successful scene, for one province. */
  async getProvince(provinceCode: string): Promise<FloodExtentResponse> {
    await this.ensureFresh();
    const retrievedAt = this.readMeta("retrievedAt");
    const r = this.retrievedMs();
    const rows = r
      ? this.ctx.storage.sql
          .exec<FeatureRow>(
            "SELECT * FROM flood_features WHERE province_code = ? AND last_seen_ms >= ?",
            provinceCode,
            r,
          )
          .toArray()
      : [];
    return {
      layer: this.layer(retrievedAt),
      retrievedAt,
      provinceCode,
      features: rows.map((row) => this.rowToFeature(row)),
    };
  }

  async getSummary(): Promise<FloodExtentSummaryResponse> {
    await this.ensureFresh();
    const retrievedAt = this.readMeta("retrievedAt");
    const r = this.retrievedMs();
    const rows = r
      ? this.ctx.storage.sql
          .exec<FeatureRow>("SELECT * FROM flood_features WHERE last_seen_ms >= ?", r)
          .toArray()
      : [];
    const byProvince = new Map<string, FloodExtentProvinceSummary>();
    for (const row of rows) {
      const f = this.rowToFeature(row);
      const code = f.properties.provinceCode ?? "??";
      const acc = byProvince.get(code) ?? {
        provinceCode: code,
        provinceTh: f.properties.provinceTh,
        tambonCount: 0,
        floodAreaRai: 0,
        houses: 0,
      };
      acc.tambonCount++;
      acc.floodAreaRai += f.properties.floodAreaRai ?? 0;
      acc.houses += f.properties.houses ?? 0;
      byProvince.set(code, acc);
    }
    return {
      layer: this.layer(retrievedAt),
      retrievedAt,
      totalFeatures: rows.length,
      provinces: [...byProvince.values()].sort((a, b) => b.floodAreaRai - a.floodAreaRai),
    };
  }

  async status(): Promise<SourceStatus> {
    const retrievedAt = this.readMeta("retrievedAt");
    const lastError = this.readMeta("lastError");
    const age = retrievedAt ? Date.now() - Date.parse(retrievedAt) : Infinity;
    const health = !retrievedAt
      ? lastError
        ? "down"
        : "unknown"
      : age > STALE_AFTER_MS
        ? "stale"
        : lastError
          ? "degraded"
          : "ok";
    return {
      id: "gistda-flood",
      labelTh: "น้ำท่วมจากภาพดาวเทียม (GISTDA)",
      health,
      fetchedAt: retrievedAt,
      latestObservedAt: null,
      lastAttemptAt: this.readMeta("lastAttemptAt"),
      lastError,
      detail: { features: Number(this.readMeta("featureCount") ?? "0") },
      staleAfterSeconds: STALE_AFTER_MS / 1000,
    };
  }
}
