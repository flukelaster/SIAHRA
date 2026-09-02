import { Hand, Layers, Maximize2, Minimize2, Minus, MousePointer2, Navigation, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type {
  DamObservation,
  EarthquakeEvent,
  FloodExtentResponse,
  ObservationSummary,
  ObservationsResponse,
  ProvinceExposureResponse,
  RadarFramesResponse,
} from "@siahra/shared-types";
import type { CameraPose, MapTool, SafeArea, SceneHandles } from "../../scene/setupScene";
import type { FloodField } from "../../scene/floodField";
import { IconButton } from "../ui/Panel";
import { Map3DCanvas, type MapApi, type MapInfo, type MapLayers } from "./Map3DCanvas";
import { StatPills } from "./StatPills";
import type { ForecastBandLevel } from "../../lib/forecastStyle";
import { GUTTER, TOOLS_W, type Tier } from "../../lib/shellLayout";
import type { QualityLevel, QualityMode } from "../../scene/quality";
import { formatDateTime, formatTime } from "../../lib/time";
import { useLang } from "../../i18n/context";

const ZOOM_FACTOR = 0.75;

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
  floodFieldDim = false,
  dams,
  radar,
  exposure,
  exposureStale = false,
  atIso,
  forecastAtIso = null,
  forecastBandLevel = null,
  layers,
  safeArea,
  observationsStale = false,
  initialPose,
  exaggeration,
  quality,
  onQualityLevel,
  tier,
  onInfo,
  onApi,
  onPoseChange,
  onOpenLayers,
}: {
  /**
   * ชั้นของเปลือกหน้าต่าง — `phone` ไม่มีหัวข้อ/StatPills บนแผนที่เลย (ย้ายไป
   * `MobileSheet`) และคอลัมน์เครื่องมือเกาะขวาล่างเหลือ 4 ปุ่ม
   */
  tier: Tier;
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
  floodFieldDim?: boolean;
  dams: DamObservation[];
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
  onInfo?: (info: MapInfo | null) => void;
  /** มือถือ: ปุ่ม "ชั้นข้อมูล" บนคอลัมน์เครื่องมือ — ไม่ส่ง = ไม่มีปุ่ม */
  onOpenLayers?: () => void;
}) {
  const { lang, t } = useLang();
  const compact = tier === "phone";
  const [tool, setTool] = useState<MapTool>("select");
  const [heading, setHeading] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [info, setInfo] = useState<MapInfo | null>(null);
  const sceneRef = useRef<SceneHandles | null>(null);
  const unsubHeading = useRef<(() => void) | null>(null);

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
  const titleRight = GUTTER + TOOLS_W + GUTTER;

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
        floodFieldDim={floodFieldDim}
        dams={dams}
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
          </div>
        </div>
      )}

      {/* Compass + tools, anchored to the viewport's right gutter.
          มือถือ: เกาะ **ขวาล่าง** เหนือส่วน peek ของแผ่นเลื่อน และเหลือ 4 ปุ่ม —
          orbit/pan ไม่มีความหมายบนจอสัมผัสอีกแล้ว (นิ้วเดียวเลื่อน สองนิ้วหมุน/ก้มเงย)
          และ fullscreen ใช้ไม่ได้บน iOS Safari ของ iPhone ส่วนปุ่ม "ชั้นข้อมูล"
          เข้ามาแทนเพราะบนมือถือมันอยู่ลึกกว่าเดิมหนึ่งชั้น
          z-10 ชัดเจน: ตอนเป็น z-auto มันถูก dock (z-10) ทับจนกดไม่ได้บนจอเตี้ย */}
      {compact ? (
        <div
          className="absolute z-10 flex flex-col items-center gap-1.5"
          style={{ bottom: safeArea.bottom + 8, right: toolsRight }}
        >
          {onOpenLayers ? (
            <button
              type="button"
              onClick={onOpenLayers}
              title={t("panel.layers")}
              aria-label={t("panel.layers")}
              className="glass-soft flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-white/90 transition-colors hover:text-white"
            >
              <Layers size={16} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => sceneRef.current?.resetNorth()}
            title={t("viewport.north")}
            aria-label={t("viewport.north")}
            className="glass-soft flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-white/90 transition-colors hover:text-white"
          >
            <span
              className="relative flex h-7 w-7 items-center justify-center rounded-full border border-white/15"
              style={{ transform: `rotate(${-heading}deg)`, transition: "transform 120ms linear" }}
            >
              <Navigation size={14} className="-translate-y-[1px] fill-red-400 text-red-400" aria-hidden="true" />
              <span className="absolute -top-[8px] text-[7px] font-bold text-white/90">N</span>
            </span>
          </button>
          <div className="glass-soft flex flex-col gap-1.5 rounded-xl p-1.5">
            <IconButton label={t("viewport.zoomIn")} onClick={() => dolly(ZOOM_FACTOR)}>
              <Plus size={16} />
            </IconButton>
            <IconButton label={t("viewport.zoomOut")} onClick={() => dolly(1 / ZOOM_FACTOR)}>
              <Minus size={16} />
            </IconButton>
          </div>
        </div>
      ) : (
        <div
          className="absolute flex flex-col items-center gap-2"
          style={{ top: safeArea.top + 8, right: toolsRight }}
        >
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

    </div>
  );
}
