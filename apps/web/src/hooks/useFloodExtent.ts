import { useEffect, useState } from "react";
import type { FloodExtentResponse } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";

export interface FloodExtentState {
  data: FloodExtentResponse | null;
  loading: boolean;
  error: ErrorMessage | null;
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
        // retrievedAt = null คือฝั่ง API ยังดึงฉากแรกไม่สำเร็จ (หรือกำลังวิ่งอยู่)
        // อย่ารอครบ 10 นาที ไม่งั้นการ์ดจะยืนยันว่า "ต้นทางไม่ตอบสนอง" ทั้งที่ข้อมูลมาแล้ว
        timer = window.setTimeout(load, data.retrievedAt ? REFRESH_MS : RETRY_MS);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setState((s) => ({ ...s, loading: false, error: errorMessage(err, "error.loadFailed") }));
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
