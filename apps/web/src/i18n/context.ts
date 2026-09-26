import { createContext, useContext } from "react";
import { DEFAULT_LANG, translator, type Lang, type TFunction } from "./index";

export interface LanguageContextValue {
  lang: Lang;
  /**
   * สลับภาษา — อาจต้องรอโหลดแคตตาล็อกก่อน (อังกฤษเป็น chunk แยก) จึงคืน promise ที่
   * resolve `true` เมื่อภาษาเปลี่ยนจริง (`false` = ถูกการกดที่ใหม่กว่าแซง) และ reject
   * เมื่อโหลดไม่สำเร็จ (ภาษาเดิมยังอยู่)
   */
  setLang: (lang: Lang) => void | Promise<boolean>;
  t: TFunction;
}

/**
 * ค่า default ของ context เป็นภาษาไทยและ `setLang` ที่ไม่ทำอะไร — ถ้ามีคอมโพเนนต์
 * หลุดออกไปนอก `LanguageProvider` มันจะยังเรนเดอร์ข้อความไทยได้ตามปกติ (ค่าเริ่มต้น
 * ที่ถูกต้อง) แทนที่จะโยน error แล้วทำให้ทั้งหน้าจอหายไป
 */
export const LanguageContext = createContext<LanguageContextValue>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: translator(DEFAULT_LANG),
});

/** ภาษาปัจจุบัน + ตัวสลับ (ใช้เมื่อต้องส่ง `lang` ต่อให้ฟังก์ชัน pure เช่น lib/time.ts) */
export function useLang(): LanguageContextValue {
  return useContext(LanguageContext);
}

/** ตัวแปลข้อความของภาษาปัจจุบัน */
export function useT(): TFunction {
  return useContext(LanguageContext).t;
}
