import { useEffect, useState } from "react";
import type { WaterLevelHistoryResponse } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";

export interface StationHistoryState {
  data: WaterLevelHistoryResponse | null;
  loading: boolean;
  error: ErrorMessage | null;
}

/** 72 h water-level series for one station; only fetched while `enabled`. */
export function useStationHistory(stationId: number | null, enabled: boolean, hours = 72): StationHistoryState {
  const [state, setState] = useState<StationHistoryState>({ data: null, loading: false, error: null });
  useEffect(() => {
    if (!enabled || stationId === null) return;
    let cancelled = false;
    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });
    (async () => {
      try {
        const res = await fetch(`/api/v1/stations/${stationId}/history?hours=${hours}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as WaterLevelHistoryResponse;
        if (!cancelled) setState({ data, loading: false, error: null });
      } catch (err) {
        if (!cancelled && !controller.signal.aborted)
          setState({ data: null, loading: false, error: errorMessage(err, "error.loadFailed") });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [stationId, enabled, hours]);
  return state;
}
