import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { LanguageContext } from "./context";
import { translator, type Lang } from "./index";
import { readInitialLang, rememberLang } from "./initialLang";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  /**
   * การจำภาษาไม่สมมาตร (ดูเหตุผลเต็มใน `initialLang.ts`): ปุ่มสลับ = ผู้ใช้เลือกเอง
   * จึงจำถาวรข้ามแท็บ ส่วนภาษาที่ติดมากับ `?lang=` ของคนอื่นถูกจำไว้แค่ในแท็บนั้น
   * ตั้งแต่ตอนอ่านลิงก์ — ไม่มีการเขียนทับ `localStorage` ทุกครั้งที่ภาษาเปลี่ยน
   * เพราะการกดลิงก์ของคนอื่นครั้งเดียวไม่ควรเปลี่ยนภาษาถาวรให้ผู้อ่าน
   */
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    rememberLang(next, "choice");
  }, []);

  // `<html lang>` ต้องตามภาษาที่แสดงจริง — screen reader และเครื่องมือแปลอ่านค่านี้
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t: translator(lang) }), [lang, setLang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
