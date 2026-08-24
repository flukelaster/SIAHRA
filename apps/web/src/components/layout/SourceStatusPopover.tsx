import { useEffect, useRef, useState } from "react";
import type { ApiHealthState } from "../../hooks/useApiHealth";
import { useT } from "../../i18n/context";
import { SourceStatusBar } from "./SourceStatusBar";

/**
 * ปุ่ม = `SourceStatusBar compact` (จุดสถานะ + จำนวนแหล่งที่ผิดปกติ) ที่อยู่ใน dock
 * **ตลอดเวลา**; popover = รายการเต็มพร้อมเวลาที่ดึงสำเร็จครั้งสุดท้ายของแต่ละแหล่ง
 *
 * กรณี API ล่ม แถวแดงของ `SourceStatusBar` แสดงตรง ๆ ไม่ห่อเป็นปุ่ม (ไม่มีรายการ
 * อะไรให้ขยาย และข้อความนั้นต้องอ่านได้ทันทีเหมือนเดิม)
 *
 * Esc ที่ปิด popover เรียก `preventDefault()` เพื่อไม่ให้ `useShellState` ปิด drawer ซ้ำ
 */
export function SourceStatusPopover({ state }: { state: ApiHealthState }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    // capture phase: ต้องวิ่งก่อน listener แบบ bubble บน window ของ useShellState
    // ไม่งั้น Esc จะปิด drawer ไปก่อนที่ popover จะได้ preventDefault
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (state.apiDown) return <SourceStatusBar state={state} compact />;

  const sources = state.health?.sources ?? [];
  if (sources.length === 0) {
    // ยังไม่เคยได้ /health เลย — บอกว่า "ยังไม่ทราบ" ไม่ใช่เว้นว่างหรือแสดงว่าปกติ
    return (
      <div className="glass-soft flex h-8 items-center gap-2 rounded-xl px-3 text-[11px]">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-fg-subtle)]" aria-hidden="true" />
        <span className="text-[var(--color-fg-subtle)]">
          {t("status.sources")} · {t("health.unknown")}
        </span>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("status.openAll")}
        title={t("status.openAll")}
        className="block cursor-pointer rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        <SourceStatusBar state={state} compact />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={t("status.sources")}
          className="glass absolute bottom-full left-0 z-30 mb-2 w-max max-w-[min(92vw,44rem)] rounded-2xl p-1"
        >
          <SourceStatusBar state={state} />
        </div>
      ) : null}
    </div>
  );
}
