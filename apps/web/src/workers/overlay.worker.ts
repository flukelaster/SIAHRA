/// <reference lib="webworker" />
import { computeOverlayField, type OverlayFieldData, type OverlayGrid } from "../scene/overlayField";

/**
 * คำนวณ overlay ของจังหวัด (แชนแนล R/B/A — ดู scene/overlayField.ts) นอก
 * main thread
 *
 * งานนี้เป็น box blur หลายรอบบนกริดทั้งจังหวัด จึงเป็น long task ก้อนใหญ่ที่สุด
 * ตอนสลับจังหวัด ย้ายมาไว้ที่นี่แล้วเฟรมยังเดินระหว่างที่ DEM ถูกประมวลผล
 *
 * รูปแบบเดียวกับ workers อีกสองตัวในโฟลเดอร์นี้: รับ job หนึ่งก้อนทาง
 * `onmessage` แล้ว postMessage ผลกลับพร้อม transfer บัฟเฟอร์ (ฝั่งเรียกเป็น
 * worker ใช้ครั้งเดียวแล้ว terminate — ดู scene/hazardOverlay.ts)
 */
export interface OverlayFieldJob {
  grid: OverlayGrid;
  /** สำเนาของ heightfield — ห้ามโอนตัวจริง main thread ยังใช้ sample() อยู่ */
  heights: Float32Array;
  insideMask: Uint8Array | null;
}

export type OverlayFieldResult =
  | ({ ok: true } & OverlayFieldData)
  | { ok: false; error: string };

self.onmessage = (ev: MessageEvent<OverlayFieldJob>) => {
  const post = (self as unknown as Worker).postMessage.bind(self);
  try {
    const { grid, heights, insideMask } = ev.data;
    const field = computeOverlayField(grid, heights, insideMask);
    const result: OverlayFieldResult = { ok: true, ...field };
    post(result, [field.data.buffer]);
  } catch (err) {
    const result: OverlayFieldResult = { ok: false, error: String(err) };
    post(result);
  }
};
