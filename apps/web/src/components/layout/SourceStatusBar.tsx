import type { ApiHealthState } from "../../hooks/useApiHealth";
import { ageLabel, healthMeta, sourceLabel, statusLabel, tooltip } from "./sourceStatusText";

/**
 * Per-source freshness strip that sits on the map (bottom-left, above the
 * attribution). Data honesty: a stale or failed source is visible right next
 * to the map it feeds, not tucked away in a settings page.
 */
export function SourceStatusBar({ state, compact = false }: { state: ApiHealthState; compact?: boolean }) {
  if (state.apiDown) {
    return (
      <div className="glass-soft flex min-h-8 items-center gap-2 rounded-xl px-3 py-1 text-[11px]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-danger)]" aria-hidden="true" />
        <span className="text-[var(--color-danger)]">เชื่อมต่อ API ไม่ได้</span>
        <span className="text-[var(--color-fg-subtle)]">— แผนที่ยังใช้ได้ แต่ไม่มีข้อมูลตรวจวัดสด</span>
      </div>
    );
  }
  const sources = state.health?.sources ?? [];
  if (sources.length === 0) return null;
  if (compact) {
    // Dots only; the label lives in the tooltip.
    return (
      <div className="glass-soft flex h-8 items-center gap-2 rounded-xl px-3 text-[11px]">
        {sources.map((s) => (
          <span key={s.id} className={`h-2.5 w-2.5 rounded-full ${healthMeta(s.health).dot}`} title={tooltip(s)} />
        ))}
        <span className="text-[var(--color-fg-subtle)]">แหล่งข้อมูล</span>
      </div>
    );
  }
  return (
    <div className="glass-soft flex min-h-8 min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 rounded-xl px-3 py-1 text-[11px]">
      {sources.map((s) => {
        const meta = healthMeta(s.health);
        const label = statusLabel(s);
        return (
          <span key={s.id} className="flex items-center gap-1.5 whitespace-nowrap" title={tooltip(s)}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
            <span className="text-[var(--color-fg)]">{sourceLabel(s)}</span>
            <span
              className={
                s.health === "ok"
                  ? "text-[var(--color-fg-subtle)]"
                  : s.health === "delayed"
                    ? "text-[var(--color-risk-low)]"
                    : "text-[var(--color-risk-medium)]"
              }
            >
              {s.health === "ok" ? `อัปเดต ${ageLabel(s.fetchedAt)}` : label}
              {s.health !== "ok" && s.health !== "delayed" && s.fetchedAt
                ? ` · ล่าสุด ${ageLabel(s.fetchedAt)}`
                : ""}
            </span>
          </span>
        );
      })}
    </div>
  );
}
