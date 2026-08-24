import type { ApiHealthState } from "../../hooks/useApiHealth";
import { useLang } from "../../i18n/context";
import { ageLabel, healthMeta, sourceLabel, statusLabel, tooltip } from "./sourceStatusText";

/**
 * Per-source freshness strip that sits on the map (bottom-left, above the
 * attribution). Data honesty: a stale or failed source is visible right next
 * to the map it feeds, not tucked away in a settings page.
 */
export function SourceStatusBar({ state, compact = false }: { state: ApiHealthState; compact?: boolean }) {
  const { lang, t } = useLang();
  if (state.apiDown) {
    return (
      <div className="glass-soft flex min-h-8 items-center gap-2 rounded-xl px-3 py-1 text-[11px]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-danger)]" aria-hidden="true" />
        <span className="text-[var(--color-danger)]">{t("status.apiDown")}</span>
        <span className="text-[var(--color-fg-subtle)]">{t("status.apiDown.detail")}</span>
      </div>
    );
  }
  const sources = state.health?.sources ?? [];
  if (sources.length === 0) return null;
  if (compact) {
    // Dots only; the label lives in the tooltip. แหล่งที่ไม่ปกติ (รวม delayed)
    // ต้องอ่านออกเป็นตัวเลขข้างจุดด้วย ไม่ใช่รู้ได้เฉพาะตอนเอาเมาส์ชี้
    const degraded = sources.filter((s) => s.health !== "ok").length;
    return (
      <div className="glass-soft flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[11px]">
        {sources.map((s) => (
          <span key={s.id} className={`h-2.5 w-2.5 rounded-full ${healthMeta(s.health).dot}`} title={tooltip(s, lang, t)} />
        ))}
        {degraded > 0 ? (
          <span className="whitespace-nowrap text-[var(--color-risk-medium)]">
            {t("status.degradedCount", { n: degraded })}
          </span>
        ) : (
          <span className="text-[var(--color-fg-subtle)]">{t("status.sources")}</span>
        )}
      </div>
    );
  }
  return (
    <div className="glass-soft flex min-h-8 min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 rounded-xl px-3 py-1 text-[11px]">
      {sources.map((s) => {
        const meta = healthMeta(s.health);
        const label = statusLabel(s, lang, t);
        return (
          /* ห้ามตัดข้อความสถานะทิ้ง: แหล่งที่เสื่อมต้องอ่านออกทั้งประโยครวมทั้งเวลาที่
             ดึงสำเร็จครั้งสุดท้าย ประโยคอังกฤษยาวกว่าไทยจนล้นออกนอก pill ตอนจอ 1280
             จึงให้ชิปตัวเองห่อบรรทัดได้ (min-w-0 + ไม่มี whitespace-nowrap) แทนที่จะ
             ให้เลยขอบไปหรือย่อข้อความจนกำกวม */
          <span
            key={s.id}
            className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5"
            title={tooltip(s, lang, t)}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
            <span className="text-[var(--color-fg)]">{sourceLabel(s, lang)}</span>
            <span
              className={`min-w-0 ${
                s.health === "ok"
                  ? "text-[var(--color-fg-subtle)]"
                  : s.health === "delayed"
                    ? "text-[var(--color-risk-low)]"
                    : "text-[var(--color-risk-medium)]"
              }`}
            >
              {s.health === "ok" ? t("status.updated", { age: ageLabel(lang, s.fetchedAt) }) : label}
              {/* ดึงไม่สำเร็จรอบล่าสุด: ยังต้องบอกว่าครั้งสุดท้ายที่สำเร็จคือเมื่อไร
                  ไม่ใช่ปล่อยให้ค่าเก่าบนแผนที่ดูเหมือนค่าปัจจุบัน */}
              {s.health !== "ok" && s.health !== "delayed" && s.fetchedAt
                ? t("status.lastSuccess", { age: ageLabel(lang, s.fetchedAt) })
                : ""}
            </span>
          </span>
        );
      })}
    </div>
  );
}
