import type { SourceHealth, SourceStatus } from "@siahra/shared-types";
import type { ApiHealthState } from "../../hooks/useApiHealth";
import { formatAge } from "../../lib/time";

const HEALTH_META: Record<SourceHealth, { dot: string; label: string }> = {
  ok: { dot: "bg-[var(--color-success)] shadow-[0_0_8px_rgba(34,197,94,0.8)]", label: "ปกติ" },
  stale: { dot: "bg-[var(--color-risk-medium)]", label: "ข้อมูลค้าง" },
  degraded: { dot: "bg-[var(--color-risk-high)]", label: "บางแหล่งล้มเหลว" },
  down: { dot: "bg-[var(--color-danger)]", label: "ดึงข้อมูลไม่ได้" },
  unknown: { dot: "bg-[var(--color-fg-subtle)]", label: "ยังไม่ทราบ" },
};

/**
 * ความซื่อสัตย์ต่อข้อมูล: "ยังไม่เคยได้ข้อมูลจากต้นทางเลย" เป็นคนละเรื่องกับ
 * "เคยได้ แต่รอบล่าสุดดึงไม่สำเร็จ" — และผู้ใช้ควรรู้ว่าความผิดพลาดอยู่ที่ต้นทาง
 * ไม่ใช่ที่แอป
 */
function statusLabel(s: SourceStatus): string {
  if (s.health === "down" && !s.fetchedAt) return "ต้นทางไม่ตอบสนอง (ยังไม่เคยได้ข้อมูล)";
  // degraded = "บางส่วนล้มเหลว" ซึ่งอาจมีข้อมูลบางชุดที่เพิ่งดึงมาใหม่จริง ๆ
  // (ThaiWater สำเร็จครึ่งเดียว / แผ่นดินไหวเสียแหล่งเดียว) จึงห้ามเหมาว่า "ใช้ข้อมูลเดิม"
  return HEALTH_META[s.health].label;
}

function tooltip(s: SourceStatus): string {
  const base = `${s.labelTh}: ${statusLabel(s)} · ${ageLabel(s.fetchedAt)}`;
  return s.lastError ? `${base}\n${s.lastError}` : base;
}

/** null = ยังไม่เคยดึงสำเร็จ → formatAge คืนข้อความ "ยังไม่เคยได้รับข้อมูล" ไม่ใช่เวลา */
const ageLabel = (iso: string | null): string => formatAge(iso);

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
          <span key={s.id} className={`h-2.5 w-2.5 rounded-full ${HEALTH_META[s.health].dot}`} title={tooltip(s)} />
        ))}
        <span className="text-[var(--color-fg-subtle)]">แหล่งข้อมูล</span>
      </div>
    );
  }
  return (
    <div className="glass-soft flex min-h-8 min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 rounded-xl px-3 py-1 text-[11px]">
      {sources.map((s) => {
        const meta = HEALTH_META[s.health];
        const label = statusLabel(s);
        return (
          <span key={s.id} className="flex items-center gap-1.5 whitespace-nowrap" title={tooltip(s)}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
            <span className="text-[var(--color-fg)]">{s.labelTh}</span>
            <span className={s.health === "ok" ? "text-[var(--color-fg-subtle)]" : "text-[var(--color-risk-medium)]"}>
              {s.health === "ok" ? `อัปเดต ${ageLabel(s.fetchedAt)}` : label}
              {s.health !== "ok" && s.fetchedAt ? ` · ล่าสุด ${ageLabel(s.fetchedAt)}` : ""}
            </span>
          </span>
        );
      })}
    </div>
  );
}
