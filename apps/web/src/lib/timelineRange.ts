import type { MessageKey } from "../i18n";

/**
 * ช่วงของแถบเวลา: ชั่วโมง, ก้าวของหัวเลื่อน (นาที), ขีดเวลา (ชั่วโมงที่แล้ว)
 *
 * E16 — **48 ชม. เป็นค่าเริ่มต้น** (ช่องแรก) ให้ตรงกับหน้าต่างของแผงเส้นทางน้ำเหนือและ
 * การดึงประวัติรอบแรก; 7 วัน / 30 วันยังอยู่ เพราะคลื่นน้ำเหนือใช้หลายวันกว่าจะถึงกรุงเทพฯ
 * และการเปิดดูคลังถาวรยังต้องใช้ (72 ชม. ถูกแทนที่ด้วย 48 ชม. เพื่อไม่ให้แถบ dense กว้างขึ้น)
 */
export const TIMELINE_RANGES: readonly { hours: number; stepMin: number; labelKey: MessageKey; ticks: number[] }[] = [
  { hours: 48, stepMin: 30, labelKey: "timeline.range.48h", ticks: [48, 36, 24, 12, 0] },
  { hours: 7 * 24, stepMin: 60, labelKey: "timeline.range.7d", ticks: [168, 120, 72, 24, 0] },
  { hours: 30 * 24, stepMin: 180, labelKey: "timeline.range.30d", ticks: [720, 480, 240, 0] },
];

/** ช่องที่แถบเลือกไว้ตอนเริ่ม */
export const DEFAULT_TIMELINE_RANGE_INDEX = 0;

/**
 * เปลี่ยนช่วงของแถบเวลา (48 ชม. / 7 วัน / 30 วัน — `TimelineBar`): หยุดเล่นและ
 * เลื่อน viewport เท่านั้น
 *
 * เวลาที่เลือก (`atIso`) เป็นของผู้ใช้ — เลือกเหตุการณ์ปี 2024 จากแผงแล้วกดขยายช่วง
 * ต้องยังอยู่ที่เหตุการณ์นั้น ไม่เด้งกลับเป็นสด ถ้าช่วงใหม่ยังสั้นกว่าอายุของเวลานั้น
 * ชิป "นอกช่วงของแถบเลื่อน" (`outOfRange` ใน TimelineBar) เป็นคนบอก ฟังก์ชันนี้จึง
 * **จงใจไม่รับ `onChange`** — ไม่มีทางรีเซ็ตเวลาได้จากตรงนี้
 *
 * อยู่นอก TimelineBar.tsx เพื่อให้เทสยืนยันข้อนี้ได้โดยไม่ต้องมี DOM (เทสฝั่ง web
 * เป็น pure module) และไม่ต้อง export ฟังก์ชันที่ไม่ใช่คอมโพเนนต์จากไฟล์คอมโพเนนต์
 */
export function applyRangeChange(
  rangeIdx: number,
  ctl: { setPlaying: (playing: boolean) => void; setRangeIdx: (rangeIdx: number) => void },
): void {
  ctl.setPlaying(false);
  ctl.setRangeIdx(rangeIdx);
}
