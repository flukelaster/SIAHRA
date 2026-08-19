import { useLang } from "../../i18n/context";
import { DEFAULT_LANG, LANGS, type Lang } from "../../i18n";

/**
 * ปุ่มนี้เป็นเสียงสุดท้าย: ถ้า URL ยังพก `?lang=` ของคนที่แชร์มา ต้องเขียนทับให้ตรง
 * กับสิ่งที่ผู้ใช้เพิ่งกด ไม่งั้นโหลดใหม่แล้วเด้งกลับเป็นภาษาของลิงก์ (`/methodology`
 * ไม่มี `usePermalinkSync` จึงไม่มีใครลบ `lang` ให้เลย) ละไว้เมื่อเป็นภาษาไทย
 * ตามกติกาเดียวกับ `serialisePermalink`
 */
function syncLangInUrl(next: Lang): void {
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
 */
export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { lang, setLang: setLangState, t } = useLang();
  const setLang = (next: Lang) => {
    setLangState(next);
    syncLangInUrl(next);
  };
  /** ภาษาที่ปุ่มบนจอแคบจะสลับไป */
  const other: Lang = lang === "th" ? "en" : "th";
  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setLang(other)}
        lang={other}
        title={t(other === "th" ? "lang.name.th" : "lang.name.en")}
        aria-label={`${t("lang.switch")}: ${t(other === "th" ? "lang.name.th" : "lang.name.en")}`}
        className="flex h-8 shrink-0 items-center rounded-lg border border-white/10 px-2 text-xs text-[var(--color-fg-muted)] transition-colors hover:border-white/25 hover:text-[var(--color-fg)]"
      >
        {t(other === "th" ? "lang.option.th" : "lang.option.en")}
      </button>
    );
  }
  return (
    <div
      className="flex shrink-0 rounded-lg border border-white/10 p-0.5"
      role="group"
      aria-label={t("lang.switch")}
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
