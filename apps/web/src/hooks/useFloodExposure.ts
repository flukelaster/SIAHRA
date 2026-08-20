import { useEffect, useState } from "react";
import type { ProvinceExposureResponse } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";

export interface FloodExposureState {
  /**
   * run ล่าสุดที่ดึงสำเร็จของจังหวัดนี้ — **ไม่ถูกล้างเมื่อรอบถัดไปล้มเหลว**
   * ชั้นนี้ต้องหรี่ลงแล้วบอกว่าไม่มีผลคำนวณรอบใหม่ตั้งแต่เมื่อไหร่ ไม่ใช่หายไปเฉย ๆ
   */
  data: ProvinceExposureResponse | null;
  loading: boolean;
  error: ErrorMessage | null;
  /**
   * true = ความพยายามดึงครั้งล่าสุดล้มเหลว (api ล่ม หรือยังไม่เคยมี run เผยแพร่ →
   * 503) ถ้ามี `data` อยู่ด้วย แปลว่าสิ่งที่เห็นบนแผนที่คือ run เก่า
   */
  failing: boolean;
}

const EMPTY: FloodExposureState = { data: null, loading: false, error: null, failing: false };

/** ฝั่ง api คำนวณ run ใหม่ทุกรอบ refresh ของ ThaiWater — ตามด้วยคาบเดียวกัน */
const REFRESH_MS = 5 * 60 * 1000;
const RETRY_MS = 20 * 1000;

/**
 * "ระดับการเผชิญน้ำ (ภาพประกอบ)" ของจังหวัดที่กำลังดู (E10.3 → E10.4)
 *
 * `enabled` ผูกกับสวิตช์ใน legend และชั้นนี้ **ปิดไว้เป็นค่าเริ่มต้น** — ปิดอยู่
 * จึงไม่มีการ poll เลยแม้แต่ครั้งเดียว (รูปแบบเดียวกับ `useRadar`)
 *
 * สิ่งที่ hook นี้ตั้งใจ **ไม่** ทำ:
 * - ไม่ประกอบ `HazardLayerDescriptor` เอง — ใช้ `data.layer` ที่ api ประกาศมาตรง ๆ
 *   (เวลาใน legend จึงเป็นเวลาที่ backend ดึงจริง ไม่ใช่เวลาของเครื่องผู้อ่าน)
 * - ไม่คำนวณ "อายุ" ของ run เก็บไว้ — อายุเกิดตอนเรนเดอร์เท่านั้น
 * - ไม่แทน `fetchedAt: null` ด้วยเวลาใด ๆ
 */
export function useFloodExposure(
  provinceCode: string | null,
  enabled: boolean,
): FloodExposureState {
  const [state, setState] = useState<FloodExposureState>(EMPTY);

  useEffect(() => {
    // สลับจังหวัด หรือปิดชั้น = ทิ้ง run ของรอบก่อนเสมอ — ห้ามให้ run ของจังหวัด
    // ก่อนหน้าค้างอยู่บนแผนที่ของจังหวัดใหม่แม้เสี้ยววินาที
    setState({ ...EMPTY, loading: enabled && provinceCode !== null });
    if (!enabled || !provinceCode) return;

    let cancelled = false;
    let timer: number | null = null;
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(`/api/v1/provinces/${provinceCode}/exposure/latest`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ProvinceExposureResponse;
        if (cancelled) return;
        setState({ data, loading: false, error: null, failing: false });
        timer = window.setTimeout(load, REFRESH_MS);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        // คง `data` เดิมไว้: ชั้นจะถูกวาดแบบหรี่พร้อมข้อความว่าไม่มีผลคำนวณรอบใหม่
        // ตั้งแต่เมื่อไหร่ ซึ่งซื่อสัตย์กว่าการทำให้ชั้นหายไปเงียบ ๆ
        setState((s) => ({
          ...s,
          loading: false,
          error: errorMessage(err, "error.loadFailed"),
          failing: true,
        }));
        timer = window.setTimeout(load, RETRY_MS);
      }
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [provinceCode, enabled]);

  return state;
}
