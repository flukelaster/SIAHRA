import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Province } from "../../data/types";
import { useLang } from "../../i18n/context";
import { ProvinceSelector } from "./ProvinceSelector";

/**
 * ชิปจังหวัดในแถบบน — แทนที่ `ProvinceSelector` ที่เคยเปิดค้างอยู่ในแผงซ้าย
 * ตัวเลือกจังหวัดเองใช้คอมโพเนนต์เดิมไม่แก้ แค่ย้ายไปอยู่ใน popover ที่ปิดเมื่อ
 * เลือก / กด Esc / คลิกข้างนอก
 *
 * Esc ที่นี่เรียก `preventDefault()` เพื่อบอก `useShellState` ว่าอีเวนต์นี้มีเจ้าของ
 * แล้ว (ไม่งั้นการปิด popover จะพา drawer ปิดตามไปด้วย)
 */
export function ProvinceChip({
  provinces,
  selected,
  onSelect,
}: {
  provinces: Province[];
  selected: Province;
  onSelect: (code: string) => void;
}) {
  const { lang, t } = useLang();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const name = lang === "th" ? selected.nameTh : selected.nameEn;

  useEffect(() => {
    if (!open) return;
    // โฟกัสช่องค้นหาของตัวเลือกทันที — คนใช้คีย์บอร์ดพิมพ์ต่อได้เลย
    popRef.current?.querySelector("input")?.focus();
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    // capture phase บน document: วิ่งก่อน listener แบบ bubble บน window ของ
    // useShellState (ไม่งั้น Esc ปิด drawer ก่อน) และไม่ขึ้นกับว่าโฟกัสอยู่ใน popover ไหม
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      chipRef.current?.focus();
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

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={chipRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("province.chip.aria", { name })}
        title={t("province.select")}
        className="flex h-8 max-w-[9rem] cursor-pointer items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 text-sm font-medium text-[var(--color-fg)] transition-colors hover:border-white/25 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] @xl:max-w-[14rem]"
      >
        <span className="truncate">{name}</span>
        <ChevronDown size={14} className="shrink-0 text-[var(--color-fg-muted)]" aria-hidden="true" />
      </button>
      {open ? (
        <div ref={popRef} className="glass absolute top-full left-0 z-50 mt-1.5 w-72 rounded-2xl p-3.5">
          <ProvinceSelector
            provinces={provinces}
            selected={selected}
            onSelect={(p) => {
              onSelect(p.code);
              setOpen(false);
              chipRef.current?.focus();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
