import { useEffect, useState } from "react";
import type { LocalAuthorityExposureResponse, LocalAuthorityImpactResponse } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";
import { nextReconnectDelayMs } from "../lib/feed/backoff";

/**
 * หนึ่งทรัพยากรของ อปท. ที่เลือกอยู่ (baseline exposure หรือ flood impact)
 *
 * `notFound` แยกออกจาก `error` โดยตั้งใจ: 404 ของสอง endpoint นี้แปลว่า "อปท.
 * รายนี้ไม่มีขอบเขต E11.2 จริง หรือไม่มีเส้นฐาน E11.3 ให้คำนวณ" ซึ่งเป็นข้อเท็จจริง
 * ถาวร (จนกว่าไปป์ไลน์จะรันใหม่) ไม่ใช่ความล้มเหลวชั่วคราวที่ควรลองใหม่ทุกไม่กี่
 * วินาทีอย่าง network/5xx — ฝั่ง UI จึงต้องแสดงข้อความคนละแบบ และ hook นี้จงใจ
 * **ไม่ตั้ง timer ลองใหม่** เมื่อเจอ 404 (ต่างจาก error ที่ backoff ต่อ)
 */
export interface LocalAuthorityResourceState<T> {
  data: T | null;
  loading: boolean;
  error: ErrorMessage | null;
  notFound: boolean;
}

const EMPTY = <T,>(): LocalAuthorityResourceState<T> => ({
  data: null,
  loading: false,
  error: null,
  notFound: false,
});

export interface LocalAuthorityImpactState {
  exposure: LocalAuthorityResourceState<LocalAuthorityExposureResponse>;
  impact: LocalAuthorityResourceState<LocalAuthorityImpactResponse>;
}

// exposure = E11.3 baseline (static-reference, สร้างครั้งเดียวต่อรอบ ETL) — รีเฟรช
// ห่าง ๆ พอ ไม่ต้องตามติดเหมือนข้อมูลสด
const EXPOSURE_REFRESH_MS = 30 * 60 * 1000;
// impact = E11.4 flood intersection สด (ขึ้นกับฉาก GISTDA ปัจจุบัน) — คาบเดียวกับ
// useFloodExtent.ts เพราะมันคือข้อมูลชุดเดียวกันที่ถูกตัดกับขอบเขต อปท.
const IMPACT_REFRESH_MS = 10 * 60 * 1000;

/**
 * ดึงทั้ง baseline exposure (E11.3) และ flood impact (E11.4) ของ อปท. หนึ่งราย
 * ที่ผู้ใช้เลือกจาก `AffectedAuthorityList` — สอง endpoint คนละคาบรีเฟรชกัน จึง
 * เป็นสอง polling loop อิสระ ไม่ใช่ทรัพยากรเดียว แต่ผูกกับ `authorityId` เดียวกัน
 * และรีเซ็ตพร้อมกันทุกครั้งที่เปลี่ยนตัวเลือก (ห้ามให้ตัวเลขของ อปท. เก่าค้างอยู่
 * ใต้หัวข้อของ อปท. ใหม่แม้เสี้ยววินาที — นี่คือบั๊กที่เวอร์ชันก่อนถูกย้อนกลับเจอ)
 */
export function useLocalAuthorityImpact(authorityId: string | null): LocalAuthorityImpactState {
  const exposure = useLocalAuthorityResource<LocalAuthorityExposureResponse>(
    authorityId,
    (id) => `/api/v1/local-authorities/${id}/exposure`,
    EXPOSURE_REFRESH_MS,
  );
  const impact = useLocalAuthorityResource<LocalAuthorityImpactResponse>(
    authorityId,
    (id) => `/api/v1/local-authorities/${id}/impact`,
    IMPACT_REFRESH_MS,
  );
  return { exposure, impact };
}

function useLocalAuthorityResource<T>(
  authorityId: string | null,
  urlFor: (id: string) => string,
  refreshMs: number,
): LocalAuthorityResourceState<T> {
  const [state, setState] = useState<LocalAuthorityResourceState<T>>(EMPTY<T>());

  useEffect(() => {
    // สลับ อปท. (รวมถึงเคลียร์การเลือก) = ทิ้งผลของรายการก่อนหน้าทันที ไม่ใช่แค่
    // ตอน fetch ใหม่กลับมา
    setState(authorityId ? { data: null, loading: true, error: null, notFound: false } : EMPTY<T>());
    if (!authorityId) return;

    let cancelled = false;
    let timer: number | null = null;
    let attempt = 0;
    const controller = new AbortController();
    const url = urlFor(authorityId);

    const load = async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.status === 404) {
          if (cancelled) return;
          // ถาวร (จนกว่า ETL จะรันใหม่) — ไม่ตั้ง timer ลองใหม่
          setState({ data: null, loading: false, error: null, notFound: true });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as T;
        if (cancelled) return;
        attempt = 0;
        setState({ data, loading: false, error: null, notFound: false });
        timer = window.setTimeout(load, refreshMs);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        // คง data เดิม (ถ้ามี) ไว้ — การ์ดหรี่ลงพร้อมบอกอายุของค่าล่าสุด ซื่อสัตย์
        // กว่าทำให้ตัวเลขหายไปเงียบ ๆ ระหว่างรอบที่ดึงพลาด
        setState((s) => ({ ...s, loading: false, error: errorMessage(err, "error.loadFailed"), notFound: false }));
        // ล้มเหลวติดกันหลายรอบ = ถอยห่างขึ้นเรื่อย ๆ (เพดาน 30 วิ) แทนที่จะยิงรัว
        // ทุก ๆ ไม่กี่วินาทีตอนต้นทางกำลังมีปัญหาอยู่แล้ว — ใช้ backoff ตัวเดียวกับ
        // ที่ WebSocket แผ่นดินไหวใช้ reconnect
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- urlFor สร้างใหม่ทุกเรนเดอร์แต่เป็นฟังก์ชันบริสุทธิ์ที่ผูกกับ authorityId อยู่แล้ว
  }, [authorityId, refreshMs]);

  return state;
}
