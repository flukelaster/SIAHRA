/**
 * อัตราส่วนความต่างของสีตาม WCAG 2.x — pure module ไม่มี DOM
 *
 * ใช้โดย `contrast.test.ts` เพื่อล็อกโทเคนสีใน `src/index.css` (E18.5) ไม่ให้ตัวอักษร/เส้นขอบ
 * จางลงจนต่ำกว่าเกณฑ์อีก — ตอนนี้ไม่มีโค้ดของแอปเรียกใช้ จึงไม่เข้า bundle
 */
export type Rgb = readonly [number, number, number];

/** `#rgb` / `#rrggbb` → [r, g, b] 0–255 */
export function parseHex(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`);
  const at = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return [at(0), at(2), at(4)];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** relative luminance ตามนิยามของ WCAG 2.x (sRGB) */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** (L1 + 0.05) / (L2 + 0.05) โดย L1 คือสีที่สว่างกว่า — ผลอยู่ระหว่าง 1 ถึง 21 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** สีโปร่งแสง `fg` (alpha 0–1) ทับบนพื้นทึบ `bg` — สีที่ตาเห็นจริง (ไม่ปัดเศษ) */
export function compositeOver(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const mix = (i: 0 | 1 | 2) => fg[i] * alpha + bg[i] * (1 - alpha);
  return [mix(0), mix(1), mix(2)];
}
