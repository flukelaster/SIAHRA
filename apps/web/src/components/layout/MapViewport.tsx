import { Hand, Maximize2, Minimize2, Minus, MousePointer2, Navigation, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type {
  DamObservation,
  EarthquakeEvent,
  FloodExtentResponse,
  ObservationsResponse,
  RadarFramesResponse,
} from "@siahra/shared-types";
import type { CameraPose, MapTool, SafeArea, SceneHandles } from "../../scene/setupScene";
import { IconButton } from "../ui/Panel";
import { Map3DCanvas, type MapApi, type MapInfo, type MapLayers } from "./Map3DCanvas";
import type { QualityLevel, QualityMode } from "../../scene/quality";

const ZOOM_FACTOR = 0.75;

function handlesHeading(h: SceneHandles): number {
  const dx = h.camera.position.x - h.controls.target.x;
  const dz = h.camera.position.z - h.controls.target.z;
  return ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360;
}

export function MapViewport({
  aoiId,
  provinceLabel,
  observations,
  earthquakes,
  floodExtent,
  dams,
  radar,
  atIso,
  layers,
  safeArea,
  observationsStale = false,
  initialPose,
  exaggeration,
  quality,
  onQualityLevel,
  compact = false,
  onInfo,
  onApi,
  onPoseChange,
}: {
  compact?: boolean;
  exaggeration: number;
  quality: QualityMode;
  onQualityLevel?: (level: QualityLevel, mode: QualityMode) => void;
  aoiId: string;
  provinceLabel: string;
  initialPose?: CameraPose | null;
  onApi?: (api: MapApi | null) => void;
  /** Throttled camera pose updates (permalink). */
  onPoseChange?: (pose: CameraPose) => void;
  observations: ObservationsResponse | null;
  earthquakes: EarthquakeEvent[];
  floodExtent: FloodExtentResponse | null;
  dams: DamObservation[];
  radar: RadarFramesResponse | null;
  atIso: string | null;
  layers: MapLayers;
  safeArea: SafeArea;
  observationsStale?: boolean;
  onInfo?: (info: MapInfo | null) => void;
}) {
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

  const rightEdge = `calc(${safeArea.right}px + 0.25rem)`;
  const leftEdge = `calc(${safeArea.left}px + 0.25rem)`;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <Map3DCanvas
        key={aoiId}
        aoiId={aoiId}
        observations={observations}
        earthquakes={earthquakes}
        floodExtent={floodExtent}
        dams={dams}
        radar={radar}
        atIso={atIso}
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

      {/* Province title */}
      <div
        className="pointer-events-none absolute"
        style={{ top: safeArea.top + 8, left: leftEdge }}
      >
        <h2 className={`${compact ? "text-lg" : "text-[26px]"} leading-tight font-bold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]`}>
          จังหวัด{provinceLabel}
        </h2>
        <p className="text-sm text-white/75 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
          มุมมอง 3 มิติ · ภูมิประเทศจริง
        </p>
        {info?.radarFrameAt ? (
          <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-0.5 text-[11px] text-white/85 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            เรดาร์ฝน TMD{" "}
            {new Date(info.radarFrameAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.
          </p>
        ) : null}
      </div>

      {/* Compass + tools, hugging the right dock */}
      <div
        className="absolute flex flex-col items-center gap-2"
        style={{ top: safeArea.top + 8, right: rightEdge }}
      >
        <button
          type="button"
          onClick={() => sceneRef.current?.resetNorth()}
          title="หันกลับทิศเหนือ"
          aria-label="หันกลับทิศเหนือ"
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
          <IconButton label="หมุน/เอียงมุมมอง" active={tool === "select"} onClick={() => setTool("select")}>
            <MousePointer2 size={16} />
          </IconButton>
          <IconButton label="เลื่อนแผนที่" active={tool === "pan"} onClick={() => setTool("pan")}>
            <Hand size={16} />
          </IconButton>
          <div className="my-0.5 h-px bg-white/10" />
          <IconButton label="ซูมเข้า" onClick={() => dolly(ZOOM_FACTOR)}>
            <Plus size={16} />
          </IconButton>
          <IconButton label="ซูมออก" onClick={() => dolly(1 / ZOOM_FACTOR)}>
            <Minus size={16} />
          </IconButton>
          <div className="my-0.5 h-px bg-white/10" />
          <IconButton label={fullscreen ? "ออกจากเต็มหน้าจอ" : "เต็มหน้าจอ"} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </IconButton>
        </div>
      </div>

    </div>
  );
}
