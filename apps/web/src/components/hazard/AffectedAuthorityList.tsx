import { ListTree } from "lucide-react";
import type { AlertEvent } from "@siahra/shared-types";
import type { AffectedAuthoritiesState } from "../../hooks/useAffectedAuthorities";
import type { RankedAffectedAuthority } from "../../lib/affectedAuthorityRanking";
import { Panel } from "../ui/Panel";
import { formatNumber } from "../../lib/number";
import { useLang } from "../../i18n/context";
import { resolveError } from "../../lib/errorMessage";
import { ALERT_SEVERITY_STYLE } from "../../lib/alertSeverityStyle";
import { LOCAL_AUTHORITY_TYPE_KEY } from "../../lib/localAuthorityTypeLabel";

function facilitiesCount(entry: RankedAffectedAuthority): number {
  if (!entry.impact) return 0;
  const f = entry.impact.facilitiesExposed;
  return f.hospitals.length + f.schools.length + f.fireStations.length;
}

/**
 * รายชื่อ อปท. ที่ได้รับผลกระทบในจังหวัดที่กำลังดู เรียงตามสัดส่วนพื้นที่ท่วม
 * มากไปน้อย (E11.6) — เป็นทั้งรายการแสดงผลและกลไกเลือก อปท. ให้
 * `ImpactSummaryCard` (ยังไม่มีการคลิกเลือกบนโพลิกอน 3 มิติ — ดู
 * `scene/LocalAuthorityOutline.ts`, นอกขอบเขตงานนี้)
 */
export function AffectedAuthorityList({
  state,
  alerts,
  selectedId,
  onSelect,
}: {
  state: AffectedAuthoritiesState;
  /** แจ้งเตือนที่ active ของทั้งจังหวัด (จาก `useActiveAlerts`) — ใช้ badge ระดับ
   *  ความรุนแรงต่อแถว ใช้ป้ายสี/ข้อความชุดเดียวกับ `ActiveAlertBanner` */
  alerts: readonly AlertEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { lang, t } = useLang();
  const { entries, loading, error, coverage } = state;
  const alertByAuthority = new Map(alerts.map((a) => [a.localAuthorityId, a]));

  return (
    <Panel
      title={t("authorityList.title")}
      icon={<ListTree size={16} className="text-[var(--color-accent)]" aria-hidden="true" />}
    >
      {loading && entries.length === 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="h-8 animate-pulse rounded bg-white/8" />
          <div className="h-8 animate-pulse rounded bg-white/8" />
        </div>
      ) : error && entries.length === 0 ? (
        <p className="rounded-lg bg-[var(--color-danger)]/10 px-2.5 py-2 text-xs text-[var(--color-danger)]">
          {t("authorityList.loadError", { error: resolveError(t, error) ?? "" })}
        </p>
      ) : coverage === "none" || entries.length === 0 ? (
        <p className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-3 text-center text-xs text-[var(--color-fg-muted)]">
          {t("authorityList.empty.noCoverage")}
        </p>
      ) : (
        <ul className="flex max-h-64 flex-col overflow-y-auto pr-0.5">
          {entries.map((entry) => {
            const alert = alertByAuthority.get(entry.id);
            const active = entry.id === selectedId;
            return (
              <li key={entry.id} className="border-t border-white/8 first:border-t-0">
                <button
                  type="button"
                  onClick={() => onSelect(entry.id)}
                  aria-pressed={active}
                  className={`flex w-full items-center gap-2 py-1.5 text-left transition-colors ${
                    active ? "bg-[var(--color-accent)]/12" : "hover:bg-white/4"
                  }`}
                >
                  <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-[#4d94b8]">
                    {entry.bucket === "measured" && entry.impact
                      ? t("authorityList.floodedFraction", {
                          pct: formatNumber(lang, (entry.impact.floodedFraction as number) * 100, 1),
                        })
                      : "—"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-[var(--color-fg)]">{entry.nameTh}</p>
                    <p className="truncate text-[10px] text-[var(--color-fg-subtle)]">
                      {t(LOCAL_AUTHORITY_TYPE_KEY[entry.type])}
                      {entry.bucket === "measured" && facilitiesCount(entry) > 0
                        ? ` · ${t("authorityList.facilitiesCount", { n: facilitiesCount(entry) })}`
                        : ""}
                      {entry.bucket === "never-fetched" ? ` · ${t("authorityList.neverFetched")}` : ""}
                      {entry.bucket === "unavailable" ? ` · ${t("authorityList.unavailable")}` : ""}
                    </p>
                  </div>
                  {alert ? (
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${ALERT_SEVERITY_STYLE[alert.level].dotClassName} ${
                        alert.stale ? "opacity-50" : ""
                      }`}
                      title={t(ALERT_SEVERITY_STYLE[alert.level].labelKey)}
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
