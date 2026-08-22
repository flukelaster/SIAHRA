import type { EarthquakeFeedState } from "../../hooks/useEarthquakeFeed";
import type { DamsState } from "../../hooks/useDams";
import type { FloodExtentState } from "../../hooks/useFloodExtent";
import type { ObservationsState } from "../../hooks/useObservations";
import type { UseLocalAuthorityImpactResult } from "../../hooks/useLocalAuthorityImpact";
import { EarthquakeLiveCard } from "../hazard/EarthquakeLiveCard";
import { DamCard } from "../hazard/DamCard";
import { FloodExtentCard } from "../hazard/FloodExtentCard";
import { RainfallCard } from "../hazard/RainfallCard";
import { WaterLevelCard } from "../hazard/WaterLevelCard";
import { ImpactSummaryCard } from "../hazard/ImpactSummaryCard";
import { AffectedAuthorityList } from "../hazard/AffectedAuthorityList";
import { useT } from "../../i18n/context";
import { resolveError } from "../../lib/errorMessage";

/** Right dock: floating observation cards over the map. */
export function RightPanel({
  observations,
  earthquakes,
  floodExtent,
  dams,
  decisionSupport,
  selectedLaoId,
  onSelectLocalAuthority,
  atIso,
  width,
  top,
}: {
  observations: ObservationsState;
  earthquakes: EarthquakeFeedState;
  floodExtent: FloodExtentState;
  dams: DamsState;
  decisionSupport?: UseLocalAuthorityImpactResult;
  selectedLaoId?: string | null;
  onSelectLocalAuthority?: (id: string) => void;
  atIso: string | null;
  width: number;
  top: number;
}) {
  const t = useT();
  const { data, loading, error } = observations;

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

      {/* Decision Support: Local Authority Impact Summary */}
      {decisionSupport?.selectedImpact ? (
        <ImpactSummaryCard impact={decisionSupport.selectedImpact} />
      ) : null}

      {/* Decision Support: Affected Authorities Rankings */}
      {decisionSupport && decisionSupport.impacts.length > 0 ? (
        <div className="glass rounded-xl p-3">
          <AffectedAuthorityList
            impacts={decisionSupport.impacts}
            selectedId={selectedLaoId ?? null}
            onSelect={(id) => onSelectLocalAuthority?.(id)}
          />
        </div>
      ) : null}

      <FloodExtentCard state={floodExtent} />

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
