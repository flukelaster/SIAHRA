/**
 * ตัวจัดรูปแบบตัวเลขชุดเดียว (คู่กับ `time.ts`) — ใช้ `Intl.NumberFormat("th-TH")`
 * แทนเมธอด locale-* บน Number ที่เคยกระจายอยู่ตามการ์ด ผลลัพธ์เหมือนเดิมทุกประการ
 * (สเปกของเมธอดพวกนั้นนิยามด้วย Intl.NumberFormat อยู่แล้ว)
 * แต่รวมศูนย์ไว้ที่เดียวและกันไม่ให้เผลอใช้ locale ของเครื่องผู้ใช้
 */

const cache = new Map<number, Intl.NumberFormat>();

function fmt(maximumFractionDigits: number): Intl.NumberFormat {
  let f = cache.get(maximumFractionDigits);
  if (!f) {
    f = new Intl.NumberFormat("th-TH", { maximumFractionDigits });
    cache.set(maximumFractionDigits, f);
  }
  return f;
}

/** ตัวเลขคั่นหลักพันแบบไทย; `null` → "—" (ไม่มีค่า ไม่ใช่ศูนย์) */
export function formatNumber(n: number | null | undefined, maximumFractionDigits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return fmt(maximumFractionDigits).format(n);
}
