import { useLayoutEffect, useRef, useState } from "react";
import type { ApiHealthState } from "../../hooks/useApiHealth";
import type { ProvinceForecastState } from "../../hooks/useProvinceForecast";
import { GUTTER } from "../../lib/shellLayout";
import { ExaggerationControl } from "./ExaggerationControl";
import { ForecastStrip } from "./ForecastStrip";
import type { MapInfo } from "./Map3DCanvas";
import { MapAttribution } from "./MapAttribution";
import { SourceStatusPopover } from "./SourceStatusPopover";
import { TimelineBar } from "./TimelineBar";

/**
 * Dock ล่างเต็มความกว้าง (จอ ≥ tablet): แถวควบคุมเดียว — สถานะแหล่งข้อมูล ·
 * ไทม์ไลน์ย้อนหลัง (dense) · แถบพยากรณ์ TMD (dense) · มาตราส่วนแนวดิ่ง — แล้ว
 * บรรทัดเครดิตใต้แถว; ห่อเป็นสองแถวเองบน tablet ความสูงจริงถูกวัดด้วย
 * ResizeObserver ใน `useLayoutEffect` (ก่อน paint) แล้วรายงานให้ safe area
 *
 * root เป็น `pointer-events-none` และเปิดกลับเฉพาะลูกที่เป็นตัวควบคุมจริง —
 * ช่องว่างระหว่างตัวควบคุมต้องปล่อยให้ลากแผนที่ทะลุได้
 */
export function BottomDock({
  apiHealth,
  mapInfo,
  exaggeration,
  onExaggerationChange,
  atIso,
  onAtIsoChange,
  forecast,
  forecastAtIso,
  onForecastAtIsoChange,
  onHeight,
}: {
  apiHealth: ApiHealthState;
  mapInfo: MapInfo | null;
  exaggeration: number;
  onExaggerationChange: (f: number) => void;
  atIso: string | null;
  onAtIsoChange: (atIso: string | null) => void;
  forecast: ProvinceForecastState;
  forecastAtIso: string | null;
  onForecastAtIsoChange: (forecastAtIso: string | null) => void;
  /** Reports the rendered dock height so the map can keep the province clear of it. */
  onHeight?: (px: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [attributionExpanded, setAttributionExpanded] = useState(false);
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
      className="pointer-events-none absolute z-10 flex flex-col gap-1.5 @container"
      style={{ left: GUTTER, right: GUTTER, bottom: GUTTER }}
    >
      {/* TimelineBar (observed, scrubs back) and ForecastStrip (TMD, scrubs
          forward) share one row so TimelineBar's live/"now" end and
          ForecastStrip's 0h end sit right next to each other. */}
      {/* flex-basis ของสองแถบ = ความกว้างที่เนื้อหาแบบ dense ต้องใช้จริง (ปุ่ม 2 ·
          Segmented · slider ≥ 64px · ป้าย) เพื่อให้แถวห่อบรรทัดก่อนที่เนื้อหาจะล้น
          ไม่ใช่ตอนที่ล้นไปแล้ว — วัดที่ 1024: timeline ต้องการ ~408–422px */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="pointer-events-auto shrink-0">
          <SourceStatusPopover state={apiHealth} />
        </div>
        <div className="pointer-events-auto min-w-0" style={{ flex: "1 1 430px" }}>
          <TimelineBar atIso={atIso} onChange={onAtIsoChange} variant="dense" />
        </div>
        <div className="pointer-events-auto min-w-0" style={{ flex: "1 1 320px" }}>
          <ForecastStrip
            state={forecast}
            forecastAtIso={forecastAtIso}
            onChange={onForecastAtIsoChange}
            variant="dense"
          />
        </div>
        <div className="pointer-events-auto shrink-0">
          <ExaggerationControl value={exaggeration} onChange={onExaggerationChange} />
        </div>
      </div>
      <div className="pointer-events-auto max-w-full self-start">
        <MapAttribution
          info={mapInfo}
          exaggeration={exaggeration}
          expanded={attributionExpanded}
          onToggle={() => setAttributionExpanded((v) => !v)}
        />
      </div>
    </div>
  );
}
