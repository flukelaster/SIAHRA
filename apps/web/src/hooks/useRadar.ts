import { useEffect, useState } from "react";
import type { RadarFramesResponse } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";

export interface RadarState {
  data: RadarFramesResponse | null;
  error: ErrorMessage | null;
}

const REFRESH_MS = 5 * 60 * 1000;

/** TMD radar composite frames (last 3 h), proxied by the backend. */
export function useRadar(enabled: boolean): RadarState {
  const [state, setState] = useState<RadarState>({ data: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | null = null;
    const load = async () => {
      try {
        const res = await fetch("/api/v1/radar/frames?hours=3");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as RadarFramesResponse;
        if (!cancelled) setState({ data, error: null });
        timer = window.setTimeout(load, REFRESH_MS);
      } catch (err) {
        if (!cancelled) setState((s) => ({ ...s, error: errorMessage(err, "error.loadFailed") }));
        timer = window.setTimeout(load, 20000);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled]);
  return state;
}
