import { BellRing } from "lucide-react";
import type { ActiveAlertsState } from "../../hooks/useActiveAlerts";
import { ALERT_SEVERITY_STYLE } from "../../lib/alertSeverityStyle";
import { formatAge, formatDateTime } from "../../lib/time";
import { useLang } from "../../i18n/context";
import { resolveError } from "../../lib/errorMessage";

/**
 * แถบแจ้งเตือน อปท. ของจังหวัดที่กำลังดู (E11.5 → E11.6)
 *
 * สี่สถานะที่ต้องแยกให้เห็นชัด ห้ามพับเป็นสถานะเดียวกัน (ดู `docs/roadmap.md`
 * E11.6 และ `useActiveAlerts.ts`):
 *   1. `evaluatedAt` เป็นเวลาจริง + `alerts` ว่าง = ประเมินแล้ว ไม่มีอะไร active
 *   2. `evaluatedAt === null` = เอนจินยังไม่เคยประเมินเลย (สถานะจริงที่เกิดขึ้นได้
 *      หลัง deploy ใหม่ หรือระหว่างรอ alarm ติ๊กแรก)
 *   3. คำขอเองล้มเหลวและไม่มี `data` ค้างอยู่เลย (`error && !data`) = ติดต่อเอนจิน
 *      ไม่ได้ — คนละเรื่องกับข้อ 2 ซึ่งเป็นคำตอบสำเร็จที่บอกว่า "ยังไม่มีอะไรต้อง
 *      รายงาน"
 *   4. คำขอ**รอบล่าสุด**ล้มเหลว แต่ยังมี `data.alerts` จากรอบก่อนค้างอยู่
 *      (`error && data && alerts.length > 0`) = รายการที่เห็นอาจไม่ทันปัจจุบันแล้ว
 *      — คนละเรื่องกับข้อ 1 (สด ต่อเชื่อมได้ปกติ) ต้องหรี่ลงพร้อมคำเตือน ไม่ใช่
 *      เรนเดอร์เหมือนสถานะปกติ
 *
 * เวอร์ชันก่อนถูกย้อนกลับทำ `if (alerts.length === 0) return null` ซึ่งกลืนทั้ง
 * สี่สถานะเป็น "ไม่แสดงอะไรเลย" — เป็นบั๊กที่ห้ามเกิดซ้ำ แถบนี้จึงเรนเดอร์เสมอ
 */
export function ActiveAlertBanner({
  state,
  authorityNames,
}: {
  state: ActiveAlertsState;
  /** id → nameTh มาจาก `AffectedAuthoritiesState.entries` ของจังหวัดเดียวกัน —
   *  ไม่มีใน map (ยังโหลดไม่เสร็จ หรือ อปท. นี้ไม่มีขอบเขต E11.2) ก็ยังแสดง id
   *  ดิบได้ ไม่ปล่อยให้แถวหายไป */
  authorityNames?: ReadonlyMap<string, string>;
}) {
  const { lang, t } = useLang();
  const { data, loading, error } = state;

  return (
    <div className="glass flex flex-col gap-2 rounded-2xl px-3.5 py-2.5">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
        <BellRing size={16} className="text-[var(--color-accent)]" aria-hidden="true" />
        <span>{t("alert.banner.title")}</span>
        {data && data.alerts.length > 0 ? (
          <span className="ml-auto rounded bg-[var(--color-risk-high)]/15 px-1.5 text-[10px] text-[var(--color-risk-high)]">
            {t("alert.banner.count", { n: data.alerts.length })}
          </span>
        ) : null}
      </div>

      {loading && !data ? (
        <div className="h-6 animate-pulse rounded bg-white/8" />
      ) : error && !data ? (
        // สถานะ 3: คำขอเองล้มเหลว — ต่างจาก "ประเมินแล้วว่าไม่มีอะไร" (สถานะ 1)
        <p className="text-xs text-[var(--color-danger)]">
          {t("alert.banner.unreachable")}
          {resolveError(t, error) ? ` (${resolveError(t, error)})` : ""}
        </p>
      ) : !data || data.evaluatedAt === null ? (
        // สถานะ 2: ตอบสำเร็จแล้ว แต่ evaluatedAt เป็น null จริง ๆ — ยังไม่เคยประเมิน
        <p className="text-xs text-[var(--color-fg-muted)]">{t("alert.banner.neverEvaluated")}</p>
      ) : data.alerts.length === 0 ? (
        // สถานะ 1: ประเมินแล้ว ไม่มีอะไร active
        <p className="text-xs text-[var(--color-fg-muted)]">
          {t("alert.banner.none")} · {t("alert.banner.evaluatedAge", { age: formatAge(lang, data.evaluatedAt) })}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {error ? (
            // สถานะ 4: รายการนี้มาจากรอบก่อนที่สำเร็จ แต่รอบล่าสุดดึงพลาด — หรี่ลง
            // พร้อมบอกว่าอาจไม่ทันปัจจุบัน แทนที่จะเรนเดอร์เหมือนข้อมูลสดปกติ
            <p className="text-[10px] text-[var(--color-risk-medium)]">
              {t("alert.banner.degraded")}
              {resolveError(t, error) ? ` (${resolveError(t, error)})` : ""}
            </p>
          ) : null}
          <ul className={`flex flex-col gap-1.5 ${error ? "opacity-70" : ""}`}>
            {data.alerts.map((a) => {
              const s = ALERT_SEVERITY_STYLE[a.level];
              return (
                <li
                  key={a.id}
                  className={`flex flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-xs ring-1 ring-inset ${s.ringClassName} ${
                    a.stale ? "opacity-60" : ""
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dotClassName}`} aria-hidden="true" />
                    <span className={`font-semibold ${s.textClassName}`}>{t(s.labelKey)}</span>
                    <span className="text-[var(--color-fg-subtle)]">
                      {authorityNames?.get(a.localAuthorityId) ?? a.localAuthorityId}
                    </span>
                    {a.stale ? (
                      <span className="ml-auto text-[10px] text-[var(--color-fg-subtle)]">{t("alert.banner.stale")}</span>
                    ) : null}
                  </span>
                  <span className="text-[10px] text-[var(--color-fg-subtle)]">
                    {t("alert.banner.triggeredAt", { time: formatDateTime(lang, a.triggeredAt) })}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
