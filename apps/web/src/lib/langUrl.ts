import { DEFAULT_LANG, type Lang } from "../i18n";

/**
 * (ย้ายมาจาก `LanguageToggle.tsx` ใน E18.4 — เมนู ⋯ ของ TopBar สลับภาษาด้วยกติกาเดียวกัน)
 *
 * ปุ่มนี้เป็นเสียงสุดท้าย: ถ้า URL ยังพก `?lang=` ของคนที่แชร์มา ต้องเขียนทับให้ตรง
 * กับสิ่งที่ผู้ใช้เพิ่งกด ไม่งั้นโหลดใหม่แล้วเด้งกลับเป็นภาษาของลิงก์ (`/methodology`
 * ไม่มี `usePermalinkSync` จึงไม่มีใครลบ `lang` ให้เลย) ละไว้เมื่อเป็นภาษาไทย
 * ตามกติกาเดียวกับ `serialisePermalink`
 */
export function syncLangInUrl(next: Lang): void {
  const q = new URLSearchParams(window.location.search);
  if (next === DEFAULT_LANG) {
    if (!q.has("lang")) return;
    q.delete("lang");
  } else {
    if (q.get("lang") === next) return;
    q.set("lang", next);
  }
  const search = q.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
}
