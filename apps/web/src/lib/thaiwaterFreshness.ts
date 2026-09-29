/**
 * งบเวลาของฟีด ThaiWater ที่เว็บใช้เมื่อ API ไม่ได้ส่ง `staleAfterSeconds` มาใน descriptor — เท่ากับ
 * `THAIWATER_STALE_AFTER_SECONDS` ของ `apps/api/src/thaiwaterFreshness.ts` (30 นาที = 3 × รอบดึง 10 นาที)
 * ค่าจริงมาจาก descriptor เสมอเมื่อมี; ค่านี้มีไว้กันกรณีไม่มีเท่านั้น
 */
export const THAIWATER_STALE_AFTER_SECONDS = 30 * 60;
