/**
 * รอบถามซ้ำของ `hooks/useNorthRoute.ts` (E16 B-1, ข้อจำกัดต้นทุนจาก devops C1/C2/C5) —
 * การตัดสินใจ "อีกกี่ ms ถึงยิงรอบถัดไป" แยกเป็นฟังก์ชันล้วนให้เทสได้ใน node โดยไม่มี DOM
 * hook เหลือหน้าที่แค่ผูก `visibilitychange` และตั้ง/ล้าง timer
 *
 * กติกา:
 * - แท็บซ่อนอยู่ (`document.visibilityState === "hidden"`) → `null` = **ไม่ตั้ง timer เลย**
 *   (ผู้ใช้ไม่เห็นอะไร จึงไม่มีเหตุให้ถาม API) กลับมาเห็นเมื่อไหร่ค่อยตัดสินใหม่
 * - รอบล่าสุดล้มเหลว → รอ `retryMs` (เส้นทางน้ำ ≥ 120 วิ: คำตอบ 503 เป็น no-store
 *   ทุกครั้งคือ RPC ใหม่ถึง DO)
 * - ยังไม่เคยสำเร็จ → 0 (ยิงทันที)
 * - ไม่งั้น → ส่วนที่เหลือของรอบนับจากความสำเร็จครั้งล่าสุด (0 ถ้าเกินรอบแล้ว) — กลับมาเห็นแท็บ
 *   หลังหายไปนานจึงยิงทันที ส่วนที่เพิ่งได้ค่ามาก็รอเฉพาะส่วนที่เหลือ ไม่เริ่มนับใหม่
 */

/** `/api/v1/rivers/north` เมื่อแผงเส้นทางน้ำเหนือถูกเรนเดอร์อยู่ (C2) */
export const ROUTE_PANEL_INTERVAL_MS = 300_000;
/** `/api/v1/rivers/north` เมื่อเปิดเฉพาะชั้น 3 มิติ — แผนที่ไม่ต้องการความสดเท่าแผง (C2) */
export const ROUTE_LAYER_INTERVAL_MS = 600_000;
/** รอบที่ล้มเหลวถามซ้ำไม่ถี่กว่านี้ (C2) */
export const ROUTE_RETRY_MS = 120_000;
/** `/api/v1/dams` — เฉพาะตอนแผงเปิด (C5) */
export const DAMS_INTERVAL_MS = 15 * 60_000;

export interface PollDelayInput {
  /** เวลาที่ได้คำตอบสำเร็จครั้งล่าสุด (ms) — null = ยังไม่เคยสำเร็จ */
  lastSuccessAtMs: number | null;
  nowMs: number;
  /** `document.visibilityState === "hidden"` */
  hidden: boolean;
  /** แผงเส้นทางน้ำเหนือถูกเรนเดอร์อยู่ (นิพจน์ `northPanel` ใน App.tsx) */
  panelOpen: boolean;
  /** รอบล่าสุดล้มเหลว */
  lastWasError: boolean;
}

/** รอบปกติของ `/api/v1/rivers/north` ตามว่าแผงเปิดอยู่หรือไม่ */
export function routeIntervalMs(panelOpen: boolean): number {
  return panelOpen ? ROUTE_PANEL_INTERVAL_MS : ROUTE_LAYER_INTERVAL_MS;
}

/** แกนกลางของทั้งสอง endpoint — `null` = อย่าตั้ง timer (แท็บซ่อนอยู่) */
export function pollDelayMs(input: {
  lastSuccessAtMs: number | null;
  nowMs: number;
  hidden: boolean;
  lastWasError: boolean;
  intervalMs: number;
  retryMs: number;
}): number | null {
  if (input.hidden) return null;
  if (input.lastWasError) return input.retryMs;
  if (input.lastSuccessAtMs === null) return 0;
  return Math.max(0, input.lastSuccessAtMs + input.intervalMs - input.nowMs);
}

/** รอบถัดไปของ `/api/v1/rivers/north` (C1 + C2) */
export function nextRoutePollDelayMs(input: PollDelayInput): number | null {
  return pollDelayMs({ ...input, intervalMs: routeIntervalMs(input.panelOpen), retryMs: ROUTE_RETRY_MS });
}

/**
 * รอบถัดไปของ `/api/v1/dams` (C5) — hook ถามเขื่อนเฉพาะตอนแผงเปิดอยู่แล้ว (`withDams = northPanel`)
 * `panelOpen` จึงไม่เปลี่ยนรอบ; ล้มเหลวก็รอ 15 นาทีเท่าเดิม (พฤติกรรมก่อน B-1)
 */
export function nextDamsPollDelayMs(input: PollDelayInput): number | null {
  return pollDelayMs({ ...input, intervalMs: DAMS_INTERVAL_MS, retryMs: DAMS_INTERVAL_MS });
}

/**
 * `/api/v1/community/{code}/reports` (รายงานจากประชาชน) — ข้อจำกัดต้นทุนจาก devops ของ PR A: ถามไม่ถี่กว่า
 * 2 นาที เฉพาะตอนชั้นเปิด + เลือกจังหวัดแล้ว + แท็บมองเห็นอยู่ (hook ไม่เริ่ม poll เลยถ้าเงื่อนไขแรกสองข้อไม่จริง
 * และ `pollDelayMs` ไม่ตั้ง timer ตอนแท็บซ่อน)
 */
export const COMMUNITY_INTERVAL_MS = 120_000;
/** รอบที่ล้มเหลว (404/400/503/เครือข่าย) ถามซ้ำไม่ถี่กว่านี้ — คำตอบผิดพลาดเป็น no-store ทุกครั้งถึง Worker */
export const COMMUNITY_RETRY_MS = 60_000;

/** รอบถัดไปของรายการรายงานจากประชาชน — `panelOpen` ไม่มีผล (ไม่มีแผงของชั้นนี้) */
export function nextCommunityPollDelayMs(input: PollDelayInput): number | null {
  return pollDelayMs({ ...input, intervalMs: COMMUNITY_INTERVAL_MS, retryMs: COMMUNITY_RETRY_MS });
}

/**
 * `/api/v1/rivers/forecast` (ผลลัพธ์แบบจำลองพยากรณ์ของ HII) — ถามเฉพาะตอนแผง north เปิดอยู่ (hook ไม่เริ่ม poll เลย
 * ถ้าแผงปิด และ `pollDelayMs` ไม่ตั้ง timer ตอนแท็บซ่อน) API ดึงต้นทางรอบละชั่วโมงและ route ตอบผ่านแคชที่ขอบ
 * จึงถามถี่กว่า 15 นาทีไม่ได้ความสดเพิ่ม
 */
export const FORECAST_INTERVAL_MS = 15 * 60_000;
/** รอบที่ล้มเหลวถามซ้ำไม่ถี่กว่านี้ — คำตอบผิดพลาดของ route นี้ไม่ผ่านแคช จึงเป็นการเรียกถึง DO ทุกครั้ง */
export const FORECAST_RETRY_MS = 120_000;

/**
 * รอบถัดไปของผลลัพธ์แบบจำลองพยากรณ์ — `panelOpen` ไม่มีผล (hook เปิดเฉพาะตอนแผงเปิดอยู่แล้ว) แต่ล้มเหลวรอ
 * 120 วิ ไม่ใช่ 15 นาทีแบบเขื่อน: แผงที่เปิดอยู่ต้องฟื้นเร็วเมื่อเครือข่ายกลับมา
 */
export function nextForecastPollDelayMs(input: PollDelayInput): number | null {
  return pollDelayMs({ ...input, intervalMs: FORECAST_INTERVAL_MS, retryMs: FORECAST_RETRY_MS });
}

/**
 * `/api/v1/basins` (มุมมองตามลุ่มน้ำ) — ถามเฉพาะตอนแผง basin ถูกเรนเดอร์อยู่ (hook ไม่เริ่ม poll เลยถ้าแผงปิด รวมถึงตอนเริ่มแอป
 * และ `pollDelayMs` ไม่ตั้ง timer ตอนแท็บซ่อน) API เขียนแถวนี้ใหม่ทุกรอบ refresh (10 นาที) และ route ตอบผ่านแคชที่ขอบ 5 นาที
 * จึงถามถี่กว่า 10 นาทีไม่ได้ความสดเพิ่ม — ข้อจำกัดต้นทุน devops C13
 */
export const BASINS_INTERVAL_MS = 10 * 60_000;
/** รอบที่ล้มเหลวถามซ้ำไม่ถี่กว่านี้ — คำตอบผิดพลาดของ route นี้เป็น no-store จึงถึง DO ทุกครั้ง */
export const BASINS_RETRY_MS = 120_000;

/** รอบถัดไปของมุมมองตามลุ่มน้ำ — `panelOpen` ไม่มีผล (hook เปิดเฉพาะตอนแผงเปิดอยู่แล้ว) */
export function nextBasinsPollDelayMs(input: PollDelayInput): number | null {
  return pollDelayMs({ ...input, intervalMs: BASINS_INTERVAL_MS, retryMs: BASINS_RETRY_MS });
}
