import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LanguageContext } from "./context";
import { loadCatalog, translator, type Lang } from "./index";
import { readInitialLang, rememberLang } from "./initialLang";

/**
 * `initialLang` มาจาก `main.tsx` ซึ่งอ่าน `readInitialLang()` ครั้งเดียวและรอแคตตาล็อก
 * ของภาษานั้นมาก่อนเรนเดอร์ (ไม่ส่งมา = อ่านเองที่นี่ ใช้ได้เฉพาะภาษาไทย/แคตตาล็อกที่โหลดแล้ว)
 */
export function LanguageProvider({ initialLang, children }: { initialLang?: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => initialLang ?? readInitialLang());
  /** กดสลับรัว ๆ ระหว่างแคตตาล็อกยังโหลดอยู่ — เอาเฉพาะการกดครั้งล่าสุด */
  const latest = useRef(0);

  /**
   * การจำภาษาไม่สมมาตร (ดูเหตุผลเต็มใน `initialLang.ts`): ปุ่มสลับ = ผู้ใช้เลือกเอง
   * จึงจำถาวรข้ามแท็บ ส่วนภาษาที่ติดมากับ `?lang=` ของคนอื่นถูกจำไว้แค่ในแท็บนั้น
   * ตั้งแต่ตอนอ่านลิงก์ — ไม่มีการเขียนทับ `localStorage` ทุกครั้งที่ภาษาเปลี่ยน
   * เพราะการกดลิงก์ของคนอื่นครั้งเดียวไม่ควรเปลี่ยนภาษาถาวรให้ผู้อ่าน
   *
   * แคตตาล็อกอังกฤษเป็น chunk แยก: ภาษาเปลี่ยน (ข้อความ, `<html lang>`, การจำ) **หลัง**
   * โหลดสำเร็จเท่านั้น โหลดพลาด = ยังเป็นภาษาเดิมทั้งหน้า และ promise reject ให้ปุ่ม
   * สลับแสดงว่าพลาด — resolve `false` เมื่อถูกการกดที่ใหม่กว่าแซงไปแล้ว (ไม่ได้เปลี่ยนภาษา)
   */
  const setLang = useCallback(async (next: Lang): Promise<boolean> => {
    const ticket = ++latest.current;
    await loadCatalog(next);
    if (ticket !== latest.current) return false;
    setLangState(next);
    rememberLang(next, "choice");
    return true;
  }, []);

  // `<html lang>` ต้องตามภาษาที่แสดงจริง — screen reader และเครื่องมือแปลอ่านค่านี้
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t: translator(lang) }), [lang, setLang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
