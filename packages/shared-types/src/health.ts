import type { SourceId } from "./sources.js";

/**
 * Operational status of every upstream source, surfaced next to the map (see
 * plan: "source freshness and model health next to the hazard map"). Nothing
 * here is hazard data — it only says how fresh/available the hazard data is.
 */
/**
 * `delayed` กับ `stale` เป็นคนละความล้มเหลว และห้ามยุบรวมกัน:
 * - `delayed` = **ดึงสำเร็จ** แต่ค่าตรวจวัดใหม่สุดที่ได้มาเก่ากว่าคาบการตรวจวัด
 *   ที่ต้นทางนั้นควรส่ง (ต้นทางยังตอบ แต่ยังไม่ปล่อยข้อมูลรอบใหม่)
 * - `stale`   = ไม่มีรอบดึงที่สำเร็จเลยเกิน `staleAfterSeconds` (ฝั่งเราตามไม่ทัน
 *   หรือต้นทางล่มยาว)
 * - `degraded` = รอบล่าสุดล้มเหลวบางส่วน (`lastError` ไม่ว่าง) แต่ยังมีข้อมูลเดิม
 * - `down`    = ล้มเหลวทั้งหมด · `unknown` = ยังไม่เคยมีผลการดึงให้ตัดสิน
 */
export type SourceHealth = "ok" | "delayed" | "stale" | "degraded" | "down" | "unknown";

/**
 * ลำดับความรุนแรง (มากขึ้น = แย่ลง) ใช้หา `HealthResponse.worst` — อยู่ในสัญญา
 * กลางเพื่อให้ api กับ web จัดอันดับเหมือนกันเสมอ ไม่ใช่ต่างคนต่างเรียง
 */
export const HEALTH_SEVERITY: Record<SourceHealth, number> = {
  ok: 0,
  delayed: 1,
  stale: 2,
  degraded: 3,
  unknown: 4,
  down: 5,
};

/**
 * สถานะที่แย่ที่สุดในชุด — รายการว่าง = `unknown` (ไม่มีข้อมูลให้ตัดสิน
 * ไม่ใช่ "ปกติ"; ความเงียบไม่ใช่ความแข็งแรง)
 */
export function worstHealth(healths: readonly SourceHealth[]): SourceHealth {
  if (healths.length === 0) return "unknown";
  return healths.reduce((a, b) => (HEALTH_SEVERITY[b] > HEALTH_SEVERITY[a] ? b : a));
}

export interface SourceStatus {
  /** Same id a layer's `sourceIds` uses — the join is checked by tsc. */
  id: SourceId;
  /** Human label (Thai), from SOURCES so the wire text cannot drift. */
  labelTh: string;
  labelEn: string;
  health: SourceHealth;
  /** When our backend last successfully pulled from the source. */
  fetchedAt: string | null;
  /** Newest observation timestamp inside the data we hold. */
  latestObservedAt: string | null;
  /** Last attempt (successful or not). */
  lastAttemptAt: string | null;
  lastError: string | null;
  /** Source-specific detail, e.g. station counts, frames, ws clients. */
  detail: Record<string, number | string | null>;
  /** After this many seconds without a successful fetch the source is stale. */
  staleAfterSeconds: number;
  /**
   * เวลาที่ยอมให้ `latestObservedAt` ตามหลังเวลาปัจจุบันได้ ก่อนจะเรียกว่า
   * `delayed` — ตั้งจาก "คาบการตรวจวัดจริง" ของต้นทางนั้น ไม่ใช่เลขกลางค่าเดียว
   *
   * `null` = ต้นทางนี้ไม่มีคาบที่คาดหมายได้ จึงตัดสิน `delayed` ไม่ได้เลย เช่น
   * แผ่นดินไหว (`latestObservedAt` คือเวลาเกิดเหตุ — วันที่ไม่มีแผ่นดินไหวไม่ใช่
   * ฟีดเสีย) หรือแหล่งที่ไม่มีเวลาตรวจวัดติดมากับข้อมูลเลย
   */
  observedLagSeconds: number | null;
  /**
   * เวลาที่นัดลองดึงใหม่ อ่านจาก alarm จริงของ Durable Object เท่านั้น —
   * `null` = ไม่มีนัดหมายค้างอยู่ ห้ามเดาจาก `fetchedAt + คาบรีเฟรช`
   */
  nextAttemptAt: string | null;
}

export interface HealthResponse {
  /**
   * "API ยังตอบด้วยข้อมูลของทุกแหล่งได้" — เป็นจริงก็ต่อเมื่อ **ทุกแหล่ง** อยู่ใน
   * สถานะ `ok` หรือ `delayed` และไม่มีแหล่งไหนถือ `lastError` ค้างอยู่
   * (`healthOk()` ใน `apps/api/src/routes/health.ts`)
   *
   * `stale` ทำให้ค่านี้เป็น **เท็จ** — มันแปลว่าดึงไม่สำเร็จมานานเกินงบเวลาของ
   * แหล่งนั้นเอง โดยไม่มี error มาอธิบายว่าทำไม การเรียกสภาพนั้นว่า ok คือการ
   * อ้างความสดที่เราไม่มี ส่วน `delayed` ยังเป็นจริงเพราะการดึง *สำเร็จ* — ต้นทาง
   * ต่างหากที่ยังไม่ปล่อยค่าใหม่ ซึ่งเป็นคนละอาการและมีข้อมูลจริงให้แสดงพร้อมอายุ
   *
   * รายละเอียดว่าแย่แค่ไหนดูที่ `worst`
   */
  ok: boolean;
  /** สถานะที่แย่ที่สุดในบรรดา `sources` — ไม่มีแหล่งเลย = `unknown` */
  worst: SourceHealth;
  serverTime: string;
  sources: SourceStatus[];
  /** Our own API's protective counters (per isolate). */
  api?: { rateLimited429LastHour: number };
}
