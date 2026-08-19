import { useEffect, useState } from "react";
import type { DamsResponse } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";

export interface DamsState {
  data: DamsResponse | null;
  loading: boolean;
  /** คีย์หรือข้อความดิบ — แปลตอนเรนเดอร์ ไม่ใช่ตอนที่ fetch ล้มเหลว */
  error: ErrorMessage | null;
}

const REFRESH_MS = 15 * 60 * 1000;

/** Reservoir storage for the selected province (ThaiWater analyst/dam, observed). */
export function useDams(provinceCode: string | null): DamsState {
  const [state, setState] = useState<DamsState>({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!provinceCode) return;
    let cancelled = false;
    let timer: number | null = null;
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(`/api/v1/dams?province=${provinceCode}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as DamsResponse;
        if (cancelled) return;
        setState({ data, loading: false, error: null });
        timer = window.setTimeout(load, REFRESH_MS);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setState((s) => ({ ...s, loading: false, error: errorMessage(err, "error.loadFailed") }));
        timer = window.setTimeout(load, 15000);
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
