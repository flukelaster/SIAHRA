import { useEffect, useState } from "react";
import type { HealthResponse, SourceStatus } from "@siahra/shared-types";

export interface ApiHealthState {
  /** null until the first successful poll. */
  health: HealthResponse | null;
  /** True when /api/v1/health itself is unreachable (API process down). */
  apiDown: boolean;
  checkedAt: string | null;
}

const POLL_MS = 60 * 1000;
const RETRY_MS = 5 * 1000;

/**
 * Polls /api/v1/health so the map can show, per upstream source, how old the
 * data is and whether the source is degraded — the plan's "source freshness
 * next to the hazard map, not hidden in an engineering dashboard".
 */
export function useApiHealth(): ApiHealthState {
  const [state, setState] = useState<ApiHealthState>({ health: null, apiDown: false, checkedAt: null });

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const schedule = (ms: number) => {
      if (cancelled) return;
      timer = window.setTimeout(load, ms);
    };
    const load = async () => {
      try {
        const res = await fetch("/api/v1/health", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const health = (await res.json()) as HealthResponse;
        if (cancelled) return;
        setState({ health, apiDown: false, checkedAt: new Date().toISOString() });
        schedule(POLL_MS);
      } catch {
        if (cancelled) return;
        setState((s) => ({ ...s, apiDown: true, checkedAt: new Date().toISOString() }));
        schedule(RETRY_MS);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  return state;
}

/** Convenience: the status entry for one source id, if known. */
export function sourceStatus(health: HealthResponse | null, id: string): SourceStatus | null {
  return health?.sources.find((s) => s.id === id) ?? null;
}
