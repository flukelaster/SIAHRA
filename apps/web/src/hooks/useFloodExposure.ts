import { useEffect, useState } from "react";
import type { ProvinceExposureResponse } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";

/**
 * เหตุผลของ 503 จาก `/provinces/{NN}/exposure/latest` — สามค่านี้มาจาก field
 * `reason` ที่ `apps/api/src/routes/exposure.ts` ใส่ในบอดี้ ไม่ใช่การเดาจากข้อความ
 * `error` (ห้ามจับข้อความมาตัดสิน เพราะข้อความอ่านง่ายเปลี่ยนได้โดยไม่ตั้งใจทำลาย
 * สัญญา แต่ `reason` เป็นค่าคงที่ที่ตั้งใจให้ client อ่าน):
 * - `"never-published"` = ยังไม่เคยเผยแพร่ run เลย (pointer เป็น null)
 * - `"missing"`         = pointer ชี้ไปที่ run ที่เคยเผยแพร่จริง แต่ object หายจาก R2
 * - `"error"`           = ล้มเหลวระหว่างพยายามอ่าน ไม่รู้ด้วยซ้ำว่า run มีอยู่ไหม
 * `null` = ยังไม่เคยได้ 503 ที่มี field นี้เลย (รวมถึงตอน apiUnreachable ซึ่งไม่มี
 * บอดี้ให้อ่าน และตอนบอดี้อ่านไม่ได้/ไม่มี field นี้ — backend รุ่นเก่ากว่านี้)
 */
export type ExposureUnavailableReason = "never-published" | "missing" | "error";

function isExposureUnavailableReason(v: unknown): v is ExposureUnavailableReason {
  return v === "never-published" || v === "missing" || v === "error";
}

/** พก `reason` มาด้วยจาก HTTP layer ไปถึง `catch` โดยไม่ต้องแยก state คนละก้อน */
class ExposureUnavailableError extends Error {
  reason: ExposureUnavailableReason | null;
  constructor(message: string, reason: ExposureUnavailableReason | null) {
    super(message);
    this.reason = reason;
  }
}

export interface FloodExposureState {
  /**
   * run ล่าสุดที่ดึงสำเร็จของจังหวัดนี้ — **ไม่ถูกล้างเมื่อรอบถัดไปล้มเหลว**
   * ชั้นนี้ต้องหรี่ลงแล้วบอกว่าไม่มีผลคำนวณรอบใหม่ตั้งแต่เมื่อไหร่ ไม่ใช่หายไปเฉย ๆ
   */
  data: ProvinceExposureResponse | null;
  loading: boolean;
  error: ErrorMessage | null;
  /**
   * true = ความพยายามดึงครั้งล่าสุดล้มเหลว (api ล่ม หรือ 503 ด้วยเหตุผลใดก็ตาม —
   * ยังไม่เคยเผยแพร่ run / เผยแพร่แล้วแต่หาย / อ่านพัง ดู `noRunReason` แยกสามเรื่อง
   * นี้) ถ้ามี `data` อยู่ด้วย แปลว่าสิ่งที่เห็นบนแผนที่คือ run เก่า
   */
  failing: boolean;
  /**
   * true เฉพาะเมื่อ `fetch()` เอง**ไปไม่ถึงเซิร์ฟเวอร์เลย** (เครือข่ายขาด/DNS/ยกเลิก
   * ไม่ใช่ error ที่ผู้ใช้สั่ง) — คำตอบ HTTP ใด ๆ ที่ได้กลับมา **นับเป็นเซิร์ฟเวอร์ตอบแล้ว**
   * แม้จะเป็น `503 "No flood-exposure run has been published yet"` (ดู
   * `apps/api/src/routes/exposure.ts`) ก็ตาม — นั่นคือคำตอบจริงจากต้นทาง ไม่ใช่
   * "ติดต่อไม่ได้" การนับสองอย่างนี้เป็นก้อนเดียวกัน (เหมือนที่เคยเป็นก่อนแก้ไข)
   * ทำให้ legend บอกว่า "ติดต่อ API ไม่ได้" ทั้งที่ API ตอบมาแล้วว่า "ยังไม่เคยมี run"
   * ซึ่งเป็นข้อเท็จจริงคนละเรื่องกัน (ดู `apiDownNoRun` vs `noRunEver` ใน MapLegend.tsx)
   */
  apiUnreachable: boolean;
  /**
   * เหตุผลของ 503 ล่าสุด เมื่อ `data` เป็น `null` (ไม่เคยมี run ในเครื่องเลย) —
   * legend ต้องแยกสามข้อเท็จจริงนี้ออกจากกัน: "ยังไม่เคยเผยแพร่" ต่างจาก "เผยแพร่
   * แล้วแต่หาย" ต่างจาก "ไม่รู้เพราะอ่านพัง" (ดูคำอธิบายที่ `ExposureUnavailableReason`)
   * `null` = ยังไม่มีคำตอบ 503 ที่มี reason เลย (รวมกรณี apiUnreachable ที่ไม่มีบอดี้
   * ให้อ่าน) — ต้องไม่ตีความว่าเป็น "never-published" เพราะอาจแค่ยังไม่ได้ถาม
   */
  noRunReason: ExposureUnavailableReason | null;
}

const EMPTY: FloodExposureState = {
  data: null,
  loading: false,
  error: null,
  failing: false,
  apiUnreachable: false,
  noRunReason: null,
};

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
      let res: Response;
      try {
        res = await fetch(`/api/v1/provinces/${provinceCode}/exposure/latest`, {
          signal: controller.signal,
        });
      } catch {
        if (cancelled || controller.signal.aborted) return;
        // `fetch()` เองไม่เคยได้คำตอบกลับมา — นี่คือกรณีเดียวที่นับเป็น "ติดต่อ API
        // ไม่ได้" จริง ๆ ต่างจากคำตอบ HTTP ใด ๆ (รวม 503) ซึ่งแปลว่าเซิร์ฟเวอร์ตอบแล้ว
        //
        // ตั้งเป็น `{ key: ... }` ตรง ๆ ไม่ผ่าน errorMessage(): errorMessage() คืน
        // `{ raw: err.message }` ทันทีที่ err เป็น instance ของ Error (ดู errorMessage.ts)
        // โดยไม่สนใจ fallbackKey ที่ส่งเข้าไปเลย — ห่อ err ด้วย Error ของเราเองแล้วส่งผ่าน
        // มันจะได้ข้อความภายในที่ไม่ได้แปล ("fetch failed" ฯลฯ) ไม่ใช่คีย์นี้ จึงไม่รับ
        // err มาเลย (ไม่มีอะไรต้องอ้างถึง — สาเหตุไม่เปลี่ยนข้อความที่แสดง)
        setState((s) => ({
          ...s,
          loading: false,
          error: { key: "error.networkUnreachable" },
          failing: true,
          apiUnreachable: true,
          // "ติดต่อไม่ได้" ไม่บอกอะไรเรื่อง run เลย — ไม่แบก reason ของ 503 ครั้งก่อน
          // (ถ้ามี) ข้ามมาด้วย เพราะมันอาจไม่จริงอีกแล้วตอนนี้ก็ได้
          noRunReason: null,
        }));
        timer = window.setTimeout(load, RETRY_MS);
        return;
      }
      try {
        // เซิร์ฟเวอร์ตอบมาแล้ว (สถานะใดก็ตาม) — `!res.ok` ไม่ใช่ "ติดต่อไม่ได้" อีกต่อไป
        // เส้นทางนี้มี**สาม**ความหมายของ 503 คนละเรื่องกัน (ดู exposure.ts): ยังไม่เคย
        // เผยแพร่ / เผยแพร่แล้วแต่ object หายจาก R2 / ล้มเหลวระหว่างอ่านโดยไม่รู้ว่า
        // run มีอยู่ไหม — ต้องอ่าน `reason` จากบอดี้มาแยกสามเรื่องนี้ ไม่ใช่จับคำใน
        // `error` message (ซึ่งเป็นข้อความอ่านง่ายที่แก้ไขได้โดยไม่ตั้งใจทำลายสัญญา)
        if (!res.ok) {
          let reason: ExposureUnavailableReason | null = null;
          try {
            const body = (await res.json()) as { reason?: unknown };
            if (isExposureUnavailableReason(body.reason)) reason = body.reason;
          } catch {
            // บอดี้อ่านไม่ได้ หรือไม่ใช่ JSON — reason ยังคง null (ไม่รู้เหตุผล
            // ไม่ใช่การเดาว่าเป็น "never-published")
          }
          throw new ExposureUnavailableError(`HTTP ${res.status}`, reason);
        }
        const data = (await res.json()) as ProvinceExposureResponse;
        if (cancelled) return;
        setState({
          data,
          loading: false,
          error: null,
          failing: false,
          apiUnreachable: false,
          noRunReason: null,
        });
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
          apiUnreachable: false,
          noRunReason: err instanceof ExposureUnavailableError ? err.reason : null,
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
