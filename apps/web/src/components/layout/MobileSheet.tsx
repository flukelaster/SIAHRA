import { ChevronDown, ChevronUp, GripHorizontal } from "lucide-react";
import { useRef } from "react";
import { useT } from "../../i18n/context";
import { SHEET_COLLAPSED_H } from "../../lib/shellLayout";
import type { PanelKey } from "../../lib/shellPrefs";
import { PanelBadge } from "./PanelBadge";
import { PANELS, panelByKey, type PanelContext } from "./panelRegistry";

/** ลากเกินระยะนี้ (px) ถือว่าเป็นการลาก ไม่ใช่แตะ */
const DRAG_THRESHOLD_PX = 30;

/**
 * Compact-screen replacement for the side docks: a bottom sheet with tabs.
 * Collapsed it shows only the tab strip so the map keeps most of the screen.
 *
 * ใช้ทะเบียนแผงเดียวกับ rail/drawer (`PANELS`) และแท็บที่เลือกถูกควบคุมจาก
 * `useShellState.panel` — แท็บที่เปิดอยู่บนมือถือจึงเป็นแผงเดียวกับที่จะเปิดใน
 * drawer ถ้าหมุนจอ/ขยายหน้าต่าง
 *
 * ปุ่มย่อ/ขยายอยู่ **นอก** แถบแท็บที่เลื่อนแนวนอน (พี่น้อง `shrink-0` ถัดจากแถบ)
 * — เวอร์ชันก่อนวางไว้ `ml-auto` ในแถบ พอมีแท็บเยอะปุ่มก็ถูกเลื่อนตกขอบจอจนกด
 * ไม่ได้ (บั๊ก "ปิดเมนูบนมือถือไม่ได้")
 */
export function MobileSheet({
  ctx,
  active,
  onActiveChange,
  open,
  onOpenChange,
  height,
}: {
  ctx: PanelContext;
  active: PanelKey;
  onActiveChange: (key: PanelKey) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  height: number;
}) {
  const t = useT();
  const current = panelByKey(active);

  // ลากที่มือจับ: ขึ้น = ขยาย ลง = ย่อ แตะเฉย ๆ = สลับ
  const dragStartY = useRef<number | null>(null);
  const dragged = useRef(false);
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    dragStartY.current = e.clientY;
    dragged.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (dragStartY.current === null) return;
    const dy = e.clientY - dragStartY.current;
    dragStartY.current = null;
    if (dy <= -DRAG_THRESHOLD_PX) {
      dragged.current = true;
      onOpenChange(true);
    } else if (dy >= DRAG_THRESHOLD_PX) {
      dragged.current = true;
      onOpenChange(false);
    }
  };
  const onHandleClick = () => {
    // click ตามหลัง pointerup เสมอ — ถ้าเพิ่งลากไปแล้ว อย่าสลับซ้ำ
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    onOpenChange(!open);
  };

  return (
    <div
      className="glass absolute right-2 bottom-2 left-2 z-20 flex flex-col overflow-hidden rounded-2xl"
      style={{ height: open ? height : SHEET_COLLAPSED_H }}
    >
      <div className="flex shrink-0 items-center gap-1 px-1.5 py-1.5">
        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragStartY.current = null;
          }}
          onClick={onHandleClick}
          aria-label={t("sheet.dragHandle")}
          title={t("sheet.dragHandle")}
          className="flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-[var(--color-fg-subtle)] hover:bg-white/8 active:cursor-grabbing"
        >
          <GripHorizontal size={14} aria-hidden="true" />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {PANELS.map((p) => {
            const isActive = current.key === p.key && open;
            const badge = p.badge?.(ctx) ?? null;
            return (
              <div key={p.key} className="relative shrink-0">
                <button
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    // แตะแท็บที่เปิดอยู่ = หุบแผ่น; แท็บอื่น = สลับแล้วเปิด
                    if (isActive) {
                      onOpenChange(false);
                      return;
                    }
                    onActiveChange(p.key);
                    if (!open) onOpenChange(true);
                  }}
                  className={`cursor-pointer rounded-lg px-2.5 py-1 text-xs whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-[var(--color-accent)]/25 text-white"
                      : "text-[var(--color-fg-muted)] hover:bg-white/8"
                  }`}
                >
                  {t(p.labelKey)}
                </button>
                <PanelBadge badge={badge} />
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-label={open ? t("sheet.collapse") : t("sheet.expand")}
          title={open ? t("sheet.collapse") : t("sheet.expand")}
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-white/8"
        >
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
      {open ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">{current.render(ctx)}</div>
      ) : null}
    </div>
  );
}
