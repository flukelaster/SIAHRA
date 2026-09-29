import { useEffect, useRef, useState } from "react";
import type { RiverForecastResponse } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";
import { nextForecastPollDelayMs } from "../lib/pollSchedule";
import { startPolling, type PollMemo } from "./useNorthRoute";

/**
 * ผลลัพธ์แบบจำลองพยากรณ์ของ HII (`GET /api/v1/rivers/forecast`) — **hook ตัวเดียว** ใน App.tsx ส่งต่อผ่าน
 * `PanelContext.riverForecast` (ไม่ใช่ `forecast` ซึ่งเป็นของ TMD) ใช้เฉพาะการ์ด `NorthWaterCard`
 *
 * - `enabled` = แผง north ถูกเรนเดอร์อยู่ (`northPanel` ใน App.tsx): แผงปิด = ไม่ยิงคำขอเลย รวมถึงตอนเริ่มแอป
 * - **ไม่มี query string** (คีย์แคชที่ขอบไม่มี query) และรอบถามทั้งหมดตัดสินใน `lib/pollSchedule.ts`
 *   `nextForecastPollDelayMs`: 15 นาที, ล้มเหลวรอ 120 วิ, แท็บซ่อน = ไม่ตั้ง timer
 * - ล้มเหลว = คงชุดล่าสุดที่ได้ไว้ (การ์ดหรี่ + บอกว่า "คำขอของเว็บพลาด" ตั้งแต่เมื่อไร) ไม่ล้างทิ้ง
 * - `data.layer.fetchedAt` / `data.source.lastSuccessAt` เป็น null = API ยังไม่เคยดึงต้นทางสำเร็จ (ไม่ใช่ "ตอนนี้")
 *
 * ใช้ `startPolling` ร่วมกับ `useNorthRoute` (visibilitychange, timer ไม่ซ้อน, ความจำของรอบอยู่ข้ามการเปิด/ปิดแผง)
 */
export interface RiverForecastState {
  data: RiverForecastResponse | null;
  loading: boolean;
  /** คำขอของเว็บเองพลาดในรอบล่าสุด — ไม่ใช่สถานะของต้นทาง HII (นั่นอยู่ใน `data.source`) */
  error: ErrorMessage | null;
  /** เวลา (ISO, นาฬิกาเครื่องนี้) ที่คำขอเริ่มพลาดต่อเนื่อง — null เมื่อรอบล่าสุดสำเร็จ */
  errorSince: string | null;
}

export function useRiverForecast(enabled: boolean): RiverForecastState {
  const [state, setState] = useState<RiverForecastState>({ data: null, loading: true, error: null, errorSince: null });
  const memo = useRef<PollMemo>({ lastSuccessAtMs: null, lastWasError: false });

  useEffect(() => {
    if (!enabled) return;
    return startPolling<RiverForecastResponse>({
      url: "/api/v1/rivers/forecast",
      memo: memo.current,
      panelOpen: enabled,
      nextDelay: nextForecastPollDelayMs,
      onOk: (data) => setState({ data, loading: false, error: null, errorSince: null }),
      onError: (err) =>
        setState((s) => ({
          ...s,
          loading: false,
          error: errorMessage(err, "error.loadFailed"),
          errorSince: s.errorSince ?? new Date().toISOString(),
        })),
    });
  }, [enabled]);

  return state;
}
