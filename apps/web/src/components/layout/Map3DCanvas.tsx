import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type {
  AoiManifest,
  DamObservation,
  EarthquakeEvent,
  FloodExtentResponse,
  ObservationsResponse,
  RadarFramesResponse,
  SourceId,
} from "@siahra/shared-types";
import { buildBoundaryOutline, type BoundaryOutlineResult } from "../../scene/BoundaryOutline";
import { buildBuildingLayer } from "../../scene/BuildingLayer";
import { buildDamMarkers, type DamMarkerResult } from "../../scene/DamMarkers";
import { BuildingTileLayer } from "../../scene/BuildingTiles";
import { FeatureTileLayer } from "../../scene/FeatureTiles";
import { VegetationTiles } from "../../scene/VegetationTiles";
import { buildFloodMask, type FloodMask } from "../../scene/floodMask";
import { RadarOverlay } from "../../scene/RadarOverlay";
import { pickAt, type PickResult } from "../../scene/picking";
import { QualityManager, type QualityLevel, type QualityMode } from "../../scene/quality";
import { InfoPopup } from "../map/InfoPopup";
import { buildEarthquakeMarkers, type EarthquakeMarkerResult } from "../../scene/EarthquakeMarkers";
import { declutterLabels, disposeLabels, makeLabel, makePlaceLabel } from "../../scene/labels";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { AoiNotBuiltError, loadAoiManifest } from "../../scene/loadAoiManifest";
import { DEFAULT_IMAGERY_PROVIDER, loadImagery, planImagery } from "../../scene/SatelliteImagery";
import {
  setupScene,
  type CameraPose,
  type MapTool,
  type SafeArea,
  type SceneHandles,
} from "../../scene/setupScene";
import { buildStationMarkers, type StationMarkerResult } from "../../scene/StationMarkers";
import { buildTerrainMesh, type TerrainField } from "../../scene/TerrainMesh";
import { createTerrainSharedUniforms } from "../../scene/terrainMaterial";
import { disposedTreeCounters, TerrainTileTree, type TerrainTileStats } from "../../scene/TerrainTiles";
import { formatNumber } from "../../lib/number";
import { useLang } from "../../i18n/context";
import type { MessageKey } from "../../i18n";
import { errorMessage, resolveError, type ErrorMessage } from "../../lib/errorMessage";
import { ILLUSTRATIVE_HATCH_PERIOD_PX } from "../../lib/illustrativeStyle";

export interface MapLayers {
  imagery: boolean;
  lowland: boolean;
  hazard: boolean;
  stations: boolean;
  buildings: boolean;
  roads: boolean;
  water: boolean;
  floodExtent: boolean;
  dams: boolean;
  radar: boolean;
  /** Sun and sky follow real (or timeline) time instead of a fixed studio light. */
  sunlight: boolean;
  /** Trees from ESA WorldCover on nearby tiles. */
  trees: boolean;
}

export interface MapInfo {
  demType: string;
  cellSizeM: number;
  /** Set when the province streams native-resolution LOD tiles. */
  nativeCellSizeM: number | null;
  buildingCount: number;
  coverage: "full-aoi" | "urban-core";
  imagery: { sourceId: SourceId; attribution: string; zoom: number; loaded: number; total: number } | null;
  stationCount: number;
  hazardCount: number;
  earthquakeCount: number;
  lowlandShare: number;
  /** Time of the radar frame currently drawn, if any. */
  radarFrameAt: string | null;
}

/** Imperative map controls exposed to the shell (search fly-to, permalink, capture). */
export interface MapApi {
  flyToLonLat: (lon: number, lat: number, distanceM?: number) => void;
  getPose: () => CameraPose | null;
  setPose: (pose: CameraPose) => void;
  captureImage: (footer: string) => Promise<Blob | null>;
}

/**
 * สถานะการโหลดเก็บเป็น "คีย์" ไม่ใช่ข้อความที่แปลแล้ว — ไม่อย่างนั้นข้อความที่ตั้ง
 * ตอนเริ่มโหลดจะค้างเป็นภาษาเดิมเมื่อผู้ใช้กดสลับภาษาระหว่างที่ฉากยังโหลดอยู่
 */
type LoadState =
  | { status: "loading"; labelKey: MessageKey; progress?: number }
  | { status: "ready" }
  | { status: "not-built" }
  | { status: "error"; message: ErrorMessage };

const MAX_STATION_LABELS = 10;

export function Map3DCanvas({
  aoiId,
  observations,
  earthquakes,
  floodExtent,
  dams,
  radar,
  atIso,
  exaggeration,
  layers,
  tool,
  safeArea,
  observationsStale = false,
  initialPose,
  quality,
  onQualityLevel,
  onSceneReady,
  onInfo,
  onApi,
}: {
  aoiId: string;
  observations: ObservationsResponse | null;
  earthquakes: EarthquakeEvent[];
  floodExtent: FloodExtentResponse | null;
  dams: DamObservation[];
  radar: RadarFramesResponse | null;
  /** Timeline position (null = live). */
  atIso: string | null;
  /** Camera pose to restore (permalink) instead of the default framing. */
  initialPose?: CameraPose | null;
  quality: QualityMode;
  onQualityLevel?: (level: QualityLevel, mode: QualityMode) => void;
  onApi?: (api: MapApi | null) => void;
  exaggeration: number;
  layers: MapLayers;
  tool: MapTool;
  safeArea: SafeArea;
  /** Dim station markers/halos when the source is stale or unreachable. */
  observationsStale?: boolean;
  onSceneReady?: (handles: SceneHandles | null) => void;
  onInfo?: (info: MapInfo | null) => void;
}) {
  const { lang, t } = useLang();
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<LoadState>({
    status: "loading",
    labelKey: "scene.loadingTerrain",
  });
  const [imageryProgress, setImageryProgress] = useState<number | null>(null);
  const [tileStats, setTileStats] = useState<TerrainTileStats | null>(null);

  // Terrain is loaded once per AOI; markers refresh independently as
  // observations poll, so they need their own handles rather than a reload.
  const sceneRef = useRef<SceneHandles | null>(null);
  const terrainRef = useRef<{
    manifest: AoiManifest;
    terrain: TerrainField;
    imagery: THREE.Texture | null;
    tiles: TerrainTileTree | null;
    buildingTiles: BuildingTileLayer | null;
    featureTiles: FeatureTileLayer | null;
    vegetation: VegetationTiles | null;
  } | null>(null);
  const buildingsRef = useRef<THREE.Mesh | null>(null);
  const boundaryRef = useRef<BoundaryOutlineResult | null>(null);
  const markersRef = useRef<StationMarkerResult | null>(null);
  const labelsRef = useRef<THREE.Group | null>(null);
  const quakesRef = useRef<EarthquakeMarkerResult | null>(null);
  const floodMaskRef = useRef<FloodMask | null>(null);
  const damsRef = useRef<DamMarkerResult | null>(null);
  const radarRef = useRef<RadarOverlay | null>(null);
  const qualityRef = useRef<QualityManager | null>(null);
  const qualityCbRef = useRef(onQualityLevel);
  qualityCbRef.current = onQualityLevel;
  const [pick, setPick] = useState<PickResult | null>(null);
  const popupDivRef = useRef<HTMLDivElement | null>(null);
  const pickRef = useRef<PickResult | null>(null);
  pickRef.current = pick;
  const floodFeaturesRef = useRef(floodExtent?.features ?? []);
  floodFeaturesRef.current = floodExtent?.features ?? [];
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const floodLabelsRef = useRef<THREE.Group | null>(null);
  const infoRef = useRef<MapInfo | null>(null);
  const safeAreaRef = useRef(safeArea);
  safeAreaRef.current = safeArea;
  const initialPoseRef = useRef(initialPose ?? null);
  initialPoseRef.current = initialPose ?? null;

  const publishInfo = (patch: Partial<MapInfo>) => {
    if (!infoRef.current) return;
    infoRef.current = { ...infoRef.current, ...patch };
    onInfo?.(infoRef.current);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let handles: SceneHandles | null = null;
    const abort = new AbortController();
    let terrainField: TerrainField | null = null;

    (async () => {
      try {
        handles = setupScene(container);
        sceneRef.current = handles;
        onSceneReady?.(handles);
        const quality = new QualityManager(handles, null);
        quality.onLevel = (level, mode) => qualityCbRef.current?.(level, mode);
        qualityRef.current = quality;
        handles.addTicker(() => quality.tick(performance.now()));

        // Click-to-inspect (select tool): a press+release with little movement.
        let downAt: { x: number; y: number; t: number } | null = null;
        const onDown = (e: PointerEvent) => {
          if (e.button !== 0) return;
          downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
        };
        const onUp = (e: PointerEvent) => {
          if (!downAt || e.button !== 0) return;
          const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
          const held = performance.now() - downAt.t;
          downAt = null;
          if (moved > 5 || held > 600 || toolRef.current !== "select") return;
          const h = sceneRef.current;
          const loaded = terrainRef.current;
          if (!h || !loaded) return;
          const rect = container.getBoundingClientRect();
          const ndc = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1,
          );
          const terrainObjects: THREE.Object3D[] = loaded.tiles ? [loaded.tiles.group] : [loaded.terrain.mesh];
          const result = pickAt(h, ndc, {
            projection: loaded.terrain.projection,
            terrainObjects,
            quakeGroup: quakesRef.current?.group ?? null,
            floodFeatures: floodFeaturesRef.current,
          });
          setPick(result);
        };
        container.addEventListener("pointerdown", onDown);
        container.addEventListener("pointerup", onUp);
        const origDispose = handles.dispose;
        handles.dispose = () => {
          container.removeEventListener("pointerdown", onDown);
          container.removeEventListener("pointerup", onUp);
          origDispose();
        };

        const manifest = await loadAoiManifest(aoiId);
        if (cancelled || !handles) return;

        const pyramid = manifest.terrain.tiles ?? null;
        const plan = pyramid
          ? null
          : planImagery(manifest, handles.renderer.capabilities.maxTextureSize, DEFAULT_IMAGERY_PROVIDER);

        // The overview heightfield always loads: it drives framing, the hazard
        // overlay and ground sampling. With a tile pyramid it is not drawn —
        // the LOD tiles are the surface.
        const shared = createTerrainSharedUniforms();
        const terrain = await buildTerrainMesh(manifest, plan, shared);
        if (cancelled || !handles) {
          terrain.dispose();
          return;
        }
        terrainField = terrain;
        let tree: TerrainTileTree | null = null;
        let buildingTiles: BuildingTileLayer | null = null;
        let featureTiles: FeatureTileLayer | null = null;
        let vegetation: VegetationTiles | null = null;
        if (pyramid) {
          tree = new TerrainTileTree({
            manifest,
            projection: terrain.projection,
            shared,
            minZ: pyramid.minZ,
            maxZ: pyramid.maxZ,
          });
          tree.onStats = (st) => {
            if (!cancelled) setTileStats(st);
          };
          quality.setTree(tree);
          // ตัวนับ LOD สำหรับ DEV — ให้ QA นับการสลับ split/merge และคู่
          // created/disposed ของ mesh ได้ แทนที่จะดูด้วยตา (registry ถูกล้าง
          // ใน handles.dispose() จึงไม่ต้องถอนเอง)
          if (import.meta.env.DEV) {
            const t = tree;
            handles.debug.register("lod", () => t.lodCounters);
            handles.debug.register("lodDisposedTrees", () => disposedTreeCounters);
          }
          handles.world.add(tree.group);
          if (manifest.buildings?.tiles) {
            buildingTiles = new BuildingTileLayer(manifest, terrain.projection);
            handles.world.add(buildingTiles.group);
          }
          if (manifest.features) {
            featureTiles = new FeatureTileLayer(
              manifest,
              terrain.projection,
              shared.uTime,
              shared.uOverlay,
            );
            handles.world.add(featureTiles.roadsGroup);
            handles.world.add(featureTiles.waterGroup);
          }
          if (manifest.landcover) {
            vegetation = new VegetationTiles(manifest, terrain.projection, tree);
            handles.world.add(vegetation.group);
          }
        } else {
          handles.world.add(terrain.mesh);
        }
        handles.frameTerrain(manifest, terrain.minZ, safeAreaRef.current);
        if (initialPoseRef.current) handles.setPose(initialPoseRef.current);
        terrainRef.current = { manifest, terrain, imagery: null, tiles: tree, buildingTiles, featureTiles, vegetation };
        const proj = terrain.projection;
        const h0 = handles;
        onApi?.({
          flyToLonLat: (lon, lat, distanceM) => {
            const [x, z] = proj.lonLatToLocal(lon, lat);
            const y = terrain.sample(x, z) * h0.world.scale.y;
            h0.flyTo(new THREE.Vector3(x, y, z), distanceM);
          },
          getPose: () => h0.getPose(),
          setPose: (pose) => h0.setPose(pose),
          captureImage: (footer) => h0.captureImage(footer),
        });
        infoRef.current = {
          demType: manifest.terrain.demType,
          cellSizeM: manifest.terrain.cellSizeM,
          nativeCellSizeM: pyramid?.leafCellSizeM ?? null,
          buildingCount: buildingTiles?.count ?? manifest.buildings?.count ?? 0,
          coverage: buildingTiles ? "full-aoi" : (manifest.buildings?.coverage ?? "full-aoi"),
          imagery: tree
            ? { sourceId: tree.imagerySourceId, attribution: tree.attribution, zoom: -1, loaded: 0, total: 0 }
            : null,
          stationCount: 0,
          hazardCount: 0,
          earthquakeCount: 0,
          lowlandShare: terrain.overlay.lowlandShare,
          radarFrameAt: null,
        };
        onInfo?.(infoRef.current);

        const radarOverlay = new RadarOverlay(shared, terrain.projection);
        radarOverlay.onFrame = (t) => publishInfo({ radarFrameAt: t });
        radarRef.current = radarOverlay;

        // Animated water shimmer / hazard pulse + label declutter.
        const h = handles;
        const frameDistance = h.controls.maxDistance / 2.2;
        // LOD re-evaluation and label declutter are the CPU-heavy part of the
        // frame. While the camera moves they must keep up with it, but on a
        // still camera nothing they compute can change, so they drop to 10 Hz
        // (a heartbeat that still picks up tiles streaming in).
        const HEAVY_IDLE_INTERVAL_MS = 100;
        let heavyAt = 0;
        handles.addTicker((t) => {
          terrain.material.uniforms.uTime.value = t;
          radarOverlay.tick(performance.now());
          const heavy =
            h.isCameraActive() || performance.now() - heavyAt >= HEAVY_IDLE_INTERVAL_MS;
          if (heavy) heavyAt = performance.now();
          if (tree && heavy) {
            tree.update(h.camera, h.world.scale.y, container.clientHeight);
            const keys = tree.visibleTileKeys();
            const now = performance.now();
            buildingTiles?.update(keys, h.camera, h.world.scale.y, now);
            featureTiles?.update(keys, h.camera, h.world.scale.y, now);
            vegetation?.update(keys, h.camera, now);
          }
          const d = h.camera.position.distanceTo(h.controls.target) / frameDistance;
          terrain.material.uniforms.uDetailFade.value = THREE.MathUtils.lerp(
            0.4,
            1,
            THREE.MathUtils.smoothstep(d, 0.12, 0.45),
          );
          // ลายเส้นของชั้น "ภาพประกอบ" วัดเป็นพิกเซลบนจอ จึงต้องคูณ pixelRatio
          // ที่ preset คุณภาพเปลี่ยนได้ตลอด (scene/quality.ts) ให้ระยะห่างบนจอ
          // เท่ากับสัญลักษณ์ใน legend เสมอ
          terrain.material.uniforms.uHatchPx.value =
            ILLUSTRATIVE_HATCH_PERIOD_PX * h.renderer.getPixelRatio();
          if (heavy) {
            const all: CSS2DObject[] = [];
            const collect = (g: THREE.Object3D | null | undefined) =>
              g?.traverse((o) => {
                if (o instanceof CSS2DObject) all.push(o);
              });
            collect(labelsRef.current);
            collect(floodLabelsRef.current);
            collect(damsRef.current?.labels);
            collect(quakesRef.current?.group);
            if (all.length > 0) {
              declutterLabels(all, h.camera, container.clientWidth, container.clientHeight);
            }
          }
        });

        // Imagery streams in behind the terrain — the map is usable at once.
        // (With LOD tiles each tile fetches its own imagery instead.)
        if (plan) {
        setImageryProgress(0);
        void loadImagery(
          plan,
          `${aoiId}:${plan.provider.id}:${plan.zoom}`,
          (done, total) => {
            if (!cancelled) setImageryProgress(Math.round((done / total) * 100));
          },
          abort.signal,
        )
          .then((result) => {
            if (cancelled) {
              result.texture.dispose();
              return;
            }
            if (terrainRef.current) terrainRef.current.imagery = result.texture;
            terrain.material.setImagery(result.texture);
            setImageryProgress(null);
            publishInfo({
              imagery: {
                sourceId: plan.provider.sourceId,
                attribution: plan.provider.attribution,
                zoom: plan.zoom,
                loaded: result.loadedTiles,
                total: result.totalTiles,
              },
            });
          })
          .catch(() => {
            if (!cancelled) setImageryProgress(null);
          });
        }

        // The province polygon renders as soon as the ground is known.
        const outline = await buildBoundaryOutline(manifest, terrain.sample);
        if (cancelled || !handles) return;
        if (outline) {
          boundaryRef.current = outline;
          handles.world.add(outline.group);
          handles.onResize(outline.setResolution);
        }

        // Legacy urban-core footprints only when the province has no
        // building tile pyramid (tiles stream on their own).
        if (!buildingTiles) {
          setState({ status: "loading", labelKey: "scene.buildingBuild", progress: 0 });
          const buildings = await buildBuildingLayer(manifest, terrain.sample, (done, total) => {
            if (cancelled) return;
            setState({
              status: "loading",
              labelKey: "scene.buildingBuild",
              progress: total > 0 ? Math.round((done / total) * 100) : 0,
            });
          });
          if (cancelled || !handles) return;
          if (buildings) {
            buildingsRef.current = buildings.mesh;
            handles.world.add(buildings.mesh);
          }
        }

        setState({ status: "ready" });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AoiNotBuiltError) {
          setState({ status: "not-built" });
          return;
        }
        setState({
          status: "error",
          message: errorMessage(err, "scene.loadError"),
        });
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
      setPick(null);
      onApi?.(null);
      onSceneReady?.(null);
      onInfo?.(null);
      infoRef.current = null;
      sceneRef.current = null;
      if (buildingsRef.current) {
        buildingsRef.current.geometry.dispose();
        (buildingsRef.current.material as THREE.Material).dispose();
      }
      buildingsRef.current = null;
      boundaryRef.current?.dispose();
      boundaryRef.current = null;
      markersRef.current?.dispose();
      markersRef.current = null;
      if (labelsRef.current) disposeLabels(labelsRef.current);
      labelsRef.current = null;
      quakesRef.current?.dispose();
      quakesRef.current = null;
      floodMaskRef.current?.dispose();
      floodMaskRef.current = null;
      if (damsRef.current) disposeLabels(damsRef.current.labels);
      damsRef.current?.dispose();
      damsRef.current = null;
      radarRef.current?.dispose();
      radarRef.current = null;
      qualityRef.current = null;
      if (floodLabelsRef.current) disposeLabels(floodLabelsRef.current);
      floodLabelsRef.current = null;
      // The imagery texture may be detached from the material (layer off),
      // so dispose it explicitly as well.
      terrainRef.current?.imagery?.dispose();
      terrainRef.current?.tiles?.dispose();
      terrainRef.current?.buildingTiles?.dispose();
      terrainRef.current?.featureTiles?.dispose();
      terrainRef.current?.vegetation?.dispose();
      terrainRef.current = null;
      terrainField?.dispose();
      handles?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aoiId, onSceneReady, onInfo, onApi]);

  // Rebuild station markers + observed-hazard halos whenever observations refresh.
  useEffect(() => {
    const handles = sceneRef.current;
    const loaded = terrainRef.current;
    if (!handles || !loaded || !observations) return;
    const { manifest, terrain } = loaded;

    if (markersRef.current) {
      handles.markers.remove(markersRef.current.dots);
      handles.world.remove(markersRef.current.rings);
      markersRef.current.dispose();
      markersRef.current = null;
    }
    if (labelsRef.current) {
      handles.world.remove(labelsRef.current);
      disposeLabels(labelsRef.current);
      labelsRef.current = null;
    }

    const result = buildStationMarkers(
      manifest,
      observations.rainfall,
      observations.waterlevel,
      terrain.sample,
      handles.viewportHeightPx(),
    );
    result.applyExaggeration(handles.getExaggeration());
    handles.markers.add(result.dots);
    handles.world.add(result.rings);
    markersRef.current = result;
    // Idle stations only once the user zooms in past ~half the framing distance.
    const zoomedInDistance = (handles.controls.maxDistance / 2.2) * 0.55;
    const untick = handles.addTicker((t) => {
      result.tick(t);
      result.quietDots.visible =
        handles.camera.position.distanceTo(handles.controls.target) < zoomedInDistance;
    });
    result.dispose = ((orig) => () => {
      untick();
      orig();
    })(result.dispose);

    // Labels for the stations that matter right now (worst first).
    const labels = new THREE.Group();
    labels.name = "station-labels";
    const proj = terrain.projection;
    // ชื่อสถานีมาจากต้นทาง (nameTh/nameEn) — เลือกฟิลด์ตามภาษา ไม่ได้แปลเอง
    const stationLabel = (st: { nameTh: string | null; nameEn: string | null; id: number }) =>
      (lang === "th" ? (st.nameTh ?? st.nameEn) : (st.nameEn ?? st.nameTh)) ??
      t("water.stationFallback", { id: st.id });
    const candidates: { lon: number; lat: number; title: string; sub: string; tone: "warning" | "severe"; rank: number }[] = [];
    for (const w of observations.waterlevel) {
      const lvl = w.situationLevel ?? 0;
      if (w.situationLevel === null) {
        // Historical snapshot: only freeboard is known.
        if (w.freeboardM === null || w.freeboardM > 1) continue;
        candidates.push({
          lon: w.station.lon,
          lat: w.station.lat,
          title: stationLabel(w.station),
          sub:
            w.freeboardM <= 0
              ? t("scene.aboveBankHistorical", { n: Math.abs(w.freeboardM).toFixed(2) })
              : t("scene.belowBankHistorical", { n: w.freeboardM.toFixed(2) }),
          tone: w.freeboardM <= 0 ? "severe" : "warning",
          rank: w.freeboardM <= 0 ? 100 : 60,
        });
        continue;
      }
      if (lvl < 4) continue;
      candidates.push({
        lon: w.station.lon,
        lat: w.station.lat,
        title: stationLabel(w.station),
        sub: lvl >= 5 ? t("scene.overflowObserved") : t("scene.highWaterObserved"),
        tone: lvl >= 5 ? "severe" : "warning",
        rank: lvl >= 5 ? 100 : 60,
      });
    }
    for (const r of observations.rainfall) {
      const mm = r.rain24h ?? 0;
      if (mm < 35) continue;
      candidates.push({
        lon: r.station.lon,
        lat: r.station.lat,
        title: stationLabel(r.station),
        sub: t("scene.rain24h", { n: mm.toFixed(0) }),
        tone: mm >= 90 ? "severe" : "warning",
        rank: mm,
      });
    }
    candidates.sort((a, b) => b.rank - a.rank);
    let placed = 0;
    for (const c of candidates) {
      if (placed >= MAX_STATION_LABELS) break;
      const [x, z] = proj.lonLatToLocal(c.lon, c.lat);
      if (!proj.insideGrid(x, z)) continue;
      labels.add(
        makeLabel(c.title, c.sub, c.tone, new THREE.Vector3(x, terrain.sample(x, z) + 30, z), c.rank),
      );
      placed++;
    }
    // District names, placed at the centroid of that district's stations —
    // a label-placement convenience, not an official district centre. Only
    // districts with a couple of stations get one so the position is sane.
    const byAmphoe = new Map<string, { lon: number; lat: number; n: number }>();
    const stationRefs = [
      ...observations.waterlevel.map((w) => w.station),
      ...observations.rainfall.map((r) => r.station),
    ];
    for (const st of stationRefs) {
      if (!st.amphoeNameTh) continue;
      const acc = byAmphoe.get(st.amphoeNameTh) ?? { lon: 0, lat: 0, n: 0 };
      acc.lon += st.lon;
      acc.lat += st.lat;
      acc.n += 1;
      byAmphoe.set(st.amphoeNameTh, acc);
    }
    for (const [name, acc] of byAmphoe) {
      if (acc.n < 2) continue;
      const [x, z] = proj.lonLatToLocal(acc.lon / acc.n, acc.lat / acc.n);
      if (!proj.insideGrid(x, z)) continue;
      // Bangkok's districts are เขต, everywhere else อำเภอ.
      const prefix = t(manifest.provinceCode === "10" ? "province.prefix.khet" : "province.prefix.amphoe");
      const display = /^(อ\.|เขต|อำเภอ)/.test(name) ? name : `${prefix}${name}`;
      labels.add(
        makePlaceLabel(display, new THREE.Vector3(x, terrain.sample(x, z) + 20, z), -100 + acc.n),
      );
    }
    handles.world.add(labels);
    labelsRef.current = labels;

    const { haloCount } = terrain.overlay.updateObserved(
      observations.rainfall,
      observations.waterlevel,
    );
    publishInfo({ stationCount: result.visibleCount, hazardCount: haloCount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observations, state.status, lang, t]);

  // Earthquake epicentres inside the province.
  useEffect(() => {
    const handles = sceneRef.current;
    const loaded = terrainRef.current;
    if (!handles || !loaded) return;
    if (quakesRef.current) {
      handles.world.remove(quakesRef.current.group);
      disposeLabels(quakesRef.current.group);
      quakesRef.current.dispose();
      quakesRef.current = null;
    }
    const result = buildEarthquakeMarkers(loaded.manifest, earthquakes, loaded.terrain.sample, t);
    if (result.count > 0) {
      handles.world.add(result.group);
      const untick = handles.addTicker(result.tick);
      const orig = result.dispose;
      result.dispose = () => {
        untick();
        orig();
      };
      quakesRef.current = result;
    } else {
      result.dispose();
    }
    publishInfo({ earthquakeCount: result.count });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earthquakes, state.status, t]);

  // Popup follows its 3D anchor: projected every frame onto the container
  // (kept out of CSS2DRenderer so it always paints above the map labels).
  useEffect(() => {
    const handles = sceneRef.current;
    const container = containerRef.current;
    if (!handles || !container) return;
    const v = new THREE.Vector3();
    return handles.addTicker(() => {
      const el = popupDivRef.current;
      const p = pickRef.current;
      if (!el || !p) return;
      v.copy(p.anchor);
      v.y *= handles.world.scale.y;
      v.project(handles.camera);
      const x = ((v.x + 1) / 2) * container.clientWidth;
      const y = ((1 - v.y) / 2) * container.clientHeight;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, calc(-100% - 14px))`;
      el.style.visibility = v.z > 1 ? "hidden" : "visible";
    });
  }, [state.status]);

  const closePopup = useCallback(() => setPick(null), []);

  useEffect(() => {
    qualityRef.current?.setMode(quality);
  }, [quality, state.status]);

  // Sun/sky follow real time or the timeline time (re-evaluated each minute).
  useEffect(() => {
    const handles = sceneRef.current;
    const loaded = terrainRef.current;
    if (!handles || !loaded) return;
    const b = loaded.manifest.bbox;
    const lat = (b.minLat + b.maxLat) / 2;
    const lon = (b.minLon + b.maxLon) / 2;
    if (!layers.sunlight) {
      handles.setSunTime(null, lat, lon);
      return;
    }
    const apply = () => handles.setSunTime(atIso ? new Date(atIso) : new Date(), lat, lon);
    apply();
    const timer = window.setInterval(apply, 60000);
    return () => window.clearInterval(timer);
  }, [layers.sunlight, atIso, state.status]);

  // Radar frames / timeline position.
  useEffect(() => {
    radarRef.current?.setFrames(radar);
  }, [radar, state.status]);
  useEffect(() => {
    radarRef.current?.setAt(atIso);
  }, [atIso, state.status]);

  // Reservoir markers.
  useEffect(() => {
    const handles = sceneRef.current;
    const loaded = terrainRef.current;
    if (!handles || !loaded) return;
    if (damsRef.current) {
      handles.markers.remove(damsRef.current.dots);
      handles.world.remove(damsRef.current.labels);
      disposeLabels(damsRef.current.labels);
      damsRef.current.dispose();
      damsRef.current = null;
    }
    if (dams.length === 0) return;
    const result = buildDamMarkers(loaded.manifest, dams, loaded.terrain.sample, handles.viewportHeightPx(), lang, t);
    result.applyExaggeration(handles.getExaggeration());
    result.dots.visible = layers.dams;
    result.labels.visible = layers.dams;
    handles.markers.add(result.dots);
    handles.world.add(result.labels);
    damsRef.current = result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dams, state.status, lang, t]);

  // GISTDA satellite flood extent -> shader mask + tambon labels.
  useEffect(() => {
    const handles = sceneRef.current;
    const loaded = terrainRef.current;
    if (!handles || !loaded) return;
    const u = loaded.terrain.material.uniforms;
    floodMaskRef.current?.dispose();
    floodMaskRef.current = null;
    if (floodLabelsRef.current) {
      handles.world.remove(floodLabelsRef.current);
      disposeLabels(floodLabelsRef.current);
      floodLabelsRef.current = null;
    }
    const features = floodExtent?.features ?? [];
    if (features.length === 0) {
      u.uFloodMask.value = null;
      u.uShowFlood.value = 0;
      return;
    }
    const mask = buildFloodMask(loaded.manifest, features, loaded.terrain.insideMask);
    if (!mask) return;
    floodMaskRef.current = mask;
    u.uFloodMask.value = mask.texture;
    u.uShowFlood.value = layers.floodExtent ? 1 : 0;

    const labels = new THREE.Group();
    labels.name = "flood-labels";
    const proj = loaded.terrain.projection;
    // Label the largest flooded tambons; the rest are visible as the tint.
    const top = [...features]
      .sort((a, b) => (b.properties.floodAreaRai ?? 0) - (a.properties.floodAreaRai ?? 0))
      .slice(0, 10);
    for (const f of top) {
      const { lat, lon, tambonTh, floodAreaRai } = f.properties;
      if (lat === null || lon === null) continue;
      const [x, z] = proj.lonLatToLocal(lon, lat);
      if (!proj.insideGrid(x, z)) continue;
      labels.add(
        makeLabel(
          tambonTh ?? t("scene.floodArea"),
          floodAreaRai !== null
            ? t("scene.floodAreaRai", { n: formatNumber(lang, Math.round(floodAreaRai)) })
            : t("scene.floodPlain"),
          "info",
          new THREE.Vector3(x, loaded.terrain.sample(x, z) + 30, z),
          40 + (floodAreaRai ?? 0) / 1000,
        ),
      );
    }
    handles.world.add(labels);
    labels.visible = layers.floodExtent;
    floodLabelsRef.current = labels;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floodExtent, state.status, lang, t]);

  useEffect(() => {
    const handles = sceneRef.current;
    if (!handles) return;
    handles.setExaggeration(exaggeration);
    markersRef.current?.applyExaggeration(exaggeration);
    damsRef.current?.applyExaggeration(exaggeration);
  }, [exaggeration, state.status]);

  useEffect(() => {
    sceneRef.current?.setTool(tool);
  }, [tool, state.status]);

  useEffect(() => {
    markersRef.current?.setDimmed(observationsStale);
    const u = terrainRef.current?.terrain.material.uniforms;
    if (u) u.uHazardStale.value = observationsStale ? 1 : 0;
    if (labelsRef.current) labelsRef.current.visible = layers.stations && !observationsStale;
  }, [observationsStale, observations, layers.stations, state.status]);

  useEffect(() => {
    const loaded = terrainRef.current;
    if (loaded) {
      const u = loaded.terrain.material.uniforms;
      u.uShowLowland.value = layers.lowland ? 1 : 0;
      u.uShowHazard.value = layers.hazard ? 1 : 0;
      const desired = layers.imagery ? loaded.imagery : null;
      if (loaded.terrain.material.material.map !== desired) loaded.terrain.material.setImagery(desired);
      loaded.tiles?.setImageryEnabled(layers.imagery);
      u.uShowFlood.value = layers.floodExtent && floodMaskRef.current ? 1 : 0;
      if (damsRef.current) {
        damsRef.current.dots.visible = layers.dams;
        damsRef.current.labels.visible = layers.dams;
      }
      radarRef.current?.setEnabled(layers.radar);
      loaded.vegetation?.setEnabled(layers.trees);
      if (floodLabelsRef.current) floodLabelsRef.current.visible = layers.floodExtent;
      if (loaded.buildingTiles) loaded.buildingTiles.group.visible = layers.buildings;
      if (loaded.featureTiles) {
        loaded.featureTiles.roadsGroup.visible = layers.roads;
        loaded.featureTiles.waterGroup.visible = layers.water;
      }
    }
    if (markersRef.current) {
      markersRef.current.dots.visible = layers.stations;
      markersRef.current.rings.visible = layers.stations;
    }
    if (labelsRef.current) labelsRef.current.visible = layers.stations;
    if (buildingsRef.current) buildingsRef.current.visible = layers.buildings;
  }, [layers, state.status, imageryProgress]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="map-sky absolute inset-0" />
      {pick ? (
        <div ref={popupDivRef} className="pointer-events-none absolute top-0 left-0 z-30 will-change-transform">
          <InfoPopup pick={pick} onClose={closePopup} />
        </div>
      ) : null}

      {state.status === "loading" ||
      imageryProgress !== null ||
      (tileStats !== null && tileStats.visible === 0 && tileStats.loading + tileStats.pending > 0) ? (
        <div className="pointer-events-none absolute top-24 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-black/80 px-4 py-2 shadow-lg backdrop-blur-md">
          <div
            className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-[var(--color-accent)]"
            aria-hidden="true"
          />
          <p className="text-xs text-white/90">
            {state.status === "loading" ? (
              <>
                {t(state.labelKey)}
                {typeof state.progress === "number" ? (
                  <span className="tabular-nums text-white/60"> {state.progress}%</span>
                ) : null}
              </>
            ) : null}
            {state.status === "loading" && imageryProgress !== null ? " · " : ""}
            {imageryProgress !== null ? (
              <>
                {t("scene.loadingImagery")}{" "}
                <span className="tabular-nums text-white/60">{imageryProgress}%</span>
              </>
            ) : null}
            {state.status !== "loading" && imageryProgress === null && tileStats?.visible === 0
              ? t("scene.loadingHiRes")
              : null}
          </p>
        </div>
      ) : null}

      {state.status === "not-built" ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
          <p className="text-sm text-[var(--color-fg-muted)]">
            {t("scene.notBuiltTitle")}
          </p>
          <p className="text-xs text-[var(--color-fg-subtle)]">
            {t("scene.notBuiltBody")}
          </p>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="max-w-sm rounded-xl border border-red-400/30 bg-black/80 px-4 py-3 text-center text-sm text-red-300 backdrop-blur-md">
            {resolveError(t, state.message)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
