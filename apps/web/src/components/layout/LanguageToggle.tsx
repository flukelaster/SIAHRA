import { useState } from "react";
import { useLang } from "../../i18n/context";
import { LANGS, type Lang } from "../../i18n";
import { syncLangInUrl } from "../../lib/langUrl";

/**
 * ปุ่มสลับภาษา — ค่าเริ่มต้นของแอปคือภาษาไทยเสมอ (docs/roadmap.md §4)
 * ไม่มีการเดาภาษาจากเบราว์เซอร์ ตัวเลือกที่กดจึงเป็นความตั้งใจของผู้ใช้ และถูกจำ
 * ไว้ถาวร (ต่างจากภาษาที่ติดมากับ `?lang=` ของคนอื่น — ดู `i18n/initialLang.ts`)
 *
 * `compact` เหลือปุ่มเดียวที่แสดง "ภาษาที่จะสลับไป" เพราะกลุ่มสองปุ่มกินความกว้าง
 * จนช่องค้นหาแคบเกินใช้งาน (วัดได้ ~76px บนจอ 390)
 *
 * แยกออกจาก `TopBar` เพราะ `/methodology` ไม่มีแถบบน แต่ต้องสลับภาษาได้เหมือนกัน
 * — สองหน้าใช้ปุ่มตัวเดียวกัน ไม่ใช่คนละสำเนา
 *
 * แคตตาล็อกอังกฤษเป็น chunk แยก: URL เปลี่ยนตามก็ต่อเมื่อภาษาเปลี่ยนจริงแล้ว (ไม่มี
 * `?lang=en` ค้างบนหน้าที่ยังเป็นภาษาไทย) และถ้าโหลดพลาด ปุ่มขึ้นกรอบแดง + title
 * "โหลดภาษาอังกฤษไม่สำเร็จ" (Chromium จำ import ที่ล้มไว้ — กดซ้ำไม่ช่วย ต้องโหลดหน้าใหม่ ดู `lib/lazyModule.ts`)
 */
export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { lang, setLang: setLangState, t } = useLang();
  const [failed, setFailed] = useState(false);
  const setLang = (next: Lang) => {
    setFailed(false);
    Promise.resolve(setLangState(next)).then(
      (applied) => {
        if (applied !== false) syncLangInUrl(next);
      },
      () => setFailed(true),
    );
  };
  const failBorder = failed ? " border-[var(--color-risk-high)]" : " border-white/10";
  const failTitle = failed ? `${t("lang.loadFailed")} · ` : "";
  /** ภาษาที่ปุ่มบนจอแคบจะสลับไป */
  const other: Lang = lang === "th" ? "en" : "th";
  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setLang(other)}
        lang={other}
        title={failTitle + t(other === "th" ? "lang.name.th" : "lang.name.en")}
        aria-label={`${failTitle}${t("lang.switch")}: ${t(other === "th" ? "lang.name.th" : "lang.name.en")}`}
        className={`flex h-8 shrink-0 items-center rounded-lg border${failBorder} px-2 text-xs text-[var(--color-fg-muted)] transition-colors hover:border-white/25 hover:text-[var(--color-fg)]`}
      >
        {t(other === "th" ? "lang.option.th" : "lang.option.en")}
      </button>
    );
  }
  return (
    <div
      className={`flex shrink-0 rounded-lg border${failBorder} p-0.5`}
      role="group"
      aria-label={failTitle + t("lang.switch")}
      title={failed ? t("lang.loadFailed") : undefined}
    >
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          lang={l}
          title={t(l === "th" ? "lang.name.th" : "lang.name.en")}
          className={`cursor-pointer rounded-md px-2 py-1 text-xs transition-colors ${
            lang === l
              ? "bg-[var(--color-accent)] text-white"
              : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          }`}
        >
          {t(l === "th" ? "lang.option.th" : "lang.option.en")}
        </button>
      ))}
    </div>
  );
}
