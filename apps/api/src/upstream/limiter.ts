/**
 * One polite queue for everything we ask an upstream (ThaiWater today):
 * bounded concurrency, a minimum gap between calls, a per-minute budget,
 * and a circuit breaker that pauses the whole queue after repeated 429/5xx
 * so we back off instead of piling on a struggling public API.
 */
export interface UpstreamQueueOptions {
  concurrency: number;
  minGapMs: number;
  /** Max jobs started per rolling minute (0 = unlimited). */
  perMinute: number;
  /** Consecutive failures that trip the breaker. */
  tripAfter: number;
  pauseMs: number;
}

interface Job<T> {
  priority: number;
  seq: number;
  run: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

export class UpstreamPausedError extends Error {
  constructor(public readonly until: number) {
    super("upstream queue paused (circuit breaker)");
    this.name = "UpstreamPausedError";
  }
}

export class UpstreamQueue {
  private queue: Job<unknown>[] = [];
  private active = 0;
  private seq = 0;
  private lastStart = 0;
  private starts: number[] = [];
  private failures = 0;
  private pausedUntil = 0;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: UpstreamQueueOptions) {}

  get length(): number {
    return this.queue.length;
  }
  get inflight(): number {
    return this.active;
  }
  get pausedUntilMs(): number {
    return this.pausedUntil > Date.now() ? this.pausedUntil : 0;
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

  /** Enqueue; lower priority number runs first. */
  run<T>(fn: () => Promise<T>, priority = 5): Promise<T> {
    if (this.pausedUntilMs) return Promise.reject(new UpstreamPausedError(this.pausedUntil));
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ priority, seq: this.seq++, run: fn, resolve, reject } as Job<unknown>);
      this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      this.drain();
    });
  }

  private drain() {
    if (this.drainTimer) return;
    const now = Date.now();
    if (this.pausedUntil > now) {
      // Fail everything queued: callers treat it as a transient error.
      const paused = this.queue.splice(0);
      for (const j of paused) j.reject(new UpstreamPausedError(this.pausedUntil));
      return;
    }
    while (this.active < this.opts.concurrency && this.queue.length) {
      const sinceLast = now - this.lastStart;
      if (sinceLast < this.opts.minGapMs) {
        this.later(this.opts.minGapMs - sinceLast);
        return;
      }
      if (this.opts.perMinute > 0 && this.startsLastMinute(now) >= this.opts.perMinute) {
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
      job
        .run()
        .then((v) => {
          this.failures = 0;
          job.resolve(v);
        })
        .catch((err: unknown) => {
          if (isUpstreamOverload(err)) {
            this.failures++;
            if (this.failures >= this.opts.tripAfter) {
              this.pausedUntil = Date.now() + this.opts.pauseMs;
              this.failures = 0;
              console.error(JSON.stringify({ level: "warn", message: "upstream queue paused", untilMs: this.pausedUntil }));
            }
          }
          job.reject(err);
        })
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }

  private later(ms: number) {
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.drain();
    }, ms);
  }
}

/** HTTP-ish failures that indicate the upstream is overloaded (429/5xx/network). */
export function isUpstreamOverload(err: unknown): boolean {
  const msg = String(err);
  return /\b(429|502|503|504)\b/.test(msg) || /fetch failed|network|timed out|ECONN/i.test(msg);
}
