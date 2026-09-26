import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { useLang } from "../../i18n/context";
import type { MessageKey } from "../../i18n";
import {
  itemsForTab,
  NOTIFICATION_TABS,
  notificationTimeText,
  tabCounts,
  type NotificationAction,
  type NotificationItem,
  type NotificationTab,
} from "../../lib/notifications";
import { GUTTER, TOPBAR_H, type Tier } from "../../lib/shellLayout";

const TAB_LABEL: Record<NotificationTab, MessageKey> = {
  all: "notifications.tab.all",
  rain: "notifications.tab.rain",
  alerts: "notifications.tab.alerts",
  system: "notifications.tab.system",
};

/** สีของแถวตามโทน — โทเคนเดียวกับ AlertToast / ALERT_SEVERITY_STYLE */
const TONE_DOT: Record<NotificationItem["tone"], string> = {
  severe: "bg-[var(--color-risk-extreme)]",
  high: "bg-[var(--color-risk-high)]",
  warn: "bg-[var(--color-risk-medium)]",
  danger: "bg-[var(--color-danger)]",
  muted: "bg-[var(--color-fg-subtle)]",
};

/**
 * ป้ายชนิดความรู้ของแถว — พยากรณ์ใช้ขอบ **เส้นประ** ให้ต่างจากค่าที่วัดได้จริง
 * (ขอบทึบ) มองปราดเดียวก็แยกได้ ป้ายพยากรณ์/ตรวจวัดยืมคีย์ `badge.*` เดิม
 */
function KindBadge({ kind }: { kind: NotificationItem["kind"] }) {
  const { t } = useLang();
  if (kind === "forecast") {
    return (
      <span
        title={t("badge.forecast.title")}
        className="shrink-0 rounded border border-dashed border-[var(--color-risk-low)]/70 px-1 text-[10px] text-[var(--color-risk-low)]"
      >
        {t("badge.forecast")}
      </span>
    );
  }
  if (kind === "observed") {
    return (
      <span
        title={t("badge.observed.title")}
        className="shrink-0 rounded border border-[var(--color-success)]/60 px-1 text-[10px] text-[var(--color-success)]"
      >
        {t("badge.observed")}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded border border-white/15 bg-white/5 px-1 text-[10px] text-[var(--color-fg-muted)]">
      {t("notifications.kind.sourceStatus")}
    </span>
  );
}

/**
 * ศูนย์การแจ้งเตือน — popover ใต้กระดิ่ง (≥ tablet, ~420 px) หรือแผงเต็มความกว้าง
 * ใต้ TopBar (phone) รายการมาจาก `lib/notifications.ts` ทั้งหมด คอมโพเนนต์นี้
 * แค่วาด แท็บ + สถานะอ่านแล้วที่รับมา ไม่มี fetch ไม่มี hook โพลใด ๆ
 *
 * ปิดด้วย X / Escape / คลิกนอกกรอบ — คลิกบนกระดิ่งเองไม่นับเป็น "นอกกรอบ" (ไม่งั้น
 * mousedown ปิดแล้ว click เปิดซ้ำทันที) Esc ถูกรับใน capture phase แล้ว
 * `preventDefault()` เพื่อไม่ให้ `useShellState` ปิด drawer/หุบแผ่นเลื่อนซ้ำ
 * (แบบเดียวกับ `SourceStatusPopover`/`ProvinceChip`) และคืนโฟกัสให้กระดิ่ง
 *
 * การเปิดศูนย์ **ไม่** ทำเครื่องหมายว่าอ่านแล้ว — ต้องกด "อ่านทั้งหมดแล้ว" เท่านั้น
 */
export function NotificationCenter({
  tier,
  bottomInset,
  items,
  seen,
  provinceName,
  bellRef,
  onClose,
  onMarkAllRead,
  onAction,
}: {
  tier: Tier;
  /**
   * ระยะที่ต้องเว้นจากขอบล่าง = `shell.safeArea.bottom` (dock บน ≥ tablet / peek ของ
   * แผ่นเลื่อนบนมือถือ) — ศูนย์การแจ้งเตือนต้องไม่บังบรรทัดเครดิตที่เงื่อนไขของผู้ให้
   * ภาพดาวเทียมบังคับให้มองเห็นได้เสมอ
   */
  bottomInset: number;
  items: readonly NotificationItem[];
  seen: readonly string[];
  provinceName: string;
  bellRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onMarkAllRead: () => void;
  onAction: (action: NotificationAction) => void;
}) {
  const { lang, t } = useLang();
  const [tab, setTab] = useState<NotificationTab>("all");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const phone = tier === "phone";

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (bellRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
      bellRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose, bellRef]);

  const counts = useMemo(() => tabCounts(items), [items]);
  const shown = useMemo(() => itemsForTab(items, tab), [items, tab]);
  const seenSet = useMemo(() => new Set(seen), [seen]);
  const anyUnread = items.some((i) => !seenSet.has(i.id));
  const top = GUTTER + TOPBAR_H + 8;
  const maxHeight = `max(160px, calc(100dvh - ${top + bottomInset + 8}px))`;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("notifications.title")}
      className="glass absolute z-30 flex flex-col overflow-hidden rounded-2xl"
      style={
        phone
          ? { top, left: GUTTER, right: GUTTER, maxHeight }
          : { top, right: GUTTER, width: 420, maxWidth: `calc(100vw - ${GUTTER * 2}px)`, maxHeight }
      }
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <h2 className="text-sm font-semibold text-[var(--color-fg)]">{t("notifications.title")}</h2>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={!anyUnread}
          className="ml-auto cursor-pointer rounded-md px-2 py-1 text-xs text-[var(--color-accent)] transition-colors hover:bg-white/8 disabled:cursor-default disabled:text-[var(--color-fg-subtle)] disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          {t("notifications.markAllRead")}
        </button>
        <button
          type="button"
          onClick={() => {
            onClose();
            bellRef.current?.focus();
          }}
          aria-label={t("notifications.close")}
          title={t("notifications.close")}
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--color-fg-muted)] transition-colors hover:bg-white/8 hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-white/10 px-2 py-1.5">
        {NOTIFICATION_TABS.map((key) => {
          const active = key === tab;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
                active
                  ? "bg-white/10 text-[var(--color-fg)]"
                  : "text-[var(--color-fg-muted)] hover:bg-white/5 hover:text-[var(--color-fg)]"
              }`}
            >
              <span>{t(TAB_LABEL[key])}</span>
              <span className="tabular-nums rounded bg-white/8 px-1 text-[10px]">{counts[key]}</span>
            </button>
          );
        })}
      </div>

      <p className="px-3 pt-2 text-[10px] text-[var(--color-fg-subtle)]">
        {t("notifications.scope", { province: provinceName })}
      </p>

      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {shown.length === 0 ? (
          <p className="px-1.5 py-3 text-xs text-[var(--color-fg-muted)]">{t("notifications.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {shown.map((item) => {
              const unread = !seenSet.has(item.id);
              return (
                <li
                  key={item.id}
                  className={`flex gap-2 rounded-lg px-2.5 py-2 text-xs ring-1 ring-inset ring-white/8 ${
                    unread ? "bg-white/[0.04]" : ""
                  } ${item.dim ? "opacity-60" : ""}`}
                >
                  <span className="mt-1.5 flex w-2 shrink-0 flex-col items-center gap-1">
                    <span className={`h-2 w-2 rounded-full ${TONE_DOT[item.tone]}`} aria-hidden="true" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-start gap-1.5">
                      <span className="min-w-0 flex-1 font-medium text-[var(--color-fg)]">{item.title}</span>
                      {unread ? (
                        <span
                          className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                          role="img"
                          aria-label={t("notifications.unread")}
                          title={t("notifications.unread")}
                        />
                      ) : null}
                    </div>
                    {item.body ? <span className="text-[var(--color-fg-muted)]">{item.body}</span> : null}
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-[var(--color-fg-subtle)]">
                      <KindBadge kind={item.kind} />
                      <span className="min-w-0 truncate">{item.source}</span>
                      <span className="text-white/25">·</span>
                      <span>{notificationTimeText(item.time, lang)}</span>
                    </div>
                    {item.action ? (
                      <button
                        type="button"
                        onClick={() => item.action && onAction(item.action)}
                        className="mt-0.5 self-start cursor-pointer text-[10px] text-[var(--color-accent)] underline decoration-white/25 underline-offset-2 hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                      >
                        {t(item.action.labelKey)}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
