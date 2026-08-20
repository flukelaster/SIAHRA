import type { SourceHealth } from "@siahra/shared-types";

/**
 * บันไดตัดสิน `SourceHealth` ที่ใช้ร่วมกันทุก Durable Object — เขียนที่เดียวเพื่อ
 * ไม่ให้แต่ละต้นทางตีความคำว่า "stale" คนละแบบ (E3.3)
 *
 * แกนสำคัญคือ **แยกความล้มเหลวสองชนิดออกจากกัน**:
 * - ดึงไม่สำเร็จ / ดึงไม่ได้มานาน → `down` · `degraded` · `stale`
 * - ดึงสำเร็จ แต่ต้นทางยังไม่ปล่อยค่าตรวจวัดรอบใหม่ → `delayed`
 *
 * ถ้ายุบสองอย่างนี้เป็นสีเดียวกัน แถบสถานะจะบอกไม่ได้ว่าปัญหาอยู่ที่ฝั่งเราหรือ
 * ฝั่งต้นทาง ซึ่งทำให้มันไร้ประโยชน์
 */
export interface SourceHealthInput {
  nowMs: number;
  /** เวลาที่ดึงสำเร็จล่าสุด — null = ไม่เคยสำเร็จเลย */
  fetchedAt: string | null;
  /** ข้อผิดพลาดของรอบล่าสุด (ว่าง = รอบล่าสุดสำเร็จหมด) */
  lastError: string | null;
  /** ค่าตรวจวัดใหม่สุดที่เราถืออยู่ */
  latestObservedAt: string | null;
  staleAfterSeconds: number;
  /** null = ต้นทางนี้ไม่มีคาบตรวจวัดที่คาดหมายได้ → ไม่มีวันเป็น `delayed` */
  observedLagSeconds: number | null;
  /** รอบล่าสุดล้มเหลว "ครบทุกต้นทางย่อย" (ใช้กับฟีดที่รวมหลายแหล่ง) */
  allFeedsFailed?: boolean;
  /** เหตุผลอื่นที่ทำให้ถือว่าให้บริการได้ไม่เต็มที่ เช่น ถูกพักการเรียกต้นทาง */
  extraDegraded?: boolean;
}

export function deriveSourceHealth(i: SourceHealthInput): SourceHealth {
  const fetchedMs = i.fetchedAt ? Date.parse(i.fetchedAt) : NaN;
  // ยังไม่เคยดึงสำเร็จ: มี error = ต้นทางไม่ตอบ, ไม่มี error = ยังไม่เคยลองเลย
  if (!Number.isFinite(fetchedMs)) return i.lastError ? "down" : "unknown";
  /**
   * **ความล้มเหลวมาก่อนอายุเสมอ** — ถ้าเรียงกลับกัน ต้นทางที่ล่มยาวจะกลายเป็น
   * `stale` (ซึ่งฟังดูเหมือนแค่ "ข้อมูลเก่า") แล้วสาขา `down`/`degraded`
   * จะไม่มีวันถูกใช้อีกเลย = ซ่อนแหล่งที่ตายไปแล้วไว้ใต้คำที่อ่อนกว่าความจริง
   */
  const fetchOverdue = i.nowMs - fetchedMs > i.staleAfterSeconds * 1000;
  if (i.allFeedsFailed) return "down";
  // ล้มเหลวอยู่ *และ* ไม่มีรอบที่สำเร็จมานานเกินงบ = ต้นทางตาย ไม่ใช่แค่ค้าง
  if (fetchOverdue && i.lastError) return "down";
  if (i.lastError || i.extraDegraded) return "degraded";
  // เกินงบแต่ไม่มี error เลย = ฝั่งเราไม่ได้ดึง (alarm/cron หาย) ไม่มีหลักฐานว่าต้นทางพัง
  if (fetchOverdue) return "stale";
  if (i.observedLagSeconds !== null) {
    const observedMs = i.latestObservedAt ? Date.parse(i.latestObservedAt) : NaN;
    /**
     * ดึงสำเร็จแต่ "ไม่มีค่าตรวจวัดอยู่ในมือเลย" ห้ามเรียกว่า `delayed` เพราะนั่น
     * เป็นการกล่าวหาต้นทางว่ายังไม่ปล่อยข้อมูล ทั้งที่อาจเป็นฝั่งเราเองที่โหลด
     * ไม่สำเร็จ (เช่น ดัชนีเรดาร์มาแต่โหลดภาพเฟรมไม่ได้สักเฟรม) — ไม่มีหลักฐาน
     * ว่าใครพลาด และไม่มีข้อมูลให้แสดง = `degraded`
     */
    if (!Number.isFinite(observedMs)) return "degraded";
    // `delayed` ต้องมีค่าตรวจวัดจริงที่เก่ากว่าคาบของต้นทางเท่านั้น
    if (i.nowMs - observedMs > i.observedLagSeconds * 1000) return "delayed";
  }
  return "ok";
}
