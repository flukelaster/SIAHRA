import { useLayoutEffect, useRef } from "react";
import type { ObservationSummary } from "@siahra/shared-types";
import type { ApiHealthState } from "../../hooks/useApiHealth";
import type { ProvinceForecastState } from "../../hooks/useProvinceForecast";
import { ExaggerationControl } from "./ExaggerationControl";
import { ForecastStrip } from "./ForecastStrip";
import type { MapInfo } from "./Map3DCanvas";
import { MapAttribution } from "./MapAttribution";
import { SourceStatusBar } from "./SourceStatusBar";
import { StatStrip } from "./StatStrip";
import { TimelineBar } from "./TimelineBar";

/**
 * Bottom dock between the side docks. Everything shares the same left/right
 * edges, top to bottom: source freshness + vertical scale, the history
 * scrubber, the stat tiles, then provenance/copyright.
 */
export function BottomBar({
  summary,
  loading,
  apiHealth,
  mapInfo,
  exaggeration,
  onExaggerationChange,
  atIso,
  onAtIsoChange,
  forecast,
  forecastAtIso,
  onForecastAtIsoChange,
  left,
  right,
  bottom,
  onHeight,
}: {
  summary: ObservationSummary | null;
  loading: boolean;
  apiHealth: ApiHealthState;
  mapInfo: MapInfo | null;
  exaggeration: number;
  onExaggerationChange: (f: number) => void;
  atIso: string | null;
  onAtIsoChange: (atIso: string | null) => void;
  forecast: ProvinceForecastState;
  forecastAtIso: string | null;
  onForecastAtIsoChange: (forecastAtIso: string | null) => void;
  left: number;
  right: number;
  bottom: number;
  /** Reports the rendered dock height so the map can keep the province clear of it. */
  onHeight?: (px: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !onHeight) return;
    const report = () => onHeight(Math.round(el.getBoundingClientRect().height));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 flex flex-col gap-2 @container"
      style={{ left, right, bottom }}
    >
      {/* The status bar wraps its chips internally when the dock is narrow;
          the scale picker stays pinned to the right edge. */}
      <div className="pointer-events-auto flex items-center gap-2">
        <div className="min-w-0">
          {/* Dots only in a narrow dock; full labels once there is room. */}
          <div className="@xl:hidden">
            <SourceStatusBar state={apiHealth} compact />
          </div>
          <div className="hidden @xl:block">
            <SourceStatusBar state={apiHealth} />
          </div>
        </div>
        <div className="ml-auto shrink-0">
          <ExaggerationControl value={exaggeration} onChange={onExaggerationChange} />
        </div>
      </div>
      {/* TimelineBar (observed, scrubs back) and ForecastStrip (TMD, scrubs
          forward) share one row so TimelineBar's live/"now" end and
          ForecastStrip's 0h end sit right next to each other. */}
      <div className="pointer-events-auto flex flex-col gap-2 @2xl:flex-row @2xl:items-stretch">
        <div className="min-w-0 @2xl:flex-1">
          <TimelineBar atIso={atIso} onChange={onAtIsoChange} />
        </div>
        <div className="min-w-0 @2xl:flex-1">
          <ForecastStrip state={forecast} forecastAtIso={forecastAtIso} onChange={onForecastAtIsoChange} />
        </div>
      </div>
      <div className="pointer-events-auto">
        <StatStrip summary={summary} loading={loading} />
      </div>
      <div className="pointer-events-auto self-start">
        <MapAttribution info={mapInfo} exaggeration={exaggeration} />
      </div>
    </div>
  );
}
