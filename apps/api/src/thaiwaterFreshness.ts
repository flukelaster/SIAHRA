/**
 * งบเวลาของฟีด ThaiWater — **ค่าเดียว** ที่ `ObservationCacheDO` (/health, descriptor ของ observations / history
 * / north route) และ `basins/build.ts` (descriptor + คำตอบเย็นของ /api/v1/basins) ต้องเท่ากันเสมอ
 * (เดิมเป็นสองสำเนา — 15 นาที — ที่ต้องพึ่งเทสคอยจับไม่ให้เลื่อนคนละทาง)
 *
 * 30 นาที = 3 × รอบดึง 10 นาที ("พลาดสามรอบ" ตามกติกา docs/api.md): ท่อที่ปกติดีมีอายุ ≈ 11 นาทีที่ฝั่ง API
 * และรอบล้มเหลวหนึ่งรอบที่ retry (1+2+4 นาที) ก็เกิน 15 อยู่แล้ว
 */
export const THAIWATER_STALE_AFTER_MS = 30 * 60 * 1000;
export const THAIWATER_STALE_AFTER_SECONDS = THAIWATER_STALE_AFTER_MS / 1000;
