/**
 * Reconnect backoff ของ WebSocket แผ่นดินไหว — โมดูลบริสุทธิ์ (ไม่มี timer, ไม่มี Math.random
 * ข้างใน) เพื่อให้เทสได้ทั้งขอบล่างและขอบบนแบบ deterministic
 *
 * ใช้ full jitter แต่มี "พื้น" ที่ MIN_RECONNECT_DELAY_MS: ถ้าปล่อยให้สุ่มลงไปถึง 0
 * ไคลเอนต์จะยิงซ้ำห่างกันไม่กี่มิลลิวินาทีตอนที่ต้นทางเพิ่งล้ม ซึ่งเป็นการซ้ำเติม
 */

export const MIN_RECONNECT_DELAY_MS = 1000;
export const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * ดีเลย์ก่อน reconnect ครั้งถัดไป
 * @param attempt จำนวนครั้งที่ต่อไม่สำเร็จติดกัน (0 = ครั้งแรกหลังหลุด)
 * @param rand    ค่าสุ่มใน [0, 1) — ฉีดเข้ามาเพื่อให้เทสได้
 */
export function nextReconnectDelayMs(attempt: number, rand: number = Math.random()): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const ceiling = Math.min(MAX_RECONNECT_DELAY_MS, MIN_RECONNECT_DELAY_MS * 2 ** safeAttempt);
  const jittered =
    MIN_RECONNECT_DELAY_MS + Math.min(1, Math.max(0, rand)) * (ceiling - MIN_RECONNECT_DELAY_MS);
  return Math.round(jittered);
}
