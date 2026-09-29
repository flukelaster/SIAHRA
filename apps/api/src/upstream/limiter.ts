/**
 * One polite queue for everything we ask an upstream (ThaiWater today):
 * bounded concurrency, a minimum gap between calls, a per-minute budget,
 * and a circuit breaker **per endpoint** that backs off on a ladder after
 * repeated 429/5xx/network failures so we stop piling on a struggling API.
 *
 * Breaker (ต่อ key = ต่อ endpoint — ความสำเร็จของ analyst/dam ต้องไม่ปิด breaker ของ rain_24h):
 * - ปิด (level 0): ล้มเหลวแบบ overload ติดกัน `tripAfter` ครั้ง → เปิดที่ขั้น 1
 * - เปิด (level ≥ 1): ทุกงานของ key นั้นถูกปฏิเสธ (`UpstreamPausedError`) โดยไม่ยิงต้นทาง จนถึง `pausedUntil`
 * - half-open: พ้นเวลาพักแล้ว → ปล่อย **probe ตัวเดียว** (ทั้งคิว ไม่ว่ากี่ key) ส่วนงานอื่นถูกปฏิเสธระหว่างที่ probe ค้าง
 *   probe ล้มเหลว → ขั้นถัดไปทันที (ไม่ต้องรอสามครั้ง) · probe สำเร็จ → กลับ level 0
 * - บันไดพัก: 5 → 10 → 20 → 40 → 60 นาที; `Retry-After` ของต้นทางบวกเป็น max ไม่เคยสั้นกว่าบันได (ครอบ 60 นาที)
 * - ตัดสิน overload จาก **ชนิดของ error** (`isUpstreamOverload`) ไม่ใช่ข้อความ
 *
 * สถานะของ breaker ถูก persist ผ่าน `persist` (DO ต่อเข้ากับตาราง meta): DO ที่ถูกถอดออกกลางการพัก
 * ต้องกลับมาพักต่อที่ขั้นเดิม ไม่เริ่มยิงใหม่จากศูนย์
 */
import { logWarn } from "../log.js";
import {
  UpstreamHttpError,
  UpstreamPausedError,
  isUpstreamOverload,
} from "../ingestion/errors.js";

export { UpstreamPausedError, isUpstreamOverload };

/** บันไดเวลาพักตามขั้นของ breaker (ms) — ขั้นแรกคือ 5 นาทีเท่าเดิม */
export const DEFAULT_PAUSE_LADDER_MS: readonly number[] = [5, 10, 20, 40, 60].map((m) => m * 60 * 1000);
/** probe ที่ค้างเกินนี้ถือว่าหายไป (fetch ที่ไม่ตอบ) ไม่ให้ half-open ค้างตลอดไป */
const PROBE_STALE_MS = 3 * 60 * 1000;

export interface BreakerPersistence {
  read(key: string): string | null;
  /** `null` = ลบ (breaker กลับไปปิดแล้ว) */
  write(key: string, value: string | null): void;
}

export interface UpstreamQueueOptions {
  concurrency: number;
  minGapMs: number;
  /** Max jobs started per rolling minute (0 = unlimited). */
  perMinute: number;
  /** Consecutive overload failures (per endpoint) that trip a closed breaker. */
  tripAfter: number;
  /** เวลาพักตามขั้น (ms) เรียงจากขั้น 1; ขั้นสุดท้ายคือเพดาน */
  pauseLadderMs?: readonly number[];
  persist?: BreakerPersistence;
  /** คำนำหน้าของคีย์ที่ persist ต่อ endpoint (`<prefix><key>`) */
  persistPrefix?: string;
}

interface Job<T> {
  key: string;
  priority: number;
  seq: number;
  run: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

/** สถานะที่ persist ต่อ endpoint — ทั้งหมดเป็นค่าจริงจากต้นทาง/นาฬิกา ไม่มีค่าที่เราเดาเอง */
interface Breaker {
  /** ขั้นของบันได: 0 = ปิด, 1..n = เปิด/half-open ที่ขั้นนั้น */
  level: number;
  /** ms epoch — ก่อนเวลานี้ห้ามยิง */
  pausedUntil: number;
  /** Retry-After ล่าสุดที่ต้นทางส่ง (ms, ผ่านการครอบเพดานแล้ว) */
  retryAfterMs: number | null;
  /** ms epoch ที่ Retry-After ล่าสุดหมดอายุ (0 = ไม่มี) */
  retryAfterUntil: number;
  /** ล้มเหลวแบบ overload ติดกันขณะปิด — ไม่ persist (นับใหม่ได้หลัง DO ถูกถอด) */
  failures: number;
}

export interface BreakerSnapshot {
  level: number;
  pausedUntil: number;
  retryAfterMs: number | null;
}

function closedBreaker(): Breaker {
  return { level: 0, pausedUntil: 0, retryAfterMs: null, retryAfterUntil: 0, failures: 0 };
}

const blockedUntil = (b: Breaker): number => Math.max(b.pausedUntil, b.retryAfterUntil);

export class UpstreamQueue {
  private queue: Job<unknown>[] = [];
  private active = 0;
  private seq = 0;
  private lastStart = 0;
  private starts: number[] = [];
  private readonly breakers = new Map<string, Breaker>();
  /** probe ที่ค้างอยู่ (มีได้ตัวเดียวทั้งคิว): key, เวลาที่เริ่ม และเลขลำดับ — เลขนี้บอกว่าผลที่กลับมาเป็นของ probe ปัจจุบันหรือของตัวเก่าที่ถูกแทนแล้ว */
  private probe: { key: string; startedAt: number; id: number } | null = null;
  private probeSeq = 0;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private hydratedOk = false;
  private readonly ladder: readonly number[];
  private readonly prefix: string;

  constructor(private readonly opts: UpstreamQueueOptions) {
    this.ladder = opts.pauseLadderMs && opts.pauseLadderMs.length > 0 ? opts.pauseLadderMs : DEFAULT_PAUSE_LADDER_MS;
    this.prefix = opts.persistPrefix ?? "breaker:";
  }

  get length(): number {
    return this.queue.length;
  }
  get inflight(): number {
    return this.active;
  }

  /**
   * ms epoch ที่ endpoint นั้น (หรือ endpoint ใดก็ตามถ้าไม่ระบุ key = ค่าสูงสุด) ถูกพักอยู่ — 0 = ไม่ได้พัก
   * ค่านี้คือสิ่งที่ /health ใช้บอก `upstreamPausedUntil` / `extraDegraded`
   */
  pausedUntilMs(key?: string, now = Date.now()): number {
    let best = 0;
    for (const [k, b] of this.breakers) {
      if (key !== undefined && k !== key) continue;
      const until = blockedUntil(b);
      if (until > now && until > best) best = until;
    }
    return best;
  }

  /**
   * ถ้า **ทุก** key ที่ระบุถูกพักอยู่ → เวลาที่แรกสุดที่ key ใดจะยิงได้ (= จุดที่รอบ refresh มีประโยชน์อีกครั้ง);
   * 0 ถ้ามี key ที่ยังยิงได้ (รอบนั้นยังทำงานได้บางส่วน)
   */
  allPausedUntilMs(keys: readonly string[], now = Date.now()): number {
    let earliest = Infinity;
    for (const key of keys) {
      const b = this.breakers.get(key);
      const until = b ? blockedUntil(b) : 0;
      if (until <= now) return 0;
      if (until < earliest) earliest = until;
    }
    return Number.isFinite(earliest) ? earliest : 0;
  }

  /** breaker ที่ไม่ได้ปิดอยู่ (level > 0 หรือมี Retry-After ค้าง) — สำหรับ /health detail */
  snapshot(now = Date.now()): Record<string, BreakerSnapshot> {
    const out: Record<string, BreakerSnapshot> = {};
    for (const [k, b] of this.breakers) {
      if (b.level === 0 && b.retryAfterUntil <= now) continue;
      out[k] = { level: b.level, pausedUntil: blockedUntil(b), retryAfterMs: b.retryAfterMs };
    }
    return out;
  }

  /**
   * โหลดสถานะที่ persist ไว้ — เรียกตอน DO ถูกสร้าง (หลังตาราง meta พร้อม) และซ้ำได้ใน `armAlarm()`
   * (no-op เมื่อโหลดสำเร็จแล้ว จึงลองใหม่เฉพาะเมื่อครั้งแรกล้ม) คีย์ที่อ่านไม่ออก/ผิดรูปถูกมองว่าไม่มี
   * ไม่ใช่ error — ผลคือ "ปิด" ซึ่งเป็นสถานะที่ปลอดภัยน้อยกว่าเดิมเพียงเรื่องความถี่ ไม่ทำให้ข้อมูลหาย
   */
  hydrate(keys: readonly string[]): void {
    if (this.hydratedOk || !this.opts.persist) return;
    for (const key of keys) {
      const raw = this.opts.persist.read(this.prefix + key);
      if (raw === null) continue;
      const parsed = parseBreaker(raw, this.ladder.length);
      if (parsed) this.breakers.set(key, parsed);
    }
    this.hydratedOk = true;
  }

  /** Jobs started in the last 60 s. */
  startsLastMinute(now = Date.now()): number {
    this.starts = this.starts.filter((t) => now - t < 60000);
    return this.starts.length;
  }
  startsLastHour(): number {
    return this.hourStarts;
  }
  private hourStarts = 0;
  private hourStart = Date.now();

  /** Enqueue; lower priority number runs first. `key` = endpoint ที่ breaker แยกกัน */
  run<T>(fn: () => Promise<T>, priority = 5, key = "default"): Promise<T> {
    const b = this.breakers.get(key);
    const until = b ? blockedUntil(b) : 0;
    if (until > Date.now()) return Promise.reject(new UpstreamPausedError(key, until));
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ key, priority, seq: this.seq++, run: fn, resolve, reject } as Job<unknown>);
      this.queue.sort((a, b2) => a.priority - b2.priority || a.seq - b2.seq);
      this.drain();
    });
  }

  private breaker(key: string): Breaker {
    let b = this.breakers.get(key);
    if (!b) {
      b = closedBreaker();
      this.breakers.set(key, b);
    }
    return b;
  }

  /**
   * ตัดสินตอน dispatch: ยิงได้ปกติ / ยิงเป็น probe / ปฏิเสธ (พักอยู่ หรือมี probe ค้าง)
   * probe ถูกจองที่นี่ (ไม่ใช่ตอน enqueue) จึงไม่ถูกถือไว้ระหว่างรอคิว
   */
  private admit(key: string, now: number): "run" | "probe" | UpstreamPausedError {
    const b = this.breakers.get(key);
    if (!b) return "run";
    const until = blockedUntil(b);
    if (until > now) return new UpstreamPausedError(key, until);
    if (b.level === 0) return "run";
    // half-open — probe ตัวเดียวทั้งคิว
    if (this.probe && now - this.probe.startedAt < PROBE_STALE_MS) return new UpstreamPausedError(key, 0);
    this.probe = { key, startedAt: now, id: ++this.probeSeq };
    return "probe";
  }

  private drain() {
    if (this.drainTimer) return;
    const now = Date.now();
    while (this.active < this.opts.concurrency && this.queue.length) {
      const verdict = this.admit(this.queue[0].key, now);
      if (verdict instanceof UpstreamPausedError) {
        // ปฏิเสธเฉพาะงานนี้ (ผู้เรียกถือเป็นความผิดพลาดชั่วคราว) แล้วดูงานถัดไป — key อื่นยังยิงได้
        this.queue.shift()!.reject(verdict);
        continue;
      }
      const sinceLast = now - this.lastStart;
      if (sinceLast < this.opts.minGapMs) {
        // คืน probe ที่เพิ่งจอง — จะจองใหม่ตอนถึงเวลายิงจริง
        if (verdict === "probe") this.probe = null;
        this.later(this.opts.minGapMs - sinceLast);
        return;
      }
      if (this.opts.perMinute > 0 && this.startsLastMinute(now) >= this.opts.perMinute) {
        if (verdict === "probe") this.probe = null;
        this.later(1000);
        return;
      }
      const job = this.queue.shift()!;
      this.active++;
      this.lastStart = now;
      this.starts.push(now);
      if (now - this.hourStart > 3600000) {
        this.hourStart = now;
        this.hourStarts = 0;
      }
      this.hourStarts++;
      const probeId = verdict === "probe" ? this.probe!.id : 0;
      // probe เก่าที่ค้างจนถูกแทนด้วยตัวใหม่ (PROBE_STALE_MS) แล้วเพิ่งจบทีหลัง ไม่ใช่ probe ปัจจุบันอีกต่อไป:
      // ถ้าปล่อยให้มันเลื่อนขั้น (หรือปิด breaker) ซ้ำ บันไดจะขยับสองครั้งต่อการหมดเวลาพักหนึ่งครั้ง และมันจะเคลียร์ช่อง probe ของตัวใหม่
      const ownsProbe = () => probeId !== 0 && this.probe?.id === probeId;
      job
        .run()
        .then((v) => {
          this.onSuccess(job.key, ownsProbe());
          job.resolve(v);
        })
        .catch((err: unknown) => {
          this.onFailure(job.key, err, ownsProbe());
          job.reject(err);
        })
        .finally(() => {
          this.active--;
          if (ownsProbe()) this.probe = null;
          this.drain();
        });
    }
  }

  private onSuccess(key: string, isProbe: boolean): void {
    const b = this.breakers.get(key);
    if (!b) return;
    // งานที่เริ่มก่อน breaker เปิดแล้วมาสำเร็จทีหลัง ไม่ใช่หลักฐานว่าต้นทางฟื้น — เฉพาะ probe หรือขณะปิดเท่านั้นที่ปิดได้
    if (b.level > 0 && !isProbe) return;
    const wasOpen = b.level > 0 || b.retryAfterUntil > 0 || b.pausedUntil > 0;
    b.failures = 0;
    b.level = 0;
    b.pausedUntil = 0;
    b.retryAfterMs = null;
    b.retryAfterUntil = 0;
    if (wasOpen) this.persistBreaker(key, b);
  }

  private onFailure(key: string, err: unknown, isProbe: boolean): void {
    // ต้นทางตอบมาแล้วแต่งานพัง (รูปร่างผิด, 403/404 …) ไม่ใช่สัญญาณแออัด — ไม่นับ ไม่เลื่อนขั้น
    if (!isUpstreamOverload(err)) return;
    const b = this.breaker(key);
    const now = Date.now();
    const retryAfterMs = err instanceof UpstreamHttpError ? err.retryAfterMs : null;
    if (b.level > 0 && !isProbe) return; // งานที่ค้างมาจากก่อนเปิด breaker
    if (retryAfterMs !== null) {
      b.retryAfterMs = retryAfterMs;
      b.retryAfterUntil = now + retryAfterMs;
    }
    if (isProbe) {
      // probe ล้ม = ต้นทางยังแออัด → ขั้นถัดไปทันที
      b.level = Math.min(b.level + 1, this.ladder.length);
      this.openBreaker(key, b, now, retryAfterMs);
      return;
    }
    b.failures++;
    if (b.failures >= this.opts.tripAfter) {
      b.level = 1;
      b.failures = 0;
      this.openBreaker(key, b, now, retryAfterMs);
      return;
    }
    // ยังไม่ถึงเกณฑ์ แต่ Retry-After ต้องถูกเชื่อฟัง (และเก็บไว้ให้ DO ที่ถูกถอดอ่านต่อ)
    if (retryAfterMs !== null) this.persistBreaker(key, b);
  }

  private openBreaker(key: string, b: Breaker, now: number, retryAfterMs: number | null): void {
    const step = this.ladder[Math.min(b.level, this.ladder.length) - 1];
    b.pausedUntil = now + Math.max(step, retryAfterMs ?? 0);
    this.persistBreaker(key, b);
    logWarn("upstream breaker open", { key, level: b.level, untilMs: b.pausedUntil, retryAfterMs });
  }

  private persistBreaker(key: string, b: Breaker): void {
    const persist = this.opts.persist;
    if (!persist) return;
    try {
      const closed = b.level === 0 && b.retryAfterUntil === 0 && b.pausedUntil === 0;
      persist.write(
        this.prefix + key,
        closed
          ? null
          : JSON.stringify({
              v: 1,
              level: b.level,
              pausedUntil: b.pausedUntil,
              retryAfterMs: b.retryAfterMs,
              retryAfterUntil: b.retryAfterUntil,
            }),
      );
    } catch (err) {
      // meta เขียนไม่ได้ต้องไม่ลาก refresh ลงไปด้วย — breaker ในหน่วยความจำยังทำงาน
      logWarn("upstream breaker persist failed", { key, error: String(err) });
    }
  }

  private later(ms: number) {
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.drain();
    }, ms);
  }
}

function parseBreaker(raw: string, maxLevel: number): Breaker | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const level = v.level;
    const pausedUntil = v.pausedUntil;
    const retryAfterUntil = v.retryAfterUntil;
    if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > maxLevel) return null;
    if (typeof pausedUntil !== "number" || !Number.isFinite(pausedUntil)) return null;
    if (typeof retryAfterUntil !== "number" || !Number.isFinite(retryAfterUntil)) return null;
    const retryAfterMs = typeof v.retryAfterMs === "number" && Number.isFinite(v.retryAfterMs) ? v.retryAfterMs : null;
    return { level, pausedUntil, retryAfterMs, retryAfterUntil, failures: 0 };
  } catch {
    return null;
  }
}
