/**
 * Cron orchestration, kept pure (no `AppEnv`, no `cloudflare:workers` import)
 * so it can be unit-tested with plain thunks.
 *
 * The rule it exists to enforce: one upstream source failing — or hanging —
 * must not starve the other three. Every source runs concurrently under
 * `Promise.allSettled` with its own timeout, and every source produces exactly
 * one structured log line per tick, whatever happened to it.
 */

/** A source refresh: an id for the log line and the thunk that does the work. */
export interface SourceTask {
  id: string;
  run: () => Promise<Record<string, unknown> | void>;
}

export interface SourceTickResult {
  id: string;
  /** "ok" = the thunk resolved, "error" = it rejected, "timeout" = it never settled in time. */
  outcome: "ok" | "error" | "timeout";
  durationMs: number;
  /** Whatever the thunk returned, merged into the log line (e.g. poll counters). */
  detail?: Record<string, unknown>;
  error?: string;
}

export interface ScheduledTickOptions {
  /**
   * Per-source budget. A Worker cron invocation gets 30 s of wall clock in
   * practice, so 25 s leaves room for the log lines and for `scheduled()` to
   * return rather than being killed mid-flight.
   */
  timeoutMs?: number;
  /** Injected so tests can capture lines instead of reading stdout. */
  log?: (line: Record<string, unknown>) => void;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 25_000;

const defaultLog = (line: Record<string, unknown>) => {
  console.log(JSON.stringify(line));
};

/**
 * A timeout does **not** cancel the underlying RPC — workerd has no cancel for
 * an in-flight DO call — so the losing promise still settles later. It is
 * given its own no-op handlers here, otherwise a slow source turns into an
 * unhandled rejection long after the tick reported on it.
 */
async function withTimeout(
  task: SourceTask,
  timeoutMs: number,
  now: () => number,
): Promise<SourceTickResult> {
  const startedAt = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SourceTickResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ id: task.id, outcome: "timeout", durationMs: now() - startedAt }),
      timeoutMs,
    );
  });
  const work = Promise.resolve()
    .then(() => task.run())
    .then(
      (detail): SourceTickResult => ({
        id: task.id,
        outcome: "ok",
        durationMs: now() - startedAt,
        ...(detail && typeof detail === "object" ? { detail } : {}),
      }),
      (err: unknown): SourceTickResult => ({
        id: task.id,
        outcome: "error",
        durationMs: now() - startedAt,
        error: String(err),
      }),
    );
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Runs every source concurrently and returns one result per source, in the
 * order the tasks were given. Never rejects: a source that throws is reported,
 * not propagated, so `scheduled()` cannot be taken down by one bad upstream.
 */
export async function runScheduledTick(
  tasks: SourceTask[],
  options: ScheduledTickOptions = {},
): Promise<SourceTickResult[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = options.log ?? defaultLog;
  const now = options.now ?? Date.now;

  const settled = await Promise.allSettled(tasks.map((task) => withTimeout(task, timeoutMs, now)));

  return settled.map((entry, i) => {
    const task = tasks[i]!;
    // `withTimeout` already absorbs the thunk's own rejection, so a rejected
    // entry here means the orchestration itself broke — still one line, never
    // a silent hole in the tick.
    const result: SourceTickResult =
      entry.status === "fulfilled"
        ? entry.value
        : { id: task.id, outcome: "error", durationMs: 0, error: String(entry.reason) };
    log({
      // The source's own detail is spread first on purpose: a thunk that
      // happens to return a key called `source` or `outcome` must not be able
      // to overwrite what the orchestrator observed about it.
      ...(result.detail ?? {}),
      level: result.outcome === "ok" ? "info" : "error",
      message: "scheduled source tick",
      source: result.id,
      outcome: result.outcome,
      durationMs: result.durationMs,
      ...(result.error !== undefined ? { error: result.error } : {}),
    });
    return result;
  });
}
