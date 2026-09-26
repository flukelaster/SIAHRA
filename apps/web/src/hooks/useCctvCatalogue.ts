import { useEffect, useState } from "react";
import type { CctvCatalogue } from "@siahra/shared-types";
import { CCTV_CATALOGUE_URL } from "../lib/cctv";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";

export interface CctvCatalogueState {
  data: CctvCatalogue | null;
  loading: boolean;
  /** คีย์หรือข้อความดิบ — แปลตอนเรนเดอร์ legend บอกเหตุผลเมื่อโหลดบัญชีกล้องไม่ได้ */
  error: ErrorMessage | null;
}

/**
 * บัญชีกล้อง CCTV ของ DWR (E15) — static asset จาก ETL (`/cctv/dwr-cameras.json`)
 *
 * ดึง **เฉพาะเมื่อ `enabled`** (แฟล็ก `VITE_FEATURE_CCTV` + ผู้ใช้เปิดชั้น) และดึงครั้งเดียว
 * ต่อการเปิดหน้า — ไฟล์เปลี่ยนเฉพาะตอนรัน ETL ใหม่ จึงไม่มีรอบ refresh; ได้มาแล้วเก็บไว้
 * แม้ปิดชั้น (เปิดใหม่ไม่ต้องดึงซ้ำ) ส่วนความล้มเหลวลองใหม่เมื่อเปิดชั้นรอบหน้า
 */
export function useCctvCatalogue(enabled: boolean): CctvCatalogueState {
  const [state, setState] = useState<CctvCatalogueState>({ data: null, loading: false, error: null });
  const loaded = state.data !== null;
  useEffect(() => {
    if (!enabled || loaded) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const res = await fetch(CCTV_CATALOGUE_URL, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // SPA fallback ตอบ 200 text/html กับ path ที่ไม่มีไฟล์ — ต้องเป็น JSON จริง
        if (!(res.headers.get("content-type") ?? "").includes("json")) throw new Error("not JSON");
        const data = (await res.json()) as CctvCatalogue;
        if (!Array.isArray(data?.cameras)) throw new Error("malformed catalogue");
        setState({ data, loading: false, error: null });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({ data: null, loading: false, error: errorMessage(err, "error.loadFailed") });
      }
    })();
    return () => controller.abort();
  }, [enabled, loaded]);
  return state;
}
