import { ClipboardList } from "lucide-react";
import type { AlertEvent, HealthResponse } from "@siahra/shared-types";
import type { RankedAffectedAuthority } from "../../lib/affectedAuthorityRanking";
import type { LocalAuthorityImpactState } from "../../hooks/useLocalAuthorityImpact";
import { worstHealth } from "../../hooks/useLayerDescriptors";
import { Panel } from "../ui/Panel";
import { FreshnessMeta } from "../ui/FreshnessMeta";
import { formatNumber } from "../../lib/number";
import { useLang } from "../../i18n/context";
import { resolveError } from "../../lib/errorMessage";
import { ALERT_SEVERITY_STYLE } from "../../lib/alertSeverityStyle";
import { LOCAL_AUTHORITY_TYPE_KEY } from "../../lib/localAuthorityTypeLabel";

/**
 * รายละเอียดของ อปท. หนึ่งรายที่ผู้ใช้เลือกจาก `AffectedAuthorityList` — E11.6
 *
 * ทุกตัวเลขที่นี่มาจาก `/exposure` (E11.3, baseline คงที่) และ `/impact`
 * (E11.4, ตัดกับฉากน้ำท่วมปัจจุบัน) ตรง ๆ ไม่มีการคำนวณเพิ่มฝั่งเว็บ — ป้าย
 * ชนิดความรู้ต่อฟิลด์มาจาก `descriptor` จริงของฟิลด์นั้น (`FreshnessMeta`) ไม่ใช่
 * ป้ายเดียวทั้งการ์ด: `floodedAreaKm2`/`facilitiesExposed` เป็น `observed`
 * (วัดจริงจากรูปหลายเหลี่ยม) ส่วน `populationExposed`/`buildingsExposed` เป็น
 * `illustrative` (สัดส่วนพื้นที่ ไม่ใช่การนับจริง) — สองอย่างนี้ต้องแยกหน้าตากันได้
 */
export function ImpactSummaryCard({
  authority,
  state,
  health,
  alerts,
}: {
  authority: RankedAffectedAuthority | null;
  state: LocalAuthorityImpactState;
  health: HealthResponse | null;
  alerts: readonly AlertEvent[];
}) {
  const { lang, t } = useLang();
  const { exposure, impact } = state;

  return (
    <Panel
      title={t("impact.card.title")}
      icon={<ClipboardList size={16} className="text-[var(--color-accent)]" aria-hidden="true" />}
    >
      {!authority ? (
        <p className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-3 text-center text-xs text-[var(--color-fg-muted)]">
          {t("impact.card.selectPrompt")}
        </p>
      ) : exposure.notFound || impact.notFound ? (
        <p className="rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-3 text-center text-xs text-[var(--color-risk-medium)]">
          {t("impact.card.noCoverage")}
        </p>
      ) : (exposure.loading && !exposure.data) || (impact.loading && !impact.data) ? (
        <div className="flex flex-col gap-2">
          <div className="h-4 w-2/3 animate-pulse rounded bg-white/8" />
          <div className="h-10 animate-pulse rounded bg-white/8" />
          <div className="h-10 animate-pulse rounded bg-white/8" />
        </div>
      ) : exposure.error && !exposure.data && impact.error && !impact.data ? (
        <p className="rounded-lg bg-[var(--color-danger)]/10 px-2.5 py-2 text-xs text-[var(--color-danger)]">
          {t("impact.card.loadError", { error: resolveError(t, exposure.error ?? impact.error) ?? "" })}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--color-fg)]">{authority.nameTh}</p>
            <p className="text-[11px] text-[var(--color-fg-subtle)]">{t(LOCAL_AUTHORITY_TYPE_KEY[authority.type])}</p>
          </div>

          {alerts.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {alerts.map((a) => {
                const s = ALERT_SEVERITY_STYLE[a.level];
                return (
                  <li
                    key={a.id}
                    className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] ring-1 ring-inset ${s.ringClassName} ${a.stale ? "opacity-50" : ""}`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dotClassName}`} aria-hidden="true" />
                    <span className={s.textClassName}>{t(s.labelKey)}</span>
                    {a.stale ? <span className="text-[var(--color-fg-subtle)]">· {t("alert.banner.stale")}</span> : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {exposure.data ? (
            <section className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold text-[var(--color-fg-muted)]">{t("impact.section.baseline")}</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[11px] text-[var(--color-fg-muted)]">{t("impact.population.label")}</p>
                  <p className="text-lg font-bold tabular-nums text-[var(--color-fg)]">
                    {formatNumber(lang, exposure.data.exposure.population.estimate)}
                  </p>
                  <p className="text-[10px] text-[var(--color-fg-subtle)]">{t("impact.population.estimateNote")}</p>
                  <FreshnessMeta
                    descriptor={exposure.data.exposure.population.descriptor}
                    health={worstHealth(exposure.data.exposure.population.descriptor.sourceIds, health)}
                  />
                </div>
                <div>
                  <p className="text-[11px] text-[var(--color-fg-muted)]">{t("impact.buildings.label")}</p>
                  <p className="text-lg font-bold tabular-nums text-[var(--color-fg)]">
                    {formatNumber(lang, exposure.data.exposure.buildings.count)}
                  </p>
                  <FreshnessMeta
                    descriptor={exposure.data.exposure.buildings.descriptor}
                    health={worstHealth(exposure.data.exposure.buildings.descriptor.sourceIds, health)}
                  />
                </div>
              </div>
            </section>
          ) : null}

          {impact.data ? (
            <section className="flex flex-col gap-2 border-t border-white/8 pt-2.5">
              <p className="text-[11px] font-semibold text-[var(--color-fg-muted)]">{t("impact.section.flood")}</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[11px] text-[var(--color-fg-muted)]">{t("impact.floodedArea.label")}</p>
                  <p className="text-lg font-bold tabular-nums text-[#4d94b8]">
                    {formatNumber(lang, impact.data.impact.floodedAreaKm2, 2)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--color-fg-muted)]">{t("impact.floodedFraction.label")}</p>
                  <p className="text-lg font-bold tabular-nums text-[#4d94b8]">
                    {impact.data.impact.floodedFraction === null
                      ? "—"
                      : `${formatNumber(lang, impact.data.impact.floodedFraction * 100, 1)}%`}
                  </p>
                  {impact.data.impact.floodedFraction === null ? (
                    <p className="text-[10px] text-[var(--color-risk-medium)]">{t("impact.floodedFraction.neverFetched")}</p>
                  ) : null}
                </div>
              </div>
              <FreshnessMeta
                descriptor={impact.data.impact.descriptor}
                health={worstHealth(impact.data.impact.descriptor.sourceIds, health)}
              />

              <div>
                <p className="text-[11px] text-[var(--color-fg-muted)]">{t("impact.facilitiesExposed.label")}</p>
                {(() => {
                  const f = impact.data.impact.facilitiesExposed;
                  const parts: string[] = [];
                  if (f.hospitals.length) parts.push(t("impact.facilitiesExposed.hospitals", { n: f.hospitals.length }));
                  if (f.schools.length) parts.push(t("impact.facilitiesExposed.schools", { n: f.schools.length }));
                  if (f.fireStations.length)
                    parts.push(t("impact.facilitiesExposed.fireStations", { n: f.fireStations.length }));
                  return (
                    <p className="text-sm text-[var(--color-fg)]">
                      {parts.length > 0 ? parts.join(" · ") : t("impact.facilitiesExposed.none")}
                    </p>
                  );
                })()}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[11px] text-[var(--color-fg-muted)]">{t("impact.populationExposed.label")}</p>
                  <p className="text-lg font-bold tabular-nums text-[#c4b0f5]">
                    {formatNumber(lang, impact.data.impact.populationExposed.estimate)}
                  </p>
                  <FreshnessMeta
                    descriptor={impact.data.impact.populationExposed.descriptor}
                    health={worstHealth(impact.data.impact.populationExposed.descriptor.sourceIds, health)}
                  />
                </div>
                <div>
                  <p className="text-[11px] text-[var(--color-fg-muted)]">{t("impact.buildingsExposed.label")}</p>
                  <p className="text-lg font-bold tabular-nums text-[#c4b0f5]">
                    {formatNumber(lang, impact.data.impact.buildingsExposed.estimate)}
                  </p>
                  <FreshnessMeta
                    descriptor={impact.data.impact.buildingsExposed.descriptor}
                    health={worstHealth(impact.data.impact.buildingsExposed.descriptor.sourceIds, health)}
                  />
                </div>
              </div>
              <p className="text-[10px] text-[var(--color-fg-subtle)]">{t("impact.method.areaWeighted")}</p>
            </section>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
