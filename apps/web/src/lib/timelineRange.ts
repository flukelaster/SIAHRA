/**
 * เปลี่ยนช่วงของแถบเวลา (72 ชม. / 7 วัน / 30 วัน — `TimelineBar`): หยุดเล่นและ
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
