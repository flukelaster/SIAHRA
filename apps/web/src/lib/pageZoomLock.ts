/**
 * ล็อกการซูมระดับ "หน้า" บนมือถือ — ให้ซูมได้เฉพาะแผนที่ (ผ่าน OrbitControls)
 *
 * ทำไมต้องมีทั้งสามชั้น:
 *  1. `<meta viewport maximum-scale=1, user-scalable=no>` (index.html) — Android Chrome
 *     และ iOS ที่เปิดแบบ standalone เคารพ; iOS Safari แท็บปกติ **เมิน** การ pinch
 *     (แต่ `maximum-scale=1` ยังกันการที่หน้าซูมเองตอนโฟกัส input ตัวอักษรเล็ก)
 *  2. `touch-action: manipulation` บน html (index.css) — กัน double-tap zoom บนข้อความ/แผง
 *  3. ไฟล์นี้ — ตระกูล `gesture*` ของ WebKit เป็นทางเดียวที่หยุด pinch ระดับหน้าบน iOS ได้
 *     และต่างจาก preventDefault บน `touchmove` ตรงที่ **ไม่ไปกดการส่ง pointer event**
 *     ซึ่งจะฆ่า OrbitControls (ดู scene/touchGestures.ts) — pinch บนแผนที่จึงยังซูมแผนที่ปกติ
 *
 * ผูกที่ `document` ครั้งเดียวตอนบูต ไม่ใช่ใน setupScene (ซึ่งถูกรื้อสร้างทุกครั้งที่สลับจังหวัด)
 * และไม่แตะ ctrl+wheel / ctrl+± ของเดสก์ท็อป — ผู้ใช้เดสก์ท็อปยังซูมหน้าเพื่ออ่านได้
 *
 * **ยังไม่ได้ทดสอบบนอุปกรณ์จริง** — headless Chromium ไม่ยิง gesture* (เป็น event ของ WebKit)
 */
export function installPageZoomLock(doc: Document = document): () => void {
  const stop = (e: Event) => e.preventDefault();
  const opts: AddEventListenerOptions = { passive: false };
  const names = ["gesturestart", "gesturechange", "gestureend"] as const;
  for (const n of names) doc.addEventListener(n, stop, opts);
  return () => {
    for (const n of names) doc.removeEventListener(n, stop, opts);
  };
}
