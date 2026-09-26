import { Camera, ExternalLink, RefreshCw, Video, X } from "lucide-react";
import { m2ToRai, sensorLabel } from "../../lib/gistdaFlood";
import { useEffect, useRef, useState } from "react";
import { FloodFieldClass, type CctvCamera, type ItiCCamera } from "@siahra/shared-types";
import { gfmConfidence } from "../../scene/floodField";
import type { FloodCellPick, PickResult } from "../../scene/picking";
import { useStationHistory } from "../../hooks/useStationHistory";
import { useNow } from "../../hooks/useNow";
import {
  DWR_HOME,
  DWR_LIVE_MAX_MS,
  DWR_LIVE_RECONNECT_MS,
  coLocatedCameras,
  distinctLabels,
  dwrLiveUrl,
  isDwrFrameFresh,
  fetchSnapshot,
  freshness,
  nearestCamera,
  type SnapshotCache,
  type SnapshotResult,
} from "../../lib/cctv";
import {
  ITIC_HOME,
  LONGDO_CAMERA_HOME,
  ITIC_SNAPSHOT_MAX_MS,
  ITIC_SNAPSHOT_REFRESH_MS,
  startHlsPlayer,
  startItiCSnapshots,
  type HlsPlayerState,
  type ItiCSnapshotState,
} from "../../lib/itic";
import { Sparkline } from "../hazard/Sparkline";
import { floodDepthMaxLabel } from "../../lib/floodStyle";
import { formatNumber } from "../../lib/number";
import { percentOfQmax } from "../../lib/northRoute";
import { formatDateTime, formatFullDateTime } from "../../lib/time";
import { damDisplayName } from "../../lib/damName";
import { nearestProvinceLabel } from "../../lib/nearestProvince";
import { useLang } from "../../i18n/context";
import { cctvCameraName, type CameraSelection } from "../../lib/cameraSheet";
import type { Lang, MessageKey, TFunction } from "../../i18n";

function fmtTime(lang: Lang, iso: string | null | undefined): string {
  return iso ? formatDateTime(lang, iso) : "—";
}

const SITUATION: Record<number, MessageKey> = {
  1: "situation.1",
  2: "situation.2",
  3: "situation.3",
  4: "situation.4",
  5: "situation.5",
};

/** ชื่อสถานี/เขื่อนมาจากต้นทาง — เลือกฟิลด์ตามภาษา ไม่ได้แปลเอง */
function pickName(nameTh: string | null, nameEn: string | null, lang: Lang): string | null {
  return (lang === "th" ? (nameTh ?? nameEn) : (nameEn ?? nameTh)) ?? null;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 text-[11px]">
      <span className="text-[var(--color-fg-subtle)]">{k}</span>
      <span className="tabular-nums text-[var(--color-fg)]">{v}</span>
    </div>
  );
}

/** หน้าวิธีคำนวณของความลึก FwDET — พาภาษาไปด้วยเหมือน MapLegend (หน้านั้นอ่านภาษาจาก query เท่านั้น) */
function floodDepthMethodologyHref(lang: Lang): string {
  return lang === "th" ? "/methodology/flood-depth" : `/methodology/flood-depth?lang=${lang}`;
}

/**
 * บรรทัดคลาสของเซลล์ Copernicus GFM (E14.F5) — หกคลาส หกประโยค ห้ามพับรวมกัน:
 * "ไม่มีภาพ" ≠ "ไม่มีการจำแนก" ≠ "แห้ง" และ "ไม่ได้ประมาณความลึก" ≠ 0 ม.
 * ความลึกเป็นภาพประกอบ (FwDET) ทศนิยมหนึ่งตำแหน่ง; likelihood คือความเชื่อมั่นของ
 * การจำแนกภาพ — ไม่ใช่เปอร์เซ็นต์ของอะไรที่ยังไม่เกิด
 */
function gfmClassLine(cell: FloodCellPick, lang: Lang, t: TFunction): string {
  switch (cell.cls) {
    case FloodFieldClass.FLOODED:
      return cell.depthCm !== null
        ? t("popup.gfm.flooded", { m: floodDepthMaxLabel(lang, cell.depthCm) })
        : t("popup.gfm.floodedNoDepth");
    case FloodFieldClass.FLOODED_DEPTH_NOT_ESTIMATED:
      return t("popup.gfm.notEstimated");
    case FloodFieldClass.REFERENCE_WATER:
      return t("popup.gfm.referenceWater");
    case FloodFieldClass.EXCLUDED:
      return t("popup.gfm.excluded");
    case FloodFieldClass.NO_OBSERVATION:
      return t("popup.gfm.noObservation");
    case FloodFieldClass.DRY:
      return t("popup.gfm.dry");
    default:
      return t("popup.gfm.unknownClass", { cls: cell.cls });
  }
}

/** export เพื่อให้เทสเรนเดอร์บล็อกนี้ตรง ๆ ได้ (popup ทั้งก้อนต้องมี PickResult + hooks) */
export function GfmCellBlock({ cell, lang, t }: { cell: FloodCellPick; lang: Lang; t: TFunction }) {
  const flooded = cell.cls === FloodFieldClass.FLOODED || cell.cls === FloodFieldClass.FLOODED_DEPTH_NOT_ESTIMATED;
  // บรรทัดความเชื่อมั่นเฉพาะเซลล์ที่ GFM จำแนกจริง — EXCLUDED/NO_OBSERVATION ไม่มี (scene/floodField.ts)
  const confidence = gfmConfidence(cell);
  return (
    <div className="mt-2 border-t border-white/10 pt-1.5" data-gfm-class={cell.cls}>
      <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("popup.gfm.title")}</p>
      <p className={`mt-0.5 text-[11px] ${flooded ? "text-[#7fc4ef]" : "text-[var(--color-fg)]"}`}>{gfmClassLine(cell, lang, t)}</p>
      {confidence !== null ? (
        <p className="text-[11px] text-[var(--color-fg-muted)]">{t("popup.gfm.confidence", { n: confidence })}</p>
      ) : null}
      <p className="mt-0.5 text-[10px] text-[var(--color-fg-subtle)]">
        {t("popup.gfm.acquired", { time: formatFullDateTime(lang, cell.observedAt), id: cell.sceneId })}
      </p>
      <a
        href={floodDepthMethodologyHref(lang)}
        target="_blank"
        rel="noreferrer"
        className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-[var(--color-accent)] hover:underline"
      >
        <ExternalLink size={10} aria-hidden="true" />
        {t("freshness.methodology")}
      </a>
    </div>
  );
}

/**
 * สิ่งที่ popup ต้องใช้กับกล้อง CCTV (E15) — null = แฟล็กปิดหรือชั้นปิด: ไม่มีแถว
 * "กล้องใกล้เคียง" และไม่มีทางที่ popup จะส่ง request ไปหา DWR
 */
export interface CctvPopupContext {
  /** บัญชีทั้งประเทศ — สถานีริมเขตจังหวัดอาจใกล้กล้องของจังหวัดข้างเคียงที่สุด */
  cameras: readonly CctvCamera[];
  cache: SnapshotCache;
}

/** E15.2 — กล้องถนนของ iTIC; null = แฟล็ก `VITE_FEATURE_ITIC` ปิดหรือชั้นปิด */
export interface ItiCPopupContext {
  cameras: readonly ItiCCamera[];
}

type SnapshotView =
  | { status: "loading" }
  | { status: "done"; result: SnapshotResult };

type DwrLiveStatus = "connecting" | "live" | "reconnecting" | "failed" | "paused";

/**
 * ตัวนับการเชื่อมต่อภาพสดทั้งหน้า — ทุกครั้งที่ตั้ง src ต้องได้ URL ใหม่จริง: ถ้า URL ซ้ำกับครั้งก่อน
 * (เช่น effect ถูก mount → cleanup → mount ซ้ำ) Chromium อาจผูก `<img>` เข้ากับคำขอเดิมที่เพิ่ง
 * ถูกยกเลิกแล้วไม่ได้เฟรมเลย
 */
let dwrLiveSeq = 0;

/**
 * ภาพสด MJPEG ของ DWR (E15.2) — `<img>` ชี้ไปที่ `mjpegStream` ตรง ๆ
 *
 * - DWR ตัดการเชื่อมต่อเองหลัง ~11–24 วินาที จึงต่อใหม่ทุก ~15 วินาทีขณะเปิดอยู่ (ตัวกันแคช
 *   ใหม่ทุกครั้ง) และหยุดเองหลัง `DWR_LIVE_MAX_MS` (กดดูต่อได้) — popup ที่ลืมเปิดค้างไว้ต้องไม่
 *   ต่อเซิร์ฟเวอร์ของ DWR ไปเรื่อย ๆ
 * - สอง `<img>` สลับกัน: การต่อใหม่โหลดเข้าภาพที่ซ่อนอยู่ แล้วสลับเมื่อได้เฟรมแรก — ตั้ง src ใหม่
 *   บนภาพที่กำลังแสดงจะทำให้ภาพว่าง 2–3 วินาทีทุกรอบ (วัดใน Chromium 2026-09-26)
 * - "กำลังเชื่อมต่อ…" จนกว่าจะได้เฟรมแรก (`load` หรือ `naturalWidth > 0` — แล้วแต่อะไรมาก่อน)
 * - ป้าย "สด" เฉพาะเมื่อเห็นเฟรมใหม่จริงภายใน `DWR_LIVE_STALE_MS` — `load` ยิงครั้งเดียวต่อการ
 *   เชื่อมต่อ และไม่มี event ตอน DWR ปิดสตรีม จึงสุ่มพิกเซลของภาพที่แสดงลง canvas 32×18 ทุก 0.4
 *   วินาที (`crossOrigin="anonymous"`) พิกเซลเปลี่ยน = เฟรมใหม่; เงียบนานกว่านั้น = "กำลังเชื่อมต่อ
 *   ใหม่…" โดยยังแสดงเฟรมเดิม แล้วกลับเป็น "สด" เมื่อได้เฟรมถัดไป (จากสตรีมเดิมหรือการเชื่อมต่อใหม่)
 *   ข้อจำกัดที่ตรวจไม่ได้: ฉากที่นิ่งสนิทจนภาพย่อ 32×18 ไม่เปลี่ยนเลย แยกจาก "ไม่มีเฟรมใหม่" ไม่ออก —
 *   จะขึ้น "กำลังเชื่อมต่อใหม่" ทั้งที่ยังสด (ผิดไปทางระวัง ไม่ใช่ทางอ้างว่าสด); ถ้าอ่านพิกเซลไม่ได้
 *   (canvas ติด taint) ถอยไปใช้ "สดได้นานสุด `DWR_LIVE_OBSERVED_LIFETIME_MS` หลังเฟรมแรก"
 * - การต่อใหม่ที่ไม่ได้เฟรมสองรอบติด หรือ `error` = ล้มเหลว (ไม่ค้างป้าย "สด" บนเฟรมเก่า)
 * - ปิด/unmount/สลับกลับภาพนิ่ง = ตั้ง src ของทั้งสองภาพเป็น "" เพื่อทิ้งการเชื่อมต่อทันที
 * - สตรีมไม่มีเวลาถ่ายกำกับ — จึงไม่แสดงเวลาใดเป็นเวลาถ่าย (ไม่ใช้นาฬิกาเครื่อง)
 * - ล้มเหลว = `<img>` ไม่บอกว่าเป็น 0 ไบต์หรือเครือข่าย ข้อความจึงพูดตามนั้น
 */
function DwrLiveView({ stationCode, name, t }: { stationCode: string; name: string; t: TFunction }) {
  const imgARef = useRef<HTMLImageElement>(null);
  const imgBRef = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<DwrLiveStatus>("connecting");
  /** เพิ่มทุกครั้งที่กด "ลองใหม่/ดูต่อ" — เชื่อมต่อใหม่และเริ่มนับเวลาดูสดใหม่ */
  const [session, setSession] = useState(0);

  useEffect(() => {
    const a = imgARef.current;
    const b = imgBRef.current;
    if (!a || !b) return;
    const imgs = [a, b];
    let stopped = false;
    /** ภาพที่กำลังแสดง; `pending` = ภาพที่กำลังรอเฟรมแรกของการเชื่อมต่อล่าสุด */
    let front = -1;
    let pending = 0;
    let missedAttempts = 0;
    const startedAt = Date.now();
    for (const img of imgs) img.style.visibility = "hidden";
    /** เวลา (นาฬิกาเครื่อง ใช้วัดช่วงห่างเท่านั้น) ของเฟรมใหม่ล่าสุดที่ตรวจเห็น */
    let lastFrameAt: number | null = null;
    // ตัวตรวจเฟรม: ภาพย่อ 32×18 ของภาพที่แสดง — false = อ่านพิกเซลไม่ได้ เห็นแค่เฟรมแรกของแต่ละการเชื่อมต่อ
    const probe = document.createElement("canvas");
    probe.width = 32;
    probe.height = 18;
    const probeCtx = probe.getContext("2d", { willReadFrequently: true });
    let perFrame = probeCtx !== null;
    let lastHash: number | null = null;

    const connect = (i: number) => {
      dwrLiveSeq += 1;
      pending = i;
      imgs[i].src = dwrLiveUrl(stationCode, dwrLiveSeq);
    };
    const stopTimers = () => {
      window.clearInterval(poll);
      window.clearInterval(reconnect);
    };
    const checkFrame = () => {
      if (stopped || pending < 0 || imgs[pending].naturalWidth === 0) return;
      const next = pending;
      pending = -1;
      missedAttempts = 0;
      imgs[next].style.visibility = "visible";
      if (front >= 0 && front !== next) {
        imgs[front].style.visibility = "hidden";
        // การเชื่อมต่อเก่า (ซึ่ง DWR น่าจะปิดไปแล้ว) ถูกทิ้ง
        imgs[front].src = "";
      }
      front = next;
      // เฟรมแรกของการเชื่อมต่อใหม่ = เฟรมใหม่ (hash ของภาพนี้เริ่มนับใหม่)
      lastFrameAt = Date.now();
      lastHash = null;
      setStatus("live");
    };
    const sampleFrame = () => {
      if (!perFrame || !probeCtx || front < 0) return;
      try {
        probeCtx.drawImage(imgs[front], 0, 0, probe.width, probe.height);
        const px = probeCtx.getImageData(0, 0, probe.width, probe.height).data;
        let h = 0;
        for (let i = 0; i < px.length; i++) h = (Math.imul(h, 31) + px[i]) | 0;
        if (lastHash !== null && h !== lastHash) lastFrameAt = Date.now();
        lastHash = h;
      } catch {
        // SecurityError (canvas ติด taint) — ถอยไปใช้อายุสตรีมที่วัดได้หลังเฟรมแรก
        perFrame = false;
      }
    };
    const tick = () => {
      checkFrame();
      if (stopped || front < 0) return;
      sampleFrame();
      setStatus(isDwrFrameFresh(Date.now(), lastFrameAt, perFrame) ? "live" : "reconnecting");
    };
    // ล้มเหลว = หยุดทั้งหมดและทิ้งการเชื่อมต่อ (`stopped` กันไม่ให้ error ของ src="" วนกลับมา)
    const giveUp = () => {
      if (stopped) return;
      stopped = true;
      stopTimers();
      for (const img of imgs) {
        img.style.visibility = "hidden";
        img.src = "";
      }
      setStatus("failed");
    };
    const onError = (e: Event) => {
      // error ของภาพที่ถูกทิ้ง (src="") ไม่ใช่ความล้มเหลว
      if (imgs.indexOf(e.currentTarget as HTMLImageElement) === pending) giveUp();
    };
    for (const img of imgs) {
      img.addEventListener("load", checkFrame);
      img.addEventListener("error", onError);
    }
    // บางเบราว์เซอร์ไม่ยิง `load` จนกว่าสตรีม multipart จะจบ — ดูขนาดภาพแทนระหว่างรอเฟรมแรก
    // และสุ่มพิกเซลหาเฟรมใหม่ของภาพที่แสดงอยู่
    const poll = window.setInterval(tick, 400);
    const reconnect = window.setInterval(() => {
      if (stopped) return;
      // การเชื่อมต่อล่าสุดไม่ได้เฟรมเลยภายในรอบ (~15 วินาที) — สองรอบติด = ไม่ได้ภาพสด (เช่น
      // สถานีที่ตอบ 200 แต่ 0 ไบต์ ซึ่งอาจไม่ยิง `error`) ห้ามค้าง "กำลังเชื่อมต่อ…"/"สด" ต่อไป
      if (pending >= 0 && ++missedAttempts >= 2) {
        giveUp();
        return;
      }
      if (Date.now() - startedAt >= DWR_LIVE_MAX_MS) {
        // หยุดต่อใหม่แต่ **ไม่** ล้างภาพที่แสดง — เฟรมสุดท้ายตามที่ป้ายบอก และ DWR ตัดสตรีมเอง
        // ภายใน ~24 วินาทีอยู่แล้ว (การไม่ต่อใหม่ = ปล่อยการเชื่อมต่อ); ภาพที่ยังรอเฟรมถูกทิ้ง
        stopped = true;
        stopTimers();
        if (pending >= 0 && pending !== front) imgs[pending].src = "";
        setStatus(front >= 0 ? "paused" : "failed");
        return;
      }
      connect(front >= 0 ? 1 - front : pending >= 0 ? pending : 0);
    }, DWR_LIVE_RECONNECT_MS);
    connect(0);
    return () => {
      stopped = true;
      stopTimers();
      for (const img of imgs) {
        img.removeEventListener("load", checkFrame);
        img.removeEventListener("error", onError);
        // ทิ้งการเชื่อมต่อ multipart ที่ค้างอยู่ (ปิด popup, สลับกลับไปภาพนิ่ง, เริ่มดูสดรอบใหม่)
        img.src = "";
      }
    };
  }, [stationCode, session]);

  const restart = () => {
    setSession((x) => x + 1);
    setStatus("connecting");
  };

  return (
    <>
      <div className="relative mt-2 aspect-video w-full overflow-hidden rounded-lg bg-black/40" data-dwr-live={status}>
        {/* crossOrigin ให้อ่านพิกเซลเพื่อตรวจเฟรมใหม่ได้ (DWR สะท้อน origin) — ต้องตั้งก่อน src */}
        <img
          ref={imgARef}
          crossOrigin="anonymous"
          alt={t("popup.cctv.liveAlt", { name })}
          className="invisible absolute inset-0 h-full w-full object-cover"
        />
        <img
          ref={imgBRef}
          crossOrigin="anonymous"
          alt={t("popup.cctv.liveAlt", { name })}
          className="invisible absolute inset-0 h-full w-full object-cover"
        />
        {status === "connecting" || status === "failed" ? (
          <p className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] leading-snug text-[var(--color-fg-muted)]">
            {status === "connecting" ? t("popup.cctv.liveConnecting") : t("popup.cctv.liveFailed")}
          </p>
        ) : null}
        {status === "live" ? (
          <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded bg-[#dc2626]/90 px-1.5 py-px text-[10px] font-semibold text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" />
            {t("popup.cctv.liveBadge")}
          </span>
        ) : null}
        {status === "paused" || status === "reconnecting" ? (
          <span className="absolute top-1.5 right-1.5 rounded bg-black/75 px-1.5 py-px text-[10px] text-white">
            {t(status === "paused" ? "popup.cctv.livePausedBadge" : "popup.cctv.liveReconnectingBadge")}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-[var(--color-fg-subtle)]">
        {status === "paused"
          ? t("popup.cctv.livePaused")
          : status === "reconnecting"
            ? t("popup.cctv.liveReconnecting")
            : t("popup.cctv.liveNoTime")}
      </p>
      {status === "failed" || status === "paused" ? (
        <button
          type="button"
          onClick={restart}
          className="mt-1 inline-flex cursor-pointer items-center gap-1 rounded-md bg-white/8 px-1.5 py-0.5 text-[10px] text-[var(--color-fg)] hover:bg-white/15"
        >
          <RefreshCw size={10} aria-hidden="true" />
          {t(status === "paused" ? "popup.cctv.liveResume" : "popup.cctv.liveRetry")}
        </button>
      ) : null}
    </>
  );
}

/**
 * ภาพล่าสุดของกล้อง DWR หนึ่งตัว (E15) — ขอจาก DWR ตอน mount เท่านั้น (คือตอนผู้ใช้คลิก
 * หมุด หรือกด "ดูภาพ" ในแถวกล้องใกล้เคียง) ภาพที่ได้ภายใน 5 นาทีมาจากแคช
 *
 * - เวลาถ่ายมาจาก path ของภาพ; แปลงไม่ได้ = "ไม่ทราบ" ไม่ใช่เวลาปัจจุบัน
 * - `fetchedAt` แสดงเฉพาะหลังได้ภาพสำเร็จ
 * - ภาพเก่า (> 45 นาที) หรี่ลงพร้อมป้าย — ยังแสดงอยู่ ไม่ซ่อน
 * - ล้มเหลวสองแบบ (`unreachable` / `no-image`) มีข้อความของตัวเอง และไม่มีแบบไหนพูดว่า
 *   กล้องหรือพื้นที่ "ปกติ/เงียบ"
 * - E15.2: ปุ่ม "ดูสด" สลับไปดูภาพสด (`DwrLiveView`) — ภาพนิ่งยังเป็นค่าเริ่มต้น และทั้งสองแบบ
 *   มีป้ายกำกับชัดว่า "สด" หรือ "ภาพนิ่ง" + เวลาถ่าย
 */
export function CctvBody({
  camera,
  cache,
  lang,
  t,
  distanceKm = null,
  showName = true,
}: {
  camera: CctvCamera;
  cache: SnapshotCache;
  lang: Lang;
  t: TFunction;
  /** ระยะจากสถานีที่เปิดมา (แถวกล้องใกล้เคียง) — null = เปิดจากหมุดกล้องโดยตรง */
  distanceKm?: number | null;
  /** false = ชื่อกล้องอยู่ที่หัวของแผงกล้อง (`CameraSheet`) แล้ว ไม่พิมพ์ซ้ำ */
  showName?: boolean;
}) {
  const nowMs = useNow();
  const [live, setLive] = useState(false);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<SnapshotView>(() => {
    const hit = cache.get(camera.id);
    return hit ? { status: "done", result: hit } : { status: "loading" };
  });

  useEffect(() => {
    if (reload === 0) {
      const hit = cache.get(camera.id);
      if (hit) {
        setView({ status: "done", result: hit });
        return;
      }
    }
    const controller = new AbortController();
    setView({ status: "loading" });
    fetchSnapshot(camera.id, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.kind === "ok") cache.set(camera.id, result);
        setView({ status: "done", result });
      })
      .catch(() => {
        // AbortError เท่านั้น (ปิด popup/สลับกล้อง) — fetchSnapshot แปลงความล้มเหลวอื่นเป็นผลลัพธ์แล้ว
      });
    return () => controller.abort();
  }, [camera.id, cache, reload]);

  const name = cctvCameraName(camera, lang, t);
  const result = view.status === "done" ? view.result : null;
  const ok = result?.kind === "ok" ? result : null;
  const fresh = ok?.observedAt ? freshness(ok.observedAt, nowMs, lang) : null;
  const dim = fresh !== null && fresh.level !== "fresh";

  return (
    <div data-cctv-camera={camera.id}>
      {showName ? <p className="pr-6 text-sm font-semibold text-white">{name}</p> : null}
      <p className="text-[11px] text-[var(--color-fg-muted)]">
        {[camera.amphoeTh, camera.stationCode, distanceKm !== null ? `${distanceKm.toFixed(1)} ${t("unit.km")}` : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="mt-2 flex rounded-md bg-white/5 p-0.5 text-[10px]" role="group" aria-label={t("popup.cctv.modeLabel")}>
        {[
          { v: false, label: t("popup.cctv.modeSnapshot") },
          { v: true, label: t("popup.cctv.modeLive") },
        ].map((m) => (
          <button
            key={String(m.v)}
            type="button"
            aria-pressed={live === m.v}
            onClick={() => setLive(m.v)}
            className={`flex-1 cursor-pointer rounded px-1.5 py-0.5 ${
              live === m.v ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {live ? (
        <DwrLiveView stationCode={camera.stationCode} name={name} t={t} />
      ) : (
        <>
          <div className="relative mt-2 aspect-video w-full overflow-hidden rounded-lg bg-black/40">
            {ok ? (
              <img
                src={ok.blobUrl}
                alt={t("popup.cctv.alt", { name })}
                className={`h-full w-full object-cover ${dim ? "opacity-55 grayscale-[35%]" : ""}`}
              />
            ) : (
              <p className="flex h-full items-center justify-center px-3 text-center text-[11px] leading-snug text-[var(--color-fg-muted)]">
                {view.status === "loading"
                  ? t("popup.cctv.loading")
                  : result?.kind === "no-image"
                    ? t("popup.cctv.noImage")
                    : result?.kind === "unreachable"
                      ? t("popup.cctv.unreachable", { detail: result.detail })
                      : null}
              </p>
            )}
            {fresh && fresh.level !== "fresh" ? (
              <span className="absolute top-1.5 left-1.5 rounded bg-[var(--color-risk-medium)]/90 px-1.5 py-px text-[10px] font-medium text-black">
                {t(fresh.level === "old" ? "popup.cctv.old" : "popup.cctv.stale")}
              </span>
            ) : null}
            {ok ? (
              // ป้าย "ภาพนิ่ง" + เวลาถ่าย บนตัวภาพเสมอ — ไม่ให้ภาพนิ่งถูกอ่านเป็นภาพสด
              <span className="absolute top-1.5 right-1.5 rounded bg-black/75 px-1.5 py-px text-[10px] text-white">
                {ok.observedAt
                  ? t("popup.cctv.snapshotBadge", { time: formatDateTime(lang, ok.observedAt) })
                  : t("popup.cctv.snapshotBadgeNoTime")}
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-col gap-0.5">
            {ok ? (
              <>
                <Row
                  k={t("popup.cctv.takenAt")}
                  v={ok.observedAt ? formatFullDateTime(lang, ok.observedAt) : t("popup.cctv.takenAtUnknown")}
                />
                {fresh ? <Row k={t("popup.cctv.age")} v={fresh.label} /> : null}
                <Row k={t("popup.cctv.fetchedAt")} v={formatDateTime(lang, ok.fetchedAt)} />
              </>
            ) : null}
          </div>
        </>
      )}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <a
          href={DWR_HOME}
          target="_blank"
          rel="noreferrer noopener"
          title={t("popup.cctv.rights")}
          className="inline-flex items-center gap-1 text-[10px] text-[var(--color-accent)] hover:underline"
        >
          <ExternalLink size={10} aria-hidden="true" />
          {t("popup.cctv.credit")}
        </a>
        {!live ? (
          <button
            type="button"
            onClick={() => setReload((n) => n + 1)}
            disabled={view.status === "loading"}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-white/8 px-1.5 py-0.5 text-[10px] text-[var(--color-fg)] hover:bg-white/15 disabled:cursor-default disabled:opacity-50"
          >
            <RefreshCw size={10} aria-hidden="true" />
            {t("popup.cctv.refresh")}
          </button>
        ) : null}
      </div>
      <p className="mt-0.5 text-[10px] text-[var(--color-fg-subtle)]">{t("popup.cctv.rights")}</p>
    </div>
  );
}

/** ชื่อกล้อง + เจ้าของ · id · ระยะ — ใช้ร่วมกันทั้งวิดีโอสดและภาพนิ่ง */
function ItiCHeader({
  camera,
  name,
  distanceKm,
  showName,
  t,
}: {
  camera: ItiCCamera;
  name: string;
  distanceKm: number | null;
  showName: boolean;
  t: TFunction;
}) {
  return (
    <>
      {showName ? <p className="pr-6 text-sm leading-snug font-semibold text-white">{name}</p> : null}
      <p className="text-[11px] text-[var(--color-fg-muted)]">
        {[camera.organization, camera.id, distanceKm !== null ? `${distanceKm.toFixed(1)} ${t("unit.km")}` : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </>
  );
}

/** เครดิตเจ้าของกล้อง + iTIC + Longdo — อยู่ใน popup ของกล้อง iTIC ทุกแบบเสมอ */
function ItiCCredits({
  camera,
  creditKey,
  t,
  action,
}: {
  camera: ItiCCamera;
  creditKey: "popup.itic.credit" | "popup.itic.creditImage";
  t: TFunction;
  /** ปุ่มขวามือ (ลองใหม่ / รีเฟรชต่อ) — null = ไม่มี */
  action: { label: string; onClick: () => void } | null;
}) {
  return (
    <>
      <div className="mt-1.5 flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-0.5 text-[10px]">
          {camera.organization ? (
            <span className="text-[var(--color-fg-muted)]">{t("popup.itic.owner", { org: camera.organization })}</span>
          ) : null}
          <a
            href={ITIC_HOME}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
          >
            <ExternalLink size={10} aria-hidden="true" />
            {t(creditKey)}
          </a>
          <a
            href={LONGDO_CAMERA_HOME}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
          >
            <ExternalLink size={10} aria-hidden="true" />
            {t("popup.itic.listCredit")}
          </a>
        </span>
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-white/8 px-1.5 py-0.5 text-[10px] text-[var(--color-fg)] hover:bg-white/15"
          >
            <RefreshCw size={10} aria-hidden="true" />
            {action.label}
          </button>
        ) : null}
      </div>
      <p className="mt-0.5 text-[10px] text-[var(--color-fg-subtle)]">{t("popup.itic.rights")}</p>
    </>
  );
}

/**
 * วิดีโอสดจากกล้องถนนของ iTIC หนึ่งตัว (E15.2) — สตรีมเริ่มตอน mount เท่านั้น (ผู้ใช้คลิกหมุด
 * หรือกด "ดูวิดีโอสด" ในแถวกล้องใกล้เคียง) และถูกตัดทันทีตอน unmount (`startHlsPlayer` คืนตัวหยุด)
 *
 * - สถานะ loading / live / buffering / suspended / unreachable / unsupported มีข้อความของตัวเอง
 *   ทั้งหมด และไม่มีแบบไหนพูดถึงสภาพถนน การจราจร หรือพื้นที่ — `buffering` แสดงเฟรมที่ค้างอยู่
 *   พร้อมป้ายสีกลาง ไม่ใช่ป้าย "สด" (และไม่ใช่ความล้มเหลว จึงไม่มีปุ่มลองใหม่)
 * - เวลา: EXT-X-PROGRAM-DATE-TIME ของสตรีมเท่านั้น ไม่มี = บอกตรง ๆ ว่าสตรีมไม่มีเวลากำกับ
 * - เครดิตเจ้าของกล้อง (`organization`) + iTIC + Longdo อยู่ใน popup เสมอ (`ItiCCredits`)
 */
function ItiCVideoBody({
  camera,
  url,
  lang,
  t,
  distanceKm,
  showName,
}: {
  camera: ItiCCamera;
  url: string;
  lang: Lang;
  t: TFunction;
  distanceKm: number | null;
  showName: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<HlsPlayerState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    return startHlsPlayer(video, url, setState);
  }, [url, attempt]);

  const name = camera.name ?? t("popup.itic.fallbackName", { id: camera.id });
  const failed = state.status === "suspended" || state.status === "unreachable" || state.status === "unsupported";
  /** มีภาพจากสตรีมแล้ว (กำลังเล่น ค้างรอบัฟเฟอร์ หรือผู้ใช้หยุดเอง) */
  const playing = state.status === "live" || state.status === "buffering" || state.status === "paused";

  return (
    <div data-itic-camera={camera.id} data-itic-kind="hls" data-itic-state={state.status}>
      <ItiCHeader camera={camera} name={name} distanceKm={distanceKm} showName={showName} t={t} />
      <div className="relative mt-2 aspect-video w-full overflow-hidden rounded-lg bg-black/60">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          controls={playing}
          aria-label={t("popup.itic.videoLabel", { name })}
          className={`h-full w-full object-contain ${playing ? "" : "invisible"}`}
        />
        {state.status === "buffering" ? (
          <span className="pointer-events-none absolute top-1.5 right-1.5 rounded bg-black/75 px-1.5 py-px text-[10px] text-white">
            {t("popup.itic.bufferingBadge")}
          </span>
        ) : state.status === "paused" ? (
          <span className="pointer-events-none absolute top-1.5 right-1.5 rounded bg-black/75 px-1.5 py-px text-[10px] text-white">
            {t("popup.itic.pausedBadge")}
          </span>
        ) : !playing ? (
          <p className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] leading-snug text-[var(--color-fg-muted)]">
            {state.status === "loading"
              ? t("popup.itic.loading")
              : state.status === "suspended"
                ? t("popup.itic.suspended", { detail: state.detail })
                : state.status === "unreachable"
                  ? t("popup.itic.unreachable", { detail: state.detail })
                  : t("popup.itic.unsupported", { detail: state.detail })}
          </p>
        ) : (
          <span className="pointer-events-none absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded bg-[#dc2626]/90 px-1.5 py-px text-[10px] font-semibold text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" />
            {t("popup.cctv.liveBadge")}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-0.5">
        {state.status === "buffering" ? (
          <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">{t("popup.itic.buffering")}</p>
        ) : state.status === "paused" ? (
          <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">{t("popup.itic.paused")}</p>
        ) : null}
        {playing ? (
          state.programDateTime ? (
            <Row k={t("popup.itic.streamTime")} v={formatFullDateTime(lang, state.programDateTime)} />
          ) : (
            <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">{t("popup.itic.noStreamTime")}</p>
          )
        ) : null}
      </div>
      <ItiCCredits
        camera={camera}
        creditKey="popup.itic.credit"
        t={t}
        action={failed ? { label: t("popup.itic.retry"), onClick: () => setAttempt((n) => n + 1) } : null}
      />
    </div>
  );
}


/**
 * ภาพนิ่งจากกล้อง iTIC ที่ไม่มี HLS (`stream.kind = "jpeg"`) — ขอภาพใหม่ทุก ~5 วินาทีขณะ mount
 * (`startItiCSnapshots` ใน `lib/itic.ts`) และตัดทันทีตอน unmount (`src = ""`)
 *
 * - ป้ายบนภาพคือ "ภาพนิ่งรีเฟรชอัตโนมัติ" เสมอ — ไม่ใช่ "สด"
 * - สถานะ loading / ok / unreachable / paused มีข้อความของตัวเอง ไม่มีแบบไหนพูดถึงสภาพถนน;
 *   `unreachable` หลังเคยได้ภาพ = ภาพเดิมค้างไว้แบบหรี่พร้อมเวลาที่ได้ภาพนั้น
 * - เวลา: แสดงเฉพาะ "ได้ภาพล่าสุดเมื่อ" (นาฬิกาเครื่องตอนได้ภาพ) — เวลาถ่ายกล้องพิมพ์ไว้บนภาพเอง
 *   ไม่มีเป็นข้อมูล จึงบอกตรง ๆ และไม่ใช้นาฬิกาเครื่องเป็นเวลาถ่าย
 */
function ItiCSnapshotBody({
  camera,
  url,
  lang,
  t,
  distanceKm,
  showName,
}: {
  camera: ItiCCamera;
  url: string;
  lang: Lang;
  t: TFunction;
  distanceKm: number | null;
  showName: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ItiCSnapshotState>({ status: "loading" });
  const [session, setSession] = useState(0);
  const name = camera.name ?? t("popup.itic.fallbackName", { id: camera.id });
  // ข้อความ alt ตามภาษาปัจจุบัน — อ่านผ่าน ref เพื่อไม่ให้การสลับภาษาเริ่มรอบขอภาพใหม่
  const alt = t("popup.itic.snapshotAlt", { name });
  const altRef = useRef(alt);
  useEffect(() => {
    altRef.current = alt;
    const shown = frameRef.current?.querySelector("img");
    if (shown) shown.alt = alt;
  }, [alt]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    return startItiCSnapshots(url, setState, {
      // ไม่ตั้ง crossOrigin — แสดงอย่างเดียว ไม่อ่านพิกเซล
      createImage: () => {
        const img = new Image();
        img.alt = altRef.current;
        img.decoding = "async";
        img.className = "h-full w-full object-contain";
        return img;
      },
      show: (img) => {
        if (img) frame.replaceChildren(img);
        else frame.replaceChildren();
      },
    });
  }, [url, session]);

  const lastFetchedAt =
    state.status === "ok" ? state.fetchedAt : state.status === "loading" ? null : state.lastFetchedAt;
  const hasFrame = lastFetchedAt !== null;
  /** ภาพที่แสดงไม่ใช่ผลของรอบล่าสุด (ล้ม) หรือหยุดรีเฟรชแล้ว → หรี่ */
  const dim =
    state.status === "unreachable" || (state.status === "paused" && (state.lastFailed || !hasFrame));
  const message =
    state.status === "loading"
      ? t("popup.itic.snapshotLoading")
      : state.status === "unreachable"
        ? t("popup.itic.snapshotUnreachable", { detail: t(`popup.itic.snapshotDetail.${state.detail === "url rejected" ? "rejected" : state.detail}`) })
        : state.status === "paused"
          ? t("popup.itic.snapshotPaused", { min: Math.round(ITIC_SNAPSHOT_MAX_MS / 60_000) })
          : null;

  return (
    <div data-itic-camera={camera.id} data-itic-kind="jpeg" data-itic-state={state.status}>
      <ItiCHeader camera={camera} name={name} distanceKm={distanceKm} showName={showName} t={t} />
      <div className="relative mt-2 aspect-video w-full overflow-hidden rounded-lg bg-black/60">
        {/* ลูกของ div นี้เป็นของ startItiCSnapshots (แทนภาพเมื่อได้เฟรมใหม่) — React ไม่เรนเดอร์อะไรในนี้ */}
        <div
          ref={frameRef}
          className={`h-full w-full ${dim ? "opacity-45 grayscale-[35%]" : ""}`}
        />
        {hasFrame ? (
          <span className="pointer-events-none absolute top-1.5 right-1.5 rounded bg-black/75 px-1.5 py-px text-[10px] text-white">
            {state.status === "paused" ? t("popup.itic.snapshotPausedBadge") : t("popup.itic.snapshotBadge")}
          </span>
        ) : null}
        {message ? (
          <p
            className={
              hasFrame
                ? "absolute inset-x-0 bottom-0 bg-black/75 px-2 py-1 text-[10px] leading-snug text-[var(--color-fg)]"
                : "absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] leading-snug text-[var(--color-fg-muted)]"
            }
          >
            {message}
          </p>
        ) : null}
      </div>
      <div className="mt-2 flex flex-col gap-0.5">
        <Row
          k={t("popup.itic.snapshotFetchedAt")}
          v={lastFetchedAt ? formatFullDateTime(lang, lastFetchedAt) : t("popup.itic.snapshotNeverFetched")}
        />
        <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">
          {t("popup.itic.snapshotCaptureTime", { s: Math.round(ITIC_SNAPSHOT_REFRESH_MS / 1000) })}
        </p>
      </div>
      <ItiCCredits
        camera={camera}
        creditKey="popup.itic.creditImage"
        t={t}
        action={
          state.status === "paused"
            ? { label: t("popup.itic.snapshotResume"), onClick: () => setSession((n) => n + 1) }
            : null
        }
      />
    </div>
  );
}

/**
 * กล้อง iTIC หนึ่งตัว — วิดีโอสด (`hls`) หรือภาพนิ่งรีเฟรชอัตโนมัติ (`jpeg`) ตาม `camera.stream`
 * ทั้งสองแบบเริ่มขอ iTIC ตอน mount เท่านั้น และหยุดตอน unmount
 */
export function ItiCBody({
  camera,
  lang,
  t,
  distanceKm = null,
  showName = true,
}: {
  camera: ItiCCamera;
  lang: Lang;
  t: TFunction;
  /** ระยะจากสถานีที่เปิดมา (แถวกล้องใกล้เคียง) — null = เปิดจากหมุดกล้องโดยตรง */
  distanceKm?: number | null;
  /** false = ชื่อกล้องอยู่ที่หัวของแผงกล้อง (`CameraSheet`) แล้ว ไม่พิมพ์ซ้ำ */
  showName?: boolean;
}) {
  return camera.stream.kind === "jpeg" ? (
    <ItiCSnapshotBody camera={camera} url={camera.stream.url} lang={lang} t={t} distanceKm={distanceKm} showName={showName} />
  ) : (
    <ItiCVideoBody camera={camera} url={camera.stream.url} lang={lang} t={t} distanceKm={distanceKm} showName={showName} />
  );
}

/**
 * เนื้อหาของหมุดกล้อง iTIC — หมุดที่ตั้งซ้อนกัน (`coLocatedCameras`) คลิกได้แค่ตัวเดียว จึงมีปุ่มสลับ
 * ไปกล้องอื่นที่ตำแหน่งเดียวกัน (วิดีโอสดและภาพนิ่งปนกันได้ ปุ่มมีไอคอนบอกชนิด); ตัวเล่น/ตัวขอภาพ
 * ยังมีทีละตัว (`ItiCBody` ถูก remount ด้วย key → ตัวเก่าหยุดก่อน)
 *
 * `activeId`/`onActiveChange` ให้แผงกล้อง (`CameraSheet`) คุมกล้องที่เลือกเอง เพื่อให้หัวแผง
 * แสดงชื่อกล้องที่กำลังดูอยู่ ไม่ใช่ตัวที่ถูกคลิก
 */
export function ItiCPickBody({
  camera,
  cameras,
  lang,
  t,
  distanceKm = null,
  activeId: controlledId,
  onActiveChange,
  showName = true,
}: {
  camera: ItiCCamera;
  cameras: readonly ItiCCamera[];
  lang: Lang;
  t: TFunction;
  distanceKm?: number | null;
  activeId?: string;
  onActiveChange?: (id: string) => void;
  showName?: boolean;
}) {
  const [ownId, setOwnId] = useState(camera.id);
  const activeId = controlledId ?? ownId;
  const setActiveId = onActiveChange ?? setOwnId;
  const cluster = coLocatedCameras(camera, cameras);
  const active = cluster.find((c) => c.id === activeId) ?? camera;
  const fullNames = cluster.map((c) => c.name ?? t("popup.itic.fallbackName", { id: c.id }));
  const labels = distinctLabels(fullNames);
  return (
    <>
      {cluster.length > 1 ? (
        <div className="mb-1.5 pr-6" role="group" aria-label={t("popup.itic.coLocated")} data-itic-cluster={cluster.length}>
          <p className="mb-0.5 text-[10px] text-[var(--color-fg-subtle)]">{t("popup.itic.coLocated")}</p>
          <div className="flex flex-col gap-0.5">
            {cluster.map((c, i) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={c.id === active.id}
                onClick={() => setActiveId(c.id)}
                className={`cursor-pointer truncate rounded px-1.5 py-0.5 text-left text-[10px] ${c.id === active.id ? "bg-[var(--color-accent)] text-white" : "bg-white/5 text-[var(--color-fg-muted)] hover:bg-white/10"}`}
                title={fullNames[i]}
              >
                <span className="inline-flex max-w-full items-center gap-1">
                  {c.stream.kind === "jpeg" ? (
                    <Camera size={10} aria-label={t("popup.itic.kindSnapshot")} className="shrink-0" />
                  ) : (
                    <Video size={10} aria-label={t("popup.itic.kindVideo")} className="shrink-0" />
                  )}
                  <span className="truncate">{labels[i]}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <ItiCBody
        key={active.id}
        camera={active}
        lang={lang}
        t={t}
        distanceKm={active.id === camera.id ? distanceKm : null}
        showName={showName}
      />
    </>
  );
}

const HISTORY_RANGES: { hours: number; labelKey: MessageKey }[] = [
  { hours: 72, labelKey: "timeline.range.72h" },
  { hours: 168, labelKey: "timeline.range.7d" },
  { hours: 720, labelKey: "timeline.range.30d" },
];

/** กล้องใกล้สถานีที่สุดจากแหล่งใดแหล่งหนึ่ง — `source` บอกว่าเปิด body ไหน */
type NearestCam =
  | { source: "dwr"; camera: CctvCamera; distanceKm: number }
  | { source: "itic"; camera: ItiCCamera; distanceKm: number };

/** ปุ่ม "กล้องใกล้เคียง" → เปิดกล้องในแผงด้านขวา; null = ไม่มีแผงให้เปิด (ไม่มีปุ่ม) */
export type OpenCamera = (sel: CameraSelection) => void;

function WaterLevelBody({
  pick,
  lang,
  t,
  cctv,
  itic,
  onOpenCamera,
}: {
  pick: Extract<PickResult, { kind: "waterlevel" }>;
  lang: Lang;
  t: TFunction;
  cctv: CctvPopupContext | null;
  itic: ItiCPopupContext | null;
  onOpenCamera: OpenCamera | null;
}) {
  const { obs } = pick;
  const [hours, setHours] = useState(72);
  // E16 — กราฟเดียวกันสลับได้ระหว่างระดับน้ำกับอัตราการไหล (คอลัมน์เดียวกันของประวัติ)
  const [series, setSeries] = useState<"level" | "discharge">("level");
  // แถว waterlevel ที่เขียนก่อน E16 ไม่มีฟิลด์ใหม่ — undefined = ไม่มีข้อมูล ไม่ใช่ 0
  const dischargeM3s = obs.dischargeM3s ?? null;
  const qmaxM3s = obs.qmaxM3s ?? null;
  const criticalLevelMsl = obs.criticalLevelMsl ?? null;
  const qmaxPct = percentOfQmax(dischargeM3s, qmaxM3s);
  const history = useStationHistory(obs.station.id, true, hours);
  // E15/E15.2 — กล้องที่ใกล้ที่สุดภายใน 3 กม. จากทั้งสองแหล่ง (DWR / iTIC) คิดจากบัญชีที่
  // โหลดไว้แล้ว ไม่ส่ง request ใด — ภาพ/สตรีมถูกขอเมื่อผู้ใช้กดปุ่มเท่านั้น
  const nearDwr = cctv ? nearestCamera(obs.station.lat, obs.station.lon, cctv.cameras) : null;
  const nearItic = itic ? nearestCamera(obs.station.lat, obs.station.lon, itic.cameras) : null;
  const nearest: NearestCam | null =
    nearDwr && (!nearItic || nearDwr.distanceKm <= nearItic.distanceKm)
      ? { source: "dwr", camera: nearDwr.camera, distanceKm: nearDwr.distanceKm }
      : nearItic
        ? { source: "itic", camera: nearItic.camera, distanceKm: nearItic.distanceKm }
        : null;
  // กล้องเปิดในแผงด้านขวา (`CameraSheet`) ไม่ใช่ใน popup เล็ก ๆ นี้ — popup ของสถานียังเปิดอยู่
  // (บริบทของกล้อง) และเป็นที่ที่โฟกัสกลับมาเมื่อปิดแผง
  const openNearest = () => {
    if (!nearest || !onOpenCamera) return;
    onOpenCamera(
      nearest.source === "dwr"
        ? { kind: "cctv", camera: nearest.camera, distanceKm: nearest.distanceKm }
        : { kind: "itic", camera: nearest.camera, distanceKm: nearest.distanceKm },
    );
  };
  return (
    <>
      <p className="text-sm font-semibold text-white">
        {pickName(obs.station.nameTh, obs.station.nameEn, lang) ??
          t("water.stationFallback", { id: obs.station.id })}
      </p>
      <p className="text-[11px] text-[var(--color-fg-muted)]">
        {[obs.station.amphoeNameTh, obs.station.basinNameTh, obs.station.agencyShortTh].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-2 flex flex-col gap-0.5">
        {/* ค่าย้อนหลังไม่มี situationLevel จาก ThaiWater — ต้องบอกว่าไม่ระบุ ไม่ใช่เดาระดับให้ */}
        {obs.situationLevel ? (
          <Row k={t("popup.situationThaiwater")} v={t(SITUATION[obs.situationLevel])} />
        ) : (
          <Row k={t("popup.situation")} v={t("popup.situationHistorical")} />
        )}
        {obs.waterlevelMsl !== null ? (
          <Row k={t("popup.waterlevel")} v={`${obs.waterlevelMsl.toFixed(2)} ${t("unit.msl")}`} />
        ) : null}
        {obs.minBankMsl !== null ? (
          <Row k={t("popup.minBank")} v={`${obs.minBankMsl.toFixed(2)} ${t("unit.msl")}`} />
        ) : null}
        {obs.freeboardM !== null ? (
          <Row
            k={obs.freeboardM <= 0 ? t("popup.aboveBank") : t("popup.belowBank")}
            v={`${Math.abs(obs.freeboardM).toFixed(2)} ${t("unit.m")}`}
          />
        ) : null}
        {criticalLevelMsl !== null ? (
          <Row k={t("popup.criticalLevel")} v={`${criticalLevelMsl.toFixed(2)} ${t("unit.msl")}`} />
        ) : null}
        {dischargeM3s !== null ? (
          <Row k={t("popup.discharge")} v={`${formatNumber(lang, dischargeM3s, 1)} ${t("unit.m3s")}`} />
        ) : null}
        {/* เฉพาะเมื่อมีทั้งอัตราการไหลและความจุลำน้ำที่ต้นทางเผยแพร่ — ไม่มีสัดส่วนที่เดาขึ้นเอง */}
        {qmaxPct !== null ? (
          <Row k={t("popup.qmaxPct")} v={`${formatNumber(lang, qmaxPct)}% (${formatNumber(lang, qmaxM3s)} ${t("unit.m3s")})`} />
        ) : null}
        <Row k={t("popup.observedAt")} v={fmtTime(lang, obs.observedAt)} />
      </div>
      {nearest && onOpenCamera ? (
        <button
          type="button"
          onClick={openNearest}
          aria-haspopup="dialog"
          className="mt-1.5 flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg bg-white/5 px-2 py-1 text-[11px] text-[var(--color-fg)] hover:bg-white/10"
        >
          <span className="inline-flex items-center gap-1.5">
            {nearest.source === "dwr" ? (
              <Camera size={12} aria-hidden="true" className="text-[#0ea5e9]" />
            ) : nearest.camera.stream.kind === "jpeg" ? (
              <Camera size={12} aria-hidden="true" className="text-[#fbbf24]" />
            ) : (
              <Video size={12} aria-hidden="true" className="text-[#fbbf24]" />
            )}
            {t(nearest.source === "dwr" ? "popup.cctv.nearest" : "popup.itic.nearest", {
              km: nearest.distanceKm.toFixed(1),
            })}
          </span>
          <span className="text-[var(--color-accent)]">
            {t(
              nearest.source === "dwr"
                ? "popup.cctv.open"
                : nearest.camera.stream.kind === "jpeg"
                  ? "popup.itic.openSnapshot"
                  : "popup.itic.open",
            )}
          </span>
        </button>
      ) : null}
      <div className="mt-2 rounded-lg bg-black/30 px-2 py-1.5">
        {history.loading ? (
          <div className="h-16 animate-pulse rounded bg-white/8" />
        ) : history.data ? (
          <>
            <Sparkline
              points={history.data.points}
              bankMsl={history.data.datum === "msl" ? obs.minBankMsl : null}
              series={series}
            />
            {history.data.points.some((p) => p.discharge !== null) ? (
              <span className="mb-0.5 flex w-fit rounded bg-white/5 p-0.5">
                {(["level", "discharge"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSeries(k)}
                    aria-pressed={series === k}
                    className={`cursor-pointer rounded px-1.5 text-[10px] ${series === k ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-fg-muted)]"}`}
                  >
                    {t(k === "level" ? "popup.series.level" : "popup.series.discharge")}
                  </button>
                ))}
              </span>
            ) : null}
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-[var(--color-fg-subtle)]">
                {t("popup.realObserved")}
                {history.data.fromArchive ? t("popup.partlyArchive") : ""}
              </p>
              <span className="flex rounded bg-white/5 p-0.5">
                {HISTORY_RANGES.map((r) => (
                  <button
                    key={r.hours}
                    type="button"
                    onClick={() => setHours(r.hours)}
                    className={`cursor-pointer rounded px-1.5 text-[10px] ${hours === r.hours ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-fg-muted)]"}`}
                  >
                    {t(r.labelKey)}
                  </button>
                ))}
              </span>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("popup.noHistory")}</p>
        )}
      </div>
    </>
  );
}

export function InfoPopup({
  pick,
  onClose,
  cctv = null,
  itic = null,
  onOpenCamera = null,
}: {
  /** กล้อง (`cctv`/`itic`) ไม่มาที่นี่ — เปิดในแผงด้านขวา (`CameraSheet`) */
  pick: PickResult;
  onClose: () => void;
  /** E15 — null = แฟล็ก/ชั้น CCTV ปิด */
  cctv?: CctvPopupContext | null;
  /** E15.2 — null = แฟล็ก iTIC/ชั้น CCTV ปิด */
  itic?: ItiCPopupContext | null;
  /** เปิดกล้องใกล้เคียงของสถานีในแผงด้านขวา — null = ไม่มีปุ่ม */
  onOpenCamera?: OpenCamera | null;
}) {
  const { lang, t } = useLang();
  return (
    <div className="glass pointer-events-auto relative w-72 rounded-xl px-3 py-2.5 shadow-2xl">
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        className="absolute top-1.5 right-1.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-white/10 hover:text-white"
      >
        <X size={13} />
      </button>
      {pick.kind === "waterlevel" ? (
        <WaterLevelBody
          key={pick.obs.station.id}
          pick={pick}
          lang={lang}
          t={t}
          cctv={cctv}
          itic={itic}
          onOpenCamera={onOpenCamera}
        />
      ) : null}
      {pick.kind === "rainfall" ? (
        <>
          <p className="text-sm font-semibold text-white">
            {pickName(pick.obs.station.nameTh, pick.obs.station.nameEn, lang) ??
              t("water.stationFallback", { id: pick.obs.station.id })}
          </p>
          <p className="text-[11px] text-[var(--color-fg-muted)]">
            {[pick.obs.station.amphoeNameTh, pick.obs.station.agencyShortTh].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex flex-col gap-0.5">
            <Row
              k={t("popup.rain24h")}
              v={pick.obs.rain24h !== null ? `${pick.obs.rain24h.toFixed(1)} ${t("unit.mm")}` : "—"}
            />
            <Row
              k={t("popup.rain1h")}
              v={pick.obs.rain1h !== null ? `${pick.obs.rain1h.toFixed(1)} ${t("unit.mm")}` : "—"}
            />
            <Row k={t("popup.observedAt")} v={fmtTime(lang, pick.obs.observedAt)} />
          </div>
        </>
      ) : null}
      {pick.kind === "dam" ? (
        <>
          <p className="text-sm font-semibold text-white">
            {damDisplayName(pick.dam, lang, t)}
          </p>
          <p className="text-[11px] text-[var(--color-fg-muted)]">
            {[pick.dam.basinNameTh, pick.dam.agencyShortTh].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex flex-col gap-0.5">
            <Row
              k={t("popup.damStorage")}
              v={pick.dam.storagePercent !== null ? `${pick.dam.storagePercent.toFixed(1)} ${t("unit.percent")}` : "—"}
            />
            <Row
              k={t("popup.damVolume")}
              v={pick.dam.storageMcm !== null ? `${formatNumber(lang, pick.dam.storageMcm, 1)} ${t("unit.mcm")}` : "—"}
            />
            {pick.dam.maxStorageMcm !== null ? (
              <Row k={t("popup.damMax")} v={`${formatNumber(lang, pick.dam.maxStorageMcm)} ${t("unit.mcm")}`} />
            ) : null}
            {pick.dam.inflowMcm !== null ? (
              <Row k={t("popup.damInflow")} v={`${pick.dam.inflowMcm.toFixed(2)} ${t("unit.mcmPerDay")}`} />
            ) : null}
            {pick.dam.releasedMcm !== null ? (
              <Row k={t("popup.damReleased")} v={`${pick.dam.releasedMcm.toFixed(2)} ${t("unit.mcmPerDay")}`} />
            ) : null}
            <Row k={t("popup.reportedAt")} v={fmtTime(lang, pick.dam.observedAt)} />
          </div>
        </>
      ) : null}
      {pick.kind === "quake" ? (
        <>
          <p className="text-sm font-semibold text-white">
            {t("popup.quakeTitle", { mag: pick.event.mag?.toFixed(1) ?? "—" })}
          </p>
          <p className="text-[11px] text-[var(--color-fg-muted)]">
            {pick.event.place ?? t("quake.unknownPlace")}
          </p>
          <div className="mt-2 flex flex-col gap-0.5">
            <Row
              k={t("popup.depth")}
              v={pick.event.depthKm !== null ? `${pick.event.depthKm.toFixed(0)} ${t("unit.km")}` : "—"}
            />
            <Row k={t("popup.localTime")} v={fmtTime(lang, pick.event.time)} />
            <Row k={t("popup.source")} v={pick.event.sources.join(" / ").toUpperCase()} />
            <Row
              k={t("popup.status")}
              v={pick.event.status === "automatic" ? t("popup.statusAutomatic") : t("popup.statusReviewed")}
            />
          </div>
          {/* จังหวัดใกล้เคียงมาจากระยะถึงขอบเขตจังหวัดที่คิดไว้ตอน ingest —
              ระเบียนที่ยังไม่มีค่านี้ต้องบอกตรง ๆ ว่ายังไม่ได้คำนวณ ไม่ใช่เงียบ */}
          <div className="mt-2 border-t border-white/10 pt-1.5">
            <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("popup.nearestProvinces")}</p>
            {pick.event.nearest && pick.event.nearest.length > 0 ? (
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {pick.event.nearest.map((n) => (
                  <li key={n.provinceCode} className="text-[11px] text-[var(--color-fg)]">
                    {nearestProvinceLabel(t, lang, n)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-[11px] text-[var(--color-fg-muted)]">
                {t("quake.nearest.unknown")}
              </p>
            )}
            <p className="mt-1 text-[10px] text-[var(--color-fg-subtle)]">{t("quake.nearest.note")}</p>
          </div>
          {pick.event.url ? (
            <a
              href={pick.event.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[var(--color-accent)] hover:underline"
            >
              <ExternalLink size={11} aria-hidden="true" />
              {t("quake.eventPage")}
            </a>
          ) : null}
        </>
      ) : null}
      {pick.kind === "ground" ? (
        <>
          <p className="text-sm font-semibold text-white">
            {pick.flood
              ? t("popup.floodTitle", { tambon: pick.flood.properties.tambonTh ?? "" })
              : t("popup.mapPoint")}
          </p>
          <div className="mt-2 flex flex-col gap-0.5">
            <Row k={t("popup.coords")} v={`${pick.lat.toFixed(5)}, ${pick.lon.toFixed(5)}`} />
            <Row k={t("popup.elevation")} v={`${pick.elevationM.toFixed(0)} ${t("unit.m")}`} />
            {pick.flood ? (
              <>
                <Row k={t("popup.amphoe")} v={pick.flood.properties.amphoeTh ?? "—"} />
                {pick.flood.properties.h3 ? <Row k={t("popup.h3Cell")} v={pick.flood.properties.h3} /> : null}
                <Row
                  k={t("popup.floodArea")}
                  v={
                    pick.flood.properties.floodAreaM2 !== null
                      ? `${formatNumber(lang, Math.round(m2ToRai(pick.flood.properties.floodAreaM2) * 10) / 10)} ${t("unit.rai")}`
                      : "—"
                  }
                />
                {/* เวลาภาพ = ภาพใหม่สุดที่ GISTDA ระบุไว้สำหรับเซลล์นี้ — null (ฉาก WFS เดิม) แสดง "—" ไม่ใช่ "ตอนนี้" */}
                <Row
                  k={t("popup.imageTime")}
                  v={
                    pick.flood.properties.observedAt
                      ? `${fmtTime(lang, pick.flood.properties.observedAt)}${
                          pick.flood.properties.acquisitions?.[0]
                            ? ` · ${sensorLabel(pick.flood.properties.acquisitions[0].sensor)}`
                            : ""
                        }`
                      : "—"
                  }
                />
                <Row k={t("popup.firstSeen")} v={fmtTime(lang, pick.flood.properties.firstSeenAt)} />
              </>
            ) : null}
          </div>
          {pick.flood ? (
            <p className="mt-1.5 text-[10px] text-[var(--color-fg-subtle)]">{t("popup.floodNote")}</p>
          ) : null}
          {/* เซลล์ GFM ใต้จุดนี้ (E14.F5) — null = ไม่มีฉากที่วาดอยู่ จึงไม่พูดถึงเลย ไม่ใช่ "แห้ง" */}
          {pick.floodCell ? <GfmCellBlock cell={pick.floodCell} lang={lang} t={t} /> : null}
        </>
      ) : null}
    </div>
  );
}
