import { useRef, type KeyboardEvent } from "react";
import { useT } from "../../i18n/context";
import type { PanelKey } from "../../lib/shellPrefs";
import { subPanelId, subTabId, topicByKey, type TopicKey } from "../../lib/topics";
import { PanelBadge } from "./PanelBadge";
import { panelByKey, type PanelContext } from "./panelRegistry";

/**
 * แถวแท็บย่อยแบบ segmented ด้านบนของ drawer/แผ่นเลื่อน — เฉพาะหัวข้อที่มีมากกว่าหนึ่งมุมมอง
 * (หัวข้อเดียวมุมมองเดียวไม่มีแถวนี้เลย: แท็บเดียวเป็นแค่เสียงรบกวน)
 *
 * ARIA tabs แบบ roving tabindex: Tab เข้ามาที่แท็บที่เลือกอยู่ตัวเดียว ลูกศรซ้าย/ขวา + Home/End
 * ย้ายโฟกัส **และ** เลือกแท็บทันที (เปลี่ยนแท็บแค่สลับ chunk ของมุมมอง ไม่มีต้นทุนที่ต้องรอ
 * ยืนยัน) กล่องเนื้อหาที่มันคุมคือ `role="tabpanel"` ที่ผู้เรียกวางไว้ด้วย `subPanelId(idBase)`
 *
 * แต่ละแท็บแสดง badge ของมุมมองนั้นเอง — badge ของหัวข้อบน rail เป็นแค่ตัวที่รุนแรงที่สุด
 * ตัวละเอียดต้องหาเจอได้เมื่อเปิดหัวข้อ
 */
export function SubTabs({
  topic,
  active,
  onSelect,
  ctx,
  idBase,
}: {
  topic: TopicKey;
  active: PanelKey;
  onSelect: (key: PanelKey) => void;
  ctx: PanelContext;
  idBase: string;
}) {
  const t = useT();
  const def = topicByKey(topic);
  const refs = useRef<Partial<Record<PanelKey, HTMLButtonElement | null>>>({});
  if (def.views.length < 2) return null;

  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = def.views.indexOf(active);
    const last = def.views.length - 1;
    let next: number;
    if (e.key === "ArrowRight") next = i >= last ? 0 : i + 1;
    else if (e.key === "ArrowLeft") next = i <= 0 ? last : i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else return;
    e.preventDefault();
    const key = def.views[next];
    onSelect(key);
    refs.current[key]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={t("subtabs.aria", { topic: t(def.labelKey) })}
      onKeyDown={move}
      // ไม่มี overflow-x: badge มุมแท็บยื่นออกนอกกรอบ (-top-1) และจะถูกคลิป — ป้ายยาว
      // ("Northern water") ห่อเป็นสองบรรทัดแทนการเลื่อน
      className="flex shrink-0 gap-0.5 rounded-xl border border-white/8 bg-white/4 p-0.5"
    >
      {def.views.map((key) => {
        const p = panelByKey(key);
        const selected = key === active;
        return (
          <div key={key} className="relative min-w-0 flex-1">
            <button
              ref={(el) => {
                refs.current[key] = el;
              }}
              id={subTabId(idBase, key)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={subPanelId(idBase)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(key)}
              className={`flex min-h-9 w-full cursor-pointer items-center justify-center rounded-lg px-1.5 py-1 text-center text-xs leading-tight transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
                selected
                  ? "bg-[var(--color-accent)]/25 font-semibold text-white"
                  : "text-[var(--color-fg-muted)] hover:bg-white/8 hover:text-[var(--color-fg)]"
              }`}
            >
              {t(p.labelKey)}
            </button>
            <PanelBadge badge={p.badge?.(ctx) ?? null} />
          </div>
        );
      })}
    </div>
  );
}
