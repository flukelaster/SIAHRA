import { useEffect, useState } from "react";
import type { ProvinceForecastResponse } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";
import { nextReconnectDelayMs } from "../lib/feed/backoff";

export interface ProvinceForecastState {
  data: ProvinceForecastResponse | null;
  loading: boolean;
  error: ErrorMessage | null;
}

// ฝั่ง backend (ForecastNwpDO, E12.2) ดึงจาก TMD ใหม่แค่ทุกชั่วโมง — โพลถี่กว่านั้น
// ไม่ได้ความสดเพิ่มขึ้นเลย ใช้ 10 นาทีเท่ากับ `useFloodExtent.ts` ซึ่งเกินเพดาน
// 120 วิ (s-maxage ของ /observations) ของ devops cost gate (PR #58) อยู่มาก และ
// hook นี้ยิงคำขอเฉพาะจังหวัดที่กำลังเลือกอยู่ตัวเดียวเท่านั้น ไม่วนทั้ง 77 จังหวัด —
// ทั้งสองข้อคือเงื่อนไขที่ gate นั้นตั้งไว้ตรง ๆ
const REFRESH_MS = 10 * 60 * 1000;

/**
 * พยากรณ์ตัวเลขเชิงเวลา (NWP) ของ TMD สำหรับจังหวัดที่เลือกอยู่ — E12.3
 *
 * โครงสร้าง effect ลอกมาจาก `useActiveAlerts.ts` ตรง ๆ (reset state ก่อนเช็ค
 * guard `provinceCode`, AbortController + cancelled flag, backoff เมื่อพลาด)
 * ไม่ใช่ `useFloodExtent.ts` ที่ reset state หลัง guard — ผลคือ state ไม่เคลียร์
 * เมื่อ `provinceCode` กลายเป็น null ซึ่งเป็นบั๊กที่ตั้งใจไม่ลอกมาที่นี่
 *
 * `data.batch === null` เป็นคำตอบ 200 ปกติ (ยังไม่เคยดึงจาก TMD สำเร็จเลยฝั่ง
 * backend) ไม่ใช่ error — คอมโพเนนต์ที่ใช้ hook นี้ต้องแยกแสดงกับ `error` (คำขอ
 * ของฝั่งเว็บเองล้มเหลว) ให้ชัด
 */
export function useProvinceForecast(provinceCode: string | null): ProvinceForecastState {
  const [state, setState] = useState<ProvinceForecastState>({ data: null, loading: true, error: null });

  useEffect(() => {
    setState({ data: null, loading: provinceCode !== null, error: null });
    if (!provinceCode) return;

    let cancelled = false;
    let timer: number | null = null;
    let attempt = 0;
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(`/api/v1/provinces/${provinceCode}/forecast`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ProvinceForecastResponse;
        if (cancelled) return;
        attempt = 0;
        setState({ data, loading: false, error: null });
        timer = window.setTimeout(load, REFRESH_MS);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        // คง data เดิมไว้ (ถ้ามี) — การ์ดหรี่ตัวเลขลงพร้อมบอกว่าดึงพลาด แทนที่จะ
        // สลับไปแสดง "ยังไม่เคยได้รับข้อมูล" ทั้งที่เคยมีข้อมูลอยู่ก่อนแล้ว
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
  }, [provinceCode]);

  return state;
}
