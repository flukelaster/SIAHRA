import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "../../i18n/context";
import { panelByKey, type PanelContext } from "./panelRegistry";
import { DRAWER_ID } from "./SideRail";
import type { PanelKey } from "../../lib/shellPrefs";

/**
 * drawer เดียวข้าง rail — mount เฉพาะตอนเปิด และเรนเดอร์เฉพาะแผงที่เลือก
 * (`panelByKey(panel).render(ctx)`) ไม่ใช่ทั้งเก้าการ์ดพร้อมกันแบบ RightPanel เดิม
 *
 * โฟกัส: เปิด → ไปที่หัวข้อ (`<h2 tabIndex={-1}>`); ปิด (unmount) → กลับไปที่
 * ปุ่มของแผงนั้นบน rail ผ่าน `onClosed` ที่ AppShell จัดให้
 */
export function SideDrawer({
  ctx,
  panel,
  width,
  onClose,
  onClosed,
}: {
  ctx: PanelContext;
  panel: PanelKey;
  width: number;
  onClose: () => void;
  /** เรียกตอน unmount พร้อมคีย์ของแผงล่าสุดที่เปิดอยู่ */
  onClosed: (panel: PanelKey) => void;
}) {
  const t = useT();
  const def = panelByKey(panel);
  const Icon = def.icon;
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const latestPanel = useRef(panel);
  latestPanel.current = panel;
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => {
    // ย้ายโฟกัสเฉพาะเมื่อมีอะไรถือโฟกัสอยู่แล้ว (ปุ่มบน rail ที่เพิ่งถูกกด) — ตอนโหลด
    // หน้าที่ drawer เปิดเป็นค่าเริ่มต้น activeElement คือ body จึงไม่แย่งโฟกัสไปเฉย ๆ
    const active = document.activeElement;
    if (active && active !== document.body) headingRef.current?.focus();
  }, [panel]);
  useEffect(() => () => onClosedRef.current(latestPanel.current), []);

  return (
    <section
      id={DRAWER_ID}
      aria-labelledby={`${DRAWER_ID}-title`}
      // เส้นคั่นอยู่ที่ rail (border-r) ไม่ใช่ที่นี่ — กล่องของ drawer จึงกว้าง DRAWER_W พอดี
      className="flex min-w-0 shrink-0 flex-col"
      style={{ width }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-white/8 px-3.5 py-2.5">
        <Icon size={16} className="shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
        <h2
          id={`${DRAWER_ID}-title`}
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 truncate text-sm font-semibold text-[var(--color-fg)] outline-none"
        >
          {t(def.labelKey)}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("drawer.close")}
          title={t("drawer.close")}
          className="ml-auto flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--color-fg-muted)] transition-colors hover:bg-white/8 hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          <X size={15} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{def.render(ctx)}</div>
    </section>
  );
}
