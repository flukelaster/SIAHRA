import type { SourceHealth } from "@siahra/shared-types";
import type { ApiHealthState } from "../../hooks/useApiHealth";

const HEALTH_META: Record<SourceHealth, { dot: string; label: string }> = {
  ok: { dot: "bg-[var(--color-success)] shadow-[0_0_8px_rgba(34,197,94,0.8)]", label: "ปกติ" },
  stale: { dot: "bg-[var(--color-risk-medium)]", label: "ข้อมูลค้าง" },
  degraded: { dot: "bg-[var(--color-risk-high)]", label: "บางแหล่งล้มเหลว" },
  down: { dot: "bg-[var(--color-danger)]", label: "ดึงข้อมูลไม่ได้" },
  unknown: { dot: "bg-[var(--color-fg-subtle)]", label: "ยังไม่ทราบ" },
};

function ageLabel(iso: string | null): string {
  if (!iso) return "ยังไม่มีข้อมูล";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "เมื่อสักครู่";
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} ชม.ที่แล้ว` : `${Math.floor(h / 24)} วันที่แล้ว`;
}

/**
 * Per-source freshness strip that sits on the map (bottom-left, above the
 * attribution). Data honesty: a stale or failed source is visible right next
 * to the map it feeds, not tucked away in a settings page.
 */
export function SourceStatusBar({ state, compact = false }: { state: ApiHealthState; compact?: boolean }) {
  if (state.apiDown) {
    return (
      <div className="glass-soft flex items-center gap-2 rounded-xl px-3 py-1.5 text-[11px]">
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
      <div className="glass-soft flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[11px]">
        {sources.map((s) => (
          <span key={s.id} className={`h-2.5 w-2.5 rounded-full ${HEALTH_META[s.health].dot}`} title={`${s.labelTh}: ${HEALTH_META[s.health].label} · ${ageLabel(s.fetchedAt)}`} />
        ))}
        <span className="text-[var(--color-fg-subtle)]">แหล่งข้อมูล</span>
      </div>
    );
  }
  return (
    <div className="glass-soft flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-3 py-1.5 text-[11px]">
      {sources.map((s) => {
        const meta = HEALTH_META[s.health];
        return (
          <span key={s.id} className="flex items-center gap-1.5" title={s.lastError ?? undefined}>
            <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden="true" />
            <span className="text-[var(--color-fg)]">{s.labelTh}</span>
            <span className={s.health === "ok" ? "text-[var(--color-fg-subtle)]" : "text-[var(--color-risk-medium)]"}>
              {s.health === "ok" ? `อัปเดต ${ageLabel(s.fetchedAt)}` : meta.label}
              {s.health !== "ok" && s.fetchedAt ? ` · ล่าสุด ${ageLabel(s.fetchedAt)}` : ""}
            </span>
          </span>
        );
      })}
    </div>
  );
}
