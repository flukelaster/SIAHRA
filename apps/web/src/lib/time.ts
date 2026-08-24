/**
 * ตัวจัดรูปแบบเวลาชุดเดียวของฝั่ง web — ตรึงไว้ที่ `Asia/Bangkok` เสมอ
 *
 * ก่อนหน้านี้แต่ละการ์ดเรียกเมธอด locale-* บน Date เอง ซึ่งใช้โซนเวลาของ
 * เครื่องผู้ใช้ ทำให้ "เวลาที่ตรวจวัด" ของข้อมูลไทยเพี้ยนไปตามนาฬิกาของคนดู
 * ทุกอย่างในไฟล์นี้จึงผ่าน `Intl.DateTimeFormat` ที่ระบุ `timeZone` ชัดเจน
 *
 * ทุกฟังก์ชันรับ `lang` เป็นพารามิเตอร์แรกและ **ไม่มีค่าเริ่มต้น** โดยตั้งใจ:
 * ถ้าใส่ default เป็น "th" ไว้ จุดเรียกที่ลืมส่งภาษาจะเรนเดอร์เป็นไทยเงียบ ๆ บนหน้า
 * ภาษาอังกฤษ แทนที่จะเป็น error ของ tsc — เขตเวลายังคงเป็นไทยทั้งสองภาษา เพราะ
 * ข้อมูลทั้งหมดเป็นข้อมูลของประเทศไทย ไม่ใช่ของนาฬิกาคนอ่าน
 *
 * ความซื่อสัตย์ต่อข้อมูล: `formatFetchedAt(lang, null)` ต้องคืนข้อความ
 * "ยังไม่เคยได้รับข้อมูล" / "Never received any data" เท่านั้น ห้ามคืนเวลาปัจจุบัน
 * หรือคำว่า "เมื่อสักครู่" เด็ดขาด — `fetchedAt: null` แปลว่ายังไม่เคยดึงข้อมูล
 * สำเร็จเลย ไม่ใช่ว่าเพิ่งดึงมา
 */
import { INTL_LOCALE, translate, type Lang } from "../i18n";

export const BANGKOK_TZ = "Asia/Bangkok";

/** ข้อความมาตรฐานสำหรับ "ไม่เคยได้รับข้อมูลจากต้นทาง" (fetchedAt/observedAt = null) */
export function neverReceived(lang: Lang): string {
  return translate(lang, "time.neverReceived");
}

type FormatKind = "time" | "dateTime" | "full" | "weekday";

const OPTIONS: Record<FormatKind, Intl.DateTimeFormatOptions> = {
  time: { hour: "2-digit", minute: "2-digit" },
  dateTime: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
  full: { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" },
  weekday: { weekday: "short" },
};

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(lang: Lang, kind: FormatKind): Intl.DateTimeFormat {
  const key = `${lang}:${kind}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(INTL_LOCALE[lang], { timeZone: BANGKOK_TZ, ...OPTIONS[kind] });
    cache.set(key, f);
  }
  return f;
}

function parse(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** เวลานาฬิกาอย่างเดียว เช่น "14:30" (เขตเวลาไทย) */
export function formatTime(lang: Lang, iso: string): string {
  const ms = parse(iso);
  return ms === null ? "—" : formatter(lang, "time").format(ms);
}

/** วัน + เวลา เช่น "18 ส.ค. 14:30" / "18 Aug, 14:30" (เขตเวลาไทย) */
export function formatDateTime(lang: Lang, iso: string): string {
  const ms = parse(iso);
  return ms === null ? "—" : formatter(lang, "dateTime").format(ms);
}

/** วัน + เดือน + ปี + เวลา สำหรับข้อความยาว เช่น footer ของภาพที่บันทึก */
export function formatFullDateTime(lang: Lang, iso: string | number | Date): string {
  const ms = typeof iso === "string" ? parse(iso) : Number(iso);
  return ms === null || Number.isNaN(ms) ? "—" : formatter(lang, "full").format(ms);
}

/**
 * ชื่อวันแบบย่อ เช่น "จ." / "Mon" (เขตเวลาไทย) — ใช้กับแถบพยากรณ์รายวันของ TMD
 * (E12.3) ที่ต้องอ่านออกว่าแต่ละแท่งคือวันไหน โดยไม่ต้องเดือน/ปีกำกับเพราะช่วง
 * พยากรณ์สั้นแค่ 7 วัน ไม่มีทางข้ามปีปฏิทินจนกำกวม
 */
export function formatWeekday(lang: Lang, iso: string): string {
  const ms = parse(iso);
  return ms === null ? "—" : formatter(lang, "weekday").format(ms);
}

/**
 * อายุของข้อมูลแบบสัมพัทธ์ ("12 นาทีที่แล้ว")
 * `null` = ไม่เคยได้รับข้อมูล จึงไม่มีอายุให้พูดถึง
 */
export function formatAge(lang: Lang, iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return neverReceived(lang);
  const ms = parse(iso);
  if (ms === null) return neverReceived(lang);
  const min = Math.floor((nowMs - ms) / 60000);
  if (min < 0) return translate(lang, "time.soon");
  if (min < 1) return translate(lang, "time.justNow");
  if (min < 60) return translate(lang, "time.minutesAgo", { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return translate(lang, "time.hoursAgo", { n: h });
  return translate(lang, "time.daysAgo", { n: Math.floor(h / 24) });
}

/**
 * เวลาที่ดึงข้อมูลสำเร็จล่าสุด แสดงเป็นเวลาไทยแบบสัมบูรณ์
 * `null` → "ยังไม่เคยได้รับข้อมูล" (ห้ามแปลงเป็นเวลาปัจจุบัน)
 */
export function formatFetchedAt(lang: Lang, iso: string | null): string {
  if (!iso) return neverReceived(lang);
  const ms = parse(iso);
  if (ms === null) return neverReceived(lang);
  return translate(lang, "time.absolute", { time: formatter(lang, "dateTime").format(ms) });
}

/** เวลาที่ดึงข้อมูล + อายุ เช่น "18 ส.ค. 14:30 น. · 12 นาทีที่แล้ว" */
export function formatFetchedAtWithAge(
  lang: Lang,
  iso: string | null,
  nowMs: number = Date.now(),
): string {
  if (!iso) return neverReceived(lang);
  return `${formatFetchedAt(lang, iso)} · ${formatAge(lang, iso, nowMs)}`;
}
