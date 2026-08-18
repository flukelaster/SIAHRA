/**
 * ตัวจัดรูปแบบเวลาชุดเดียวของฝั่ง web — ตรึงไว้ที่ `Asia/Bangkok` เสมอ
 *
 * ก่อนหน้านี้แต่ละการ์ดเรียกเมธอด locale-* บน Date เอง ซึ่งใช้โซนเวลาของ
 * เครื่องผู้ใช้ ทำให้ "เวลาที่ตรวจวัด" ของข้อมูลไทยเพี้ยนไปตามนาฬิกาของคนดู
 * ทุกอย่างในไฟล์นี้จึงผ่าน `Intl.DateTimeFormat` ที่ระบุ `timeZone` ชัดเจน
 *
 * ความซื่อสัตย์ต่อข้อมูล: `formatFetchedAt(null)` ต้องคืนข้อความ "ยังไม่เคยได้รับข้อมูล"
 * เท่านั้น ห้ามคืนเวลาปัจจุบันหรือคำว่า "เมื่อสักครู่" เด็ดขาด — `fetchedAt: null`
 * แปลว่ายังไม่เคยดึงข้อมูลสำเร็จเลย ไม่ใช่ว่าเพิ่งดึงมา
 */

export const BANGKOK_TZ = "Asia/Bangkok";

/** ข้อความมาตรฐานสำหรับ "ไม่เคยได้รับข้อมูลจากต้นทาง" (fetchedAt/observedAt = null) */
export const NEVER_RECEIVED_TH = "ยังไม่เคยได้รับข้อมูล";

const timeFmt = new Intl.DateTimeFormat("th-TH", {
  timeZone: BANGKOK_TZ,
  hour: "2-digit",
  minute: "2-digit",
});

const dateTimeFmt = new Intl.DateTimeFormat("th-TH", {
  timeZone: BANGKOK_TZ,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const fullFmt = new Intl.DateTimeFormat("th-TH", {
  timeZone: BANGKOK_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function parse(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** เวลานาฬิกาอย่างเดียว เช่น "14:30" (เขตเวลาไทย) */
export function formatTime(iso: string): string {
  const ms = parse(iso);
  return ms === null ? "—" : timeFmt.format(ms);
}

/** วัน + เวลา เช่น "18 ส.ค. 14:30" (เขตเวลาไทย) */
export function formatDateTime(iso: string): string {
  const ms = parse(iso);
  return ms === null ? "—" : dateTimeFmt.format(ms);
}

/** วัน + เดือน + ปี + เวลา สำหรับข้อความยาว เช่น footer ของภาพที่บันทึก */
export function formatFullDateTime(iso: string | number | Date): string {
  const ms = typeof iso === "string" ? parse(iso) : Number(iso);
  return ms === null || Number.isNaN(ms) ? "—" : fullFmt.format(ms);
}

/**
 * อายุของข้อมูลแบบสัมพัทธ์ ("12 นาทีที่แล้ว")
 * `null` = ไม่เคยได้รับข้อมูล จึงไม่มีอายุให้พูดถึง
 */
export function formatAge(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return NEVER_RECEIVED_TH;
  const ms = parse(iso);
  if (ms === null) return NEVER_RECEIVED_TH;
  const min = Math.floor((nowMs - ms) / 60000);
  if (min < 0) return "อีกไม่นาน";
  if (min < 1) return "เมื่อสักครู่";
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  return `${Math.floor(h / 24)} วันที่แล้ว`;
}

/**
 * เวลาที่ดึงข้อมูลสำเร็จล่าสุด แสดงเป็นเวลาไทยแบบสัมบูรณ์
 * `null` → "ยังไม่เคยได้รับข้อมูล" (ห้ามแปลงเป็นเวลาปัจจุบัน)
 */
export function formatFetchedAt(iso: string | null): string {
  if (!iso) return NEVER_RECEIVED_TH;
  const ms = parse(iso);
  return ms === null ? NEVER_RECEIVED_TH : `${dateTimeFmt.format(ms)} น.`;
}

/** เวลาที่ดึงข้อมูล + อายุ เช่น "18 ส.ค. 14:30 น. · 12 นาทีที่แล้ว" */
export function formatFetchedAtWithAge(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return NEVER_RECEIVED_TH;
  return `${formatFetchedAt(iso)} · ${formatAge(iso, nowMs)}`;
}
