import { useEffect, useState } from "react";
import type { ActiveAlertsResponse } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";
import { nextReconnectDelayMs } from "../lib/feed/backoff";

export interface ActiveAlertsState {
  data: ActiveAlertsResponse | null;
  loading: boolean;
  /**
   * ตั้งเมื่อคำขอเองล้มเหลว (เครือข่ายขาด หรือ backend ตอบ non-2xx เช่น 503 ตอน
   * `AlertEngineDO` ล้ม) — ต่างจาก `data.evaluatedAt === null` ซึ่งเป็นคำตอบ
   * **สำเร็จ** ที่บอกว่าเอนจินยังไม่เคยประเมินเลย สองเรื่องนี้ต้องแสดงข้อความ
   * คนละแบบ: "ติดต่อระบบแจ้งเตือนไม่ได้" (error) กับ "ยังไม่เคยประเมิน"
   * (data.evaluatedAt === null) — ห้ามพับเป็นสถานะเดียวกัน
   */
  error: ErrorMessage | null;
}

// เอนจินประเมินทุก 5 นาที (alarm ของ AlertEngineDO) — poll ถี่กว่านั้นเล็กน้อยก็พอ
const REFRESH_MS = 5 * 60 * 1000;

/**
 * แจ้งเตือนที่กำลัง active ของจังหวัดหนึ่ง (E11.5) — ใช้ทั้ง `ActiveAlertBanner`
 * (ทั้งจังหวัด) และแหล่งข้อมูลตั้งต้นให้ `ImpactSummaryCard`/`AffectedAuthorityList`
 * กรองเอาเฉพาะ อปท. ที่ตัวเองสนใจต่อ (client-side filter บน `alerts[]` เดียวกัน
 * แทนที่จะยิง `?localAuthorityId=` ซ้ำอีกรอบ — ข้อมูลชุดเดียวกันอยู่แล้ว)
 */
export function useActiveAlerts(provinceCode: string | null): ActiveAlertsState {
  const [state, setState] = useState<ActiveAlertsState>({ data: null, loading: true, error: null });

  useEffect(() => {
    setState({ data: null, loading: provinceCode !== null, error: null });
    if (!provinceCode) return;

    let cancelled = false;
    let timer: number | null = null;
    let attempt = 0;
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(`/api/v1/alerts/active?province=${provinceCode}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ActiveAlertsResponse;
        if (cancelled) return;
        attempt = 0;
        setState({ data, loading: false, error: null });
        timer = window.setTimeout(load, REFRESH_MS);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        // คง data เดิมไว้ (ถ้ามี) — แถบแจ้งเตือนหรี่ลงพร้อมบอกว่าดึงพลาด แทนที่จะ
        // สลับไปแสดง "ไม่มีอะไร active" ซึ่งไม่จริง
        setState((s) => ({ ...s, loading: false, error: errorMessage(err, "error.loadFailed") }));
        // ล้มเหลวติดกันหลายรอบ = ถอยห่างขึ้นเรื่อย ๆ (เพดาน 30 วิ) แทนที่จะยิงรัว
        // ทุก ๆ ไม่กี่วินาทีตอนต้นทางกำลังมีปัญหาอยู่แล้ว — ใช้ backoff ตัวเดียวกับ
        // useLocalAuthorityImpact.ts/useAffectedAuthorities.ts
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
