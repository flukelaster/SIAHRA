import { useEffect, useState } from "react";

/** ค่าเริ่มต้น: อายุข้อมูลแสดงเป็นนาที จึงเดินนาฬิกาถี่กว่านั้นเล็กน้อยก็พอ */
const DEFAULT_INTERVAL_MS = 30_000;

/**
 * นาฬิกาที่เดินอยู่ สำหรับข้อความอายุข้อมูล ("12 นาทีที่แล้ว")
 *
 * อายุถูกคำนวณตอนเรนเดอร์เสมอ ไม่ได้เก็บไว้ในสถานะหรือส่งมาจาก API — ถ้าไม่มี
 * นาฬิกาที่เดิน ตัวเลข "5 นาทีที่แล้ว" จะค้างอยู่อย่างนั้นทั้งวันจนกว่าจะมีอะไร
 * มาสั่งเรนเดอร์ใหม่ ซึ่งอ่านแล้วเข้าใจผิดว่าข้อมูลยังสดอยู่
 *
 * ใช้ให้ใกล้จุดที่แสดงผลที่สุด (เช่นใน MapLegend) ไม่ใช่ที่ App เพื่อไม่ให้แผนที่
 * 3 มิติถูกเรนเดอร์ใหม่ทุก 30 วินาทีโดยไม่จำเป็น
 */
export function useNow(intervalMs: number = DEFAULT_INTERVAL_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
