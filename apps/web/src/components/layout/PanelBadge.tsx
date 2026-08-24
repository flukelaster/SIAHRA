import { useT } from "../../i18n/context";
import type { AlertRailBadge } from "../../lib/alertSummary";

/**
 * จุด/ตัวเลขเล็ก ๆ มุมปุ่ม rail หรือแท็บบนแผ่นเลื่อน — สี่สถานะของ
 * `lib/alertSummary.ts` ต้องแยกกันด้วยตา: จำนวน (มี active) · จุดแดง (ติดต่อ
 * ไม่ได้) · จุดเหลือง (รอบล่าสุดพลาด) · "?" เทา (ยังไม่เคยประเมิน)
 */
export function PanelBadge({ badge }: { badge: AlertRailBadge }) {
  const t = useT();
  if (!badge) return null;
  if (badge.kind === "count") {
    return (
      <span
        className="pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-risk-high)] px-1 text-[10px] leading-none font-bold text-white tabular-nums"
        title={t("alert.banner.count", { n: badge.n })}
      >
        {badge.n}
      </span>
    );
  }
  if (badge.kind === "neverEvaluated") {
    return (
      <span
        className="pointer-events-none absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-fg-subtle)] text-[10px] leading-none font-bold text-black"
        title={t("alert.badge.neverEvaluated")}
      >
        ?
      </span>
    );
  }
  const unreachable = badge.kind === "unreachable";
  return (
    <span
      className={`pointer-events-none absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[#0b1120] ${
        unreachable ? "animate-pulse bg-[var(--color-danger)]" : "bg-[var(--color-risk-medium)]"
      }`}
      title={unreachable ? t("alert.banner.unreachable") : t("alert.banner.degraded")}
    />
  );
}
