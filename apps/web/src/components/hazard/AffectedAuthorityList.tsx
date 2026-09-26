import { ListTree } from "lucide-react";
import type { AlertEvent, HealthResponse } from "@siahra/shared-types";
import type { AffectedAuthoritiesState } from "../../hooks/useAffectedAuthorities";
import type { RankedAffectedAuthority } from "../../lib/affectedAuthorityRanking";
import { Panel } from "../ui/Panel";
import { formatNumber } from "../../lib/number";
import { useLang } from "../../i18n/context";
import { resolveError } from "../../lib/errorMessage";
import { ALERT_SEVERITY_STYLE } from "../../lib/alertSeverityStyle";
import { LOCAL_AUTHORITY_TYPE_KEY } from "../../lib/localAuthorityTypeLabel";
import {
  deriveGistdaImpactFreshness,
  gistdaSourceStatus,
  newestImpactDescriptor,
  type GistdaImpactFreshness,
} from "../../lib/gistdaImpactFreshness";
import { formatDateTime, formatDayMonth } from "../../lib/time";
import { useNow } from "../../hooks/useNow";
import type { MessageKey } from "../../i18n";

function facilitiesCount(entry: RankedAffectedAuthority): number {
  if (!entry.impact) return 0;
  const f = entry.impact.facilitiesExposed;
  return f.hospitals.length + f.schools.length + f.fireStations.length;
}

/** ข้อความแจ้งหนึ่งบรรทัดเหนือรายการ — null = ไม่ต้องแจ้งอะไร */
function noticeKey(
  freshness: GistdaImpactFreshness,
  entries: readonly RankedAffectedAuthority[],
): MessageKey | null {
  switch (freshness.kind) {
    case "unreachable":
      return "authorityList.notice.unreachable";
    case "no-new-scene":
      return "authorityList.notice.noNewScene";
    case "old":
      return "authorityList.notice.old";
    case "fresh": {
      // ดึงฉากสดได้จริง และไม่มีแถวใดตัดกับพื้นที่ท่วมเลย = "GISTDA ตอบ ไม่มีน้ำท่วมใน
      // พื้นที่เหล่านี้" — พูดได้เฉพาะตอนสดเท่านั้น (ตอนติดต่อไม่ได้ ห้ามอ่านว่าเงียบ)
      const measured = entries.filter((e) => e.bucket === "measured");
      return measured.length > 0 && measured.every((e) => e.impact?.floodedFraction === 0)
        ? "authorityList.notice.noneMapped"
        : null;
    }
    case "never-fetched":
      // แต่ละแถวบอก "ยังไม่เคยดึงข้อมูลจาก GISTDA สำเร็จ" อยู่แล้ว
      return null;
  }
}

/**
 * รายชื่อ อปท. ที่ได้รับผลกระทบในจังหวัดที่กำลังดู เรียงตามสัดส่วนพื้นที่ท่วม
 * มากไปน้อย (E11.6) — เป็นทั้งรายการแสดงผลและกลไกเลือก อปท. ให้
 * `ImpactSummaryCard` (ยังไม่มีการคลิกเลือกบนโพลิกอน 3 มิติ — ดู
 * `scene/LocalAuthorityOutline.ts`, นอกขอบเขตงานนี้)
 *
 * ตัวเลข % มาจากฉาก GISTDA ที่ดึงได้ล่าสุด — เมื่อฉากเก่ากว่ารอบปกติหรือ /health
 * บอกว่า `gistda-flood` ไม่ ok ตัวเลขถูกหรี่และติดวันที่ของฉาก และมีข้อความแจ้ง
 * หนึ่งบรรทัดที่แยก "ติดต่อ GISTDA ไม่ได้" ออกจาก "GISTDA ตอบ ไม่พบน้ำท่วม"
 * (`lib/gistdaImpactFreshness.ts`) — ไม่มีคำขอเพิ่ม: ใช้ descriptor ของ `/impact` ที่
 * โหลดมาแล้วกับ `health` ที่ `useApiHealth` ดึงอยู่แล้วเท่านั้น
 */
export function AffectedAuthorityList({
  state,
  alerts,
  health,
  selectedId,
  onSelect,
}: {
  state: AffectedAuthoritiesState;
  /** `/api/v1/health` ที่ App ดึงอยู่แล้ว — ใช้แถว `gistda-flood` เท่านั้น */
  health: HealthResponse | null;
  /** แจ้งเตือนที่ active ของทั้งจังหวัด (จาก `useActiveAlerts`) — ใช้ badge ระดับ
   *  ความรุนแรงต่อแถว ใช้ป้ายสี/ข้อความชุดเดียวกับ `ActiveAlertBanner` */
  alerts: readonly AlertEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { lang, t } = useLang();
  const nowMs = useNow();
  const { entries, loading, error, coverage } = state;
  const alertByAuthority = new Map(alerts.map((a) => [a.localAuthorityId, a]));
  const freshness = deriveGistdaImpactFreshness(
    newestImpactDescriptor(entries.flatMap((e) => (e.impact ? [e.impact.descriptor] : []))),
    gistdaSourceStatus(health),
    nowMs,
  );
  const notice = noticeKey(freshness, entries);
  const sceneDate = freshness.fetchedAt ? formatDayMonth(lang, freshness.fetchedAt) : null;
  // เขตของกรุงเทพฯ ไม่ใช่ อปท. — หัวแผงต้องไม่เรียกมันว่า อปท.
  const bmaOnly = entries.length > 0 && entries.every((e) => e.type === "bma_district");

  return (
    <Panel
      title={t(bmaOnly ? "authorityList.title.bma" : "authorityList.title")}
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
        <div className="flex flex-col gap-1.5">
          {notice && freshness.fetchedAt ? (
            <p
              role="status"
              className={`rounded-lg px-2.5 py-1.5 text-[11px] ${
                freshness.dim
                  ? "bg-[var(--color-risk-medium)]/10 text-[var(--color-risk-medium)]"
                  : "bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)]"
              }`}
            >
              {t(notice, { date: formatDateTime(lang, freshness.fetchedAt) })}
            </p>
          ) : null}
          <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">{t("authorityList.explain")}</p>
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
                    <span
                      className={`w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-[#4d94b8] ${
                        freshness.dim && entry.bucket === "measured" ? "opacity-50" : ""
                      }`}
                    >
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
                        {entry.bucket === "measured" && freshness.dim && sceneDate
                          ? ` · ${t("authorityList.sceneDate", { date: sceneDate })}`
                          : ""}
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
        </div>
      )}
    </Panel>
  );
}
