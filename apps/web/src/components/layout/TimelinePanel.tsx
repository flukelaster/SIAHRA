import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useT } from "../../i18n/context";
import { ChunkBoundary } from "../ui/ChunkBoundary";
import { lazyView } from "../ui/lazyView";
import type { TimelineMark } from "./TimelineBar";

/** id ของแผง — ชิปเวลาชี้มาที่นี่ด้วย `aria-controls` (เฉพาะตอนที่แผง mount อยู่) */
export const TIMELINE_PANEL_ID = "siahra-timeline";

/**
 * `TimelineBar` ตัวเต็มเป็น chunk แยก — ไม่มีใครเห็นมันจนกว่าจะกดชิปเวลา จึงไม่ต้องอยู่ในบันเดิลหลัก
 * (ระหว่างโหลด `ChunkBoundary` แสดงวงหมุน; โหลดพลาด = กล่องลองใหม่ ไม่ใช่แผงว่าง)
 */
const LazyTimelineBar = lazyView(() => import("./TimelineBar").then((m) => m.TimelineBar));

const frame = (content: ReactNode) => <div className="flex min-h-16 items-center justify-center p-2">{content}</div>;

/**
 * แผงลอยของแถบเวลา (E18.4) — กางจากชิปเวลา: ≥ tablet อยู่ใน `BottomDock` เหนือแถวสถานะ + เครดิต,
 * มือถืออยู่เหนือแถบแท็บหัวข้อ (ทับ peek ของแผ่นเลื่อน แล้วพกบรรทัดเครดิตของตัวเองมาใน `footer`)
 *
 * แผงนี้ **ไม่มีอยู่เลย** ตอนหุบ — AppShell mount มันเฉพาะตอนกาง (devops C5): `TimelineBar` ที่กำลัง
 * เล่นอยู่จึงหยุดพร้อมกับถูก unmount ไม่มีแถบที่ซ่อนด้วย CSS แล้วยังเรียก onChange ต่อ
 * การกาง/หุบเองไม่เปลี่ยน atIso (C6) — ช่วงที่เลือกถูกถือไว้ที่เปลือก (`rangeIdx`) ไม่ใช่ใน permalink
 *
 * ไม่ใช่ modal: ปิดด้วย X / Escape แล้วคืนโฟกัสให้ชิป — Escape รับใน capture phase แล้ว
 * `preventDefault()` เพื่อไม่ให้ `useShellState` ปิด drawer / หุบแผ่นเลื่อนซ้ำ (แบบเดียวกับ LayersPopover)
 */
export function TimelinePanel({
  atIso,
  onAtIsoChange,
  marks,
  rangeIdx,
  onRangeIdxChange,
  onClose,
  returnFocusRef,
  className = "",
  footer = null,
}: {
  atIso: string | null;
  onAtIsoChange: (atIso: string | null) => void;
  marks?: TimelineMark[];
  rangeIdx: number;
  onRangeIdxChange: (rangeIdx: number) => void;
  onClose: () => void;
  /** ชิปเวลาที่เปิดแผงนี้ */
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  className?: string;
  /** มือถือ: บรรทัดเครดิตย่อ (แผงทับ peek อยู่ เครดิตภาพดาวเทียมต้องยังมองเห็นได้) */
  footer?: ReactNode;
}) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
      returnFocusRef.current?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, returnFocusRef]);

  return (
    <div
      ref={panelRef}
      id={TIMELINE_PANEL_ID}
      role="dialog"
      aria-modal="false"
      aria-label={t("timeline.title")}
      tabIndex={-1}
      className={`flex flex-col gap-1.5 outline-none ${className}`}
    >
      <div className="flex items-start gap-2 @container">
        <div className="min-w-0 flex-1">
          <ChunkBoundary frame={frame}>
            <LazyTimelineBar
              atIso={atIso}
              onChange={onAtIsoChange}
              variant="full"
              marks={marks}
              rangeIdx={rangeIdx}
              onRangeIdxChange={onRangeIdxChange}
            />
          </ChunkBoundary>
        </div>
        <button
          type="button"
          onClick={() => {
            onClose();
            returnFocusRef.current?.focus();
          }}
          aria-label={t("timeChip.close")}
          title={t("timeChip.close")}
          className="glass-soft flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      {footer}
    </div>
  );
}
