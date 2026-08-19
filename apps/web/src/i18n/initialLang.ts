import { parsePermalink } from "../lib/permalink";
import { DEFAULT_LANG, LANG_STORAGE_KEY, isLang, type Lang } from "./index";

/**
 * ลำดับความสำคัญของการเลือกภาษา (ไม่มี `navigator.language` อยู่ในนี้โดยตั้งใจ):
 *
 *   1. `?lang=` ในลิงก์ — คนแชร์ระบุมาชัดเจน
 *   2. ภาษาของ "แท็บนี้" (`sessionStorage`) — มาจากลิงก์ที่เปิดในแท็บนี้ หรือจากปุ่มสลับ
 *   3. ภาษาที่ผู้ใช้เคยกดสลับไว้เอง (`localStorage["siahra.lang"]`)
 *   4. ภาษาไทย
 *
 * มติเจ้าของโครงการ (docs/roadmap.md §4): ค่าเริ่มต้นคือภาษาไทย **เสมอ** ห้าม
 * เดาจากภาษาของเบราว์เซอร์ คนไทยที่เครื่องตั้งเป็น en-US ต้องได้หน้าไทย
 *
 * **การจำภาษาไม่สมมาตรโดยตั้งใจ** ภาษาที่ผู้ใช้ "เลือกเอง" (กดปุ่มสลับ) เขียนลงทั้ง
 * `localStorage` และ `sessionStorage` จึงติดตัวข้ามแท็บและข้ามการปิดเบราว์เซอร์ ส่วน
 * ภาษาที่ "ติดมากับลิงก์ของคนอื่น" เขียนลง `sessionStorage` อย่างเดียว — อยู่รอด
 * การรีโหลดในแท็บเดิม (เพราะ `serialisePermalink` ลบ `lang=th` ออกจาก URL ตามแบบ
 * เดียวกับ `ex` ถ้าไม่จำอะไรเลย ผู้อ่านจะเด้งกลับทุกครั้งที่โหลดใหม่) แต่หายไปเมื่อ
 * ปิดแท็บ การกดลิงก์ของคนอื่นครั้งเดียวจึงไม่เปลี่ยนภาษาถาวรให้ผู้อ่าน
 *
 * `sessionStorage` มาก่อน `localStorage` เพราะเป็นสัญญาณที่ใหม่กว่าและเจาะจงกว่า
 * (ปุ่มสลับเขียนทั้งสองที่ ความจำข้ามแท็บจึงไม่เสียไป)
 *
 * อ่าน `window.location.search` เองที่นี่ ไม่ได้รับผ่าน App เพราะ `/methodology`
 * เป็นอีกหน้าหนึ่งที่ไม่ได้ mount `usePermalinkSync` แต่ก็ต้องรับ `?lang=` ได้
 */
export function readInitialLang(): Lang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  const fromLink = parsePermalink(window.location.search).lang;
  if (fromLink) {
    // ภาษาของลิงก์กลายเป็นภาษาของ "แท็บนี้" ตั้งแต่วินาทีนี้ — เขียนทันทีตรงนี้
    // ไม่ใช่ใน effect เพราะข้อเท็จจริงเป็นจริง ณ ตอนที่อ่านลิงก์ได้เลย
    rememberLang(fromLink, "link");
    return fromLink;
  }
  return readStoredLang() ?? DEFAULT_LANG;
}

/** ภาษาที่จำไว้ (แท็บนี้ก่อน แล้วค่อยเป็นตัวเลือกถาวร) — null = ไม่เคยจำอะไรไว้ */
function readStoredLang(): Lang | null {
  for (const store of [window.sessionStorage, window.localStorage]) {
    try {
      const stored = store.getItem(LANG_STORAGE_KEY);
      if (isLang(stored)) return stored;
    } catch {
      // storage ถูกปิด (โหมดส่วนตัว/นโยบายองค์กร) — ข้ามไป ไม่ใช่ล้มทั้งหน้า
    }
  }
  return null;
}

/**
 * จำภาษาไว้ตาม "ที่มา" ของมัน
 *   - `"choice"` = ผู้ใช้กดปุ่มสลับเอง → ถาวร (localStorage) + แท็บนี้ (sessionStorage)
 *   - `"link"`   = ติดมากับ `?lang=` ของคนอื่น → แท็บนี้เท่านั้น
 */
export function rememberLang(lang: Lang, source: "choice" | "link"): void {
  if (typeof window === "undefined") return;
  const stores = source === "choice" ? [window.sessionStorage, window.localStorage] : [window.sessionStorage];
  for (const store of stores) {
    try {
      store.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // เก็บไม่ได้ก็ยังสลับภาษาในหน้านี้ได้ตามปกติ
    }
  }
}
