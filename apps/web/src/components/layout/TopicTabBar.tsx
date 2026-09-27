import { useT } from "../../i18n/context";
import { PHONE_TABBAR_H } from "../../lib/shellLayout";
import { TOPICS, type TopicKey } from "../../lib/topics";
import { PanelBadge } from "./PanelBadge";
import { TOPIC_ICONS, topicBadge, type PanelContext } from "./panelRegistry";

export const SHEET_ID = "siahra-sheet";

/**
 * แถบแท็บหัวข้อล่างสุดของมือถือ (`PHONE_TABBAR_H` + `env(safe-area-inset-bottom)`) — แผ่นเลื่อน
 * วางอยู่ **บน** แถบนี้ จึงไม่มีสแนปไหนที่แถบบังบรรทัดเครดิตของส่วน peek
 *
 * แตะหัวข้อ = เลือก + กางแผ่นครึ่งจอ; แตะหัวข้อที่เลือกอยู่ขณะกางครึ่ง/เต็ม = หุบลง peek
 * (ตรรกะอยู่ใน `useShellState.tapTopic`) หัวข้อที่เลือกอยู่ถูกไฮไลต์เสมอ (`aria-current`)
 * เพราะเนื้อของแผ่นเป็นของหัวข้อนั้นแม้ตอนหุบ ส่วน `aria-expanded` บอกว่าแผ่นกางอยู่หรือไม่
 */
export function TopicTabBar({
  ctx,
  topic,
  sheetOpen,
  onTap,
}: {
  ctx: PanelContext;
  topic: TopicKey;
  sheetOpen: boolean;
  onTap: (topic: TopicKey) => void;
}) {
  const t = useT();
  return (
    <nav
      aria-label={t("tabbar.aria")}
      className="glass absolute right-0 bottom-0 left-0 z-20 flex items-stretch justify-around px-1"
      style={{ height: `calc(${PHONE_TABBAR_H}px + env(safe-area-inset-bottom))`, paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TOPICS.map((def) => {
        const Icon = TOPIC_ICONS[def.key];
        const active = def.key === topic;
        return (
          <div key={def.key} className="relative flex min-w-0 flex-1 items-center justify-center">
            <button
              type="button"
              onClick={() => onTap(def.key)}
              aria-label={t(def.labelKey)}
              aria-current={active ? "true" : undefined}
              aria-controls={SHEET_ID}
              aria-expanded={active && sheetOpen}
              className={`flex h-12 min-w-11 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl px-1 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
                active ? "text-white" : "text-[var(--color-fg-muted)]"
              }`}
            >
              <span
                className={`flex h-6 w-12 items-center justify-center rounded-full transition-colors ${
                  active ? "bg-[var(--color-accent)]/30" : ""
                }`}
                aria-hidden="true"
              >
                <Icon size={18} aria-hidden="true" />
              </span>
              <span className={`max-w-full truncate text-[11px] leading-normal ${active ? "font-semibold" : ""}`} aria-hidden="true">
                {t(def.shortLabelKey)}
              </span>
            </button>
            {/* badge เกาะมุมขวาบนของไอคอน ไม่ใช่มุมของปุ่มทั้งปุ่ม (ปุ่มกว้างเต็มช่อง) */}
            <span className="pointer-events-none absolute top-1 left-1/2 h-4 w-6">
              <PanelBadge badge={topicBadge(def.key, ctx)} />
            </span>
          </div>
        );
      })}
    </nav>
  );
}
