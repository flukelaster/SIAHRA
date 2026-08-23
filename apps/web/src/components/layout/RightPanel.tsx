import type { HealthResponse } from "@siahra/shared-types";
import type { EarthquakeFeedState } from "../../hooks/useEarthquakeFeed";
import type { DamsState } from "../../hooks/useDams";
import type { FloodExtentState } from "../../hooks/useFloodExtent";
import type { ObservationsState } from "../../hooks/useObservations";
import type { AffectedAuthoritiesState } from "../../hooks/useAffectedAuthorities";
import type { ActiveAlertsState } from "../../hooks/useActiveAlerts";
import type { LocalAuthorityImpactState } from "../../hooks/useLocalAuthorityImpact";
import { EarthquakeLiveCard } from "../hazard/EarthquakeLiveCard";
import { DamCard } from "../hazard/DamCard";
import { FloodExtentCard } from "../hazard/FloodExtentCard";
import { RainfallCard } from "../hazard/RainfallCard";
import { WaterLevelCard } from "../hazard/WaterLevelCard";
import { ActiveAlertBanner } from "../hazard/ActiveAlertBanner";
import { AffectedAuthorityList } from "../hazard/AffectedAuthorityList";
import { ImpactSummaryCard } from "../hazard/ImpactSummaryCard";
import { useT } from "../../i18n/context";
import { resolveError } from "../../lib/errorMessage";

/** Right dock: floating observation cards over the map. */
export function RightPanel({
  observations,
  earthquakes,
  floodExtent,
  dams,
  activeAlerts,
  affectedAuthorities,
  localAuthorityImpact,
  selectedAuthorityId,
  onSelectAuthority,
  health,
  atIso,
  width,
  top,
}: {
  observations: ObservationsState;
  earthquakes: EarthquakeFeedState;
  floodExtent: FloodExtentState;
  dams: DamsState;
  /** E11.5/E11.6 — แจ้งเตือน อปท. ทั้งจังหวัดที่กำลังดู */
  activeAlerts: ActiveAlertsState;
  /** E11.6 — รายชื่อ อปท. ที่ได้รับผลกระทบ เรียงลำดับแล้ว */
  affectedAuthorities: AffectedAuthoritiesState;
  /** E11.6 — รายละเอียดของ อปท. ที่เลือกอยู่ */
  localAuthorityImpact: LocalAuthorityImpactState;
  selectedAuthorityId: string | null;
  onSelectAuthority: (id: string) => void;
  health: HealthResponse | null;
  atIso: string | null;
  width: number;
  top: number;
}) {
  const t = useT();
  const { data, loading, error } = observations;
  const selectedAuthority =
    affectedAuthorities.entries.find((e) => e.id === selectedAuthorityId) ?? null;
  const authorityNames = new Map(affectedAuthorities.entries.map((e) => [e.id, e.nameTh]));
  const selectedAuthorityAlerts = selectedAuthorityId
    ? (activeAlerts.data?.alerts.filter((a) => a.localAuthorityId === selectedAuthorityId) ?? [])
    : [];

  return (
    <aside
      className="absolute right-3 bottom-3 flex flex-col gap-3 overflow-y-auto pl-0.5"
      style={{ width, top }}
    >
      {error ? (
        <div className="glass flex shrink-0 items-start gap-2 rounded-xl border-[var(--color-risk-high)]/40 px-3 py-2 text-xs text-[var(--color-risk-high)]">
          <span
            className="mt-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-risk-high)]"
            aria-hidden="true"
          />
          <span>
            {resolveError(t, error)}
            <br />
            <span className="text-[var(--color-fg-muted)]">{t("common.reconnecting")}</span>
          </span>
        </div>
      ) : null}

      <ActiveAlertBanner state={activeAlerts} authorityNames={authorityNames} />

      <FloodExtentCard state={floodExtent} />

      <AffectedAuthorityList
        state={affectedAuthorities}
        alerts={activeAlerts.data?.alerts ?? []}
        selectedId={selectedAuthorityId}
        onSelect={onSelectAuthority}
      />

      <ImpactSummaryCard
        authority={selectedAuthority}
        state={localAuthorityImpact}
        health={health}
        alerts={selectedAuthorityAlerts}
      />

      <WaterLevelCard
        stations={data?.waterlevel ?? []}
        loading={loading}
        attribution={data?.summary.sourceAttribution ?? null}
        observedAt={data?.summary.latestObservedAt ?? null}
        historical={atIso !== null}
      />

      <DamCard state={dams} />

      <RainfallCard
        stations={data?.rainfall ?? []}
        loading={loading}
        attribution={data?.summary.sourceAttribution ?? null}
      />

      <EarthquakeLiveCard feed={earthquakes} />
    </aside>
  );
}
