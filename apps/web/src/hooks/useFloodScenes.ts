import { useEffect, useState } from "react";
import type { FloodSceneIndex } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";
import { isFloodSceneIndex } from "../lib/floodScenes";

export interface FloodScenesState {
  index: FloodSceneIndex | null;
  /**
   * true = `index.json` ตอบ 404: จังหวัดนี้ **ยังไม่มีฉากในระบบ** (job ยังไม่เคย
   * เขียนดัชนี) — เป็นข้อเท็จจริงจากเซิร์ฟเวอร์ ต่างจาก `error` ที่แปลว่าถามไม่ได้
   */
  missing: boolean;
  loading: boolean;
  error: ErrorMessage | null;
}

const REFRESH_MS = 10 * 60 * 1000;
/** ดึงไม่สำเร็จ (สด): ลองใหม่ช้ากว่า useFloodExtent เพราะไฟล์นี้ผ่าน CDN ไม่ใช่ DO */
const RETRY_MS = 60 * 1000;
/** ระหว่างลาก TimelineBar — รอให้นิ่งก่อนยิง (กฎเดียวกับ useFloodExtent) */
const HISTORICAL_DEBOUNCE_MS = 300;

/**
 * รายการฉาก Copernicus GFM ของจังหวัด (`/aoi/{code}/flood/index.json`, E14.F3)
 *
 * ต้นทุน (devops gate ของ F3): ดัชนีต่อจังหวัดถูกขอ **ไม่เกินหนึ่งครั้งต่อ 5 นาที**
 * ในสภาวะปกติ — ที่นี่ poll ทุก 10 นาทีขณะดูสด และ **ครั้งเดียว** เมื่อเข้าโหมด
 * ย้อนหลัง (`atIso` ไม่ null): ดัชนีเป็นไฟล์เดียวกันไม่ว่าจะเลือกเวลาไหน การเลือก
 * ฉากตามเวลาเกิดฝั่ง client (`lib/floodScenes.ts`) จึงไม่ต้องยิงซ้ำทุกครั้งที่
 * เลื่อนเส้นเวลา — deps ของ effect คือ "สดหรือย้อนหลัง" ไม่ใช่ตัว `atIso` เอง
 * หนึ่ง gesture จึงเกิดคำขอดัชนีได้อย่างมากหนึ่งครั้ง (หลัง debounce 300 ms)
 * และโหมดย้อนหลังไม่ retry เมื่อล้มเหลว
 *
 * 404 = ยังไม่มีฉากของจังหวัดนี้ (`missing`) ไม่ใช่ความล้มเหลวของเครือข่าย —
 * สองอย่างนี้ต้องแยกกันบน legend (AGENTS.md: "ถามไม่ได้" ≠ "ต้นทางบอกว่าไม่มี")
 */
export function useFloodScenes(provinceCode: string | null, atIso: string | null = null): FloodScenesState {
  const [state, setState] = useState<FloodScenesState>({ index: null, missing: false, loading: true, error: null });
  const historical = atIso !== null;

  useEffect(() => {
    if (!provinceCode) return;
    let cancelled = false;
    let timer: number | null = null;
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(`/aoi/${provinceCode}/flood/index.json`, { signal: controller.signal });
        if (res.status === 404) {
          if (cancelled) return;
          setState({ index: null, missing: true, loading: false, error: null });
          // ยังไม่มีดัชนี = job ยังไม่เคยเขียน; รอบถัดไปตามคาบปกติ ไม่ใช่ retry ถี่ ๆ
          if (!historical) timer = window.setTimeout(load, REFRESH_MS);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: unknown = await res.json();
        if (!isFloodSceneIndex(json)) throw new Error("flood index.json: unexpected shape");
        if (cancelled) return;
        setState({ index: json, missing: false, loading: false, error: null });
        if (historical) return;
        timer = window.setTimeout(load, REFRESH_MS);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setState((s) => ({ ...s, loading: false, error: errorMessage(err, "error.loadFailed") }));
        // ย้อนหลังไม่ retry — หนึ่ง gesture = ไม่เกินหนึ่งคำขอ
        if (historical) return;
        timer = window.setTimeout(load, RETRY_MS);
      }
    };
    // สลับสด ↔ ย้อนหลังของจังหวัดเดิม: เก็บดัชนีเดิมไว้ระหว่างโหลดซ้ำ (ไฟล์เดียวกัน) —
    // ไม่งั้นรายการรอบบิน/ขีดบนเส้นเวลา/ฉากที่วาดจะหายไป 300 ms ทุกครั้งที่กดเลือกฉาก
    // จากแผง (E14.F5) เปลี่ยนจังหวัดยังรีเซ็ตเป็น null เหมือนเดิม จำนวนคำขอไม่เปลี่ยน
    setState((s) =>
      s.index?.provinceCode === provinceCode
        ? { ...s, loading: true, error: null }
        : { index: null, missing: false, loading: true, error: null },
    );
    if (historical) {
      timer = window.setTimeout(load, HISTORICAL_DEBOUNCE_MS);
    } else {
      void load();
    }
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [provinceCode, historical]);

  return state;
}
