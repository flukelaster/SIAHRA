import { SOURCES, type SourceHealth, type SourceStatus } from "@siahra/shared-types";
import type { ApiHealthState } from "../../hooks/useApiHealth";
import { formatAge } from "../../lib/time";

/**
 * `delayed` กับ `stale` ต้องอ่านออกว่าเป็นคนละความล้มเหลว: `delayed` คือดึงสำเร็จ
 * แต่ต้นทางยังไม่ปล่อยค่าตรวจวัดรอบใหม่ (จุดกลวงสีฟ้า) ส่วน `stale` คือฝั่งเรา
 * ดึงไม่สำเร็จมานาน (จุดทึบสีเหลือง)
 */
const HEALTH_META: Record<SourceHealth, { dot: string; label: string }> = {
  ok: { dot: "bg-[var(--color-success)] shadow-[0_0_8px_rgba(34,197,94,0.8)]", label: "ปกติ" },
  delayed: {
    dot: "bg-transparent ring-2 ring-inset ring-[var(--color-risk-low)]",
    label: "ต้นทางยังไม่ส่งค่าใหม่",
  },
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
/**
 * api กับ web ถูก deploy แยกกัน: api รุ่นใหม่อาจส่งสถานะที่บันเดิลนี้ยังไม่รู้จัก
 * ตกกลับไปที่ "ยังไม่ทราบ" แทนที่จะโยน error แล้วทำให้แถบสถานะหายไปทั้งแถบ
 * (แนวเดียวกับ `SOURCES[s.id]?.nameTh ?? s.labelTh` ด้านล่าง)
 */
function healthMeta(health: SourceHealth): { dot: string; label: string } {
  return HEALTH_META[health] ?? HEALTH_META.unknown;
}

function statusLabel(s: SourceStatus): string {
  if (s.health === "down" && !s.fetchedAt) return "ต้นทางไม่ตอบสนอง (ยังไม่เคยได้ข้อมูล)";
  // delayed = การดึง "สำเร็จ" ตัวเลขที่ผิดปกติคืออายุของค่าตรวจวัด ไม่ใช่อายุการดึง
  if (s.health === "delayed") return `${HEALTH_META.delayed.label} (ค่าล่าสุด ${ageLabel(s.latestObservedAt)})`;
  // degraded = "บางส่วนล้มเหลว" ซึ่งอาจมีข้อมูลบางชุดที่เพิ่งดึงมาใหม่จริง ๆ
  // (ThaiWater สำเร็จครึ่งเดียว / แผ่นดินไหวเสียแหล่งเดียว) จึงห้ามเหมาว่า "ใช้ข้อมูลเดิม"
  return healthMeta(s.health).label;
}

/**
 * ชื่อแหล่งข้อมูลมาจากทะเบียนกลาง (`SOURCES`) — แต่ api กับ web ถูก deploy แยกกัน
 * ถ้า api รุ่นใหม่ส่ง id ที่ web รุ่นเก่ายังไม่รู้จัก ให้ตกกลับไปใช้ป้ายที่ติดมากับ
 * ข้อมูล แทนที่จะพังทั้งแถบ
 */
function sourceLabel(s: SourceStatus): string {
  return SOURCES[s.id]?.nameTh ?? s.labelTh;
}

function tooltip(s: SourceStatus): string {
  const agency = SOURCES[s.id]?.agency;
  // ไม่เคยดึงสำเร็จเลย = ไม่มี "เวลาที่ดึงสำเร็จ" ให้พูดถึง การต่อท้ายว่า
  // "ดึงข้อมูลสำเร็จ ยังไม่เคยได้รับข้อมูล" ขัดกันเองในประโยคเดียว
  const fetched = s.fetchedAt ? ` · ดึงข้อมูลสำเร็จ ${ageLabel(s.fetchedAt)}` : "";
  const base = `${sourceLabel(s)}: ${statusLabel(s)}${fetched}`;
  const withAgency = agency ? `${base}\n${agency}` : base;
  return s.lastError ? `${withAgency}\n${s.lastError}` : withAgency;
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
