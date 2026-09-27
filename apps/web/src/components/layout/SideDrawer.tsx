import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "../../i18n/context";
import type { PanelKey } from "../../lib/shellPrefs";
import { subPanelId, subTabId, topicByKey, topicOf, type TopicKey } from "../../lib/topics";
import { TOPIC_ICONS, panelByKey, type PanelContext } from "./panelRegistry";
import { PanelSlot } from "./PanelSlot";
import { DRAWER_ID } from "./SideRail";
import { SubTabs } from "./SubTabs";

/**
 * drawer เดียวข้าง rail — mount เฉพาะตอนเปิด หัวข้อของมันอยู่ที่ header และแท็บย่อย
 * (`SubTabs`) อยู่ใต้ header เมื่อหัวข้อมีหลายมุมมอง เรนเดอร์ **เฉพาะมุมมองที่เลือก**
 * (`<PanelSlot def={panelByKey(panel)}>` — เนื้อแผงเป็น chunk แยก)
 *
 * โฟกัส: เปิด/เปลี่ยนหัวข้อ → ไปที่หัวข้อ (`<h2 tabIndex={-1}>`) — เปลี่ยนแท็บย่อยไม่ย้าย
 * (โฟกัสต้องอยู่ที่แท็บให้ลูกศรทำงานต่อได้); ปิด (unmount) → กลับไปที่ปุ่มของหัวข้อนั้นบน
 * rail ผ่าน `onClosed` ที่ AppShell จัดให้
 */
export function SideDrawer({
  ctx,
  panel,
  onPanelChange,
  width,
  onClose,
  onClosed,
}: {
  ctx: PanelContext;
  panel: PanelKey;
  onPanelChange: (key: PanelKey) => void;
  width: number;
  onClose: () => void;
  /** เรียกตอน unmount พร้อมหัวข้อล่าสุดที่เปิดอยู่ */
  onClosed: (topic: TopicKey) => void;
}) {
  const t = useT();
  const def = panelByKey(panel);
  const topic = topicOf(panel);
  const topicDef = topicByKey(topic);
  const Icon = TOPIC_ICONS[topic];
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const latestTopic = useRef(topic);
  latestTopic.current = topic;
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const hasTabs = topicDef.views.length > 1;

  useEffect(() => {
    // ย้ายโฟกัสเฉพาะเมื่อมีอะไรถือโฟกัสอยู่แล้ว (ปุ่มบน rail ที่เพิ่งถูกกด) — ตอนโหลด
    // หน้าที่ drawer เปิดเป็นค่าเริ่มต้น activeElement คือ body จึงไม่แย่งโฟกัสไปเฉย ๆ
    const active = document.activeElement;
    if (active && active !== document.body) headingRef.current?.focus();
  }, [topic]);
  useEffect(() => () => onClosedRef.current(latestTopic.current), []);

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
          {t(topicDef.labelKey)}
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
      {hasTabs ? (
        <div className="shrink-0 px-3 pt-3">
          <SubTabs topic={topic} active={panel} onSelect={onPanelChange} ctx={ctx} idBase={DRAWER_ID} />
        </div>
      ) : null}
      <div
        id={hasTabs ? subPanelId(DRAWER_ID) : undefined}
        role={hasTabs ? "tabpanel" : undefined}
        aria-labelledby={hasTabs ? subTabId(DRAWER_ID, panel) : undefined}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
      >
        <PanelSlot def={def} ctx={ctx} />
      </div>
    </section>
  );
}
