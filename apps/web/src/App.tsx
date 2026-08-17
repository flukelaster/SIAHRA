import { useCallback, useMemo, useRef, useState } from "react";
import { BottomBar } from "./components/layout/BottomBar";
import type { MapApi, MapInfo, MapLayers } from "./components/layout/Map3DCanvas";
import { MapViewport } from "./components/layout/MapViewport";
import { ExaggerationControl } from "./components/layout/ExaggerationControl";
import { SourceStatusBar } from "./components/layout/SourceStatusBar";
import { RightPanel } from "./components/layout/RightPanel";
import { Sidebar } from "./components/layout/Sidebar";
import { TopBar, type SearchPlace } from "./components/layout/TopBar";
import { PROVINCES } from "./data/provinces";
import { aoiIdForProvince } from "./data/types";
import { useApiHealth, sourceStatus } from "./hooks/useApiHealth";
import { useEarthquakeFeed } from "./hooks/useEarthquakeFeed";
import { useDams } from "./hooks/useDams";
import { useFloodExtent } from "./hooks/useFloodExtent";
import { useRadar } from "./hooks/useRadar";
import { TimelineBar } from "./components/layout/TimelineBar";
import { useObservations } from "./hooks/useObservations";
import { readPermalink, usePermalinkSync } from "./hooks/usePermalink";
import { useViewport } from "./hooks/useViewport";
import { MobileSheet } from "./components/layout/MobileSheet";
import { ProvinceSelector } from "./components/layout/ProvinceSelector";
import { MapLegend } from "./components/layout/MapLegend";
import { FloodExtentCard } from "./components/hazard/FloodExtentCard";
import { WaterLevelCard } from "./components/hazard/WaterLevelCard";
import { RainfallCard } from "./components/hazard/RainfallCard";
import { DamCard } from "./components/hazard/DamCard";
import { EarthquakeLiveCard } from "./components/hazard/EarthquakeLiveCard";
import { BRAND, DATA_ATTRIBUTION_TH } from "./branding";
import type { CameraPose } from "./scene/setupScene";
import type { QualityLevel, QualityMode } from "./scene/quality";

const DEFAULT_PROVINCE_CODE = "10"; // Bangkok

/** Floating-panel geometry (CSS px). The map itself is always full-bleed. */
const GUTTER = 12;
const TOPBAR_H = 60;
const LEFT_W = 272;
const RIGHT_W = 352;
/** Initial guess for the bottom dock height; the dock reports its real size once mounted. */
const BOTTOM_DOCK_H = 276;
/** Compact mode: status row + timeline stacked above the sheet. */
const COMPACT_DOCK_H = 120;

const DEFAULT_LAYERS: MapLayers = {
  imagery: true,
  lowland: true,
  hazard: true,
  stations: true,
  buildings: true,
  roads: true,
  water: true,
  floodExtent: true,
  dams: true,
  radar: true,
  sunlight: true,
  trees: true,
};

/** Parsed once at startup; a shared link restores province, camera, layers and time. */
const INITIAL = readPermalink();

export default function App() {
  const [provinceCode, setProvinceCode] = useState(INITIAL.provinceCode ?? DEFAULT_PROVINCE_CODE);
  const [layers, setLayers] = useState<MapLayers>(() => {
    if (!INITIAL.layers) return DEFAULT_LAYERS;
    const on = new Set(INITIAL.layers);
    return Object.fromEntries(Object.keys(DEFAULT_LAYERS).map((k) => [k, on.has(k)])) as unknown as MapLayers;
  });
  /** null = live; otherwise an ISO time the map is scrubbed back to. */
  const [atIso, setAtIso] = useState<string | null>(INITIAL.atIso);
  const [exaggeration, setExaggeration] = useState(INITIAL.exaggeration ?? 1);
  const [pose, setPose] = useState<CameraPose | null>(INITIAL.pose);
  const [mapInfo, setMapInfo] = useState<MapInfo | null>(null);
  const [dockHeight, setDockHeight] = useState(BOTTOM_DOCK_H);
  const [quality, setQuality] = useState<QualityMode>("auto");
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>("high");
  const handleQualityLevel = useCallback((level: QualityLevel) => setQualityLevel(level), []);
  const initialPoseRef = useRef<CameraPose | null>(INITIAL.pose);
  const mapApiRef = useRef<MapApi | null>(null);
  const handleApi = useCallback((api: MapApi | null) => {
    mapApiRef.current = api;
    // The restored pose is only for the very first load; a province switch reframes.
    if (api) initialPoseRef.current = null;
  }, []);
  const handlePose = useCallback((p: CameraPose) => setPose(p), []);
  const province = useMemo(
    () => PROVINCES.find((p) => p.code === provinceCode) ?? PROVINCES[0],
    [provinceCode],
  );
  const observations = useObservations(provinceCode, atIso);
  const dams = useDams(provinceCode);
  const radar = useRadar(layers.radar);
  const earthquakes = useEarthquakeFeed();
  const apiHealth = useApiHealth();
  const floodExtent = useFloodExtent(provinceCode);
  const thaiwater = sourceStatus(apiHealth.health, "thaiwater");
  // Stale/failed station data is drawn dimmed so nobody reads an old reading as current.
  const observationsStale =
    apiHealth.apiDown || (thaiwater !== null && thaiwater.health !== "ok");
  const aoiId = aoiIdForProvince(provinceCode);

  const toggleLayer = useCallback((key: keyof MapLayers, value: boolean) => {
    setLayers((l) => ({ ...l, [key]: value }));
  }, []);

  usePermalinkSync({ provinceCode, pose, exaggeration, layers: { ...layers }, atIso });

  const selectProvince = useCallback((code: string) => {
    initialPoseRef.current = null;
    setPose(null);
    setProvinceCode(code);
  }, []);

  // Search index: amphoe centroids (from station coordinates), stations, dams of this province.
  const places = useMemo<SearchPlace[]>(() => {
    const out: SearchPlace[] = [];
    const data = observations.data;
    if (data) {
      const byAmphoe = new Map<string, { lon: number; lat: number; n: number }>();
      const seen = new Set<string>();
      for (const st of [...data.waterlevel.map((w) => w.station), ...data.rainfall.map((r) => r.station)]) {
        if (st.amphoeNameTh) {
          const a = byAmphoe.get(st.amphoeNameTh) ?? { lon: 0, lat: 0, n: 0 };
          a.lon += st.lon;
          a.lat += st.lat;
          a.n++;
          byAmphoe.set(st.amphoeNameTh, a);
        }
        // Rain and water-level ids overlap upstream; key on name+coords instead.
        const key = `s:${st.nameTh ?? st.id}:${st.lon.toFixed(4)}:${st.lat.toFixed(4)}`;
        if (st.nameTh && !seen.has(key)) {
          seen.add(key);
          out.push({ key, label: st.nameTh, sub: st.amphoeNameTh ?? province.nameTh, kind: "station", lon: st.lon, lat: st.lat });
        }
      }
      for (const [name, a] of byAmphoe) {
        out.push({ key: `a:${name}`, label: (provinceCode === "10" ? "เขต" : "อ.") + name, sub: province.nameTh, kind: "amphoe", lon: a.lon / a.n, lat: a.lat / a.n });
      }
    }
    for (const d of dams.data?.dams ?? []) {
      out.push({ key: `d:${d.id}`, label: (d.kind === "large" ? "เขื่อน" : "") + (d.nameTh ?? d.nameEn ?? `#${d.id}`), sub: d.basinNameTh ?? province.nameTh, kind: "dam", lon: d.lon, lat: d.lat });
    }
    return out;
  }, [observations.data, dams.data, province.nameTh, provinceCode]);

  const selectPlace = useCallback((pl: SearchPlace) => {
    const dist = pl.kind === "amphoe" ? 12000 : 4000;
    mapApiRef.current?.flyToLonLat(pl.lon, pl.lat, dist);
  }, []);

  const share = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      return true;
    } catch {
      return false;
    }
  }, []);

  const snapshot = useCallback(async () => {
    const api = mapApiRef.current;
    if (!api) return;
    const stamp = new Date().toLocaleString("th-TH");
    const footer = `${BRAND.name} · จังหวัด${province.nameTh} · ${stamp}${atIso ? ` · ค่าย้อนหลัง ${new Date(atIso).toLocaleString("th-TH")}` : ""} · ${DATA_ATTRIBUTION_TH} · ภาพดาวเทียม Esri`;
    const blob = await api.captureImage(footer);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `siahra-${province.nameEn.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}.png`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [province, atIso]);

  const viewport = useViewport();
  const compact = viewport.compact;
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetHeight = Math.round(viewport.height * 0.45);
  const dockTop = GUTTER + TOPBAR_H + GUTTER;
  const safeArea = useMemo(
    () =>
      compact
        ? {
            left: 8,
            right: 8,
            top: dockTop,
            bottom: (sheetOpen ? sheetHeight : 44) + 12 + COMPACT_DOCK_H,
          }
        : {
            left: GUTTER + LEFT_W + GUTTER,
            right: GUTTER + RIGHT_W + GUTTER,
            top: dockTop,
            bottom: GUTTER + dockHeight,
          },
    [dockTop, compact, sheetOpen, sheetHeight, dockHeight],
  );

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[var(--color-bg)]">
      <MapViewport
        aoiId={aoiId}
        provinceLabel={province.nameTh}
        observations={observations.data}
        earthquakes={earthquakes.events}
        floodExtent={floodExtent.data}
        dams={dams.data?.dams ?? []}
        radar={radar.data}
        atIso={atIso}
        layers={layers}
        safeArea={safeArea}
        observationsStale={observationsStale}
        initialPose={initialPoseRef.current}
        exaggeration={exaggeration}
        quality={quality}
        onQualityLevel={handleQualityLevel}
        compact={compact}
        onInfo={setMapInfo}
        onApi={handleApi}
        onPoseChange={handlePose}
      />

      <TopBar
        provinces={PROVINCES}
        places={places}
        onSelectProvince={selectProvince}
        onSelectPlace={selectPlace}
        onShare={share}
        onSnapshot={() => void snapshot()}
        height={TOPBAR_H}
        compact={compact}
      />

      {compact ? (
        <>
          <div
            className="absolute z-10 flex flex-col gap-2 @container"
            style={{ left: 8, right: 8, bottom: (sheetOpen ? sheetHeight : 44) + 12 }}
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0">
                <SourceStatusBar state={apiHealth} compact />
              </div>
              <div className="ml-auto shrink-0">
                <ExaggerationControl value={exaggeration} onChange={setExaggeration} />
              </div>
            </div>
            <TimelineBar atIso={atIso} onChange={setAtIso} />
          </div>
          <MobileSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            height={sheetHeight}
            tabs={[
              {
                key: "province",
                label: "จังหวัด",
                content: (
                  <ProvinceSelector provinces={PROVINCES} selected={province} onSelect={(p) => selectProvince(p.code)} />
                ),
              },
              {
                key: "layers",
                label: "ชั้นข้อมูล",
                content: (
                  <MapLegend
                    layers={layers}
                    onToggle={toggleLayer}
                    quality={quality}
                    qualityLevel={qualityLevel}
                    onQualityChange={setQuality}
                  />
                ),
              },
              { key: "flood", label: "น้ำท่วม", content: <FloodExtentCard state={floodExtent} /> },
              {
                key: "water",
                label: "ระดับน้ำ",
                content: (
                  <WaterLevelCard
                    stations={observations.data?.waterlevel ?? []}
                    loading={observations.loading}
                    attribution={observations.data?.summary.sourceAttribution ?? null}
                    observedAt={observations.data?.summary.latestObservedAt ?? null}
                    historical={atIso !== null}
                  />
                ),
              },
              {
                key: "rain",
                label: "ฝน",
                content: (
                  <RainfallCard
                    stations={observations.data?.rainfall ?? []}
                    loading={observations.loading}
                    attribution={observations.data?.summary.sourceAttribution ?? null}
                  />
                ),
              },
              { key: "dams", label: "เขื่อน", content: <DamCard state={dams} /> },
              { key: "quake", label: "แผ่นดินไหว", content: <EarthquakeLiveCard feed={earthquakes} /> },
            ]}
          />
        </>
      ) : (
        <>
          <Sidebar
            provinces={PROVINCES}
            selected={province}
            onSelect={(p) => selectProvince(p.code)}
            observations={observations.data}
            layers={layers}
            onToggleLayer={toggleLayer}
            quality={quality}
            qualityLevel={qualityLevel}
            onQualityChange={setQuality}
            width={LEFT_W}
            top={dockTop}
          />

          <RightPanel
            observations={observations}
            earthquakes={earthquakes}
            floodExtent={floodExtent}
            dams={dams}
            atIso={atIso}
            width={RIGHT_W}
            top={dockTop}
          />

          <BottomBar
            summary={observations.data?.summary ?? null}
            loading={observations.loading}
            apiHealth={apiHealth}
            mapInfo={mapInfo}
            exaggeration={exaggeration}
            onExaggerationChange={setExaggeration}
            atIso={atIso}
            onAtIsoChange={setAtIso}
            left={safeArea.left}
            right={safeArea.right}
            bottom={GUTTER}
            onHeight={setDockHeight}
          />
        </>
      )}
    </div>
  );
}
