import { Camera, Check, Database, Languages, Link2, Ellipsis } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLang } from "../../i18n/context";
import type { Lang } from "../../i18n";
import { syncLangInUrl } from "../../lib/langUrl";

const MENU_ID = "siahra-more-menu";

const ICON_BUTTON =
  "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/10 text-[var(--color-fg-muted)] transition-colors hover:border-white/25 hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]";

const ITEM =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--color-fg-muted)] transition-colors hover:bg-white/8 hover:text-[var(--color-fg)] focus-visible:bg-white/8 focus-visible:text-[var(--color-fg)] focus-visible:outline-none";

/**
 * เมนู ⋯ ของ TopBar (E18.4) — ทุก tier: แชร์ลิงก์ · บันทึกภาพ (ไม่มีบนมือถือ เหมือนก่อน) · สลับภาษา ·
 * แหล่งข้อมูล (ThaiWater) — ของทุกชิ้นที่เคยเป็นปุ่มไอคอนบน TopBar ยังกดได้ครบ แค่ย้ายมาอยู่ที่นี่
 * เพื่อให้ช่องค้นหา + ชิปเวลามีที่
 *
 * รูปแบบ menu button ของ WAI-ARIA: `aria-haspopup="menu"` + `aria-expanded` + `aria-controls`;
 * เปิดแล้วโฟกัสรายการแรก; ↑/↓/Home/End เดินในรายการ; Escape / Tab / คลิกนอกกรอบปิด; Escape และ
 * การเลือกรายการคืนโฟกัสให้ปุ่ม Escape รับใน capture phase แล้ว `preventDefault()` เพื่อไม่ให้
 * `useShellState` ปิด drawer / หุบแผ่นเลื่อนซ้ำ
 *
 * ไม่มีการดึงข้อมูลที่นี่ (devops C3) — การสลับภาษาโหลดแคตตาล็อกอังกฤษผ่าน `setLang` ของ i18n
 * (chunk แยกเดิม) และถ้าโหลดพลาด ปุ่ม ⋯ ขึ้นกรอบแดง + title "โหลดภาษาอังกฤษไม่สำเร็จ" แบบเดียวกับ
 * `LanguageToggle`
 */
export function MoreMenu({
  onShare,
  onSnapshot,
  showSnapshot,
}: {
  onShare: () => Promise<boolean>;
  onSnapshot: () => void;
  /** ปุ่มบันทึกภาพซ่อนบนมือถือ (เหมือนก่อน E18.4) */
  showSnapshot: boolean;
}) {
  const { lang, setLang: setLangState, t } = useLang();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [langFailed, setLangFailed] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const copiedTimer = useRef<number | null>(null);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = (i + 1) % items.length;
    else if (e.key === "ArrowUp") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (next !== null) {
      e.preventDefault();
      items[next].focus();
    }
  };

  const share = async () => {
    close(true);
    const ok = await onShare();
    setCopied(ok);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1800);
  };

  const other: Lang = lang === "th" ? "en" : "th";
  const otherName = t(other === "th" ? "lang.name.th" : "lang.name.en");
  const switchLang = () => {
    close(true);
    setLangFailed(false);
    Promise.resolve(setLangState(other)).then(
      (applied) => {
        if (applied !== false) syncLangInUrl(other);
      },
      () => setLangFailed(true),
    );
  };

  const buttonLabel = copied ? t("topbar.copied") : langFailed ? `${t("lang.loadFailed")} · ${t("topbar.more")}` : t("topbar.more");

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? MENU_ID : undefined}
        aria-label={buttonLabel}
        title={buttonLabel}
        className={`${ICON_BUTTON} ${open ? "border-white/25 text-[var(--color-fg)]" : ""} ${
          langFailed ? "border-[var(--color-risk-high)]" : ""
        }`}
      >
        {copied ? (
          <Check size={14} className="text-[var(--color-success)]" aria-hidden="true" />
        ) : (
          <Ellipsis size={15} aria-hidden="true" />
        )}
      </button>
      {/* ผลของการคัดลอกลิงก์ — เมนูปิดไปแล้วตอนที่ผลมาถึง จึงประกาศผ่าน live region แทน */}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? t("topbar.copied") : ""}
      </span>
      {open ? (
        <div
          ref={menuRef}
          id={MENU_ID}
          data-topbar-popover
          role="menu"
          aria-label={t("topbar.more")}
          onKeyDown={onMenuKey}
          className="glass absolute top-full right-0 z-50 mt-1.5 flex w-60 flex-col gap-0.5 rounded-xl p-1"
        >
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => void share()} className={ITEM}>
            <Link2 size={14} className="shrink-0" aria-hidden="true" />
            {t("topbar.shareTitle")}
          </button>
          {showSnapshot ? (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close(true);
                onSnapshot();
              }}
              className={ITEM}
            >
              <Camera size={14} className="shrink-0" aria-hidden="true" />
              {t("topbar.snapshotTitle")}
            </button>
          ) : null}
          <button type="button" role="menuitem" tabIndex={-1} lang={other} onClick={switchLang} className={ITEM}>
            <Languages size={14} className="shrink-0" aria-hidden="true" />
            <span>
              <span lang={lang}>{t("lang.switch")}: </span>
              {otherName}
            </span>
          </button>
          {/* ลิงก์ไปต้นทาง ThaiWater — เดิมเป็นไอคอนบน TopBar เฉพาะ ≥ tablet ตอนนี้อยู่ในเมนูทุก tier */}
          <a
            role="menuitem"
            tabIndex={-1}
            href="https://www.thaiwater.net/"
            target="_blank"
            rel="noreferrer noopener"
            onClick={() => close(false)}
            className={ITEM}
          >
            <Database size={14} className="shrink-0" aria-hidden="true" />
            {t("topbar.sources")}
          </a>
        </div>
      ) : null}
    </div>
  );
}
