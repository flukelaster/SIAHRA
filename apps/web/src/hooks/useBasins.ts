import { useEffect, useRef, useState } from "react";
import type { BasinsResponse } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";
import { nextBasinsPollDelayMs } from "../lib/pollSchedule";
import { startPolling, type PollMemo } from "./useNorthRoute";

/**
 * มุมมองตามลุ่มน้ำ (`GET /api/v1/basins`) — **hook ตัวเดียว** ใน App.tsx ส่งต่อผ่าน `PanelContext.basins` ใช้เฉพาะการ์ด `BasinCard`
 *
 * - `enabled` = แผง basin ถูกเรนเดอร์อยู่ (`basinPanel` ใน App.tsx): แผงปิด = **ไม่ยิงคำขอเลย** รวมถึงตอนเริ่มแอป (devops C13)
 * - **ไม่มี query string** (คีย์แคชที่ขอบไม่มี query — มี query API ตอบ 400) และไม่มีคำขอรายสถานี/ประวัติ/observations ใด ๆ:
 *   คำขอเดียวทั้งประเทศ รอบถามตัดสินใน `lib/pollSchedule.ts` `nextBasinsPollDelayMs`: 10 นาที, ล้มเหลวรอ 120 วิ, แท็บซ่อน = ไม่ตั้ง timer
 * - ล้มเหลว = คงชุดล่าสุดที่ได้ไว้ (การ์ดหรี่ + บอกว่า "คำขอของเว็บพลาด" ตั้งแต่เมื่อไร) ไม่ล้างทิ้ง
 * - `data.fetchedAt` เป็น null = API ยังไม่เคยดึงระดับน้ำสำเร็จ (ไม่ใช่ "ตอนนี้" และไม่ใช่ "ไม่มีลุ่มน้ำ")
 *
 * ใช้ `startPolling` ร่วมกับ `useNorthRoute` (visibilitychange, timer ไม่ซ้อน, ความจำของรอบอยู่ข้ามการเปิด/ปิดแผง)
 */
export interface BasinsState {
  data: BasinsResponse | null;
  loading: boolean;
  /** คำขอของเว็บเองพลาดในรอบล่าสุด — ไม่ใช่สถานะของ ThaiWater (นั่นอยู่ใน `data.fetchedAt` / `/api/v1/health`) */
  error: ErrorMessage | null;
  /** เวลา (ISO, นาฬิกาเครื่องนี้) ที่คำขอเริ่มพลาดต่อเนื่อง — null เมื่อรอบล่าสุดสำเร็จ */
  errorSince: string | null;
}

export function useBasins(enabled: boolean): BasinsState {
  const [state, setState] = useState<BasinsState>({ data: null, loading: true, error: null, errorSince: null });
  const memo = useRef<PollMemo>({ lastSuccessAtMs: null, lastWasError: false });

  useEffect(() => {
    if (!enabled) return;
    return startPolling<BasinsResponse>({
      url: "/api/v1/basins",
      memo: memo.current,
      panelOpen: enabled,
      nextDelay: nextBasinsPollDelayMs,
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
