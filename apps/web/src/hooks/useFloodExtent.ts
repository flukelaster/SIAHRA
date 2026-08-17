import { useEffect, useState } from "react";
import type { FloodExtentResponse } from "@siahra/shared-types";

export interface FloodExtentState {
  data: FloodExtentResponse | null;
  loading: boolean;
  error: string | null;
}

const REFRESH_MS = 10 * 60 * 1000;
const RETRY_MS = 15 * 1000;

/**
 * GISTDA satellite flood-extent polygons for the selected province. This is
 * an observed layer (interpreted satellite scene) with no upstream timestamp,
 * so consumers must display `retrievedAt` / per-feature first/last-seen and
 * never present it as a live "now" picture.
 */
export function useFloodExtent(provinceCode: string | null): FloodExtentState {
  const [state, setState] = useState<FloodExtentState>({ data: null, loading: true, error: null });

  useEffect(() => {
    if (!provinceCode) return;
    let cancelled = false;
    let timer: number | null = null;
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(`/api/v1/provinces/${provinceCode}/flood-extent`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as FloodExtentResponse;
        if (cancelled) return;
        setState({ data, loading: false, error: null });
        timer = window.setTimeout(load, REFRESH_MS);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : "โหลดไม่สำเร็จ" }));
        timer = window.setTimeout(load, RETRY_MS);
      }
    };
    setState({ data: null, loading: true, error: null });
    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [provinceCode]);

  return state;
}
