import { useEffect, useState } from "react";
import type { CctvCatalogue, ItiCCatalogue } from "@siahra/shared-types";
import { CCTV_CATALOGUE_URL } from "../lib/cctv";
import { ITIC_CATALOGUE_URL } from "../lib/itic";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";

export interface CatalogueState<T> {
  data: T | null;
  loading: boolean;
  /** คีย์หรือข้อความดิบ — แปลตอนเรนเดอร์ legend บอกเหตุผลเมื่อโหลดบัญชีกล้องไม่ได้ */
  error: ErrorMessage | null;
}

export type CctvCatalogueState = CatalogueState<CctvCatalogue>;
export type ItiCCatalogueState = CatalogueState<ItiCCatalogue>;

/**
 * บัญชีกล้องแบบ static asset จาก ETL (`/cctv/*.json`)
 *
 * ดึง **เฉพาะเมื่อ `enabled`** (แฟล็กของแหล่งนั้น + ผู้ใช้เปิดชั้น) และดึงครั้งเดียวต่อการเปิดหน้า
 * — ไฟล์เปลี่ยนเฉพาะตอนรัน ETL ใหม่ จึงไม่มีรอบ refresh; ได้มาแล้วเก็บไว้แม้ปิดชั้น (เปิดใหม่
 * ไม่ต้องดึงซ้ำ) ส่วนความล้มเหลวลองใหม่เมื่อเปิดชั้นรอบหน้า
 */
function useStaticCatalogue<T extends { cameras: unknown[] }>(url: string, enabled: boolean): CatalogueState<T> {
  const [state, setState] = useState<CatalogueState<T>>({ data: null, loading: false, error: null });
  const loaded = state.data !== null;
  useEffect(() => {
    if (!enabled || loaded) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // SPA fallback ตอบ 200 text/html กับ path ที่ไม่มีไฟล์ — ต้องเป็น JSON จริง
        if (!(res.headers.get("content-type") ?? "").includes("json")) throw new Error("not JSON");
        const data = (await res.json()) as T;
        if (!Array.isArray(data?.cameras)) throw new Error("malformed catalogue");
        setState({ data, loading: false, error: null });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({ data: null, loading: false, error: errorMessage(err, "error.loadFailed") });
      }
    })();
    return () => controller.abort();
  }, [url, enabled, loaded]);
  return state;
}

/** บัญชีกล้อง CCTV ของ DWR (E15) — `enabled` = แฟล็ก `VITE_FEATURE_CCTV` + ชั้นเปิด */
export function useCctvCatalogue(enabled: boolean): CctvCatalogueState {
  return useStaticCatalogue<CctvCatalogue>(CCTV_CATALOGUE_URL, enabled);
}

/** บัญชีกล้องถนนของ iTIC (E15.2) — `enabled` = แฟล็ก `VITE_FEATURE_ITIC` + ชั้นเปิด */
export function useItiCCatalogue(enabled: boolean): ItiCCatalogueState {
  return useStaticCatalogue<ItiCCatalogue>(ITIC_CATALOGUE_URL, enabled);
}
