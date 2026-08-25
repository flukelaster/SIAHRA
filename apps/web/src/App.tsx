import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "./components/layout/AppShell";
import type { MapApi, MapInfo, MapLayers } from "./components/layout/Map3DCanvas";
import { MapViewport } from "./components/layout/MapViewport";
import type { PanelContext } from "./components/layout/panelRegistry";
import { PROVINCES } from "./data/provinces";
import { aoiIdForProvince } from "./data/types";
import { useApiHealth, sourceStatus } from "./hooks/useApiHealth";
import { useLayerDescriptors } from "./hooks/useLayerDescriptors";
import { useEarthquakeFeed } from "./hooks/useEarthquakeFeed";
import { useDams } from "./hooks/useDams";
import { useFloodExposure } from "./hooks/useFloodExposure";
import { useFloodExtent } from "./hooks/useFloodExtent";
import { useAffectedAuthorities } from "./hooks/useAffectedAuthorities";
import { useActiveAlerts } from "./hooks/useActiveAlerts";
import { useLocalAuthorityImpact } from "./hooks/useLocalAuthorityImpact";
import { useProvinceForecast } from "./hooks/useProvinceForecast";
import { useRadar } from "./hooks/useRadar";
import { useObservations } from "./hooks/useObservations";
import { readPermalink, usePermalinkSync } from "./hooks/usePermalink";
import { useShellState } from "./hooks/useShellState";
import { BRAND, DATA_ATTRIBUTION_TH } from "./branding";
import type { CameraPose } from "./scene/setupScene";
import type { QualityLevel, QualityMode } from "./scene/quality";
import { formatFullDateTime } from "./lib/time";
import { exposureInputsAreDegraded } from "./lib/exposureInputHealth";
import { computeForecastBandStatus } from "./lib/forecastStyle";
import { buildSearchIndex, type SearchPlace } from "./lib/searchIndex";
import { useLang } from "./i18n/context";

const DEFAULT_PROVINCE_CODE = "10"; // Bangkok

const DEFAULT_LAYERS: MapLayers = {
  imagery: true,
  lowland: true,
  /**
   * E10.4 — ชั้นเดียวที่ **ปิดไว้เป็นค่าเริ่มต้น** ชั้นนี้เป็นสิ่งที่เราคำนวณเอง
   * ไม่ใช่สิ่งที่ใครวัดมา จึงต้องเป็นการกดเปิดของผู้ใช้เสมอ ไม่ใช่ของแถมที่ติดมา
   * (ผลข้างเคียงที่ตั้งใจ: `?layers=` จะปรากฏใน permalink เสมอ เพราะมีชั้นที่ปิดอยู่
   *  หนึ่งชั้น — ซึ่งเป็นความหมายเดิมของพารามิเตอร์นั้นทุกประการ)
   */
  exposure: false,
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
  // ครอบคลุมไม่ครบทุกจังหวัด/อปท. (E11.2) แต่เป็นของจริงที่ OSM แม็ปไว้ ไม่ใช่ข้อมูล
  // เสื่อมคุณภาพที่ต้องซ่อนไว้ก่อน — เปิดเป็นค่าเริ่มต้นได้ ตราบใดที่ legend บอก
  // caveat ความไม่ครบทุกครั้งที่ชั้นนี้แสดงอยู่ (ดู MapLegend.tsx)
  localAuthorities: true,
};

/**
 * ค่าเริ่มต้นในรูป `Record` สำหรับ permalink codec — สร้างครั้งเดียวที่โมดูล ไม่ใช่
 * ทุกเรนเดอร์ (`MapLayers` ไม่มี index signature จึงต้องคัดลอกออกมา)
 */
const DEFAULT_LAYERS_RECORD: Record<string, boolean> = { ...DEFAULT_LAYERS };

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
  // E12.4a — ขั้นพยากรณ์ TMD ที่กำลังเลือกอยู่ใน ForecastStrip; null = ยังไม่ได้
  // เลือก ไม่รีเซ็ตตอนเปลี่ยนจังหวัด เหมือนกับ atIso ข้างบน (ธรรมเนียมเดียวกัน)
  const [forecastAtIso, setForecastAtIso] = useState<string | null>(INITIAL.forecastAtIso);
  const [exaggeration, setExaggeration] = useState(INITIAL.exaggeration ?? 1);
  const [pose, setPose] = useState<CameraPose | null>(INITIAL.pose);
  const [mapInfo, setMapInfo] = useState<MapInfo | null>(null);
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
  // E14.F1 — ชั้นน้ำท่วมดาวเทียมเดินตามเส้นเวลาเดียวกับ observations (ฉากที่ครอบ atIso)
  const floodExtent = useFloodExtent(provinceCode, atIso);
  // ชั้นปิดอยู่ = ไม่ยิงคำขอเลยแม้แต่ครั้งเดียว (รูปแบบเดียวกับ useRadar)
  const exposure = useFloodExposure(provinceCode, layers.exposure);
  // E11.6 — แดชบอร์ดผลกระทบ อปท.: รายชื่อจัดอันดับ + แจ้งเตือนทั้งจังหวัด + ราย
  // ละเอียดของ อปท. ที่เลือกอยู่ (สาม hook อิสระ ผูกกันด้วย provinceCode/id เดียวกัน
  // ตามรูปแบบเดียวกับ observations/earthquakes/floodExtent/dams ด้านบน)
  const affectedAuthorities = useAffectedAuthorities(provinceCode);
  const activeAlerts = useActiveAlerts(provinceCode);
  const [selectedAuthorityId, setSelectedAuthorityId] = useState<string | null>(null);
  const localAuthorityImpact = useLocalAuthorityImpact(selectedAuthorityId);
  // E12.3 — พยากรณ์ TMD ของจังหวัดที่กำลังเลือกอยู่เท่านั้น (ไม่วนทั้ง 77 จังหวัด —
  // ข้อบังคับต้นทุนจาก devops cost gate PR #58 ดู useProvinceForecast.ts)
  const forecast = useProvinceForecast(provinceCode);
  // E12.4b — จุดคำนวณเดียวของ "แถบฝนพยากรณ์รายวัน (TMD)": หาขั้นรายวันของวัน
  // ปฏิทินกรุงเทพฯ เดียวกับ forecastAtIso แล้วจัดแถบ ครั้งเดียวตรงนี้ ไม่ใช่ใน
  // Map3DCanvas.tsx และ MapLegend.tsx แยกกัน (ทั้งสองที่รับผลลัพธ์สำเร็จรูปนี้
  // ไปใช้เท่านั้น ไม่งั้นสองจุดอาจตัดสินไม่ตรงกันได้ถ้าตรรกะเพี้ยนไปทีละที่)
  // forecastAtIso === null (ยังไม่ได้เลือกขั้นใด) → null ตรง ๆ ไม่ผ่านการคำนวณ
  const forecastDaily = forecast.data?.batch?.daily ?? null;
  const forecastBandStatus = useMemo(
    () => (forecastAtIso === null ? null : computeForecastBandStatus(forecastDaily, forecastAtIso)),
    [forecastAtIso, forecastDaily],
  );
  const forecastBandLevel = forecastBandStatus?.kind === "band" ? forecastBandStatus.level : null;
  const forecastLegend = {
    atIso: forecastAtIso,
    firstHourlyIso: forecast.data?.batch?.hourly[0]?.validAt ?? null,
    status: forecastBandStatus,
  };
  const thaiwater = sourceStatus(apiHealth.health, "thaiwater");
  // Stale/failed station data is drawn dimmed so nobody reads an old reading as current.
  // เงื่อนไข `!== "ok"` ครอบ `delayed` ด้วยโดยตั้งใจ (E3.3): ต้นทางตอบปกติแต่ค่า
  // ตรวจวัดล่าสุดเก่ากว่าคาบที่ควรเป็น ก็ยังเป็นค่าเก่าที่ห้ามอ่านว่าเป็นปัจจุบัน
  // และรูปแบบนี้ยัง fail-safe กับสถานะใหม่ที่จะเพิ่มเข้ามาในอนาคต
  //
  // จงใจอ่านเฉพาะสุขภาพของ sub-feed ฝน/ระดับน้ำ (`exposureInputsAreDegraded`) ไม่ใช่
  // `thaiwater.health` โดยรวม (review round 8): `status()` ฝั่ง backend พับ
  // `damsError` เข้า `lastError`/`health` โดยตั้งใจเพื่อให้ SourceStatusBar เห็น
  // ความล้มเหลวของเขื่อน — แต่ผลคือถ้าใช้ `thaiwater.health` ตรงนี้ เขื่อนล่มตัวเดียว
  // (ฝน/ระดับน้ำยังสดปกติ) จะไปหรี่หมุดฝน/ระดับน้ำที่ไม่เกี่ยวข้องเลย ความล้มเหลวของ
  // เขื่อนมีป้ายของตัวเองอยู่แล้วที่ `DamCard` จึงไม่จำเป็นต้องยืมสัญญาณนี้มาบอกซ้ำ
  // ใช้ตัวตัดสินเดียวกับ `exposureInputsDegraded` ด้านล่างเพราะเป็นเกณฑ์เดียวกันเป๊ะ
  // (ทั้งสองจุดต้องการรู้แค่ "ฝนกับระดับน้ำเองยังโอเคอยู่ไหม" ไม่ใช่ ThaiWater โดยรวม)
  const observationsStale = apiHealth.apiDown || exposureInputsAreDegraded(thaiwater);
  // ชั้นการเผชิญน้ำมีแหล่งข้อมูลของตัวเองใน /health (E10.3) — `delayed` คือ "ไม่มี run
  // ใหม่เกิน 30 นาที" ซึ่งต้องหรี่ชั้นและบอกเวลาของรอบล่าสุดเหมือนกับตอนดึงไม่สำเร็จ
  const exposureSource = sourceStatus(apiHealth.health, "exposure-illustrative");
  // เหตุผลของ "ไม่มีรอบใหม่" ที่มาจากตัว exposure/การดึงเอง — เก็บชื่อไว้แยกจากตัว OR
  // รวมด้านล่าง เพราะ legend ต้องบอกเหตุผลได้แม่นกว่า "ไม่มีรอบใหม่" เฉย ๆ (ดูหมายเหตุถัดไป)
  const exposureOwnNoNewRun =
    exposure.failing ||
    apiHealth.apiDown ||
    (exposureSource !== null && exposureSource.health !== "ok");
  // exposure ใช้เฉพาะฝนและระดับน้ำ — ไม่ใช่ทุกอย่างที่ถูกรวมไว้ใต้ source ThaiWater
  // (เช่น error ของเขื่อน) จึงต้องอ่านสุขภาพของสอง sub-feed ตรง ๆ; ค่าที่ขาดจาก
  // backend รุ่นเก่าถูกถือว่าไม่ยืนยัน ไม่ใช่เดาว่าอินพุตพร้อม
  //
  // `exposureOwnNoNewRun` กับ `exposureInputsDegraded` เกิดพร้อมกันได้จริง (ไม่ใช่กรณี
  // แปลก): ThaiWater ล่มทั้งหมด → ObservationCacheDO ไม่เผยแพร่ run ใหม่เลย (own = true)
  // **และ** thaiwater เองก็ผิดปกติ (inputsDegraded = true) พร้อมกัน — ข้อความจึงต้อง
  // เลือกจากทั้งสองสัญญาณแยกกัน ไม่ใช่พับเป็นตัวเดียวแล้วเดาสาเหตุจากมันทีหลัง
  // (`ExposureDetails` ให้ `noRunSince` ขึ้นก่อนเสมอเมื่อ `exposureOwnNoNewRun` เป็นจริง
  // — ข้อเท็จจริงที่หนักกว่า: "ไม่มีรอบใหม่" ต้องไม่ถูกกลบด้วย "อินพุตอาจไม่ครบ")
  const exposureInputsDegraded = exposureInputsAreDegraded(thaiwater);
  // ใช้หรี่ชั้นบนแผนที่ (`exposureStale` prop): หรี่ทุกครั้งที่สิ่งที่วาดอยู่อาจไม่ใช่
  // ของล่าสุดหรือคำนวณจากอินพุตที่ไม่ครบ — ไม่ใช่ค่าที่ใช้เลือกข้อความใน legend โดยตรง
  const exposureNoNewRun = exposureOwnNoNewRun || exposureInputsDegraded;
  // ชั้นถูกหรี่ในทุกกรณีที่สิ่งที่วาดอยู่อาจไม่ใช่ของล่าสุด (`exposureNoNewRun`)
  // แต่ข้อความใน legend ต้องแยก "เราถามไม่ได้" ออกจาก "เซิร์ฟเวอร์บอกว่าไม่มีรอบใหม่"
  // — `exposure.apiUnreachable` เป็น true เฉพาะตอน fetch() เองไปไม่ถึงเซิร์ฟเวอร์
  // (ไม่ใช่ทุก `exposure.failing`: 503 "ยังไม่เคยมี run" ก็นับเป็น failing แต่เป็น
  // คำตอบจริงจาก API ที่ตอบสำเร็จ ไม่ใช่ "ติดต่อไม่ได้")
  const exposureApiUnreachable = exposure.apiUnreachable || apiHealth.apiDown;
  const exposureLegend = {
    run: exposure.data,
    // ตั้งใจส่งเหตุผล "ของตัวเอง" เท่านั้น ไม่ใช่ `exposureNoNewRun` ที่รวม
    // inputsDegraded เข้าไปแล้ว — ไม่งั้น legend จะเลือกข้อความ "noRunSince" ผิดจังหวะ
    // ตอน run===null ทั้งที่คำขอยังไม่กลับมา เพียงเพราะ thaiwater ไม่ปกติ ณ ขณะนั้นพอดี
    noNewRun: exposureOwnNoNewRun,
    apiUnreachable: exposureApiUnreachable,
    inputsDegraded: exposureInputsDegraded,
    // เหตุผลของ 503 ล่าสุด (เมื่อยังไม่มี run ในเครื่องเลย) มาจาก hook ตรง ๆ — App.tsx
    // ไม่แปล/ไม่เดาเพิ่ม แค่ส่งต่อไปให้ MapLegend เลือกข้อความให้ตรงกับสามข้อเท็จจริง
    // ที่ backend แยกไว้ (ดูคำอธิบายที่ useFloodExposure.ts)
    noRunReason: exposure.noRunReason,
  };
  const aoiId = aoiIdForProvince(provinceCode);
  // ป้ายชนิดความรู้ + เวลาของแต่ละชั้นใน legend มาจาก descriptor ที่ backend ประกาศ
  // (หรือจาก data/staticLayerDescriptors.ts สำหรับชั้นคงที่) — อายุคำนวณตอนเรนเดอร์
  const layerDescriptors = useLayerDescriptors({
    observations,
    radar,
    floodExtent,
    dams,
    exposure,
    health: apiHealth.health,
    // เวลาที่ artefact ของชั้นคงที่ถูก build มาจาก manifest ของจังหวัดที่แสดงอยู่
    // (null ตอนยังไม่โหลด/manifest รุ่นก่อน E9.1 → legend คงข้อความ "ไม่ได้บันทึกเวลา")
    provenance: mapInfo?.provenance ?? null,
  });

  const toggleLayer = useCallback((key: keyof MapLayers, value: boolean) => {
    setLayers((l) => ({ ...l, [key]: value }));
  }, []);

  // E12.4a — atIso (ย้อนหลัง) กับ forecastAtIso (พยากรณ์ล่วงหน้า) แยกกันคนละ
  // useState แต่ต้องกันไม่ให้ทั้งคู่ non-null พร้อมกัน: เลือกฝั่งไหน อีกฝั่งกลับ
  // เป็น null ทันที — ตรงกับกฎเดียวกับที่ permalink.ts ใช้ตัดสินว่า `t` หรือ `f`
  // ชนะเมื่อทั้งคู่ถูกส่งมาพร้อมกัน (`t`/observed ชนะเสมอ)
  const handleAtIsoChange = useCallback((iso: string | null) => {
    setAtIso(iso);
    if (iso !== null) setForecastAtIso(null);
  }, []);
  const handleForecastAtIsoChange = useCallback((iso: string | null) => {
    setForecastAtIso(iso);
    if (iso !== null) setAtIso(null);
  }, []);

  // `lang` ต้องอยู่ในสถานะที่ sync ลง URL ด้วย ไม่งั้นการเปิดลิงก์ `?lang=en`
  // แล้วปล่อยไว้ 400 มิลลิวินาที จะถูก replaceState เขียนทับจนพารามิเตอร์หายไป
  usePermalinkSync({
    provinceCode,
    pose,
    exaggeration,
    layers: { ...layers },
    // ต้องส่งค่าเริ่มต้นไปด้วย ไม่งั้นชั้นที่ "ปิดไว้เป็นค่าเริ่มต้น" (exposure) จะหลุด
    // ออกจากลิงก์ตอนที่ผู้ใช้เปิดมัน เพราะทุกชั้นกลายเป็นเปิดหมดพอดี
    defaultLayers: DEFAULT_LAYERS_RECORD,
    atIso,
    forecastAtIso,
    lang,
  });

  const selectProvince = useCallback((code: string) => {
    initialPoseRef.current = null;
    setPose(null);
    setProvinceCode(code);
    // เปลี่ยนจังหวัด = เลิกเลือก อปท. ทันที ห้ามให้ตัวเลขของ อปท. จังหวัดก่อนหน้า
    // ค้างอยู่ใต้หัวข้อของจังหวัดใหม่แม้เสี้ยววินาที (บั๊กที่เวอร์ชันก่อนถูกย้อนกลับเจอ)
    setSelectedAuthorityId(null);
  }, []);

  // เมื่อรายชื่อ อปท. ที่ได้รับผลกระทบของจังหวัดนี้โหลดเสร็จและตัวที่เลือกอยู่ไม่ได้
  // อยู่ในรายการนี้แล้ว (ยังไม่เคยเลือกเลย หรือเป็นตัวที่เลือกไว้จากจังหวัดก่อนหน้า
  // ที่ setSelectedAuthorityId(null) ใน selectProvince ยังมาไม่ทัน) ให้เลือกอันดับ
  // แรกให้อัตโนมัติ (อันดับแรก = โดนน้ำท่วมมากที่สุด) — เช็คด้วย "อยู่ในรายการไหม"
  // ไม่ใช่แค่ "เป็น null ไหม" เพื่อไม่ให้ useLocalAuthorityImpact ค้าง poll id ของ
  // จังหวัดเก่าต่อไปได้ในทุกกรณี ไม่ใช่แค่ตอนที่ผ่าน selectProvince เท่านั้น
  const affectedAuthoritiesEntries = affectedAuthorities.entries;
  useEffect(() => {
    if (affectedAuthoritiesEntries.length === 0) return;
    if (
      selectedAuthorityId &&
      affectedAuthoritiesEntries.some((e) => e.id === selectedAuthorityId)
    ) {
      return;
    }
    setSelectedAuthorityId(affectedAuthoritiesEntries[0].id);
  }, [affectedAuthoritiesEntries, selectedAuthorityId]);

  // Search index: amphoe centroids (from station coordinates), stations, dams of this province.
  const observationsData = observations.data;
  const damsList = dams.data?.dams;
  const places = useMemo<SearchPlace[]>(
    () =>
      buildSearchIndex({
        observations: observationsData,
        dams: damsList ?? [],
        provinceName,
        provinceCode,
        lang,
        t,
      }),
    [observationsData, damsList, provinceName, provinceCode, lang, t],
  );

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

  // เปลือกหน้าต่าง: tier / drawer / แผ่นเลื่อน / ความสูง dock → safe area (lib/shellLayout.ts)
  // ไม่มีการ re-frame กล้องตอนเปิด-ปิด drawer — `frameTerrain` ยังถูกเรียกเฉพาะตอน
  // AOI โหลด (Map3DCanvas) เหมือนเดิม การเปลี่ยนจังหวัดจึงจัดกรอบตามสถานะ drawer ขณะนั้น
  const shell = useShellState();
  // ปุ่ม "ชั้นข้อมูล" บนคอลัมน์เครื่องมือของมือถือ — identity คงที่เพื่อไม่ให้
  // MapViewport (และ Map3DCanvas ใต้มัน) re-render ทุกครั้งที่ App เรนเดอร์ใหม่
  const openPanel = shell.openPanel;
  const openLayersPanel = useCallback(() => openPanel("layers"), [openPanel]);

  // ทุกอย่างที่แผงใดแผงหนึ่งอาจต้องใช้ — ก้อนเดียว ส่งให้ drawer/แผ่นเลื่อนเรนเดอร์
  // เฉพาะแผงที่เปิดอยู่ (components/layout/panels.tsx)
  const ctx: PanelContext = {
    province,
    provinceName,
    lang,
    layers,
    toggleLayer,
    layerDescriptors,
    quality,
    qualityLevel,
    setQuality,
    mapInfo,
    exposureLegend,
    forecastLegend,
    observations,
    floodExtent,
    dams,
    earthquakes,
    forecast,
    activeAlerts,
    affectedAuthorities,
    localAuthorityImpact,
    selectedAuthorityId,
    setSelectedAuthorityId,
    apiHealth: apiHealth.health,
    atIso,
  };

  return (
    // `h-dvh` ไม่ใช่ `h-screen` (100vh): บน iOS Safari แถบ URL/แถบเครื่องมือหุบ-กาง
    // ได้ระหว่างที่หน้าไม่ได้เลื่อน — `100vh` วัดความสูงตอนแถบหุบสุด (ใหญ่กว่าที่
    // มองเห็นจริงตอนแถบกางอยู่) ทำให้ลูกที่ยึด `bottom: N` (PhoneDock/MobileSheet/
    // BottomDock) ไปหลบอยู่ใต้แถบเครื่องมือของเบราว์เซอร์เอง กดไม่โดนเลย แม้จะยัง
    // มองเห็นบางส่วน — เหตุผลเดียวกับที่ MethodologyPage.tsx ใช้ `dvh`
    <div className="relative h-dvh w-screen overflow-hidden bg-[var(--color-bg)]">
      <MapViewport
        aoiId={aoiId}
        provinceLabel={provinceName}
        summary={observations.data?.summary ?? null}
        summaryLoading={observations.loading}
        observations={observations.data}
        earthquakes={earthquakes.events}
        floodExtent={floodExtent.data}
        dams={dams.data?.dams ?? []}
        radar={radar.data}
        exposure={exposure.data}
        exposureStale={exposureNoNewRun}
        atIso={atIso}
        forecastAtIso={forecastAtIso}
        forecastBandLevel={forecastBandLevel}
        layers={layers}
        safeArea={shell.safeArea}
        observationsStale={observationsStale}
        initialPose={initialPoseRef.current}
        exaggeration={exaggeration}
        quality={quality}
        onQualityLevel={handleQualityLevel}
        tier={shell.tier}
        onInfo={setMapInfo}
        onApi={handleApi}
        onPoseChange={handlePose}
        onOpenLayers={openLayersPanel}
      />

      <AppShell
        ctx={ctx}
        shell={shell}
        provinces={PROVINCES}
        places={places}
        onSelectProvince={selectProvince}
        onSelectPlace={selectPlace}
        onShare={share}
        onSnapshot={() => void snapshot()}
        apiHealth={apiHealth}
        mapInfo={mapInfo}
        exaggeration={exaggeration}
        onExaggerationChange={setExaggeration}
        onAtIsoChange={handleAtIsoChange}
        forecastAtIso={forecastAtIso}
        onForecastAtIsoChange={handleForecastAtIsoChange}
      />
    </div>
  );
}
