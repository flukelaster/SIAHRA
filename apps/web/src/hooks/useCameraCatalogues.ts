import { useEffect, useMemo, useState } from "react";
import {
  CAMERA_SOURCE_IDS,
  cameraCatalogueUrl,
  type Camera,
  type CameraCatalogue,
  type CameraSourceId,
} from "@siahra/shared-types";
import { ENABLED_CAMERA_SOURCES } from "../lib/featureFlags";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";

export interface CatalogueState {
  data: CameraCatalogue | null;
  loading: boolean;
  /** คีย์หรือข้อความดิบ — แปลตอนเรนเดอร์ legend บอกเหตุผลเมื่อโหลดบัญชีกล้องไม่ได้ */
  error: ErrorMessage | null;
}

/** เวลา probe ของบัญชีหนึ่งแหล่ง — ป้าย "ไม่ตอบตอน build เมื่อ … จาก …" ในแผงกล้องใช้คู่นี้ */
export interface CatalogueProbe {
  probedAt: string | null;
  probeVantage: string | null;
}

export interface CameraCataloguesState {
  /** กล้องทุกแหล่งที่โหลดได้ รวมเป็นรายการเดียว (memo) ตามลำดับ `CAMERA_SOURCE_IDS` */
  cameras: readonly Camera[];
  /** `builtAt` ของบัญชีที่โหลดได้ — ไม่มี = ยังไม่โหลด/โหลดไม่ได้ (ไม่ใช่ null ที่แปลว่า "ตอนนี้") */
  builtAt: Partial<Record<CameraSourceId, string>>;
  probes: Partial<Record<CameraSourceId, CatalogueProbe>>;
  /** แหล่งที่โหลดไม่สำเร็จ + เหตุผล — legend พิมพ์บรรทัดต่อแหล่ง ไม่หายเงียบ */
  errors: Partial<Record<CameraSourceId, ErrorMessage>>;
  loading: boolean;
}

/**
 * ดึงและตรวจบัญชีของแหล่งหนึ่ง (ฟังก์ชันล้วน ทดสอบได้โดยไม่มี React) — โยน Error เมื่อไม่ใช่ JSON
 * จริง (SPA fallback ตอบ 200 text/html กับ path ที่ไม่มีไฟล์), รูปผิด หรือ `sourceId` ในไฟล์ไม่ตรงกับ
 * แหล่งที่ขอ (ไฟล์ถูกวางผิดที่/สลับกัน — กล้องของแหล่งหนึ่งต้องไม่ถูกเครดิตเป็นอีกแหล่ง)
 */
export async function loadCatalogue(
  id: CameraSourceId,
  signal: AbortSignal,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<CameraCatalogue> {
  const res = await fetchImpl(cameraCatalogueUrl(id), { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!(res.headers.get("content-type") ?? "").includes("json")) throw new Error("not JSON");
  const data = (await res.json()) as CameraCatalogue;
  if (!Array.isArray(data?.cameras)) throw new Error("malformed catalogue");
  if (data.sourceId !== id) throw new Error(`catalogue sourceId mismatch: ${String(data.sourceId)}`);
  return data;
}

/**
 * รวมกล้องจากบัญชีที่โหลดได้ตามลำดับ `CAMERA_SOURCE_IDS` (ลำดับเครดิต) — ไม่ใช่ลำดับที่โหลดเสร็จ
 * เพื่อให้ผลคงที่ข้ามการโหลดซ้ำ
 */
export function mergeCatalogues(loaded: Partial<Record<CameraSourceId, CameraCatalogue | null>>): Camera[] {
  const out: Camera[] = [];
  for (const id of CAMERA_SOURCE_IDS) {
    const cat = loaded[id];
    if (cat) out.push(...cat.cameras);
  }
  return out;
}

/**
 * บัญชีกล้องแบบ static asset จาก ETL (`/cctv/{sourceId}.json`)
 *
 * ดึง **เฉพาะเมื่อ `enabled`** (ชั้นเปิด — แฟล็กของแหล่งถูกคิดไว้ใน `ENABLED_CAMERA_SOURCES` แล้ว)
 * และดึงครั้งเดียวต่อการเปิดหน้า — ไฟล์เปลี่ยนเฉพาะตอนรัน ETL ใหม่ จึงไม่มีรอบ refresh; ได้มาแล้ว
 * เก็บไว้แม้ปิดชั้น (เปิดใหม่ไม่ต้องดึงซ้ำ) ส่วนความล้มเหลวลองใหม่เมื่อเปิดชั้นรอบหน้า
 */
function useStaticCatalogue(id: CameraSourceId, enabled: boolean): CatalogueState {
  const [state, setState] = useState<CatalogueState>({ data: null, loading: false, error: null });
  const loaded = state.data !== null;
  useEffect(() => {
    if (!enabled || loaded) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    loadCatalogue(id, controller.signal).then(
      (data) => setState({ data, loading: false, error: null }),
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ data: null, loading: false, error: errorMessage(err, "error.loadFailed") });
      },
    );
    return () => controller.abort();
  }, [id, enabled, loaded]);
  return state;
}

/**
 * บัญชีกล้องของทุกแหล่งที่ build นี้เปิดอยู่ — หนึ่ง `useStaticCatalogue` ต่อแหล่งใน
 * `ENABLED_CAMERA_SOURCES` ซึ่งเป็น **ค่าคงที่ตอน build** จำนวน hook จึงคงที่ทุกเรนเดอร์
 * (ห้ามกรองรายการนี้ด้วยสถานะ runtime — จะผิดกฎของ hooks ทันที)
 */
export function useCameraCatalogues(enabled: boolean): CameraCataloguesState {
  const states: CatalogueState[] = [];
  for (const id of ENABLED_CAMERA_SOURCES) {
    // oxlint-disable-next-line react/rules-of-hooks -- ENABLED_CAMERA_SOURCES คงที่ตอน build จำนวน hook ไม่เปลี่ยน
    states.push(useStaticCatalogue(id, enabled));
  }
  const datas = states.map((s) => s.data);
  return useMemo(() => {
    const loaded: Partial<Record<CameraSourceId, CameraCatalogue | null>> = {};
    const builtAt: CameraCataloguesState["builtAt"] = {};
    const probes: CameraCataloguesState["probes"] = {};
    const errors: CameraCataloguesState["errors"] = {};
    let loading = false;
    ENABLED_CAMERA_SOURCES.forEach((id, i) => {
      const s = states[i];
      loaded[id] = s.data;
      if (s.data) {
        builtAt[id] = s.data.builtAt;
        probes[id] = { probedAt: s.data.probedAt, probeVantage: s.data.probeVantage };
      }
      if (s.error) errors[id] = s.error;
      if (s.loading) loading = true;
    });
    return { cameras: mergeCatalogues(loaded), builtAt, probes, errors, loading };
    // deps มีความยาวคงที่ (ตาม ENABLED_CAMERA_SOURCES) — data/error/loading ของทุกแหล่ง
  }, [...datas, ...states.map((s) => s.error), ...states.map((s) => s.loading)]);
}
