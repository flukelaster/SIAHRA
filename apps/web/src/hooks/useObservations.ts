import { useEffect, useState } from "react";
import type { ObservationsResponse } from "@siahra/shared-types";

export interface ObservationsState {
  data: ObservationsResponse | null;
  loading: boolean;
  error: string | null;
}

const REFRESH_MS = 5 * 60 * 1000;
/** Backend may be starting or restarting; retry quickly before giving up. */
const RETRY_MS = 4000;

/**
 * 502/503/504 from the dev proxy (or a gateway in production) means the API
 * process is not reachable — a different, self-healing situation from a real
 * application error, so it gets its own actionable message.
 */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

function describeError(err: unknown): string {
  if (err instanceof ApiUnavailableError) {
    return "เชื่อมต่อ API ไม่ได้ — ตรวจสอบว่าเซิร์ฟเวอร์ API ทำงานอยู่ (npm run dev)";
  }
  if (err instanceof TypeError) {
    return "เชื่อมต่อเครือข่ายไม่ได้ กำลังลองใหม่...";
  }
  return err instanceof Error ? err.message : "โหลดข้อมูลตรวจวัดไม่สำเร็จ";
}

class ApiUnavailableError extends Error {
  constructor(status: number) {
    super(`API unavailable (HTTP ${status})`);
    this.name = "ApiUnavailableError";
  }
}

/**
 * Live observations (rainfall + water level) from ThaiWater/HII via the
 * Worker. Everything returned is epistemicClass "observed" — direct station
 * readings, no modelling.
 */
export function useObservations(provinceCode: string | null, atIso: string | null = null): ObservationsState {
  const [state, setState] = useState<ObservationsState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    const controller = new AbortController();

    const load = async () => {
      try {
        const params = new URLSearchParams();
        if (provinceCode) params.set("province", provinceCode);
        if (atIso) params.set("at", atIso);
        const qs = params.size ? `?${params.toString()}` : "";
        const res = await fetch(`/api/v1/observations${qs}`, { signal: controller.signal });
        if (GATEWAY_STATUSES.has(res.status)) throw new ApiUnavailableError(res.status);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ObservationsResponse;
        if (cancelled) return;
        setState({ data, loading: false, error: null });
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setState((s) => ({ ...s, loading: false, error: describeError(err) }));

        // The API being down is usually transient (restart / not started yet),
        // so keep retrying instead of stranding the UI until a manual reload.
        const transient = err instanceof ApiUnavailableError || err instanceof TypeError;
        if (transient && retryTimer === null) {
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            void load();
          }, RETRY_MS);
        }
      }
    };

    // Drop the previous province's readings immediately. Retaining them while
    // the new request is in flight renders one province's water levels under
    // another province's name — unacceptable for a hazard display. (Scrubbing
    // the timeline within the same province keeps the last frame instead.)
    setState((s) =>
      s.data && s.data.summary.provinceCode === provinceCode
        ? { ...s, loading: true }
        : { data: null, loading: true, error: null },
    );
    void load();
    const timer = window.setInterval(load, REFRESH_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [provinceCode, atIso]);

  return state;
}
