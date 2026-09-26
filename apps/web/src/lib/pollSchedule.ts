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
