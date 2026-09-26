import { useEffect, useRef, useState } from "react";
import type { DamsResponse, NorthRouteResponse, NorthRouteTopology } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";
import { nextDamsPollDelayMs, nextRoutePollDelayMs, type PollDelayInput } from "../lib/pollSchedule";

/**
 * ข้อมูลของเส้นทางน้ำเหนือ (E16) — **hook ตัวเดียว** ใน App.tsx ที่ทั้งแผง `NorthWaterCard`
 * และชั้นเส้นลำน้ำ 3 มิติ (`scene/NorthRouteRivers.ts`, E16 B-1) อ่านร่วมกัน
 * `enabled` = ชั้น `northRoute` เปิด **หรือ** แผง north ถูกเรนเดอร์อยู่ — ปิดทั้งสองอย่าง =
 * ไม่ยิงคำขอเลย (รูปแบบเดียวกับ `useRadar(layers.radar)`) ค่าที่โหลดไว้แล้วคงอยู่ในสถานะ
 * `panelOpen` = แผง north ถูกเรนเดอร์อยู่ (นิพจน์ `northPanel` ใน App.tsx) — กำหนดทั้งรอบถาม
 * เส้นทาง (5 นาทีเมื่อแผงเปิด / 10 นาทีเมื่อเปิดเฉพาะชั้น 3 มิติ) และการถามเขื่อน (เฉพาะแผง)
 *
 * สามแหล่ง แต่ละแหล่งมีสถานะของตัวเอง (อันหนึ่งล่มไม่ลบอีกอัน):
 * - `/rivers/north-route.json` — ผังคงที่ (static-reference) โหลดครั้งเดียว
 * - `/api/v1/rivers/north` — ค่าตรวจวัด + 48 ชม. **ไม่มี query string เลย** (API ตอบ 400
 *   ถ้ามี และคีย์แคชที่ขอบไม่มี query) การเลื่อนเวลาบน TimelineBar ใช้ประวัติที่ถืออยู่แล้ว
 * - `/api/v1/dams` ทั้งประเทศ (endpoint เดิม) — เขื่อนบนเส้นทางกรองด้วย id ที่ผังระบุ
 *
 * รอบถามทั้งหมดตัดสินใน `lib/pollSchedule.ts` (ข้อจำกัดต้นทุน devops C1/C2/C5): แท็บซ่อน = ไม่ตั้ง
 * timer เลย, กลับมาเห็น = ยิงทันทีถ้าค่าอายุเกินรอบแล้ว ไม่งั้นรอส่วนที่เหลือ เวลาของความสำเร็จ
 * ครั้งล่าสุดอยู่ใน ref ที่อยู่ข้ามการรันซ้ำของ effect — แผงเปิด/ปิด (รอบเปลี่ยน) หรือชั้นถูกปิดแล้ว
 * เปิดใหม่จึงนับต่อจากรอบเดิม ไม่ยิงซ้ำทันที
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

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** ความจำของรอบถามหนึ่ง endpoint — อยู่ข้ามการรันซ้ำของ effect */
interface PollMemo {
  lastSuccessAtMs: number | null;
  lastWasError: boolean;
}

/**
 * เริ่มถามซ้ำหนึ่ง endpoint แล้วคืนตัวหยุด — ตั้ง timer ตาม `nextDelay` เท่านั้น, ผูก/ถอด
 * `visibilitychange` เอง (ซ่อน = ล้าง timer, เห็น = ตัดสินใหม่) และไม่ตั้ง timer ซ้อนขณะมีคำขอค้าง
 */
function startPolling<T>(opts: {
  url: string;
  memo: PollMemo;
  panelOpen: boolean;
  nextDelay: (input: PollDelayInput) => number | null;
  onOk: (value: T) => void;
  onError: (err: unknown) => void;
}): () => void {
  const { memo } = opts;
  let stopped = false;
  let inFlight: AbortController | null = null;
  let timer: number | null = null;
  const clearTimer = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    clearTimer();
    // คำขอที่ค้างอยู่จะเรียก schedule เองเมื่อจบ — ไม่ซ้อนรอบ
    if (stopped || inFlight) return;
    const delay = opts.nextDelay({
      lastSuccessAtMs: memo.lastSuccessAtMs,
      nowMs: Date.now(),
      hidden: document.visibilityState === "hidden",
      panelOpen: opts.panelOpen,
      lastWasError: memo.lastWasError,
    });
    if (delay === null) return;
    timer = window.setTimeout(() => void load(), delay);
  };
  const load = async () => {
    timer = null;
    const controller = new AbortController();
    inFlight = controller;
    try {
      const value = await getJson<T>(opts.url, controller.signal);
      if (stopped) return;
      memo.lastSuccessAtMs = Date.now();
      memo.lastWasError = false;
      opts.onOk(value);
    } catch (err) {
      if (stopped || controller.signal.aborted) return;
      // ค่าที่โหลดไว้แล้วคงอยู่ (อายุของมันแสดงอยู่ในแผง) — แค่บอกว่ารอบล่าสุดล้มเหลว
      memo.lastWasError = true;
      opts.onError(err);
    } finally {
      if (inFlight === controller) inFlight = null;
    }
    schedule();
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") clearTimer();
    else schedule();
  };
  document.addEventListener("visibilitychange", onVisibility);
  schedule();
  return () => {
    stopped = true;
    clearTimer();
    inFlight?.abort();
    inFlight = null;
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

export function useNorthRoute(enabled = true, panelOpen = enabled): NorthRouteState {
  const [state, setState] = useState<NorthRouteState>({
    topology: null,
    topologyError: null,
    route: null,
    routeError: null,
    dams: null,
    damsError: null,
    loading: true,
  });
  const routeMemo = useRef<PollMemo>({ lastSuccessAtMs: null, lastWasError: false });
  const damsMemo = useRef<PollMemo>({ lastSuccessAtMs: null, lastWasError: false });
  const topologyLoaded = state.topology !== null;

  // ผังคงที่ — โหลดครั้งเดียว (โหลดแล้วไม่ถามซ้ำแม้ชั้นถูกปิดแล้วเปิดใหม่)
  useEffect(() => {
    if (!enabled || topologyLoaded) return;
    let cancelled = false;
    const controller = new AbortController();
    void getJson<NorthRouteTopology>("/rivers/north-route.json", controller.signal)
      .then((topology) => {
        if (!cancelled) setState((s) => ({ ...s, topology, topologyError: null }));
      })
      .catch((err: unknown) => {
        if (!cancelled && !controller.signal.aborted) {
          setState((s) => ({ ...s, topologyError: errorMessage(err, "error.loadFailed") }));
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, topologyLoaded]);

  useEffect(() => {
    if (!enabled) return;
    return startPolling<NorthRouteResponse>({
      url: "/api/v1/rivers/north",
      memo: routeMemo.current,
      panelOpen,
      nextDelay: nextRoutePollDelayMs,
      onOk: (route) => setState((s) => ({ ...s, route, routeError: null, loading: false })),
      onError: (err) => setState((s) => ({ ...s, routeError: errorMessage(err, "error.loadFailed"), loading: false })),
    });
  }, [enabled, panelOpen]);

  // เขื่อนทั้งประเทศใช้เฉพาะในแผง — ชั้น 3 มิติไม่ใช้ จึงไม่ถามเพียงเพราะชั้นเปิดอยู่ (C5)
  useEffect(() => {
    if (!panelOpen) return;
    return startPolling<DamsResponse>({
      url: "/api/v1/dams",
      memo: damsMemo.current,
      panelOpen,
      nextDelay: nextDamsPollDelayMs,
      onOk: (dams) => setState((s) => ({ ...s, dams, damsError: null })),
      onError: (err) => setState((s) => ({ ...s, damsError: errorMessage(err, "error.loadFailed") })),
    });
  }, [panelOpen]);

  return state;
}
