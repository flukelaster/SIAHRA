import type { HealthResponse } from "@siahra/shared-types";
import type { Dispatch, SetStateAction } from "react";
import type { Province } from "../../data/types";
import type { Lang } from "../../i18n";
import { useT } from "../../i18n/context";
import type { ActiveAlertsState } from "../../hooks/useActiveAlerts";
import type { AffectedAuthoritiesState } from "../../hooks/useAffectedAuthorities";
import type { CameraCataloguesState } from "../../hooks/useCameraCatalogues";
import type { DamsState } from "../../hooks/useDams";
import type { EarthquakeFeedState } from "../../hooks/useEarthquakeFeed";
import type { FloodExtentState } from "../../hooks/useFloodExtent";
import type { FloodSceneState } from "../../hooks/useFloodScene";
import type { FloodScenesState } from "../../hooks/useFloodScenes";
import type { LayerDescriptors } from "../../hooks/useLayerDescriptors";
import type { LocalAuthorityImpactState } from "../../hooks/useLocalAuthorityImpact";
import type { NorthRouteState } from "../../hooks/useNorthRoute";
import type { FloodSourceAgeInput } from "../../lib/floodSourceAge";
import type { ObservationsState } from "../../hooks/useObservations";
import type { ProvinceForecastState } from "../../hooks/useProvinceForecast";
import type { StormsState } from "../../hooks/useStorms";
import { resolveError } from "../../lib/errorMessage";
import type { LayerPresetState } from "../../lib/defaultLayers";
import { applyToggle, resetToTopic } from "../../lib/layerGroups";
import type { TopicKey } from "../../lib/topics";
import type { QualityLevel, QualityMode } from "../../scene/quality";
import { ActiveAlertBanner } from "../hazard/ActiveAlertBanner";
import { AffectedAuthorityList } from "../hazard/AffectedAuthorityList";
import { ImpactSummaryCard } from "../hazard/ImpactSummaryCard";
import { OverviewSources, OverviewSummary } from "../hazard/OverviewSummary";
import { RainfallCard } from "../hazard/RainfallCard";
import { WaterLevelCard } from "../hazard/WaterLevelCard";
import { ApiStatusFooter } from "./ApiStatusFooter";
import { ExaggerationControl } from "./ExaggerationControl";
import { LayerPresetCard } from "./LayerPresetCard";
import type { MapInfo, MapLayers } from "./Map3DCanvas";
import {
  MapLegend,
  type ExposureLegendState,
  type FloodGfmLegendState,
  type GistdaDepthLegendState,
  type CommunityLegendState,
  type ForecastLegendState,
} from "./MapLegend";

/**
 * ทุกอย่างที่แผงใดแผงหนึ่งอาจต้องใช้ — App.tsx ประกอบก้อนนี้ก้อนเดียวแล้วส่งให้
 * `SideDrawer` (จอกว้าง) หรือ `MobileSheet` (มือถือ) ซึ่งเรนเดอร์ **เฉพาะแผงที่
 * เปิดอยู่** ผ่าน `<PanelSlot>` + `PANELS[i].view` (`panelRegistry.ts`) — สองเปลือกใช้
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
  /**
   * redesign PR 3 — หัวข้อที่เลือกอยู่ + "เดินตามหัวข้อไหม" + ตัวตั้งสถานะชั้นตัวเดียวของ App.tsx: สวิตช์ใน
   * legend (`applyToggle`) และปุ่มคืนค่า (`resetToTopic`) เรียกกฎของ `lib/layerGroups.ts` ผ่านตัวตั้งนี้
   * (ตัวเดียวกับที่ App ใช้ตอนเปลี่ยนหัวข้อ — permalink จึงตามไปเหมือนกันทุกทาง) สถานะอยู่ในหน่วยความจำเท่านั้น
   */
  layerPreset: LayerPresetInfo;
  layerDescriptors: LayerDescriptors;
  quality: QualityMode;
  qualityLevel: QualityLevel;
  setQuality: (q: QualityMode) => void;
  mapInfo: MapInfo | null;
  exposureLegend: ExposureLegendState;
  forecastLegend: ForecastLegendState;
  /** E14.F4 — ฉาก Copernicus GFM ที่กำลังแสดง + เหตุผลเมื่อไม่มี (legend สองแถว) */
  floodGfmLegend: FloodGfmLegendState;
  /** E16 B-2 — แผ่นน้ำ GISTDA 3 มิติ: สถานะข้อมูล + ผลคำนวณ (legend แถว gistdaDepth) */
  gistdaDepthLegend: GistdaDepthLegendState;
  /** รายงานจากประชาชน — สถานะของรายการสำหรับแถวใน legend */
  communityLegend: CommunityLegendState;
  /** E15/E15.3 — บัญชีกล้องทุกแหล่งที่เปิด (โหลดเฉพาะเมื่อชั้นเปิด) legend บอกต่อแหล่งเมื่อโหลดไม่ได้ */
  cameraCatalogues: CameraCataloguesState;
  observations: ObservationsState;
  floodExtent: FloodExtentState;
  /** E14.F5 — ดัชนีฉาก Copernicus GFM ของจังหวัด + ฉากที่เลือกตาม atIso (แผง flood) */
  floodScenes: FloodScenesState;
  floodScene: FloodSceneState;
  dams: DamsState;
  earthquakes: EarthquakeFeedState;
  forecast: ProvinceForecastState;
  /**
   * ชั้นพายุ v1 — `useStorms` ตัวเดียวของ App.tsx (คำขอเดียวระดับประเทศ) ใช้ร่วมกันทั้ง
   * แผงพายุ badge บน rail และศูนย์การแจ้งเตือน
   */
  storms: StormsState;
  /** E11.5/E11.6 — แจ้งเตือน อปท. ทั้งจังหวัดที่กำลังดู */
  activeAlerts: ActiveAlertsState;
  /** E11.6 — รายชื่อ อปท. ที่ได้รับผลกระทบ เรียงลำดับแล้ว */
  affectedAuthorities: AffectedAuthoritiesState;
  /** E11.6 — รายละเอียดของ อปท. ที่เลือกอยู่ */
  localAuthorityImpact: LocalAuthorityImpactState;
  selectedAuthorityId: string | null;
  setSelectedAuthorityId: (id: string | null) => void;
  apiHealth: HealthResponse | null;
  /**
   * `/api/v1/health` ตอบไม่ได้ (`apiDown` ของ hook สถานะ API ตัวเดียวใน App.tsx) — ส่วนแหล่งข้อมูลของ
   * หัวข้อภาพรวมต้องพูดว่า "ถามสถานะไม่ได้" แยกจาก "ยังไม่ได้คำตอบแรก" (`apiHealth: null`)
   */
  apiDown: boolean;
  atIso: string | null;
  /**
   * E18.4 — ขั้นพยากรณ์ TMD ที่เลือกอยู่ + ตัวตั้งตัวเดียวของ App.tsx (`handleForecastAtIsoChange`,
   * ล้าง atIso เมื่อเลือก) — แถบพยากรณ์ในมุมมองพยากรณ์ขับแผนที่และชิปเวลาผ่านทางนี้
   */
  forecastAtIso: string | null;
  setForecastAtIso: (forecastAtIso: string | null) => void;
  /**
   * E18.4 — มาตราส่วนแนวดิ่ง: ตัวเลือกอยู่ในกลุ่มแผนที่ฐานของชั้นข้อมูล (`LayersPanel`) พารามิเตอร์ `ex`
   * ของ permalink ยังมาจาก state เดียวกันใน App.tsx
   */
  exaggeration: number;
  setExaggeration: (factor: number) => void;
  /**
   * E14.F5 — ตัวตั้ง `atIso` **ตัวเดียวกับที่ TimelineBar ใช้** (`handleAtIsoChange` ใน
   * App.tsx): แผงฉาก GFM เลือกเวลาผ่านทางนี้ ทุกชั้นที่เดินตามเส้นเวลาจึงตามไปด้วยกัน
   */
  setAtIso: (atIso: string | null) => void;
  /**
   * E16 — แผงเส้นทางน้ำเหนือ: สลับไปจังหวัดของสถานี บินไปที่หมุด แล้วเปิด popup ของมัน
   * (กลไกเดียวกับการคลิกหมุดเอง — `MapApi.selectWaterlevel`)
   */
  focusStation: (target: StationFocus) => void;
  /** E16 — ข้อมูลเส้นทางน้ำเหนือจาก hook ตัวเดียวใน App.tsx (แผง north + ชั้นเส้นลำน้ำ 3 มิติ) */
  northRoute: NorthRouteState;
  /** E16 B-1 — ชิปอายุแหล่งน้ำท่วมจากดาวเทียม (แผ่นเลื่อนมือถือ) — null = ชั้นน้ำท่วมปิดทั้งคู่ */
  floodAge: FloodSourceAgeInput | null;
}

export interface LayerPresetInfo {
  topic: TopicKey;
  /** false = ปรับเองแล้ว (สลับชั้นที่ชุดของหัวข้อตั้งค่าเอง หรือเปิดจาก `?layers=`) */
  following: boolean;
  setState: Dispatch<SetStateAction<LayerPresetState>>;
  /** โหลดกฎของชุดหัวข้อไม่สำเร็จตอนเปลี่ยนหัวข้อครั้งล่าสุด (ชั้นไม่ถูกเปลี่ยน) — null = ไม่มีปัญหา */
  loadError: string | null;
  clearLoadError: () => void;
}

/** เป้าหมายของ `focusStation` — พิกัด/จังหวัดมาจากผังเส้นทาง (ใช้ได้แม้ไม่มีค่าล่าสุด) */
export interface StationFocus {
  /**
   * ชนิดสถานี — id ของสถานีวัดน้ำฝนกับสถานีวัดระดับน้ำเป็นคนละเนมสเปซของ ThaiWater จึงต้องบอก
   * ว่าให้หาใน `rainfall` หรือ `waterlevel` ไม่งั้น id ที่ชนกันจะเปิด popup ของอีกสถานี
   * (ไม่ระบุ = ระดับน้ำ ตามผู้เรียกเดิมคือแผงเส้นทางน้ำเหนือ)
   */
  kind?: "waterlevel" | "rainfall";
  stationId: number;
  provinceCode: string | null;
  lat: number;
  lon: number;
}

/**
 * แผงชั้นข้อมูล: การ์ดชุดของหัวข้อ + legend จัดเป็นสามกลุ่ม (redesign PR 3 — ทุกบรรทัดของแต่ละชั้น
 * ยังอยู่ครบ แค่ย้ายเข้ากลุ่ม) + สถานะการดึงของ ThaiWater เป็น footer (ย้ายมาจาก Sidebar เดิม)
 */
export function LayersPanel({ ctx }: { ctx: PanelContext }) {
  const t = useT();
  const obs = ctx.observations.data;
  const { topic, setState, clearLoadError } = ctx.layerPreset;
  return (
    <div className="flex min-h-full flex-col gap-3">
      <MapLegend
        header={
          <LayerPresetCard
            topic={topic}
            layers={ctx.layers}
            following={ctx.layerPreset.following}
            loadError={ctx.layerPreset.loadError}
            onReset={() => {
              clearLoadError();
              setState((s) => resetToTopic(s, topic));
            }}
          />
        }
        layers={ctx.layers}
        onToggle={(key, value) => setState((s) => applyToggle(s, key, value))}
        descriptors={ctx.layerDescriptors}
        quality={ctx.quality}
        qualityLevel={ctx.qualityLevel}
        onQualityChange={ctx.setQuality}
        terrainIntegrity={ctx.mapInfo?.terrainIntegrity}
        buildingsError={ctx.mapInfo?.buildingsError ?? null}
        exposure={ctx.exposureLegend}
        forecast={ctx.forecastLegend}
        floodGfm={ctx.floodGfmLegend}
        stationSheet={ctx.mapInfo?.stationSheet ?? null}
        gistdaDepth={ctx.gistdaDepthLegend}
        cameraErrors={ctx.cameraCatalogues.errors}
        layerLoadErrors={ctx.mapInfo?.layerLoadErrors}
        community={ctx.communityLegend}
        basemapFooter={
          // E18.4 — มาตราส่วนแนวดิ่งเป็นของแผนที่ฐาน (ภูมิประเทศ) ค่าที่ไม่ใช่ 1:1 ยังขึ้นในบรรทัดเครดิต
          // ที่ mount เสมอทุก tier (`MapAttribution`) ตัวเลือกจึงย้ายมาที่นี่ได้โดยไม่ซ่อนค่า
          <div className="flex min-h-11 items-center justify-between gap-2 px-1.5" data-layer-row="exaggeration">
            <span className="min-w-0 text-xs text-[var(--color-fg-muted)]">
              {t("exaggeration.label")}{" "}
              <span className="tabular-nums text-[var(--color-fg)]">
                {ctx.exaggeration === 1 ? t("exaggeration.real") : `${ctx.exaggeration}×`}
              </span>
            </span>
            <ExaggerationControl value={ctx.exaggeration} onChange={ctx.setExaggeration} compact />
          </div>
        }
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
 * หัวข้อภาพรวม (redesign PR 2) — การ์ดสรุปจากค่าตรวจวัด + "ควรดูก่อน" อยู่บนสุด ตามด้วยเนื้อเดิมของ
 * แผงผลกระทบ (ไม่แก้) และส่วนแหล่งข้อมูลท้ายแผง — ทุกอย่างอ่านจาก `ctx` ไม่มี hook ดึงข้อมูลเพิ่ม
 *
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
      <OverviewSummary observations={ctx.observations} atIso={ctx.atIso} onFocusStation={ctx.focusStation} />
      <ActiveAlertBanner state={activeAlerts} authorityNames={authorityNames} />
      <AffectedAuthorityList
        state={affectedAuthorities}
        alerts={activeAlerts.data?.alerts ?? []}
        health={ctx.apiHealth}
        selectedId={selectedAuthorityId}
        onSelect={ctx.setSelectedAuthorityId}
      />
      {/* จังหวัดที่ไม่มีขอบเขตเลยไม่มีรายการให้เลือก — ไม่แสดงการ์ดที่บอกให้ "เลือกจากรายการ" */}
      {affectedAuthorities.coverage === "none" ? null : (
        <ImpactSummaryCard
          authority={selectedAuthority}
          state={localAuthorityImpact}
          health={ctx.apiHealth}
          alerts={selectedAuthorityAlerts}
        />
      )}
      <OverviewSources health={ctx.apiHealth} apiDown={ctx.apiDown} />
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
