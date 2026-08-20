/**
 * ตัวจัดรูปแบบตัวเลขชุดเดียว (คู่กับ `time.ts`) — ใช้ `Intl.NumberFormat` ตาม
 * ภาษาที่กำลังแสดง แทนเมธอด locale-* บน Number ที่เคยกระจายอยู่ตามการ์ด
 * (สเปกของเมธอดพวกนั้นนิยามด้วย Intl.NumberFormat อยู่แล้ว) รวมศูนย์ไว้ที่เดียว
 * และกันไม่ให้เผลอใช้ locale ของเครื่องผู้ใช้
 *
 * `lang` เป็นพารามิเตอร์แรกและไม่มีค่าเริ่มต้น ด้วยเหตุผลเดียวกับใน `time.ts`
 */
import { INTL_LOCALE, type Lang } from "../i18n";

const cache = new Map<string, Intl.NumberFormat>();

function fmt(lang: Lang, maximumFractionDigits: number): Intl.NumberFormat {
  const key = `${lang}:${maximumFractionDigits}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(INTL_LOCALE[lang], { maximumFractionDigits });
    cache.set(key, f);
  }
  return f;
}

/** ตัวเลขคั่นหลักพัน; `null` → "—" (ไม่มีค่า ไม่ใช่ศูนย์) */
export function formatNumber(
  lang: Lang,
  n: number | null | undefined,
  maximumFractionDigits = 0,
): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return fmt(lang, maximumFractionDigits).format(n);
}
