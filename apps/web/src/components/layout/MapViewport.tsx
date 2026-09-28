import { Hand, Layers, MapPinPlus, Maximize2, Minimize2, Minus, MousePointer2, Navigation, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import type {
  Camera,
  CameraSourceId,
  DamObservation,
  EarthquakeEvent,
  FloodExtentResponse,
  NorthRouteStationState,
  NorthRouteTopology,
  ObservationSummary,
  ObservationsResponse,
  ProvinceExposureResponse,
  RadarFramesResponse,
} from "@siahra/shared-types";
import type { CameraPose, MapTool, SafeArea, SceneHandles } from "../../scene/setupScene";
import type { CatalogueProbe } from "../../hooks/useCameraCatalogues";
import type { FloodField } from "../../scene/floodField";
import { IconButton } from "../ui/Panel";
import {
  Map3DCanvas,
  type CommunityActions,
  type CommunityMapState,
  type MapApi,
  type MapInfo,
  type MapLayers,
} from "./Map3DCanvas";
import { StatPills } from "./StatPills";
import { FloodSourceAgeChip } from "./FloodSourceAgeChip";
import type { FloodSourceAgeInput } from "../../lib/floodSourceAge";
import type { ForecastBandLevel } from "../../lib/forecastStyle";
import { GUTTER, phoneToolsBottom, type SheetSnap, type Tier } from "../../lib/shellLayout";
import {
  PHONE_FAB_TOOLS_GAP,
  TITLE_RIGHT,
  phoneBadgeRight,
  placingHintBox,
  reportFabHeightPx,
  reportFabPlacement,
  reportFabVisible,
  type FabBox,
  type FabSize,
} from "../../lib/reportFab";
import { useViewport } from "../../hooks/useViewport";
import { ENABLED_CAMERA_SOURCES } from "../../lib/featureFlags";
import { countLayersOn } from "../../lib/layerCount";
import { LAYERS_DIALOG_ID } from "./LayersSurface";
import { ILLUSTRATIVE_HATCH_DUTY, ILLUSTRATIVE_HATCH_PERIOD_PX, illustrativeCss } from "../../lib/illustrativeStyle";
import { stationSheetCss } from "../../lib/floodStyle";
import type { QualityLevel, QualityMode } from "../../scene/quality";
import { formatDateTime, formatTime } from "../../lib/time";
import { useLang } from "../../i18n/context";
import { isTypingTarget } from "../../hooks/useShellState";

const ZOOM_FACTOR = 0.75;
/** "แตะบนพื้นที่แผนที่" ค้างไว้นานเท่านี้หลังแตะพลาด (ท้องฟ้า/นอกกริด) */
const PLACE_MISS_MS = 2500;
/** ความกว้างเส้นของลายบนป้าย "แผ่นน้ำจำลอง" — คาบ/สัดส่วนเดียวกับลายบนแผ่นจริง */
const SHEET_BADGE_STRIPE_PX = ILLUSTRATIVE_HATCH_PERIOD_PX * ILLUSTRATIVE_HATCH_DUTY;

function handlesHeading(h: SceneHandles): number {
  const dx = h.camera.position.x - h.controls.target.x;
  const dz = h.camera.position.z - h.controls.target.z;
  return ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360;
}

export function MapViewport({
  aoiId,
  provinceLabel,
  summary,
  summaryLoading = false,
  observations,
  earthquakes,
  floodExtent,
  floodField = null,
  floodSceneId = null,
  floodSceneObservedAt = null,
  floodFieldDim = false,
  gistdaDim = false,
  dams,
  cameras,
  cameraProbes,
  radar,
  exposure,
  exposureStale = false,
  atIso,
  forecastAtIso = null,
  forecastBandLevel = null,
  layers,
  safeArea,
  observationsStale = false,
  northRouteTopology = null,
  northRouteStations = null,
  community = null,
  communityActions = null,
  floodAge = null,
  initialPose,
  exaggeration,
  quality,
  onQualityLevel,
  tier,
  sheetSnap = "peek",
  onInfo,
  onApi,
  onPoseChange,
  onOpenLayers,
  onToggleLayers,
  layersOpen = false,
  layersButtonRef,
}: {
  /**
   * ชั้นของเปลือกหน้าต่าง — `phone` ไม่มีหัวข้อ/StatPills บนแผนที่เลย (ย้ายไป
   * `MobileSheet`) และคอลัมน์เครื่องมือเกาะขวาล่างเหลือ 2 ปุ่ม (ชั้นข้อมูล + เข็มทิศ)
   */
  tier: Tier;
  /**
   * E18.4 — ระดับของแผ่นเลื่อน (มือถือเท่านั้น): ที่ half/full คอลัมน์เครื่องมือยกขึ้นเหนือขอบบนของแผ่น
   * ที่ half (`phoneToolsBottom`) ปุ่มชั้นข้อมูลจึงไม่ถูกแผ่นบังที่ half อีก
   */
  sheetSnap?: SheetSnap;
  exaggeration: number;
  quality: QualityMode;
  onQualityLevel?: (level: QualityLevel, mode: QualityMode) => void;
  aoiId: string;
  provinceLabel: string;
  /** ตัวเลขสรุปของจังหวัด (pill ใต้ชื่อ) — null = ยังไม่มี/โหลดไม่สำเร็จ */
  summary: ObservationSummary | null;
  summaryLoading?: boolean;
  initialPose?: CameraPose | null;
  onApi?: (api: MapApi | null) => void;
  /** Throttled camera pose updates (permalink). */
  onPoseChange?: (pose: CameraPose) => void;
  observations: ObservationsResponse | null;
  earthquakes: EarthquakeEvent[];
  floodExtent: FloodExtentResponse | null;
  /** ฉาก Copernicus GFM ที่ถอดแล้ว (E14.F4) — ส่งต่อให้ Map3DCanvas ตรง ๆ */
  floodField?: FloodField | null;
  floodSceneId?: string | null;
  /** เวลาบันทึกภาพของฉากที่วาด — popup ของจุดบนแผนที่ (E14.F5) */
  floodSceneObservedAt?: string | null;
  floodFieldDim?: boolean;
  /** E16 B-2 — แหล่ง GISTDA ค้าง/ติดต่อไม่ได้ → แผ่นน้ำ GISTDA หรี่ลง */
  gistdaDim?: boolean;
  dams: DamObservation[];
  /** กล้องทุกแหล่งที่โหลดได้ (E15/E15.3) — ส่งต่อให้ Map3DCanvas; undefined/ว่าง = ไม่มีหมุด */
  cameras?: readonly Camera[];
  /** เวลา/vantage ของ probe ต่อแหล่ง — ป้ายในแผงกล้อง */
  cameraProbes?: Partial<Record<CameraSourceId, CatalogueProbe>>;
  radar: RadarFramesResponse | null;
  /** run ล่าสุดของ "ระดับการเผชิญน้ำ (ภาพประกอบ)" — null = ยังไม่มี/ชั้นถูกปิด */
  exposure: ProvinceExposureResponse | null;
  /** true = ไม่มีผลคำนวณรอบใหม่ → ชั้นหรี่ลง ไม่ใช่หายไป */
  exposureStale?: boolean;
  atIso: string | null;
  /** ขั้นพยากรณ์รายชั่วโมงที่กำลังเลือกอยู่ใน ForecastStrip (E12.4b) — ส่งต่อ
   *  ให้ Map3DCanvas หรี่หมุดสถานีเท่านั้น (ตัวแถบเองมาจาก forecastBandLevel) */
  forecastAtIso?: string | null;
  /** แถบฝนพยากรณ์รายวัน (TMD) ที่คำนวณไว้แล้วใน App.tsx — null = ไม่วาดแถบ */
  forecastBandLevel?: ForecastBandLevel | null;
  layers: MapLayers;
  safeArea: SafeArea;
  observationsStale?: boolean;
  /** เส้นทางน้ำเหนือ (E16 B-1) — ส่งต่อให้ Map3DCanvas ตรง ๆ */
  northRouteTopology?: NorthRouteTopology | null;
  northRouteStations?: readonly NorthRouteStationState[] | null;
  /** รายงานจากประชาชน — ส่งต่อให้ Map3DCanvas ตรง ๆ (null = ชั้นปิด/ยังไม่เคยได้รายการ) */
  community?: CommunityMapState | null;
  /** ส่ง/โหวต/ลบรายงาน — null = ไม่มีปุ่ม "รายงานผลกระทบ" */
  communityActions?: CommunityActions | null;
  /** ชิปอายุแหล่งน้ำท่วมจากดาวเทียม — null = ไม่แสดง (ชั้นน้ำท่วมทั้งสองปิดอยู่) */
  floodAge?: FloodSourceAgeInput | null;
  onInfo?: (info: MapInfo | null) => void;
  /** ป้าย "แผ่นน้ำจำลอง" เปิดชั้นข้อมูล (legend + หมายเหตุเต็ม) — ไม่ส่ง = ป้ายเป็นข้อความเฉย ๆ */
  onOpenLayers?: () => void;
  /** ปุ่ม "ชั้นข้อมูล" บนคอลัมน์เครื่องมือ (ทุก tier) — ไม่ส่ง = ไม่มีปุ่ม */
  onToggleLayers?: () => void;
  /** popover/แผ่นล่างของชั้นข้อมูลเปิดอยู่ (`aria-expanded` + สถานะ active ของปุ่ม) */
  layersOpen?: boolean;
  /** ปุ่มชั้นข้อมูล — popover/แผ่นล่างคืนโฟกัสให้ และไม่นับเป็น "คลิกนอกกรอบ" */
  layersButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { lang, t } = useLang();
  const compact = tier === "phone";
  const [tool, setTool] = useState<MapTool>("select");
  const [heading, setHeading] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [info, setInfo] = useState<MapInfo | null>(null);
  const sceneRef = useRef<SceneHandles | null>(null);
  const unsubHeading = useRef<(() => void) | null>(null);

  // โหมดปักหมุดรายงาน — ไม่ใช่ `MapTool` ตัวที่สาม (เครื่องมือเปลี่ยนแค่การลากของเมาส์ ส่วนนี้เปลี่ยนความหมายของ
  // การแตะ) ผูกกับจังหวัดที่เปิดโหมด: สลับจังหวัด = แผนที่ถูก remount (หมุดชั่วคราว/ฟอร์มหาย) และโหมดจบไปด้วย
  const [placingAoi, setPlacingAoi] = useState<string | null>(null);
  const placing = communityActions !== null && placingAoi === aoiId;
  const [draftPlaced, setDraftPlaced] = useState(false);
  const [placeMiss, setPlaceMiss] = useState(false);
  /** แผงกล้อง/แผงรายงานด้านขวาเปิดอยู่ (`Map3DCanvas`) — ปุ่ม "รายงานผลกระทบ" หลบ (ซ่อน) ระหว่างนั้น */
  const [infoSheetOpen, setInfoSheetOpen] = useState(false);
  const endPlacing = useCallback(() => {
    setPlacingAoi(null);
    setPlaceMiss(false);
    setDraftPlaced(false);
  }, []);
  const handlePlaceMiss = useCallback(() => setPlaceMiss(true), []);
  const handleDraftChange = useCallback((placed: boolean) => {
    setDraftPlaced(placed);
    setPlaceMiss(false);
  }, []);
  useEffect(() => {
    if (!placeMiss) return;
    const timer = window.setTimeout(() => setPlaceMiss(false), PLACE_MISS_MS);
    return () => window.clearTimeout(timer);
  }, [placeMiss]);
  // Escape ยกเลิกโหมด (ไม่ทำงานขณะพิมพ์) — ฟอร์มที่เปิดอยู่ปิดตัวเองก่อนใน capture (`RightSheet`) แล้ว
  // preventDefault ไว้; ที่นี่ฟังบน document แบบ bubble จึงวิ่งก่อนตัวของ `useShellState` บน window และ
  // preventDefault เองเช่นกัน: Escape หนึ่งครั้งไม่หุบ drawer/แผ่นเลื่อนไปด้วย
  useEffect(() => {
    if (!placing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return;
      e.preventDefault();
      endPlacing();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [placing, endPlacing]);
  const togglePlacing = () => {
    setPlaceMiss(false);
    setDraftPlaced(false);
    setPlacingAoi((cur) => (cur === aoiId ? null : aoiId));
  };

  // ปุ่มลอย "รายงานผลกระทบ" — มุมขวาล่าง แยกจากคอลัมน์เครื่องมือมุมมอง (ข้อตัดสินใจเจ้าของ 2026-09-28: ไอคอนเปล่า
  // ในคอลัมน์ดูเหมือนเครื่องมือมุมมอง) ระหว่างปักหมุดกลายเป็นปุ่ม "ยกเลิก" (สลับด้วย `togglePlacing` ตัวเดิม)
  // ซ่อนเมื่อแผงด้านขวาเปิด (แผงกล้อง/รายงาน หรือฟอร์ม = หมุดชั่วคราวถูกวางแล้ว) — แผงกินขอบขวาลงมาถึงแถวของปุ่ม
  // ขนาดเป็นค่าที่วัด (ป้ายต่างกันตามภาษา/tier/สถานะ) — แถบคำแนะนำหดขอบขวาให้พ้นมัน (`placingHintBox`)
  const vp = useViewport();
  const fabVisible = reportFabVisible({
    hasActions: communityActions !== null,
    infoSheetOpen,
    composeOpen: draftPlaced,
  });
  const [fabEl, setFabEl] = useState<HTMLButtonElement | null>(null);
  const [fabSize, setFabSize] = useState<FabSize | null>(null);
  /** ความกว้างตอนแสดงป้ายเต็ม — วัดเฉพาะตอนป้ายเต็ม (ไม่อย่างนั้นสลับไปไอคอนแล้ววัดได้แคบ → กลับมาป้ายเต็ม → วนไม่จบ) */
  const [fabFullWidth, setFabFullWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!fabEl) return;
    const measure = () => {
      const width = fabEl.offsetWidth;
      const height = fabEl.offsetHeight;
      setFabSize((cur) => (cur && cur.width === width && cur.height === height ? cur : { width, height }));
      if (fabEl.dataset.reportFab === "full") setFabFullWidth(width);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(fabEl);
    return () => ro.disconnect();
  }, [fabEl]);
  // คอลัมน์เครื่องมือด้านขวาบน (≥tablet) — วัดจริง: บนจอเตี้ย (tablet แนวนอน 844×390) ปุ่มที่มุมขวาล่างเคยทับปุ่มหมุน
  const [toolsEl, setToolsEl] = useState<HTMLDivElement | null>(null);
  const [toolsBox, setToolsBox] = useState<{ bottom: number; width: number } | null>(null);
  useEffect(() => {
    if (!toolsEl) return;
    const measure = () => {
      const r = toolsEl.getBoundingClientRect();
      const bottom = Math.round(r.bottom);
      const width = Math.round(r.width);
      setToolsBox((cur) => (cur && cur.bottom === bottom && cur.width === width ? cur : { bottom, width }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(toolsEl);
    return () => ro.disconnect();
  }, [toolsEl]);
  const fabHeight = reportFabHeightPx(tier);
  const fabPlacement = compact
    ? null
    : reportFabPlacement({
        tier,
        safeArea,
        viewportW: vp.width,
        viewportH: vp.height,
        fabHeight,
        fullWidth: fabFullWidth,
        tools: toolsEl ? toolsBox : null,
      });
  const fabIconOnly = fabPlacement?.label === "icon";
  const fabMode = placing ? "cancel" : fabIconOnly ? "icon" : compact ? "short" : "full";
  const fab: FabBox | null =
    fabVisible && fabEl && fabSize ? { ...fabSize, right: fabPlacement?.right ?? GUTTER } : null;
  const fabLabel = placing ? t("community.place.cancelAria") : t("community.place.button");
  const reportFab = fabVisible ? (
    <button
      ref={setFabEl}
      type="button"
      onClick={togglePlacing}
      aria-label={fabLabel}
      title={fabLabel}
      aria-pressed={placing}
      data-report-fab={fabMode}
      // สีชมพูเดียวกับหมุด/แถบคำแนะนำของรายงานจากประชาชน ทับบนกระจก (`.glass-soft` ตั้ง background เอง
      // นอก layer ของ Tailwind — ย้อมด้วย background-image แบบ inline จึงไม่ถูกทับ)
      style={{
        height: fabHeight,
        width: fabIconOnly ? fabHeight : undefined,
        backgroundImage: placing
          ? undefined
          : "linear-gradient(rgba(236,72,153,0.26), rgba(236,72,153,0.26))",
      }}
      className={`glass-soft flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full text-sm ${fabIconOnly ? "" : "pr-4 pl-3.5"} font-semibold whitespace-nowrap text-white ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
        placing ? "ring-2 ring-[#ec4899]" : "ring-1 ring-[#ec4899]/70 hover:ring-[#ec4899]"
      }`}
    >
      {placing ? (
        <X size={18} className="shrink-0 text-[#f9a8d4]" aria-hidden="true" />
      ) : (
        <MapPinPlus size={18} className="shrink-0 text-[#f9a8d4]" aria-hidden="true" />
      )}
      {/* ไอคอนอย่างเดียว (ไม่มีที่ทั้งใต้และซ้ายของคอลัมน์) — ชื่อเต็มอยู่ใน aria-label/title */}
      {fabIconOnly ? null : (
        <span className="leading-thai" aria-hidden="true">
          {placing
            ? t("community.place.cancel")
            : compact
              ? t("community.place.buttonShort")
              : t("community.place.button")}
        </span>
      )}
    </button>
  ) : null;

  // ป้าย "แผ่นน้ำจำลอง" — ติดแผนที่ตลอดที่แผ่นถูกวาดอยู่จริง (ชั้น illustrative ต้องบอกตัวเองบนภาพ
  // ไม่ใช่แค่ใน legend) บนมือถือแตะแล้วเปิดแผงชั้นข้อมูล (legend + หมายเหตุเต็ม)
  const sheetBadgeBody = (
    <>
      <span
        className="h-2 w-3 rounded-sm"
        style={{
          background: `repeating-linear-gradient(45deg,${illustrativeCss("light")} 0 ${SHEET_BADGE_STRIPE_PX}px,${stationSheetCss("deep")} ${SHEET_BADGE_STRIPE_PX}px ${ILLUSTRATIVE_HATCH_PERIOD_PX}px)`,
        }}
        aria-hidden="true"
      />
      {t("viewport.sheetBadge")}
    </>
  );
  const sheetBadgeCls =
    "pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-0.5 text-[11px] leading-5 text-white/90 ring-1 ring-white/25 ring-inset backdrop-blur-sm";
  const sheetBadge =
    layers.stationSheet && info?.stationSheet?.drawn ? (
      onOpenLayers ? (
        <button type="button" onClick={onOpenLayers} className={`${sheetBadgeCls} cursor-pointer`}>
          {sheetBadgeBody}
        </button>
      ) : (
        <p className={sheetBadgeCls}>{sheetBadgeBody}</p>
      )
    ) : null;

  // ปุ่ม "ชั้นข้อมูล" — ไอคอน + ป้าย + จำนวนชั้นที่เปิดอยู่ (นับเฉพาะชั้นที่มีแถวใน legend ของ build นี้)
  const layersOn = countLayersOn(layers, ENABLED_CAMERA_SOURCES.length > 0 ? [] : ["cctv"]);
  const layersButton = onToggleLayers ? (
    <button
      ref={layersButtonRef}
      type="button"
      onClick={onToggleLayers}
      aria-label={t("layers.button.aria", { n: layersOn })}
      title={t("layers.button.aria", { n: layersOn })}
      aria-haspopup="dialog"
      aria-expanded={layersOpen}
      aria-controls={layersOpen ? LAYERS_DIALOG_ID : undefined}
      className={`relative flex h-[52px] w-12 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
        layersOpen
          ? "glass-soft text-white ring-1 ring-[var(--color-accent)]/70 ring-inset"
          : "glass-soft text-white/90 hover:text-white"
      }`}
    >
      <Layers size={16} aria-hidden="true" />
      <span className="max-w-full truncate px-0.5 text-[10px] leading-thai" aria-hidden="true">
        {t("panel.layers")}
      </span>
      <span
        className="pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] leading-none font-bold text-white tabular-nums"
        aria-hidden="true"
      >
        {layersOn}
      </span>
    </button>
  ) : null;

  const poseTimer = useRef<number | null>(null);
  const handleSceneReady = useCallback(
    (handles: SceneHandles | null) => {
      unsubHeading.current?.();
      unsubHeading.current = null;
      sceneRef.current = handles;
      if (handles) {
        unsubHeading.current = handles.onCameraChange(() => {
          setHeading(handlesHeading(handles));
          if (poseTimer.current !== null) window.clearTimeout(poseTimer.current);
          poseTimer.current = window.setTimeout(() => onPoseChange?.(handles.getPose()), 500);
        });
      }
    },
    [onPoseChange],
  );

  const handleInfo = useCallback(
    (next: MapInfo | null) => {
      setInfo(next);
      onInfo?.(next);
    },
    [onInfo],
  );

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const dolly = (factor: number) => {
    const handles = sceneRef.current;
    if (!handles) return;
    const { camera, controls } = handles;
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    offset.setLength(
      THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance),
    );
    camera.position.copy(controls.target).add(offset);
    controls.update();
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  const leftEdge = `calc(${safeArea.left}px + 0.25rem)`;
  /** กลุ่มเครื่องมือเกาะขอบขวาของ viewport เสมอ ไม่ใช่ขอบของแผงขวา (ซึ่งไม่มีแล้ว) */
  const toolsRight = GUTTER;
  /** หัวข้อ + pill ห้ามวิ่งใต้กลุ่มเครื่องมือ */
  const titleRight = TITLE_RIGHT;
  const hintBox = placing
    ? placingHintBox({
        tier,
        safeArea,
        viewportW: vp.width,
        fab,
        composeOpen: draftPlaced,
        sheetBadge: sheetBadge !== null,
      })
    : null;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <Map3DCanvas
        key={aoiId}
        aoiId={aoiId}
        observations={observations}
        earthquakes={earthquakes}
        floodExtent={floodExtent}
        floodField={floodField}
        floodSceneId={floodSceneId}
        floodSceneObservedAt={floodSceneObservedAt}
        floodFieldDim={floodFieldDim}
        gistdaDim={gistdaDim}
        dams={dams}
        cameras={cameras}
        cameraProbes={cameraProbes}
        radar={radar}
        exposure={exposure}
        exposureStale={exposureStale}
        atIso={atIso}
        forecastAtIso={forecastAtIso}
        forecastBandLevel={forecastBandLevel}
        exaggeration={exaggeration}
        layers={layers}
        tool={tool}
        safeArea={safeArea}
        observationsStale={observationsStale}
        northRouteTopology={northRouteTopology}
        northRouteStations={northRouteStations}
        community={community}
        communityActions={communityActions}
        placing={placing}
        onPlacingEnd={endPlacing}
        onPlaceMiss={handlePlaceMiss}
        onDraftChange={handleDraftChange}
        onRightSheetChange={setInfoSheetOpen}
        initialPose={initialPose}
        quality={quality}
        onQualityLevel={onQualityLevel}
        onSceneReady={handleSceneReady}
        onInfo={handleInfo}
        onApi={onApi}
      />

      {/* Province title + stat pills (pills เปิด pointer-events เพื่อให้ tooltip ทำงาน)
          บนมือถือทั้งก้อนนี้ไม่มี — ชื่อจังหวัดกับชิปย้อนหลังย้ายไปอยู่แถวสรุปของ
          แผ่นเลื่อน และ StatPills อยู่ใน body ของแผ่น (`MobileSheet`) แทน */}
      {compact ? null : (
        <div
          className="pointer-events-none absolute flex flex-col items-start gap-1"
          style={{ top: safeArea.top + 8, left: leftEdge, right: titleRight }}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-[22px] leading-tight font-bold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
              {t("viewport.province", { name: provinceLabel })}
            </h2>
            {/* กำลังดูค่าย้อนหลัง — ต้องบอกข้างชื่อจังหวัดเสมอ ไม่ใช่รู้ได้เฉพาะในการ์ดระดับน้ำ */}
            {atIso !== null ? (
              <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-[var(--color-risk-medium)]/20 px-2.5 py-0.5 text-[11px] text-[var(--color-risk-medium)] ring-1 ring-[var(--color-risk-medium)]/50 ring-inset backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-risk-medium)]" aria-hidden="true" />
                {t("viewport.historical", { time: formatDateTime(lang, atIso) })}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-white/75 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
            {t("viewport.subtitle")}
          </p>
          <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
            <StatPills summary={summary} loading={summaryLoading} />
            {info?.radarFrameAt ? (
              <p className="inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-0.5 text-[11px] leading-5 text-white/85 backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                {t("viewport.radarFrame", { time: formatTime(lang, info.radarFrameAt) })}
              </p>
            ) : null}
            {floodAge ? <FloodSourceAgeChip input={floodAge} /> : null}
            {sheetBadge}
          </div>
        </div>
      )}

      {/* ชั้นข้อมูล + compass + tools, anchored to the viewport's right gutter.
          ปุ่ม "ชั้นข้อมูล" อยู่บนสุดของคอลัมน์ทุก tier (popover ของมันเปิดชิดซ้ายของคอลัมน์)
          มือถือ: เกาะ **ขวาล่าง** เหนือส่วน peek ของแผ่นเลื่อน (ซึ่งอยู่บนแถบแท็บหัวข้อ) และเหลือ
          2 ปุ่ม — ชั้นข้อมูล + เข็มทิศ: orbit/pan ไม่มีความหมายบนจอสัมผัส (นิ้วเดียวเลื่อน
          สองนิ้วหมุน/ก้มเงย/บีบซูม) ซูมเข้า/ออกจึงไม่ต้องมีปุ่ม และ fullscreen ใช้ไม่ได้บน
          iOS Safari ของ iPhone
          z-10 ชัดเจน: ตอนเป็น z-auto มันถูก dock (z-10) ทับจนกดไม่ได้บนจอเตี้ย */}
      {compact && sheetBadge ? (
        // มุมซ้ายล่างเหนือส่วน peek ของแผ่นเลื่อน — ด้านบนเป็นที่ของ AlertToast (ทับป้ายนี้จนมองไม่เห็น)
        // ด้านขวาเป็นคอลัมน์เครื่องมือ
        <div
          className="pointer-events-none absolute"
          style={{ bottom: safeArea.bottom + 8, left: leftEdge, right: phoneBadgeRight(fab) }}
        >
          {sheetBadge}
        </div>
      ) : null}
      {placing && hintBox ? (
        // แถบคำแนะนำของโหมดปักหมุด — กลางล่างเหนือ dock/ส่วน peek ของแผ่นเลื่อน (ด้านบนเป็นที่ของ AlertToast ซึ่งทับ
        // มันจนมองไม่เห็น) บนมือถือยกขึ้นเหนือป้าย "แผ่นน้ำจำลอง" ที่มุมซ้ายล่าง; ขอบขวาพ้นปุ่ม "ยกเลิก" (FAB) ที่
        // วัดได้และคอลัมน์เครื่องมือ ฟอร์มเปิดแล้ว (จอกว้าง): ชิดซ้ายและจบก่อนขอบซ้ายของแผงฟอร์ม; ไม่มีที่พอ = ไม่แสดง
        // (ฟอร์มมีข้อความ "แตะอีกครั้งเพื่อย้ายหมุด" และปุ่มปิดของตัวเอง) ปุ่ม "ยกเลิก" ของแถบมีเฉพาะตอน FAB ถูกซ่อน —
        // ตอน FAB แสดง FAB คือปุ่มยกเลิก (Escape ยกเลิกได้เสมอ) — กฎทั้งหมดอยู่ใน `placingHintBox`
        <div
          className={`pointer-events-none absolute z-20 flex ${hintBox.align === "start" ? "justify-start" : "justify-center"}`}
          style={{ bottom: hintBox.bottom, left: hintBox.left, right: hintBox.right }}
        >
          <div
            className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-full bg-black/80 pl-3 text-xs text-white shadow-lg ring-1 ring-[#ec4899]/60 ring-inset backdrop-blur-md ${
              hintBox.cancel ? "py-1 pr-1" : "py-2 pr-3.5"
            }`}
            role="status"
            data-report-placing-hint=""
          >
            <MapPinPlus size={14} className="shrink-0 text-[#f9a8d4]" aria-hidden="true" />
            <span className={placeMiss ? "text-[var(--color-risk-medium)]" : undefined}>
              {placeMiss ? t("community.place.miss") : draftPlaced ? t("community.place.move") : t("community.place.hint")}
            </span>
            {hintBox.cancel ? (
              <button
                type="button"
                onClick={endPlacing}
                className="min-h-11 shrink-0 cursor-pointer rounded-full bg-white/10 px-3 md:min-h-8 text-xs text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                {t("community.place.cancel")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {compact ? (
        <div
          className="absolute z-10 flex flex-col items-end"
          style={{
            // FAB "รายงาน" อยู่ล่างสุดของก้อนนี้ คอลัมน์เครื่องมือจึงยกขึ้นเหนือมันเอง และทั้งก้อนเลื่อนตามแผ่นด้วยกัน
            gap: PHONE_FAB_TOOLS_GAP,
            bottom: phoneToolsBottom(sheetSnap, safeArea.bottom),
            right: toolsRight,
            // จังหวะเดียวกับการเข้าที่ของแผ่น (`useSheetDrag` REST_TRANSITION)
            transition: "bottom 260ms cubic-bezier(0.32, 0.72, 0, 1)",
          }}
        >
          <div className="flex flex-col items-center gap-1.5">
            {layersButton}
            <button
              type="button"
              onClick={() => sceneRef.current?.resetNorth()}
              title={t("viewport.north")}
              aria-label={t("viewport.north")}
              className="glass-soft flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-white/90 transition-colors hover:text-white"
            >
              <span
                className="relative flex h-7 w-7 items-center justify-center rounded-full border border-white/15"
                style={{ transform: `rotate(${-heading}deg)`, transition: "transform 120ms linear" }}
              >
                <Navigation size={14} className="-translate-y-[1px] fill-red-400 text-red-400" aria-hidden="true" />
                <span className="absolute -top-[8px] text-[7px] font-bold text-white/90">N</span>
              </span>
            </button>
          </div>
          {reportFab}
        </div>
      ) : (
        <div
          ref={setToolsEl}
          className="absolute flex flex-col items-center gap-2"
          style={{ top: safeArea.top + 8, right: toolsRight }}
        >
          {layersButton}
          <button
            type="button"
            onClick={() => sceneRef.current?.resetNorth()}
            title={t("viewport.north")}
            aria-label={t("viewport.north")}
            className="glass-soft flex h-12 w-12 cursor-pointer items-center justify-center rounded-full text-white/90 transition-colors hover:text-white"
          >
            <span
              className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/15"
              style={{ transform: `rotate(${-heading}deg)`, transition: "transform 120ms linear" }}
            >
              <Navigation size={16} className="-translate-y-[1px] fill-red-400 text-red-400" aria-hidden="true" />
              <span className="absolute -top-[9px] text-[8px] font-bold text-white/90">N</span>
            </span>
          </button>

          <div className="glass-soft flex flex-col gap-1.5 rounded-xl p-1.5">
            <IconButton label={t("viewport.orbit")} active={tool === "select"} onClick={() => setTool("select")}>
              <MousePointer2 size={16} />
            </IconButton>
            <IconButton label={t("viewport.pan")} active={tool === "pan"} onClick={() => setTool("pan")}>
              <Hand size={16} />
            </IconButton>
            <div className="my-0.5 h-px bg-white/10" />
            <IconButton label={t("viewport.zoomIn")} onClick={() => dolly(ZOOM_FACTOR)}>
              <Plus size={16} />
            </IconButton>
            <IconButton label={t("viewport.zoomOut")} onClick={() => dolly(1 / ZOOM_FACTOR)}>
              <Minus size={16} />
            </IconButton>
            <div className="my-0.5 h-px bg-white/10" />
            <IconButton label={fullscreen ? t("viewport.exitFullscreen") : t("viewport.fullscreen")} onClick={toggleFullscreen}>
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </IconButton>
          </div>
        </div>
      )}
      {fabPlacement && reportFab ? (
        // ≥tablet: มุมขวาล่างเหนือ dock (ใต้คอลัมน์เครื่องมือ หรือซ้ายของมันบนจอเตี้ย — `reportFabPlacement`)
        // z-10 ชัดเจนด้วยเหตุผลเดียวกับคอลัมน์เครื่องมือ (dock เป็น z-10)
        <div className="absolute z-10" style={{ right: fabPlacement.right, bottom: fabPlacement.bottom }}>
          {reportFab}
        </div>
      ) : null}

    </div>
  );
}
