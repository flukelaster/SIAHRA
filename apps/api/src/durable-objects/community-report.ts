import { DurableObject } from "cloudflare:workers";
import {
  COMMUNITY_REPORT_CAP_PER_DAY,
  COMMUNITY_RETENTION_DAYS,
  COMMUNITY_VOTE_CAP_PER_DAY,
  isAutoHidden,
  type CommunityCategory,
  type CommunityReport,
  type CommunityReportsResponse,
  type CommunityVoteResponse,
  type CommunityVoteValue,
  type HazardLayerDescriptor,
} from "@siahra/shared-types";
import { imageUrlFor } from "../community/validate.js";
import { META_TABLE_DDL, readMeta, writeMeta } from "./metaKv.js";
import { errorText, logError, logInfo } from "../log.js";

/**
 * รายงานผลกระทบจากประชาชน — หนึ่ง instance ชื่อ `"primary"` ทั้งประเทศ (SQLite)
 *
 * ข้อบังคับต้นทุนจาก devops (บิล 2026-08-18..23 = rows *scanned*) ที่ไฟล์นี้ต้องถือ:
 *
 * 1. **ทุกคำสั่งต่อคำขอใช้ดัชนี** — รายการรายจังหวัดอ่านผ่าน `idx_reports_province_hidden_created`
 *    (ไม่มี TEMP B-TREE), `hiddenCount` เป็น COVERING INDEX ของดัชนีเดียวกัน, ต่อรายงานอ่านด้วย PK,
 *    retention อ่านผ่าน `idx_reports_created` — `ALLOWED_SCANS` ไม่มีรายการของ DO นี้เลย (SQL-1..3)
 * 2. **memo ในหน่วยความจำ** `Map<provinceCode, {body, expiresAtMs}>` อายุ ≤ 30 วิ — SELECT + COUNT
 *    วิ่งเฉพาะตอน memo หมดอายุ/ถูกล้าง ไม่ใช่ต่อคำขอ และการเขียนทุกแบบล้าง entry ของจังหวัดนั้น (SQL-4)
 * 3. **เพดานรายวันอยู่ในแถว meta เดียว** `caps` = `{date, uploads, votes}` เขียนทับ ไม่มีคีย์ต่อวัน (SQL-6)
 * 4. **โหวตที่ไม่เปลี่ยนอะไรเขียน 0 แถว**; โหวตที่เปลี่ยน = ≤ 1 แถว votes + UPDATE reports 1 ครั้ง + caps 1 แถว
 *    (VOTE-2) ตัวนับ up/down เก็บซ้ำบนแถว report — ไม่มี COUNT ต่อโหวต
 * 5. **alarm รายชั่วโมงเฉพาะตอนมีแถว** — ตั้งตอนสร้างรายงานเมื่อยังไม่มีนัด และตั้งต่อเฉพาะเมื่อ
 *    `MIN(created_ms)` ไม่เป็น null (ALARM-1) ไม่มี cron ใหม่
 * 6. **ไม่มี setTimeout/WebSocket/fetch ภายนอก** — I/O มีแค่ SQL และ `HAZARD_BUCKET` (DO-1) การตรวจ
 *    Turnstile/HMAC ทั้งหมดอยู่ที่ Worker ก่อนเรียก DO
 *
 * ไม่มี IP ไม่มีตัวตนของผู้ส่ง: votes เก็บ `voter_id` สุ่มที่ Worker ลงนามแล้ว, ownerToken ไม่ถูกเก็บ
 * (Worker คำนวณ HMAC ซ้ำตอนตรวจ)
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const RETENTION_MS = COMMUNITY_RETENTION_DAYS * DAY_MS;
/** อายุของ memo รายจังหวัด — เท่ากับ s-maxage ของแคชขอบ (devops SQL-4: ≤ 30 วิ) */
export const MEMO_TTL_MS = 30_000;
/** batch ของ retention — ≤ 1000 ตาม `HAZARD_BUCKET.delete(keys[])` ที่รับได้ต่อครั้ง (SQL-5) */
const RETENTION_BATCH = 1000;
/** กันลูปไม่จบในรอบเดียว — 10 × 1000 เกินเพดาน 500/วันไปมาก ที่เหลือไปรอบชั่วโมงถัดไป */
const RETENTION_MAX_BATCHES = 10;
/** เพดานรายวันนับตามวันของประเทศไทย (UTC+7) — รีเซ็ตเที่ยงคืนเวลาไทย ไม่ใช่ 07:00 */
const CAP_TZ_OFFSET_MS = 7 * HOUR_MS;
const STALE_AFTER_SECONDS = 600;

/** moderation (ค่าตั้งต้นของคอลัมน์ = 0): 0 = ไม่มีผู้ดูแลแตะ (ซ่อนตามโหวต), 1 = ผู้ดูแลซ่อน, 2 = ผู้ดูแลยืนยันให้แสดง (โหวตไม่ซ่อนอีก) */
const MOD_HIDDEN = 1;
const MOD_SHOWN = 2;

interface ReportRow extends Record<string, SqlStorageValue> {
  id: string;
  province_code: string;
  lat: number;
  lon: number;
  categories: string;
  description: string;
  image_key: string | null;
  created_ms: number;
  up: number;
  down: number;
}

interface StateRow extends Record<string, SqlStorageValue> {
  province_code: string;
  image_key: string | null;
  up: number;
  down: number;
  hidden: number;
  moderation: number;
}

interface Caps {
  date: string;
  uploads: number;
  votes: number;
}

/** แถวที่ Worker ตรวจแล้วทุกฟิลด์ (DO เข้าถึงจากภายนอกไม่ได้ — เชื่อ Worker) */
export interface NewReport {
  id: string;
  provinceCode: string;
  lat: number;
  lon: number;
  categories: CommunityCategory[];
  description: string;
  imageKey: string | null;
  createdMs: number;
}

export type InsertResult = { ok: true; report: CommunityReport } | { ok: false; reason: "report-cap" };
export type VoteResult =
  | ({ ok: true } & CommunityVoteResponse)
  | { ok: false; reason: "not-found" | "vote-cap" };

function capDate(nowMs: number): string {
  return new Date(nowMs + CAP_TZ_OFFSET_MS).toISOString().slice(0, 10);
}

function effectiveHidden(moderation: number, up: number, down: number): number {
  if (moderation === MOD_HIDDEN) return 1;
  if (moderation === MOD_SHOWN) return 0;
  return isAutoHidden(up, down) ? 1 : 0;
}

function toReport(r: ReportRow): CommunityReport {
  let categories: CommunityCategory[] = [];
  try {
    categories = JSON.parse(r.categories) as CommunityCategory[];
  } catch {
    // แถวที่เราเขียนเองเป็น JSON เสมอ — อ่านไม่ออกก็ยังแสดงหมุดได้ ไม่ทิ้งทั้งรายการ
  }
  return {
    id: r.id,
    lat: r.lat,
    lon: r.lon,
    provinceCode: r.province_code,
    categories,
    description: r.description,
    imageUrl: r.image_key ? imageUrlFor(r.id) : null,
    createdAt: new Date(r.created_ms).toISOString(),
    up: r.up,
    down: r.down,
  };
}

/**
 * descriptor ของชั้น — `crowdsourced` (ไม่ใช่ observed: ไม่มีเครื่องมือวัด), `fetchedAt` = เวลาที่ DO อ่าน
 * รายการนี้จากฐานข้อมูลของเราเอง, `publishedAt: null` (ไม่มีต้นทางใดเผยแพร่)
 */
function layerFor(fetchedAt: string): HazardLayerDescriptor {
  return {
    id: "community-reports",
    epistemicClass: "crowdsourced",
    liveOrStatic: "live",
    publishedAt: null,
    fetchedAt,
    staleAfterSeconds: STALE_AFTER_SECONDS,
    sourceIds: ["community-report"],
  };
}

export class CommunityReportDO extends DurableObject<Env> {
  private readonly memo = new Map<string, { body: CommunityReportsResponse; expiresAtMs: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS reports (
          id TEXT PRIMARY KEY,
          province_code TEXT NOT NULL,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          categories TEXT NOT NULL,
          description TEXT NOT NULL,
          image_key TEXT,
          created_ms INTEGER NOT NULL,
          up INTEGER NOT NULL DEFAULT 0,
          down INTEGER NOT NULL DEFAULT 0,
          hidden INTEGER NOT NULL DEFAULT 0,
          moderation INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_reports_province_hidden_created ON reports(province_code, hidden, created_ms);
        CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_ms);
        CREATE TABLE IF NOT EXISTS votes (
          report_id TEXT NOT NULL,
          voter_id TEXT NOT NULL,
          value INTEGER NOT NULL,
          PRIMARY KEY(report_id, voter_id)
        ) WITHOUT ROWID;
        ${META_TABLE_DDL}
      `);
    });
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private readCaps(nowMs: number): Caps {
    const date = capDate(nowMs);
    const raw = readMeta(this.sql, "caps");
    if (raw) {
      try {
        const c = JSON.parse(raw) as Partial<Caps>;
        if (c.date === date && typeof c.uploads === "number" && typeof c.votes === "number") {
          return { date, uploads: c.uploads, votes: c.votes };
        }
      } catch {
        // แถวพัง = เริ่มนับวันนี้ใหม่ (เขียนทับในการเขียนครั้งถัดไป)
      }
    }
    return { date, uploads: 0, votes: 0 };
  }

  private writeCaps(caps: Caps): void {
    writeMeta(this.sql, "caps", JSON.stringify(caps));
  }

  private readState(id: string): StateRow | undefined {
    return this.sql
      .exec<StateRow>("SELECT province_code, image_key, up, down, hidden, moderation FROM reports WHERE id = ?", id)
      .toArray()[0];
  }

  /**
   * จองหนึ่งที่ในเพดานรายงานของวันนี้ — Worker เรียกก่อน `HAZARD_BUCKET.put` ของรูป (REPORT-1)
   * ที่จองแล้วไม่คืนแม้ put/insert จะล้มเหลวภายหลัง: เพดานคือเกราะกันการใช้ในทางที่ผิด ไม่ใช่บัญชี
   */
  async reserveUpload(nowMs: number = Date.now()): Promise<boolean> {
    const caps = this.readCaps(nowMs);
    if (caps.uploads >= COMMUNITY_REPORT_CAP_PER_DAY) return false;
    this.writeCaps({ ...caps, uploads: caps.uploads + 1 });
    return true;
  }

  /**
   * เขียนแถวรายงาน — `reserve: true` = ตรวจ+จองเพดานในคำขอเดียวกัน (รายงานไม่มีรูป = DO call เดียว)
   * `reserve: false` = จองไปแล้วด้วย `reserveUpload()` ก่อน put รูป (รายงานมีรูป = DO call ที่สอง ซึ่ง
   * ถูกเรียกหลัง put สำเร็จเท่านั้น — จึงไม่มีแถวที่ชี้ไปหา object ที่ไม่มีอยู่)
   */
  async insertReport(row: NewReport, reserve: boolean): Promise<InsertResult> {
    if (reserve && !(await this.reserveUpload(row.createdMs))) return { ok: false, reason: "report-cap" };
    this.sql.exec(
      "INSERT INTO reports (id, province_code, lat, lon, categories, description, image_key, created_ms, up, down, hidden, moderation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0)",
      row.id,
      row.provinceCode,
      row.lat,
      row.lon,
      JSON.stringify(row.categories),
      row.description,
      row.imageKey,
      row.createdMs,
    );
    this.memo.delete(row.provinceCode);
    // ALARM-1: ตั้งนัด retention เฉพาะเมื่อยังไม่มี — ไม่เลื่อนนัดที่มีอยู่
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + HOUR_MS);
    logInfo("community report created", { province: row.provinceCode, image: row.imageKey !== null });
    return {
      ok: true,
      report: toReport({
        id: row.id,
        province_code: row.provinceCode,
        lat: row.lat,
        lon: row.lon,
        categories: JSON.stringify(row.categories),
        description: row.description,
        image_key: row.imageKey,
        created_ms: row.createdMs,
        up: 0,
        down: 0,
      }),
    };
  }

  /**
   * รายการรายจังหวัด — memo ≤ 30 วิ; ตอนคำนวณใหม่ = SELECT หนึ่ง + COUNT หนึ่ง ทั้งคู่ผ่านดัชนีเดียวกัน
   * `fetchedAt` = เวลาที่อ่านจริง (ไม่ใช่เวลาที่คำขอนี้มาถึง ถ้าตอบจาก memo)
   */
  async list(provinceCode: string): Promise<CommunityReportsResponse> {
    const nowMs = Date.now();
    const hit = this.memo.get(provinceCode);
    if (hit && hit.expiresAtMs > nowMs) return hit.body;
    const since = nowMs - RETENTION_MS;
    const rows = this.sql
      .exec<ReportRow>(
        "SELECT id, province_code, lat, lon, categories, description, image_key, created_ms, up, down FROM reports WHERE province_code = ? AND hidden = 0 AND created_ms > ? ORDER BY created_ms DESC LIMIT 500",
        provinceCode,
        since,
      )
      .toArray();
    const hiddenCount = this.sql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM reports WHERE province_code = ? AND hidden = 1 AND created_ms > ?",
        provinceCode,
        since,
      )
      .one().n;
    const fetchedAt = new Date(nowMs).toISOString();
    const body: CommunityReportsResponse = {
      fetchedAt,
      reports: rows.map(toReport),
      hiddenCount,
      layer: layerFor(fetchedAt),
    };
    this.memo.set(provinceCode, { body, expiresAtMs: nowMs + MEMO_TTL_MS });
    return body;
  }

  /**
   * หนึ่งโหวตของ `voterId` (Worker ตรวจลายเซ็นแล้ว) — `0` = ถอนเสียง
   *
   * - ค่าเท่าเดิม (หรือ 0 โดยไม่เคยโหวต) → คืนตัวนับปัจจุบัน **เขียน 0 แถว** และไม่นับเข้าเพดาน
   * - เกินเพดานรายวันทั้งประเทศ → `vote-cap` เขียน 0 แถว
   * - อย่างอื่น → votes ≤ 1 แถว + UPDATE reports 1 ครั้ง + caps 1 แถว
   */
  async vote(reportId: string, voterId: string, value: CommunityVoteValue, nowMs: number = Date.now()): Promise<VoteResult> {
    const state = this.readState(reportId);
    if (!state) return { ok: false, reason: "not-found" };
    const prev =
      this.sql
        .exec<{ value: number }>("SELECT value FROM votes WHERE report_id = ? AND voter_id = ?", reportId, voterId)
        .toArray()[0]?.value ?? 0;
    if (prev === value) return { ok: true, up: state.up, down: state.down, hidden: state.hidden === 1 };

    const caps = this.readCaps(nowMs);
    if (caps.votes >= COMMUNITY_VOTE_CAP_PER_DAY) return { ok: false, reason: "vote-cap" };

    const up = state.up - (prev === 1 ? 1 : 0) + (value === 1 ? 1 : 0);
    const down = state.down - (prev === -1 ? 1 : 0) + (value === -1 ? 1 : 0);
    const hidden = effectiveHidden(state.moderation, up, down);
    if (value === 0) {
      this.sql.exec("DELETE FROM votes WHERE report_id = ? AND voter_id = ?", reportId, voterId);
    } else {
      this.sql.exec(
        "INSERT INTO votes (report_id, voter_id, value) VALUES (?, ?, ?) ON CONFLICT(report_id, voter_id) DO UPDATE SET value = excluded.value",
        reportId,
        voterId,
        value,
      );
    }
    this.sql.exec("UPDATE reports SET up = ?, down = ?, hidden = ? WHERE id = ?", up, down, hidden, reportId);
    this.writeCaps({ ...caps, votes: caps.votes + 1 });
    this.memo.delete(state.province_code);
    return { ok: true, up, down, hidden: hidden === 1 };
  }

  /**
   * ผู้ดูแลซ่อน/เลิกซ่อน — รูปใน R2 **คงไว้** (เลิกซ่อนต้องกลับมาครบ) ต่างจากการลบ
   * เลิกซ่อน = ยืนยันให้แสดง: โหวตลงหลังจากนี้ไม่ซ่อนอัตโนมัติอีก (ผู้ดูแลดูแล้ว)
   */
  async moderate(reportId: string, action: "hide" | "unhide"): Promise<CommunityVoteResponse | null> {
    const state = this.readState(reportId);
    if (!state) return null;
    const moderation = action === "hide" ? MOD_HIDDEN : MOD_SHOWN;
    const hidden = effectiveHidden(moderation, state.up, state.down);
    this.sql.exec("UPDATE reports SET hidden = ?, moderation = ? WHERE id = ?", hidden, moderation, reportId);
    this.memo.delete(state.province_code);
    return { up: state.up, down: state.down, hidden: hidden === 1 };
  }

  /**
   * ลบรายงาน (เจ้าของหรือผู้ดูแล — Worker ตรวจสิทธิ์แล้ว): แถวก่อน แล้วค่อยรูป — ถ้าลบรูปพลาด
   * เหลือ object กำพร้าที่ไม่มีแถวชี้ (lifecycle rule 30 วันของ R2 เก็บกวาด) ไม่ใช่แถวที่ชี้หารูปที่หายไป
   */
  async deleteReport(reportId: string): Promise<boolean> {
    const state = this.readState(reportId);
    if (!state) return false;
    this.sql.exec("DELETE FROM votes WHERE report_id = ?", reportId);
    this.sql.exec("DELETE FROM reports WHERE id = ?", reportId);
    this.memo.delete(state.province_code);
    if (state.image_key) {
      try {
        await this.env.HAZARD_BUCKET.delete(state.image_key);
      } catch (err) {
        logError("community image delete failed", { error: errorText(err) });
      }
    }
    return true;
  }

  /**
   * retention รายชั่วโมง: ทีละ batch ≤ 1000 ผ่าน `idx_reports_created` → `HAZARD_BUCKET.delete(keys[])`
   * หนึ่งครั้งต่อ batch → ลบ votes รายรายงาน (PK prefix) → ลบแถวรายงาน
   *
   * ลบรูปก่อนแถว: ถ้า R2 พัง แถวยังอยู่และถูกลองใหม่ชั่วโมงหน้า (แถวที่อายุเกิน 30 วันไม่อยู่ในรายการ
   * อยู่แล้ว จึงไม่มีใครเห็นแถวที่รูปหายไป) ตั้งนัดต่อเฉพาะเมื่อยังมีแถวเหลือ (ALARM-1)
   */
  async alarm(): Promise<void> {
    const nowMs = Date.now();
    const cutoff = nowMs - RETENTION_MS;
    let deleted = 0;
    let images = 0;
    let failure: string | null = null;
    for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch++) {
      const rows = this.sql
        .exec<{ id: string; image_key: string | null }>(
          "SELECT id, image_key FROM reports WHERE created_ms < ? LIMIT ?",
          cutoff,
          RETENTION_BATCH,
        )
        .toArray();
      if (rows.length === 0) break;
      const keys = rows.map((r) => r.image_key).filter((k): k is string => typeof k === "string");
      if (keys.length > 0) {
        try {
          await this.env.HAZARD_BUCKET.delete(keys);
        } catch (err) {
          failure = errorText(err);
          break;
        }
      }
      for (const r of rows) {
        this.sql.exec("DELETE FROM votes WHERE report_id = ?", r.id);
        this.sql.exec("DELETE FROM reports WHERE id = ?", r.id);
      }
      deleted += rows.length;
      images += keys.length;
      if (rows.length < RETENTION_BATCH) break;
    }
    // retention กวาดได้หลายจังหวัดในรอบเดียว — ล้าง memo ทั้งก้อน (ชั่วโมงละครั้ง ไม่ใช่ต่อคำขอ)
    if (deleted > 0) this.memo.clear();
    const oldest = this.sql.exec<{ t: number | null }>("SELECT MIN(created_ms) AS t FROM reports").one().t;
    if (oldest !== null) await this.ctx.storage.setAlarm(nowMs + HOUR_MS);
    if (failure !== null) logError("community retention failed", { deleted, error: failure });
    else logInfo("community retention", { deleted, images, remaining: oldest !== null });
  }
}
