import { useEffect, useState } from "react";
import type { StormsResponse } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";
import { nextReconnectDelayMs } from "../lib/feed/backoff";

export interface StormsState {
  data: StormsResponse | null;
  loading: boolean;
  error: ErrorMessage | null;
}

// ฝั่ง backend (StormTrackDO) ถาม JMA/GDACS ทุก 30 นาที และ route ส่ง s-maxage=300 —
// โพลถี่กว่า 10 นาทีไม่ได้ความสดเพิ่ม (รูปแบบเดียวกับ useProvinceForecast.ts)
const REFRESH_MS = 10 * 60 * 1000;

/**
 * เส้นทางพายุหมุนเขตร้อน (ชั้นพายุ v1) — **คำขอเดียวระดับประเทศ** (`/api/v1/storms`)
 * ไม่ผูกกับจังหวัด: `nearestKmByProvince` มีครบทั้ง 77 จังหวัดในคำตอบเดียว การสลับ
 * จังหวัดจึงไม่ยิงคำขอใหม่ ต้องมี hook นี้ตัวเดียวใน App.tsx (ส่งต่อผ่าน PanelContext)
 *
 * โครงสร้าง effect ลอกจาก `useProvinceForecast.ts` (AbortController + cancelled flag,
 * backoff เมื่อพลาด, คง data เดิมไว้เมื่อรอบใหม่พลาด)
 *
 * `storms: []` เป็นคำตอบ 200 ปกติ — ความหมายขึ้นกับ `sources[].lastSuccessAt` (ไม่มีพายุ
 * ตามแหล่งที่ติดต่อได้ ≠ ยังไม่เคยดึงสำเร็จ) ส่วน `error` คือคำขอของเว็บเองพลาด
 */
export function useStorms(): StormsState {
  const [state, setState] = useState<StormsState>({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let attempt = 0;
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch("/api/v1/storms", { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as StormsResponse;
        if (cancelled) return;
        attempt = 0;
        setState({ data, loading: false, error: null });
        timer = window.setTimeout(load, REFRESH_MS);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        // คง data เดิมไว้ — แผงหรี่รายการเดิมพร้อมบอกว่ารอบล่าสุดดึงพลาด
        setState((s) => ({ ...s, loading: false, error: errorMessage(err, "error.loadFailed") }));
        const delay = nextReconnectDelayMs(attempt);
        attempt += 1;
        timer = window.setTimeout(load, delay);
      }
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  return state;
}
