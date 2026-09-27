import type { RefObject } from "react";
import { useT } from "../../i18n/context";
import { RAIL_W } from "../../lib/shellLayout";
import { TOPICS, type TopicKey } from "../../lib/topics";
import { PanelBadge } from "./PanelBadge";
import { TOPIC_ICONS, topicBadge, type PanelContext } from "./panelRegistry";

export const DRAWER_ID = "siahra-drawer";

/**
 * rail หัวข้อซ้ายสุด (`RAIL_W`) — ปุ่มละหัวข้อ ไอคอนบน ป้ายสั้นล่าง (ชื่อเต็มเป็น aria-label)
 * กดหัวข้อที่เปิดอยู่ = ปิด drawer; หัวข้ออื่น = เปิดที่มุมมองย่อยล่าสุดของมัน
 *
 * badge ของหัวข้อ = ตัวที่รุนแรงที่สุดของมุมมองย่อย (`topicBadge`) — แจ้งเตือน อปท. อยู่ที่
 * ภาพรวม พายุอยู่ที่ฝนและพายุ ต้องเห็นได้แม้ drawer ปิดอยู่
 */
export function SideRail({
  ctx,
  topic,
  drawerOpen,
  onToggle,
  buttonRefs,
}: {
  ctx: PanelContext;
  topic: TopicKey;
  drawerOpen: boolean;
  onToggle: (topic: TopicKey) => void;
  /** SideDrawer คืนโฟกัสให้ปุ่มของหัวข้อที่เพิ่งปิด */
  buttonRefs: RefObject<Partial<Record<TopicKey, HTMLButtonElement | null>>>;
}) {
  const t = useT();
  return (
    <nav
      aria-label={t("rail.aria")}
      className="flex shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-white/8 py-1.5"
      style={{ width: RAIL_W }}
    >
      {TOPICS.map((def) => {
        const Icon = TOPIC_ICONS[def.key];
        const open = drawerOpen && topic === def.key;
        return (
          <div key={def.key} className="relative shrink-0">
            <button
              ref={(el) => {
                buttonRefs.current[def.key] = el;
              }}
              type="button"
              onClick={() => onToggle(def.key)}
              aria-label={t(def.labelKey)}
              title={t(def.labelKey)}
              aria-controls={DRAWER_ID}
              aria-expanded={open}
              aria-current={open ? "true" : undefined}
              className={`flex min-h-14 w-[72px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border px-1 py-1.5 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
                open
                  ? "border-[var(--color-accent)]/70 bg-[var(--color-accent)]/25 text-white"
                  : "border-transparent text-[var(--color-fg-muted)] hover:border-white/15 hover:bg-white/8 hover:text-[var(--color-fg)]"
              }`}
            >
              <Icon size={18} aria-hidden="true" />
              <span className="max-w-full text-center text-[11px] leading-tight" aria-hidden="true">
                {t(def.shortLabelKey)}
              </span>
            </button>
            <PanelBadge badge={topicBadge(def.key, ctx)} />
          </div>
        );
      })}
    </nav>
  );
}
