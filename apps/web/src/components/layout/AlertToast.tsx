import { BellRing } from "lucide-react";
import type { ActiveAlertsState } from "../../hooks/useActiveAlerts";
import { useT } from "../../i18n/context";
import { alertToastState } from "../../lib/alertSummary";
import type { ShellSafeArea } from "../../lib/shellLayout";

/**
 * toast บาง ๆ บนแผนที่สำหรับสถานะแจ้งเตือน อปท. ที่ต้องเห็นแม้ drawer ปิดอยู่
 * (มี active / ติดต่อเอนจินไม่ได้ / รอบล่าสุดพลาด) — ตัดสินโดย
 * `lib/alertSummary.ts` ตัวเดียวกับ badge บน rail จึงไม่มีวันขัดกัน
 * กดแล้วเปิดแผงผลกระทบซึ่งมี `ActiveAlertBanner` ฉบับเต็ม
 *
 * ตำแหน่ง: กึ่งกลางด้านบนของ safe area **ทุก tier** — เวอร์ชันก่อนหน้าวางไว้
 * ด้านล่างเฉพาะมือถือ เพราะด้านบนถูกชื่อจังหวัด + pill สรุปใช้อยู่ ทั้งสองอย่างนั้น
 * ย้ายเข้าแผ่นเลื่อนแล้ว ด้านบนจึงว่าง ส่วนด้านล่างกลายเป็นที่ของแผ่นเลื่อนกับ
 * คอลัมน์ปุ่มเครื่องมือ ซึ่งจะบังหรือถูกบังกันเอง
 */
export function AlertToast({
  state,
  safeArea,
  onOpen,
}: {
  state: ActiveAlertsState;
  safeArea: ShellSafeArea;
  onOpen: () => void;
}) {
  const t = useT();
  const toast = alertToastState(state);
  if (!toast) return null;
  const tone =
    toast.kind === "active"
      ? "text-[var(--color-risk-high)] ring-[var(--color-risk-high)]/50"
      : toast.kind === "unreachable"
        ? "text-[var(--color-danger)] ring-[var(--color-danger)]/50"
        : "text-[var(--color-risk-medium)] ring-[var(--color-risk-medium)]/50";
  const text =
    toast.kind === "active"
      ? t("alert.toast.active", { n: toast.n })
      : toast.kind === "unreachable"
        ? t("alert.toast.unreachable")
        : t("alert.toast.degraded");
  const pos = { left: safeArea.left, right: safeArea.right, top: safeArea.top + 8 };
  return (
    <div role="status" className="pointer-events-none absolute z-20 flex justify-center px-2" style={pos}>
      <button
        type="button"
        onClick={onOpen}
        className={`glass pointer-events-auto flex max-w-full cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-xs ring-1 ring-inset transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${tone}`}
      >
        <BellRing size={14} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{text}</span>
        <span className="shrink-0 text-[var(--color-fg-muted)] underline decoration-white/30 underline-offset-2">
          {t("alert.toast.open")}
        </span>
      </button>
    </div>
  );
}
