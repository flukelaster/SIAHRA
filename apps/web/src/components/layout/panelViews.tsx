import type { HealthResponse } from "@siahra/shared-types";
import type { Province } from "../../data/types";
import type { Lang } from "../../i18n";
import { useT } from "../../i18n/context";
import type { ActiveAlertsState } from "../../hooks/useActiveAlerts";
import type { AffectedAuthoritiesState } from "../../hooks/useAffectedAuthorities";
import type { DamsState } from "../../hooks/useDams";
import type { EarthquakeFeedState } from "../../hooks/useEarthquakeFeed";
import type { FloodExtentState } from "../../hooks/useFloodExtent";
import type { FloodSceneState } from "../../hooks/useFloodScene";
import type { FloodScenesState } from "../../hooks/useFloodScenes";
import type { LayerDescriptors } from "../../hooks/useLayerDescriptors";
import type { LocalAuthorityImpactState } from "../../hooks/useLocalAuthorityImpact";
import type { ObservationsState } from "../../hooks/useObservations";
import type { ProvinceForecastState } from "../../hooks/useProvinceForecast";
import { resolveError } from "../../lib/errorMessage";
import type { QualityLevel, QualityMode } from "../../scene/quality";
import { ActiveAlertBanner } from "../hazard/ActiveAlertBanner";
import { AffectedAuthorityList } from "../hazard/AffectedAuthorityList";
import { ImpactSummaryCard } from "../hazard/ImpactSummaryCard";
import { RainfallCard } from "../hazard/RainfallCard";
import { WaterLevelCard } from "../hazard/WaterLevelCard";
import { ApiStatusFooter } from "./ApiStatusFooter";
import type { MapInfo, MapLayers } from "./Map3DCanvas";
import {
  MapLegend,
  type ExposureLegendState,
  type FloodGfmLegendState,
  type ForecastLegendState,
} from "./MapLegend";

/**
 * ทุกอย่างที่แผงใดแผงหนึ่งอาจต้องใช้ — App.tsx ประกอบก้อนนี้ก้อนเดียวแล้วส่งให้
 * `SideDrawer` (จอกว้าง) หรือ `MobileSheet` (มือถือ) ซึ่งเรนเดอร์ **เฉพาะแผงที่
 * เปิดอยู่** ผ่าน `PANELS[i].render(ctx)` (`panelRegistry.ts`) — สองเปลือกใช้
 * ทะเบียนเดียวกัน จึงไม่มีวันที่แผงหนึ่งหายไปจากมือถือแต่ยังอยู่บนเดสก์ท็อป
 * (หรือกลับกัน)
 *
 * ไฟล์นี้มีเฉพาะคอมโพเนนต์ของแผงที่ประกอบจากหลายการ์ด (รวม `PanelContext` ที่พวกมัน
 * รับ); ทะเบียนเองอยู่ใน `panelRegistry.ts` เพื่อให้ไฟล์นี้ export แต่คอมโพเนนต์
 * (react fast-refresh)
 */
export interface PanelContext {
  province: Province;
  /** ชื่อจังหวัดในภาษาที่กำลังแสดง (จาก data/provinces.ts) */
  provinceName: string;
  lang: Lang;
  layers: MapLayers;
  toggleLayer: (key: keyof MapLayers, value: boolean) => void;
  layerDescriptors: LayerDescriptors;
  quality: QualityMode;
  qualityLevel: QualityLevel;
  setQuality: (q: QualityMode) => void;
  mapInfo: MapInfo | null;
  exposureLegend: ExposureLegendState;
  forecastLegend: ForecastLegendState;
  /** E14.F4 — ฉาก Copernicus GFM ที่กำลังแสดง + เหตุผลเมื่อไม่มี (legend สองแถว) */
  floodGfmLegend: FloodGfmLegendState;
  observations: ObservationsState;
  floodExtent: FloodExtentState;
  /** E14.F5 — ดัชนีฉาก Copernicus GFM ของจังหวัด + ฉากที่เลือกตาม atIso (แผง flood) */
  floodScenes: FloodScenesState;
  floodScene: FloodSceneState;
  dams: DamsState;
  earthquakes: EarthquakeFeedState;
  forecast: ProvinceForecastState;
  /** E11.5/E11.6 — แจ้งเตือน อปท. ทั้งจังหวัดที่กำลังดู */
  activeAlerts: ActiveAlertsState;
  /** E11.6 — รายชื่อ อปท. ที่ได้รับผลกระทบ เรียงลำดับแล้ว */
  affectedAuthorities: AffectedAuthoritiesState;
  /** E11.6 — รายละเอียดของ อปท. ที่เลือกอยู่ */
  localAuthorityImpact: LocalAuthorityImpactState;
  selectedAuthorityId: string | null;
  setSelectedAuthorityId: (id: string | null) => void;
  apiHealth: HealthResponse | null;
  atIso: string | null;
  /**
   * E14.F5 — ตัวตั้ง `atIso` **ตัวเดียวกับที่ TimelineBar ใช้** (`handleAtIsoChange` ใน
   * App.tsx): แผงฉาก GFM เลือกเวลาผ่านทางนี้ ทุกชั้นที่เดินตามเส้นเวลาจึงตามไปด้วยกัน
   */
  setAtIso: (atIso: string | null) => void;
}

/** แผงชั้นข้อมูล: legend เดิมไม่แก้ + สถานะการดึงของ ThaiWater เป็น footer (ย้ายมาจาก Sidebar เดิม) */
export function LayersPanel({ ctx }: { ctx: PanelContext }) {
  const obs = ctx.observations.data;
  return (
    <div className="flex min-h-full flex-col gap-3">
      <MapLegend
        layers={ctx.layers}
        onToggle={ctx.toggleLayer}
        descriptors={ctx.layerDescriptors}
        quality={ctx.quality}
        qualityLevel={ctx.qualityLevel}
        onQualityChange={ctx.setQuality}
        terrainIntegrity={ctx.mapInfo?.terrainIntegrity}
        buildingsError={ctx.mapInfo?.buildingsError ?? null}
        exposure={ctx.exposureLegend}
        forecast={ctx.forecastLegend}
        floodGfm={ctx.floodGfmLegend}
      />
      <div className="glass-soft mt-auto shrink-0 rounded-2xl px-3.5 py-2.5">
        <ApiStatusFooter
          fetchedAt={obs?.summary.fetchedAt ?? null}
          attribution={obs?.summary.sourceAttribution ?? null}
        />
      </div>
    </div>
  );
}

/**
 * ข้อความเมื่อคำขอ observations ล้มเหลว (ย้ายมาจาก RightPanel เดิม) — แสดงในแผง
 * ระดับน้ำและฝน เพราะสองแผงนั้นคือผู้ใช้ข้อมูลชุดนี้ ความล้มเหลวต้องไม่ถูกกลืน
 */
export function ObservationsErrorNotice({ state }: { state: ObservationsState }) {
  const t = useT();
  if (!state.error) return null;
  return (
    <div className="glass flex shrink-0 items-start gap-2 rounded-xl border-[var(--color-risk-high)]/40 px-3 py-2 text-xs text-[var(--color-risk-high)]">
      <span
        className="mt-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-risk-high)]"
        aria-hidden="true"
      />
      <span>
        {resolveError(t, state.error)}
        <br />
        <span className="text-[var(--color-fg-muted)]">{t("common.reconnecting")}</span>
      </span>
    </div>
  );
}

/**
 * E11.6 — แถบแจ้งเตือน + รายชื่อ อปท. + สรุปผลกระทบ วางต่อกันในแผงเดียว
 * การ derive `authorityNames`/`selectedAuthority`/`selectedAuthorityAlerts` เคย
 * ซ้ำกันใน RightPanel.tsx และ App.tsx — ตอนนี้อยู่ที่นี่ที่เดียว
 */
export function ImpactPanel({ ctx }: { ctx: PanelContext }) {
  const { activeAlerts, affectedAuthorities, localAuthorityImpact, selectedAuthorityId } = ctx;
  const selectedAuthority =
    affectedAuthorities.entries.find((e) => e.id === selectedAuthorityId) ?? null;
  const authorityNames = new Map(affectedAuthorities.entries.map((e) => [e.id, e.nameTh]));
  const selectedAuthorityAlerts = selectedAuthorityId
    ? (activeAlerts.data?.alerts.filter((a) => a.localAuthorityId === selectedAuthorityId) ?? [])
    : [];
  return (
    <div className="flex flex-col gap-3">
      <ActiveAlertBanner state={activeAlerts} authorityNames={authorityNames} />
      <AffectedAuthorityList
        state={affectedAuthorities}
        alerts={activeAlerts.data?.alerts ?? []}
        selectedId={selectedAuthorityId}
        onSelect={ctx.setSelectedAuthorityId}
      />
      <ImpactSummaryCard
        authority={selectedAuthority}
        state={localAuthorityImpact}
        health={ctx.apiHealth}
        alerts={selectedAuthorityAlerts}
      />
    </div>
  );
}

export function WaterPanel({ ctx }: { ctx: PanelContext }) {
  const { data, loading } = ctx.observations;
  return (
    <div className="flex flex-col gap-3">
      <ObservationsErrorNotice state={ctx.observations} />
      <WaterLevelCard
        stations={data?.waterlevel ?? []}
        loading={loading}
        attribution={data?.summary.sourceAttribution ?? null}
        observedAt={data?.summary.latestObservedAt ?? null}
        historical={ctx.atIso !== null}
      />
    </div>
  );
}

export function RainPanel({ ctx }: { ctx: PanelContext }) {
  const { data, loading } = ctx.observations;
  return (
    <div className="flex flex-col gap-3">
      <ObservationsErrorNotice state={ctx.observations} />
      <RainfallCard
        stations={data?.rainfall ?? []}
        loading={loading}
        attribution={data?.summary.sourceAttribution ?? null}
      />
    </div>
  );
}
