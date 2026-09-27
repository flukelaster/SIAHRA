import { DurableObject } from "cloudflare:workers";
import { SOURCES, type RadarFramesResponse, type SourceStatus } from "@siahra/shared-types";
import {
  RADAR_GEOREFERENCES,
  RadarFrameNotServedError,
  fetchRadarFrame,
  fetchRadarIndex,
  radarProjectionAt,
  type RadarSlot,
} from "../ingestion/tmdRadar.js";
import { UpstreamShapeError } from "../ingestion/errors.js";
import { radarFrameProjection } from "../ingestion/schemas/radar.js";
import { deriveSourceHealth } from "../sourceHealth.js";
import { errorText, logInfo, logWarn } from "../log.js";

const REFRESH_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 1000;
/**
 * เพดานอายุของ "เฟรมใหม่สุด" ก่อนถือว่า `delayed` — ต้นทางผลิตเฟรมทุก 15 นาที
 * (วัดจริง 2026-08-19: ดัชนีเป็นกริด :00/:15/:30/:45 และมี 90 เฟรมใน 24 ชม.
 * จาก 96 ช่อง คือหายเป็นครั้งคราว) และเผยแพร่ช้ากว่าเวลาเฟรมราว 40 นาที
 * 90 นาที = ค่าที่โค้ดเดิมใช้เทียบกับอายุเฟรมอยู่แล้ว ครอบคลุมช่องที่หายติดกัน
 * สองสามช่องโดยไม่แจ้งเตือนผิด — งานนี้เพียงเรียกมันด้วยชื่อที่ตรงความหมาย
 */
const OBSERVED_LAG_MS = 90 * 60 * 1000;
/**
 * เพดานของ "รอบดึงที่สำเร็จ" (คนละเรื่องกับอายุเฟรม) — รีเฟรชทุก 5 นาที ลองใหม่
 * ทุก 1 นาทีเมื่อพลาด ดังนั้นเงียบเกิน 15 นาที = พลาดสามรอบติด ถือว่า `stale`
 */
const FETCH_STALE_AFTER_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Frames older than this are dropped from R2 and the index. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const R2_PREFIX = "radar/tmd-composite/";

interface FrameRow extends Record<string, SqlStorageValue> {
  ts_ms: number;
  key: string;
}
interface MetaRow extends Record<string, SqlStorageValue> {
  value: string;
}

/** เฟรมใหม่สุดที่เก็บไว้แล้ว — meta `newestFrameSha` เก็บเป็น `"<tsMs>:<sha256 hex>"` ค่าเดียว */
interface NewestFrame {
  tsMs: number;
  sha: string;
}

function parseNewestFrame(value: string | null): NewestFrame | null {
  const m = value ? /^(\d+):([0-9a-f]{64})$/.exec(value) : null;
  return m ? { tsMs: Number(m[1]), sha: m[2] } : null;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Keeps a rolling archive of TMD radar composite frames. Because the source
 * overwrites its image files in place, every poll reads the file→time index,
 * downloads any new frame, re-reads the index once to confirm the file still
 * maps to the same time, and only then copies it into R2 keyed by its
 * timestamp — so a frame is never mislabelled and history survives past 6 hours.
 */
export class RadarDO extends DurableObject<Env> {
  private inflight: Promise<boolean> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS frames (ts_ms INTEGER PRIMARY KEY, key TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
    });
  }

  private readMeta(key: string): string | null {
    return this.ctx.storage.sql.exec<MetaRow>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value ?? null;
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

  private async armAlarm(delay = REFRESH_MS): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== null && existing > Date.now()) return;
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }

  async alarm(): Promise<void> {
    const ok = await this.refreshOnce();
    await this.armAlarm(ok ? REFRESH_MS : RETRY_MS);
  }

  async ensureFresh(): Promise<void> {
    const f = this.readMeta("fetchedAt");
    if (!f || Date.now() - Date.parse(f) > REFRESH_MS) await this.refreshOnce();
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
    let index;
    try {
      index = await fetchRadarIndex();
    } catch (err) {
      this.writeMeta("lastError", String(err).slice(0, 200));
      return false;
    }
    const slots = index.slots;
    // ต้นทางบอกเวลาเผยแพร่มาบ้างไม่บอกบ้าง — ไม่บอกคือ null ไม่ใช่เวลาเดิมที่ค้างอยู่
    this.writeMeta("publishedAt", index.publishedAt);
    let added = 0;
    /**
     * เฟรมที่ตรวจไม่ผ่าน/โหลดไม่ได้ ต้อง "ข้ามแล้วมองเห็น" ไม่ใช่ข้ามเงียบ ๆ
     * ตัวนับใน `detail` อย่างเดียวไม่พอ เพราะ SourceStatusBar แสดงเฉพาะ `health`
     * กับ `lastError` — ถ้าไม่ตั้ง lastError ผู้ใช้จะไม่รู้อะไรเลยจนกว่าเฟรมที่
     * ยังเก็บไว้จะเก่าจนกลายเป็น stale ไปเอง (E4.4 AC 3)
     */
    const skipped: string[] = [];
    const skippedDetail: string[] = [];
    /**
     * สองกรณีที่ "ไม่ใช่ความล้มเหลว" จึงไม่ลง lastError — นับไว้ใน `detail` แทน:
     * - `notServed`: TMD ลงเวลาไว้ในดัชนีแต่ตอบ 404 ให้ภาพ (ต้นทางไม่ได้ให้บริการ
     *   ภาพนั้น ไม่ใช่เราถามไม่ได้) — ถ้าเป็นช่องใหม่สุด ความล่าช้าจะโผล่เองผ่าน
     *   `latestObservedAt` ตามเดิม ไม่ถูกซ่อน
     * - `rotated`: ชื่อไฟล์ถูกใช้ซ้ำกับเวลาใหม่ระหว่างที่เราโหลด จึงยืนยันไม่ได้ว่า
     *   ภาพที่ได้คือเวลาไหน — ทิ้งไป รอบหน้าลองใหม่
     */
    const notServed: string[] = [];
    const rotated: string[] = [];
    /**
     * ชื่อไฟล์แบบใหม่ (`zr/24.png`) เป็นหน้าต่างเลื่อนที่ถูกใช้ซ้ำทุก 15 นาที
     * ภาพที่โหลดมาจึงถือไว้ในหน่วยความจำก่อน แล้วอ่านดัชนีซ้ำ "ครั้งเดียว" หลังโหลด
     * ครบ — เก็บเฉพาะเฟรมที่ดัชนีรอบสองยังชี้ชื่อไฟล์เดิมไปที่เวลาเดิม ไม่มีการ put
     * แล้วค่อยลบทีหลัง
     */
    const downloaded: { slot: RadarSlot; png: ArrayBuffer }[] = [];
    const seenTs = new Set<number>();
    for (const slot of slots) {
      // สองบรรทัดที่เวลาเดียวกัน = ช่องเดียว ยิงภาพครั้งเดียวพอ
      if (seenTs.has(slot.tsMs)) continue;
      seenTs.add(slot.tsMs);
      const have = this.ctx.storage.sql.exec<FrameRow>("SELECT key FROM frames WHERE ts_ms = ?", slot.tsMs).toArray()[0];
      if (have) continue;
      try {
        const png = await fetchRadarFrame(slot.file);
        /**
         * getFrames() ติดป้าย projection จากเวลาของเฟรม (ไม่มีคอลัมน์เก็บ) — ขาเข้าจึง
         * ต้องบังคับให้ขนาดภาพจริงตรงกับ projection ตามเวลา ไม่งั้นป้ายตอนอ่านจะโกหก
         * ไม่ตรง = ความล้มเหลวจริง (ข้าม + lastError) ไม่ใช่เดาแล้ววาด
         */
        const bySize = radarFrameProjection(png, slot.file);
        const byTime = radarProjectionAt(slot.tsMs);
        if (bySize !== byTime) {
          throw new UpstreamShapeError(
            "tmd-radar",
            `frame.${slot.file}`,
            `${bySize} size for a ${byTime} time ${new Date(slot.tsMs).toISOString()}`,
          );
        }
        downloaded.push({ slot, png });
      } catch (err) {
        if (err instanceof RadarFrameNotServedError) {
          notServed.push(slot.file);
          continue;
        }
        skipped.push(slot.file);
        skippedDetail.push(`${slot.file} (${String(err)})`);
        logWarn("radar frame skipped", { file: slot.file, error: errorText(err) });
      }
    }
    /**
     * ด่านเนื้อภาพ (ในหน่วยความจำทั้งหมด ยกเว้น meta หนึ่งค่า `newestFrameSha`)
     * ดัชนีรูปแบบใหม่เลื่อนทั้งหน้าต่างทุก 15 นาที — ไฟล์ทุกชื่อถูกเขียนใหม่ทุกรอบหมุน
     * กรณีอันตรายคือ "ดัชนีบอกแล้วว่า zr/24 = T+15 แต่ภาพที่ zr/24 ยังเป็นภาพของ T"
     * ซึ่งการอ่านดัชนีซ้ำจับไม่ได้ (ดัชนีสองรอบตรงกันเอง) จึงเทียบไบต์ภาพด้วย:
     * 1. ในรอบเดียวกัน ภาพสองเฟรมที่เวลาต่างกันแต่ไบต์เหมือนกันทุกไบต์ = *อาจ* มีเฟรม
     *    ที่ยังไม่ถูกสลับภาพ และบอกไม่ได้ว่าอันไหน → ทิ้งทั้งคู่
     * 2. ข้ามรอบ: ภาพที่ไบต์ตรงกับเฟรมใหม่สุดที่เก็บไว้แล้วแต่อ้างเวลาอื่น = *อาจ* เป็น
     *    ภาพเก่าที่ยังไม่ถูกสลับ → ทิ้งรอบนี้ รอบหน้าโหลดใหม่
     * ทั้งสองกรณีนับเป็น `rotated` (ยืนยันเวลาของภาพไม่ได้) ไม่ใช่ lastError
     *
     * **ไม่ใช่ความแน่นอน และมีราคา**: ภาพฟ้าโปร่ง (ไม่มีเสียงสะท้อนเลย) ของ TMD ไบต์
     * ตรงกันทุกไบต์ข้ามเวลา (chunk มีแค่ IHDR, tEXt "Matplotlib", pHYs, IDAT, IEND
     * ไม่มีเวลาฝังในไฟล์) ช่วงอากาศแห้งเฟรมว่างที่ถูกต้องจริงจึงถูกทิ้งเป็น `rotated`
     * ต่อเนื่อง — เฟรมใหม่สุดที่เก็บไว้ไม่ขยับ และแหล่งนี้จะขึ้น `delayed` จนกว่าจะมี
     * ภาพที่ไบต์ต่างออกไป (รวมถึงรอบแรกที่ภาพว่างหลายช่องจะถูกทิ้งทั้งหมดตามข้อ 1)
     * เลือกเสียเฟรมว่างที่ถูกต้องดีกว่าเก็บภาพผิดเวลา เพราะ `delayed` มองเห็นได้
     * ส่วนภาพผิดเวลามองไม่เห็น
     *
     * ความเสี่ยงที่ยังเหลือ (ด่านนี้ไม่ครอบคลุม):
     * - TMD สลับดัชนีกับภาพห่างกันนานกว่าหนึ่งรอบดึง (5 นาที) **และ** ภาพเก่าที่ค้าง
     *   ไม่ใช่ภาพเดียวกับเฟรมใหม่สุดที่เราเก็บไว้ — เฟรมจะถูกเก็บช้ากว่าจริงหนึ่งช่อง
     * - TMD เขียน **ภาพก่อนดัชนี**: ดัชนีสองรอบยังบอก zr/24 = T แต่ภาพเป็นของ T+15
     *   แล้ว → เก็บภาพ T+15 ไว้ที่เวลา T (เร็วไปหนึ่งช่อง) และรอบถัดไปเมื่อดัชนีบอก
     *   zr/24 = T+15 ภาพเดียวกันนั้นจะตรงกับ `newestFrameSha` จึงถูกทิ้ง — เฟรม T+15
     *   ที่ถูกต้องจะรอจนมีเฟรมที่ใหม่กว่าถูกเก็บ แล้วค่อยถูกเก็บในรอบหลังจากนั้น
     */
    const newestStored = parseNewestFrame(this.readMeta("newestFrameSha"));
    const hashed = await Promise.all(downloaded.map(async (d) => ({ ...d, sha: await sha256Hex(d.png) })));
    const timesBySha = new Map<string, Set<number>>();
    for (const h of hashed) {
      const times = timesBySha.get(h.sha) ?? new Set<number>();
      times.add(h.slot.tsMs);
      timesBySha.set(h.sha, times);
    }
    const candidates: typeof hashed = [];
    for (const h of hashed) {
      const duplicateInTick = (timesBySha.get(h.sha)?.size ?? 0) > 1;
      const sameAsStoredNewest =
        newestStored !== null && h.sha === newestStored.sha && h.slot.tsMs !== newestStored.tsMs;
      if (duplicateInTick || sameAsStoredNewest) rotated.push(h.slot.file);
      else candidates.push(h);
    }
    let confirmed: typeof hashed = [];
    if (candidates.length > 0) {
      try {
        const reread = await fetchRadarIndex();
        // ไฟล์เดียวที่โผล่หลายบรรทัดด้วยเวลาต่างกัน = ยืนยันไม่ได้ → NaN ไม่ตรงกับอะไรเลย
        const timeOf = new Map<string, number>();
        for (const s of reread.slots) {
          const prev = timeOf.get(s.file);
          timeOf.set(s.file, prev === undefined || prev === s.tsMs ? s.tsMs : NaN);
        }
        for (const d of candidates) {
          if (timeOf.get(d.slot.file) === d.slot.tsMs) confirmed.push(d);
          else rotated.push(d.slot.file);
        }
      } catch (err) {
        // อ่านดัชนีซ้ำไม่ได้ = ยืนยันเวลาไม่ได้สักเฟรม — ไม่เก็บอะไรเลย แต่ไม่ใช่
        // ความล้มเหลวของดัชนีรอบแรก จึงไม่คืน false (ไม่ต้องสลับไปคาบ RETRY)
        confirmed = [];
        for (const d of candidates) skipped.push(d.slot.file);
        skippedDetail.push(`list re-read failed, ${candidates.length} frame(s) unconfirmed (${String(err)})`);
        logWarn("radar list re-read failed", { frames: candidates.length, error: errorText(err) });
      }
    }
    let newestPut: NewestFrame | null = null;
    for (const { slot, png, sha } of confirmed) {
      // คีย์มาจากเวลาของช่องเสมอ ห้ามมาจากชื่อไฟล์ — ชื่อไฟล์ไม่ได้บอกเวลาอีกต่อไป
      const key = `${R2_PREFIX}${new Date(slot.tsMs).toISOString().replace(/[:.]/g, "-")}.png`;
      try {
        await this.env.HAZARD_BUCKET.put(key, png, { httpMetadata: { contentType: "image/png" } });
        logInfo("r2 put", { key, bytes: png.byteLength, tsMs: slot.tsMs });
        this.ctx.storage.sql.exec("INSERT OR REPLACE INTO frames (ts_ms, key) VALUES (?, ?)", slot.tsMs, key);
        added++;
        if (!newestPut || slot.tsMs > newestPut.tsMs) newestPut = { tsMs: slot.tsMs, sha };
      } catch (err) {
        skipped.push(slot.file);
        skippedDetail.push(`${slot.file} (${String(err)})`);
        logWarn("radar frame skipped", { file: slot.file, error: errorText(err) });
      }
    }
    // ขยับ `newestFrameSha` เฉพาะเมื่อเก็บเฟรมที่ใหม่กว่าตัวเดิมได้จริง (ไม่เขียนทุกรอบ)
    if (newestPut && (!newestStored || newestPut.tsMs > newestStored.tsMs)) {
      this.writeMeta("newestFrameSha", `${newestPut.tsMs}:${newestPut.sha}`);
    }
    // Prune old frames from both the index and R2.
    const old = this.ctx.storage.sql
      .exec<FrameRow>("SELECT ts_ms, key FROM frames WHERE ts_ms < ?", nowMs - RETENTION_MS)
      .toArray();
    for (const row of old) {
      await this.env.HAZARD_BUCKET.delete(row.key).catch(() => undefined);
      this.ctx.storage.sql.exec("DELETE FROM frames WHERE ts_ms = ?", row.ts_ms);
    }
    this.writeMeta("fetchedAt", new Date(nowMs).toISOString());
    // เขียนทับทุกรอบที่เดินมาถึงตรงนี้ รวมถึงกรณี 0 — ตัวเลขของรอบก่อนต้องไม่ค้าง
    // (รอบที่ดึง "ดัชนี" ไม่สำเร็จจะ return ไปก่อนหน้านี้ และคงค่าเดิมไว้ตามเจตนา:
    //  เรายังไม่ได้ตรวจเฟรมใด ๆ ในรอบนั้นเลย จึงไม่มีข้อมูลใหม่มาแทนที่)
    this.writeMeta("skippedFrames", String(skipped.length));
    this.writeMeta("notServedFrames", String(notServed.length));
    this.writeMeta("rotatedFrames", String(rotated.length));
    this.writeMeta(
      "lastError",
      skipped.length === 0
        ? null
        : `radar frames skipped (${skipped.length}/${slots.length}): ${skippedDetail.join("; ")}`.slice(0, 200),
    );
    // บรรทัดเดียวต่อรอบ ไม่ใช่บรรทัดละเฟรม — ช่องที่ 404 ซ้ำทุก 5 นาทีเป็นเรื่องปกติของต้นทาง
    if (notServed.length > 0 || rotated.length > 0) {
      logWarn("radar frames not stored", {
        notServed: notServed.length,
        rotated: rotated.length,
        notServedFiles: notServed,
        rotatedFiles: rotated,
      });
    }
    if (added > 0) logInfo("radar frames added", { added });
    return true;
  }

  /** Frames within the last `hours`, oldest first. */
  async getFrames(hours: number): Promise<RadarFramesResponse> {
    await this.ensureFresh();
    const nowMs = Date.now();
    const rows = this.ctx.storage.sql
      .exec<FrameRow>("SELECT ts_ms, key FROM frames WHERE ts_ms >= ? ORDER BY ts_ms ASC", nowMs - hours * 3600 * 1000)
      .toArray();
    const fetchedAt = this.readMeta("fetchedAt");
    const newest = rows.length ? new Date(rows[rows.length - 1].ts_ms).toISOString() : undefined;
    // ช่องที่เลิกใช้แล้ว (bounds/widthPx/heightPx) = georeference ของเฟรมใหม่สุด
    // เก็บไว้ให้ bundle เว็บรุ่นก่อนไม่พังเท่านั้น
    const legacyGeo =
      RADAR_GEOREFERENCES[rows.length ? radarProjectionAt(rows[rows.length - 1].ts_ms) : "equirectangular"];
    return {
      layer: {
        id: "tmd-radar-composite",
        epistemicClass: "observed",
        liveOrStatic: "live",
        observedAt: newest,
        publishedAt: this.readMeta("publishedAt"),
        fetchedAt,
        staleAfterSeconds: OBSERVED_LAG_MS / 1000,
        sourceIds: ["tmd-radar"],
      },
      georeferences: RADAR_GEOREFERENCES,
      bounds: legacyGeo.bounds,
      widthPx: legacyGeo.widthPx,
      heightPx: legacyGeo.heightPx,
      fetchedAt,
      frames: rows.map((r) => ({
        t: new Date(r.ts_ms).toISOString(),
        url: `/api/v1/radar/frame/${r.ts_ms}.png`,
        projection: radarProjectionAt(r.ts_ms),
      })),
    };
  }

  /** R2 key for a frame timestamp, or null. */
  async frameKey(tsMs: number): Promise<string | null> {
    return this.ctx.storage.sql.exec<FrameRow>("SELECT key FROM frames WHERE ts_ms = ?", tsMs).toArray()[0]?.key ?? null;
  }

  async status(): Promise<SourceStatus> {
    const fetchedAt = this.readMeta("fetchedAt");
    const lastError = this.readMeta("lastError");
    const nowMs = Date.now();
    const newest = this.ctx.storage.sql.exec<{ t: number | null }>("SELECT MAX(ts_ms) AS t FROM frames").toArray()[0]?.t ?? null;
    // frames24h ต้องนับเฉพาะเฟรมที่อยู่ใน 24 ชม.จริง ๆ — ตารางเก็บย้อนหลัง 30 วัน
    // การนับทั้งตารางเคยทำให้ตัวเลขนี้โตขึ้นเรื่อย ๆ ทั้งที่เรดาร์หยุดส่งไปแล้ว
    const count =
      this.ctx.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM frames WHERE ts_ms >= ?", nowMs - DAY_MS)
        .toArray()[0]?.n ?? 0;
    const latestObservedAt = newest ? new Date(newest).toISOString() : null;
    const health = deriveSourceHealth({
      nowMs,
      fetchedAt,
      lastError,
      latestObservedAt,
      staleAfterSeconds: FETCH_STALE_AFTER_MS / 1000,
      observedLagSeconds: OBSERVED_LAG_MS / 1000,
    });
    const alarmAtMs = await this.ctx.storage.getAlarm();
    return {
      id: "tmd-radar",
      labelTh: SOURCES["tmd-radar"].nameTh,
      labelEn: SOURCES["tmd-radar"].nameEn,
      health,
      fetchedAt,
      latestObservedAt,
      lastAttemptAt: this.readMeta("lastAttemptAt"),
      lastError,
      detail: {
        frames24h: count,
        skippedFrames: Number(this.readMeta("skippedFrames") ?? "0"),
        // ช่องที่ TMD ลงไว้ในดัชนีแต่ตอบ 404 และช่องที่ชื่อไฟล์ถูกหมุนไปก่อนยืนยันได้
        // ของรอบล่าสุด — ไม่ใช่ความล้มเหลว จึงไม่อยู่ใน lastError
        notServed: Number(this.readMeta("notServedFrames") ?? "0"),
        rotated: Number(this.readMeta("rotatedFrames") ?? "0"),
      },
      staleAfterSeconds: FETCH_STALE_AFTER_MS / 1000,
      observedLagSeconds: OBSERVED_LAG_MS / 1000,
      nextAttemptAt: alarmAtMs === null ? null : new Date(alarmAtMs).toISOString(),
    };
  }
}
