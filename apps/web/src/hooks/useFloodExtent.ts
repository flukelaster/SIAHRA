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
/** ระหว่างลาก TimelineBar ค่า atIso เปลี่ยนรัว ๆ — รอให้นิ่งก่อนยิงคำขอย้อนหลัง */
const HISTORICAL_DEBOUNCE_MS = 300;
const SNAP_MS = 10 * 60 * 1000;

/**
 * ปัด `at` ลงเป็นช่วง 10 นาที — TimelineBar ส่งค่าปัดมาแล้ว แต่ permalink `?t=`
 * อาจไม่ปัด ถ้าไม่ปัดซ้ำตรงนี้ URL จะต่างจากที่ CDN แคชไว้ทั้งที่ตอบฉากเดียวกัน
 */
export function snapAtIso(atIso: string): string | null {
  const t = Date.parse(atIso);
  if (!Number.isFinite(t)) return null;
  return new Date(Math.floor(t / SNAP_MS) * SNAP_MS).toISOString();
}

/**
 * GISTDA satellite flood-extent polygons for the selected province. This is
 * an observed layer (interpreted satellite scene) with no upstream timestamp,
 * so consumers must display `retrievedAt` / per-feature first/last-seen and
 * never present it as a live "now" picture.
 *
 * `atIso` (E14.F1): null = the live scene, polled every 10 minutes; set = the
 * scene that covered that instant (`?at=`), fetched once — the past does not
 * change, so there is nothing to poll for.
 */
export function useFloodExtent(provinceCode: string | null, atIso: string | null = null): FloodExtentState {
  const [state, setState] = useState<FloodExtentState>({ data: null, loading: true, error: null });
  const snappedAt = atIso ? snapAtIso(atIso) : null;

  useEffect(() => {
    if (!provinceCode) return;
    let cancelled = false;
    let timer: number | null = null;
    const controller = new AbortController();
    const qs = snappedAt ? `?at=${encodeURIComponent(snappedAt)}` : "";
    const load = async () => {
      try {
        const res = await fetch(`/api/v1/provinces/${provinceCode}/flood-extent${qs}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as FloodExtentResponse;
        if (cancelled) return;
        setState({ data, loading: false, error: null });
        // ย้อนหลัง: ฉากที่ครอบเวลานั้นตายตัวแล้ว ไม่ต้อง poll — retrievedAt null ตรงนี้
        // แปลว่า "ไม่มีฉากที่เก็บไว้" (reason) ไม่ใช่ "กำลังดึง" จึงไม่ retry เช่นกัน
        if (snappedAt) return;
        // retrievedAt = null คือฝั่ง API ยังดึงฉากแรกไม่สำเร็จ (หรือกำลังวิ่งอยู่)
        // อย่ารอครบ 10 นาที ไม่งั้นการ์ดจะยืนยันว่า "ต้นทางไม่ตอบสนอง" ทั้งที่ข้อมูลมาแล้ว
        timer = window.setTimeout(load, data.retrievedAt ? REFRESH_MS : RETRY_MS);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setState((s) => ({ ...s, loading: false, error: errorMessage(err, "error.loadFailed") }));
        // ย้อนหลังไม่ retry เช่นกัน — หนึ่ง gesture = หนึ่ง request (devops constraint F1)
        if (snappedAt) return;
        timer = window.setTimeout(load, RETRY_MS);
      }
    };
    setState({ data: null, loading: true, error: null });
    if (snappedAt) {
      timer = window.setTimeout(load, HISTORICAL_DEBOUNCE_MS);
    } else {
      void load();
    }
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [provinceCode, snappedAt]);

  return state;
}
