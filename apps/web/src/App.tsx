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
import { useLayerDescriptors } from "./hooks/useLayerDescriptors";
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
import { formatFullDateTime } from "./lib/time";
import { damDisplayName } from "./lib/damName";
import { useLang } from "./i18n/context";

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
  const { lang, t } = useLang();
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
  /** ชื่อจังหวัดมาจาก data/provinces.ts ที่มีทั้งสองภาษาอยู่แล้ว */
  const provinceName = lang === "th" ? province.nameTh : province.nameEn;
  const observations = useObservations(provinceCode, atIso);
  const dams = useDams(provinceCode);
  const radar = useRadar(layers.radar);
  const earthquakes = useEarthquakeFeed();
  const apiHealth = useApiHealth();
  const floodExtent = useFloodExtent(provinceCode);
  const thaiwater = sourceStatus(apiHealth.health, "thaiwater");
  // Stale/failed station data is drawn dimmed so nobody reads an old reading as current.
  // เงื่อนไข `!== "ok"` ครอบ `delayed` ด้วยโดยตั้งใจ (E3.3): ต้นทางตอบปกติแต่ค่า
  // ตรวจวัดล่าสุดเก่ากว่าคาบที่ควรเป็น ก็ยังเป็นค่าเก่าที่ห้ามอ่านว่าเป็นปัจจุบัน
  // และรูปแบบนี้ยัง fail-safe กับสถานะใหม่ที่จะเพิ่มเข้ามาในอนาคต
  const observationsStale =
    apiHealth.apiDown || (thaiwater !== null && thaiwater.health !== "ok");
  const aoiId = aoiIdForProvince(provinceCode);
  // ป้ายชนิดความรู้ + เวลาของแต่ละชั้นใน legend มาจาก descriptor ที่ backend ประกาศ
  // (หรือจาก data/staticLayerDescriptors.ts สำหรับชั้นคงที่) — อายุคำนวณตอนเรนเดอร์
  const layerDescriptors = useLayerDescriptors({
    observations,
    radar,
    floodExtent,
    dams,
    health: apiHealth.health,
  });

  const toggleLayer = useCallback((key: keyof MapLayers, value: boolean) => {
    setLayers((l) => ({ ...l, [key]: value }));
  }, []);

  // `lang` ต้องอยู่ในสถานะที่ sync ลง URL ด้วย ไม่งั้นการเปิดลิงก์ `?lang=en`
  // แล้วปล่อยไว้ 400 มิลลิวินาที จะถูก replaceState เขียนทับจนพารามิเตอร์หายไป
  usePermalinkSync({ provinceCode, pose, exaggeration, layers: { ...layers }, atIso, lang });

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
          out.push({ key, label: st.nameTh, sub: st.amphoeNameTh ?? provinceName, kind: "station", lon: st.lon, lat: st.lat });
        }
      }
      for (const [name, a] of byAmphoe) {
        out.push({
          key: `a:${name}`,
          label: t(provinceCode === "10" ? "province.prefix.khet" : "province.prefix.amphoe") + name,
          sub: provinceName,
          kind: "amphoe",
          lon: a.lon / a.n,
          lat: a.lat / a.n,
        });
      }
    }
    for (const d of dams.data?.dams ?? []) {
      out.push({
        key: `d:${d.id}`,
        label: damDisplayName(d, lang, t),
        sub: d.basinNameTh ?? provinceName,
        kind: "dam",
        lon: d.lon,
        lat: d.lat,
      });
    }
    return out;
  }, [observations.data, dams.data, provinceName, provinceCode, lang, t]);

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
    // เวลาที่กดบันทึกภาพ (ไม่ใช่เวลาที่ดึงข้อมูล) — ตรึงเป็นเวลาไทยเช่นกัน
    const stamp = formatFullDateTime(lang, Date.now());
    // DATA_ATTRIBUTION_TH เป็นบรรทัดเครดิตของหน่วยงานต้นทาง จึงคงไว้ตามที่เผยแพร่
    // ทั้งสองภาษา — ส่วนที่เหลือของ footer เดินตามภาษาที่กำลังแสดง
    const footer = `${BRAND.name} · ${t("viewport.province", { name: provinceName })} · ${stamp}${
      atIso ? ` · ${t("attribution.snapshotHistorical", { time: formatFullDateTime(lang, atIso) })}` : ""
    } · ${DATA_ATTRIBUTION_TH} · ${t("attribution.imageryEsri")}`;
    const blob = await api.captureImage(footer);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `siahra-${province.nameEn.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}.png`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [province, provinceName, atIso, lang, t]);

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
        provinceLabel={provinceName}
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
                label: t("sheet.tab.province"),
                content: (
                  <ProvinceSelector provinces={PROVINCES} selected={province} onSelect={(p) => selectProvince(p.code)} />
                ),
              },
              {
                key: "layers",
                label: t("sheet.tab.layers"),
                content: (
                  <MapLegend
                    layers={layers}
                    onToggle={toggleLayer}
                    descriptors={layerDescriptors}
                    quality={quality}
                    qualityLevel={qualityLevel}
                    onQualityChange={setQuality}
                  />
                ),
              },
              { key: "flood", label: t("sheet.tab.flood"), content: <FloodExtentCard state={floodExtent} /> },
              {
                key: "water",
                label: t("sheet.tab.water"),
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
                label: t("sheet.tab.rain"),
                content: (
                  <RainfallCard
                    stations={observations.data?.rainfall ?? []}
                    loading={observations.loading}
                    attribution={observations.data?.summary.sourceAttribution ?? null}
                  />
                ),
              },
              { key: "dams", label: t("sheet.tab.dams"), content: <DamCard state={dams} /> },
              { key: "quake", label: t("sheet.tab.quake"), content: <EarthquakeLiveCard feed={earthquakes} /> },
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
            descriptors={layerDescriptors}
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
