import { useEffect, useState } from "react";
import type { DamsResponse, NorthRouteResponse, NorthRouteTopology } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";

/**
 * ข้อมูลของแผงเส้นทางน้ำเหนือ (E16) — ถูกเรียกจาก `NorthWaterCard` เท่านั้น ซึ่งถูก mount
 * เฉพาะตอนแผงเปิด จึงไม่มีการ poll ใด ๆ ขณะแผงปิด
 *
 * สามแหล่ง แต่ละแหล่งมีสถานะของตัวเอง (อันหนึ่งล่มไม่ลบอีกอัน):
 * - `/rivers/north-route.json` — ผังคงที่ (static-reference) โหลดครั้งเดียว
 * - `/api/v1/rivers/north` — ค่าตรวจวัด + 48 ชม. **ไม่มี query string เลย** (API ตอบ 400
 *   ถ้ามี และคีย์แคชที่ขอบไม่มี query) ถามซ้ำทุก 5 นาที (≥ 120 วิ ตามงบต้นทุน) การเลื่อน
 *   เวลาบน TimelineBar ใช้ประวัติที่ถืออยู่แล้ว ไม่ยิงคำขอใหม่
 * - `/api/v1/dams` ทั้งประเทศ (endpoint เดิม) — เขื่อนบนเส้นทางกรองด้วย id ที่ผังระบุ
 */
export interface NorthRouteState {
  topology: NorthRouteTopology | null;
  topologyError: ErrorMessage | null;
  route: NorthRouteResponse | null;
  routeError: ErrorMessage | null;
  dams: DamsResponse | null;
  damsError: ErrorMessage | null;
  loading: boolean;
}

const ROUTE_REFRESH_MS = 5 * 60 * 1000;
const DAMS_REFRESH_MS = 15 * 60 * 1000;
/** รอบที่ล้มเหลวก็ถามซ้ำไม่ถี่กว่า 120 วิ (คำตอบ 503 เป็น no-store = ทุกครั้งคือ RPC ใหม่ถึง DO) */
const RETRY_MS = 120_000;

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function useNorthRoute(): NorthRouteState {
  const [state, setState] = useState<NorthRouteState>({
    topology: null,
    topologyError: null,
    route: null,
    routeError: null,
    dams: null,
    damsError: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timers: number[] = [];

    void getJson<NorthRouteTopology>("/rivers/north-route.json", controller.signal)
      .then((topology) => {
        if (!cancelled) setState((s) => ({ ...s, topology, topologyError: null }));
      })
      .catch((err: unknown) => {
        if (!cancelled && !controller.signal.aborted) {
          setState((s) => ({ ...s, topologyError: errorMessage(err, "error.loadFailed") }));
        }
      });

    const loadRoute = async () => {
      try {
        const route = await getJson<NorthRouteResponse>("/api/v1/rivers/north", controller.signal);
        if (cancelled) return;
        setState((s) => ({ ...s, route, routeError: null, loading: false }));
        timers.push(window.setTimeout(loadRoute, ROUTE_REFRESH_MS));
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        // ค่าที่โหลดไว้แล้วคงอยู่ (อายุของมันแสดงอยู่ในแผง) — แค่บอกว่ารอบล่าสุดล้มเหลว
        setState((s) => ({ ...s, routeError: errorMessage(err, "error.loadFailed"), loading: false }));
        timers.push(window.setTimeout(loadRoute, RETRY_MS));
      }
    };

    const loadDams = async () => {
      try {
        const dams = await getJson<DamsResponse>("/api/v1/dams", controller.signal);
        if (cancelled) return;
        setState((s) => ({ ...s, dams, damsError: null }));
        timers.push(window.setTimeout(loadDams, DAMS_REFRESH_MS));
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setState((s) => ({ ...s, damsError: errorMessage(err, "error.loadFailed") }));
        timers.push(window.setTimeout(loadDams, DAMS_REFRESH_MS));
      }
    };

    void loadRoute();
    void loadDams();
    return () => {
      cancelled = true;
      controller.abort();
      for (const id of timers) window.clearTimeout(id);
    };
  }, []);

  return state;
}
