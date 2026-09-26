import { Camera as CameraIcon, ExternalLink, RefreshCw, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SOURCES, cameraKey, type Camera, type CameraStream, type CameraStreamKind } from "@siahra/shared-types";
import { useNow } from "../../hooks/useNow";
import type { Lang, MessageKey, TFunction } from "../../i18n";
import { isAllowedStreamUrl, isAllowedUrl } from "../../lib/cameraSources";
import { cameraName, type CameraContext } from "../../lib/cameraSheet";
import {
  DWR_LIVE_MAX_MS,
  DWR_LIVE_RECONNECT_MS,
  coLocatedCameras,
  distinctLabels,
  dwrLiveUrl,
  fetchSnapshot,
  freshness,
  isDwrFrameFresh,
  type SnapshotCache,
  type SnapshotResult,
} from "../../lib/cctv";
import {
  JPEG_POLL_MAX_MS,
  JPEG_POLL_REFRESH_MS,
  fetchJpegOnce,
  snapshotFrameUrl,
  startHlsPlayer,
  startJpegPoll,
  type HlsPlayerState,
  type JpegFetchResult,
  type JpegPollState,
} from "../../lib/streams";
import { formatDateTime, formatFullDateTime } from "../../lib/time";
import { markerStyle } from "../../scene/CctvMarkers";

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 text-[11px]">
      <span className="text-[var(--color-fg-subtle)]">{k}</span>
      <span className="tabular-nums text-[var(--color-fg)]">{v}</span>
    </div>
  );
}

/** ป้ายของสตรีมเมื่อบัญชีไม่ให้ `label` — ต่อชนิด ไม่ใช่ต่อแหล่ง */
const KIND_LABEL: Record<CameraStreamKind, MessageKey> = {
  "dwr-snapshot": "popup.camera.kind.dwrSnapshot",
  "dwr-mjpeg": "popup.camera.kind.dwrMjpeg",
  hls: "popup.camera.kind.hls",
  mjpeg: "popup.camera.kind.mjpeg",
  jpeg: "popup.camera.kind.jpeg",
  "jpeg-fetch": "popup.camera.kind.jpegFetch",
};

const VIDEO_KINDS: ReadonlySet<CameraStreamKind> = new Set(["hls", "mjpeg", "dwr-mjpeg"]);

const ACTION_CLASS =
  "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-white/8 px-1.5 py-0.5 text-[10px] text-[var(--color-fg)] hover:bg-white/15 disabled:cursor-default disabled:opacity-50";
const FRAME_MSG_CLASS =
  "absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] leading-snug text-[var(--color-fg-muted)]";
const BADGE_CLASS = "pointer-events-none absolute top-1.5 right-1.5 rounded bg-black/75 px-1.5 py-px text-[10px] text-white";
const LIVE_BADGE_CLASS =
  "pointer-events-none absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded bg-[#dc2626]/90 px-1.5 py-px text-[10px] font-semibold text-white";

function ActionButton({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={ACTION_CLASS}>
      <RefreshCw size={10} aria-hidden="true" />
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------------------------------------
 * dwr-snapshot — ภาพล่าสุดของกล้อง DWR หนึ่งตัว (E15): ขอจาก DWR ตอน mount เท่านั้น (คือตอนผู้ใช้เปิดแผง)
 * ภาพที่ได้ภายใน 5 นาทีมาจากแคช (กุญแจ `cameraKey`)
 *
 * - เวลาถ่ายมาจาก path ของภาพ; แปลงไม่ได้ = "ไม่ทราบ" ไม่ใช่เวลาปัจจุบัน
 * - `fetchedAt` แสดงเฉพาะหลังได้ภาพสำเร็จ
 * - ภาพเก่า (> 45 นาที) หรี่ลงพร้อมป้าย — ยังแสดงอยู่ ไม่ซ่อน
 * - ล้มเหลวสองแบบ (`unreachable` / `no-image`) มีข้อความของตัวเอง และไม่มีแบบไหนพูดว่ากล้องหรือ
 *   พื้นที่ "ปกติ/เงียบ"
 * ---------------------------------------------------------------------------------------------- */

type SnapshotView = { status: "loading" } | { status: "done"; result: SnapshotResult };

function DwrSnapshotView({
  camera,
  cache,
  name,
  allowed,
  lang,
  t,
}: {
  camera: Camera;
  cache: SnapshotCache;
  name: string;
  allowed: boolean;
  lang: Lang;
  t: TFunction;
}) {
  const nowMs = useNow();
  const key = cameraKey(camera);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<SnapshotView>(() => {
    if (!allowed) return { status: "done", result: { kind: "unreachable", detail: "url rejected" } };
    const hit = cache.get(key);
    return hit ? { status: "done", result: hit } : { status: "loading" };
  });

  useEffect(() => {
    if (!allowed) return;
    if (reload === 0) {
      const hit = cache.get(key);
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
        if (result.kind === "ok") cache.set(key, result);
        setView({ status: "done", result });
      })
      .catch(() => {
        // AbortError เท่านั้น (ปิดแผง/สลับกล้อง) — fetchSnapshot แปลงความล้มเหลวอื่นเป็นผลลัพธ์แล้ว
      });
    return () => controller.abort();
  }, [camera.id, key, cache, reload, allowed]);

  const result = view.status === "done" ? view.result : null;
  const ok = result?.kind === "ok" ? result : null;
  const fresh = ok?.observedAt ? freshness(ok.observedAt, nowMs, lang) : null;
  const dim = fresh !== null && fresh.level !== "fresh";

  return (
    <div data-stream-state={view.status === "loading" ? "loading" : result?.kind}>
      <div className="relative mt-2 aspect-video w-full overflow-hidden rounded-lg bg-black/40">
        {ok ? (
          <img
            src={ok.blobUrl}
            alt={t("stream.dwrSnapshot.alt", { name })}
            className={`h-full w-full object-cover ${dim ? "opacity-55 grayscale-[35%]" : ""}`}
          />
        ) : (
          <p className={FRAME_MSG_CLASS}>
            {view.status === "loading"
              ? t("stream.dwrSnapshot.loading")
              : result?.kind === "no-image"
                ? t("stream.dwrSnapshot.noImage")
                : result?.kind === "unreachable"
                  ? t("stream.dwrSnapshot.unreachable", { detail: result.detail })
                  : null}
          </p>
        )}
        {fresh && fresh.level !== "fresh" ? (
          <span className="absolute top-1.5 left-1.5 rounded bg-[var(--color-risk-medium)]/90 px-1.5 py-px text-[10px] font-medium text-black">
            {t(fresh.level === "old" ? "stream.dwrSnapshot.old" : "stream.dwrSnapshot.stale")}
          </span>
        ) : null}
        {ok ? (
          // ป้าย "ภาพนิ่ง" + เวลาถ่าย บนตัวภาพเสมอ — ไม่ให้ภาพนิ่งถูกอ่านเป็นภาพสด
          <span className={BADGE_CLASS}>
            {ok.observedAt
              ? t("stream.dwrSnapshot.badge", { time: formatDateTime(lang, ok.observedAt) })
              : t("stream.dwrSnapshot.badgeNoTime")}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-col gap-0.5">
        {ok ? (
          <>
            <Row
              k={t("stream.dwrSnapshot.takenAt")}
              v={ok.observedAt ? formatFullDateTime(lang, ok.observedAt) : t("stream.dwrSnapshot.takenAtUnknown")}
            />
            {fresh ? <Row k={t("stream.dwrSnapshot.age")} v={fresh.label} /> : null}
            <Row k={t("stream.dwrSnapshot.fetchedAt")} v={formatDateTime(lang, ok.fetchedAt)} />
          </>
        ) : null}
      </div>
      {allowed ? (
        <div className="mt-1.5 flex justify-end">
          <ActionButton label={t("stream.dwrSnapshot.refresh")} onClick={() => setReload((n) => n + 1)} disabled={view.status === "loading"} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * mjpeg / dwr-mjpeg — `<img>` ชี้ไปที่สตรีม `multipart/x-mixed-replace` ตรง ๆ (E15.2, generalised E15.3:
 * `urlFor(n)` มาจากผู้เรียก — DWR derive จาก `stationCode`, `mjpeg` ทั่วไปใช้ url ในบัญชี + ตัวกันแคช)
 *
 * - ต้นทาง (DWR) ตัดการเชื่อมต่อเองหลัง ~11–24 วินาที จึงต่อใหม่ทุก ~15 วินาทีขณะเปิดอยู่ (ตัวกันแคช
 *   ใหม่ทุกครั้ง) และหยุดเองหลัง `DWR_LIVE_MAX_MS` (กดดูต่อได้) — แผงที่ลืมเปิดค้างไว้ต้องไม่ต่อ
 *   เซิร์ฟเวอร์ของต้นทางไปเรื่อย ๆ
 * - สอง `<img>` สลับกัน: การต่อใหม่โหลดเข้าภาพที่ซ่อนอยู่ แล้วสลับเมื่อได้เฟรมแรก — ตั้ง src ใหม่
 *   บนภาพที่กำลังแสดงจะทำให้ภาพว่าง 2–3 วินาทีทุกรอบ (วัดใน Chromium 2026-09-26)
 * - "กำลังเชื่อมต่อ…" จนกว่าจะได้เฟรมแรก (`load` หรือ `naturalWidth > 0` — แล้วแต่อะไรมาก่อน)
 * - ป้าย "สด" เฉพาะเมื่อเห็นเฟรมใหม่จริงภายใน `DWR_LIVE_STALE_MS` — `load` ยิงครั้งเดียวต่อการ
 *   เชื่อมต่อ และไม่มี event ตอนต้นทางปิดสตรีม จึงสุ่มพิกเซลของภาพที่แสดงลง canvas 32×18 ทุก 0.4
 *   วินาที (ต้อง `crossOrigin="anonymous"` ซึ่งตั้งเฉพาะเมื่อ probe ตอน build เห็นว่าต้นทางให้ CORS —
 *   ไม่งั้นภาพจะโหลดไม่ขึ้นเลย) พิกเซลเปลี่ยน = เฟรมใหม่; เงียบนานกว่านั้น = "กำลังเชื่อมต่อใหม่…"
 *   โดยยังแสดงเฟรมเดิม แล้วกลับเป็น "สด" เมื่อได้เฟรมถัดไป ข้อจำกัดที่ตรวจไม่ได้: ฉากที่นิ่งสนิทจน
 *   ภาพย่อ 32×18 ไม่เปลี่ยนเลย แยกจาก "ไม่มีเฟรมใหม่" ไม่ออก — จะขึ้น "กำลังเชื่อมต่อใหม่" ทั้งที่ยังสด
 *   (ผิดไปทางระวัง ไม่ใช่ทางอ้างว่าสด); ถ้าอ่านพิกเซลไม่ได้ (canvas ติด taint / ไม่มี CORS) ถอยไปใช้
 *   "สดได้นานสุด `DWR_LIVE_OBSERVED_LIFETIME_MS` หลังเฟรมแรก"
 * - การต่อใหม่ที่ไม่ได้เฟรมสองรอบติด หรือ `error` = ล้มเหลว (ไม่ค้างป้าย "สด" บนเฟรมเก่า)
 * - ปิด/unmount/สลับสตรีม = ตั้ง src ของทั้งสองภาพเป็น "" เพื่อทิ้งการเชื่อมต่อทันที
 * - สตรีมไม่มีเวลาถ่ายกำกับ — จึงไม่แสดงเวลาใดเป็นเวลาถ่าย (ไม่ใช้นาฬิกาเครื่อง)
 * - ล้มเหลว = `<img>` ไม่บอกว่าเป็น 0 ไบต์หรือเครือข่าย ข้อความจึงพูดตามนั้น
 * ---------------------------------------------------------------------------------------------- */

type MjpegStatus = "connecting" | "live" | "reconnecting" | "failed" | "paused";

/**
 * ตัวนับการเชื่อมต่อภาพสดทั้งหน้า — ทุกครั้งที่ตั้ง src ต้องได้ URL ใหม่จริง: ถ้า URL ซ้ำกับครั้งก่อน
 * (เช่น effect ถูก mount → cleanup → mount ซ้ำ) Chromium อาจผูก `<img>` เข้ากับคำขอเดิมที่เพิ่ง
 * ถูกยกเลิกแล้วไม่ได้เฟรมเลย
 */
let mjpegSeq = 0;

function MjpegView({
  urlFor,
  allowed,
  cors,
  name,
  t,
}: {
  /** URL ของการเชื่อมต่อครั้งที่ `n` — ต้องต่างกันทุกครั้ง */
  urlFor: (n: number) => string;
  allowed: boolean;
  /** ต้นทางให้ CORS (probe ตอน build) → อ่านพิกเซลตรวจเฟรมใหม่ได้ */
  cors: boolean;
  name: string;
  t: TFunction;
}) {
  const imgARef = useRef<HTMLImageElement>(null);
  const imgBRef = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<MjpegStatus>(allowed ? "connecting" : "failed");
  /** เพิ่มทุกครั้งที่กด "ลองใหม่/ดูต่อ" — เชื่อมต่อใหม่และเริ่มนับเวลาดูสดใหม่ */
  const [session, setSession] = useState(0);

  useEffect(() => {
    const a = imgARef.current;
    const b = imgBRef.current;
    if (!a || !b || !allowed) return;
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
    const probeCtx = cors ? probe.getContext("2d", { willReadFrequently: true }) : null;
    let perFrame = probeCtx !== null;
    let lastHash: number | null = null;

    const connect = (i: number) => {
      mjpegSeq += 1;
      pending = i;
      imgs[i].src = urlFor(mjpegSeq);
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
        // การเชื่อมต่อเก่า (ซึ่งต้นทางน่าจะปิดไปแล้ว) ถูกทิ้ง
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
        // หยุดต่อใหม่แต่ **ไม่** ล้างภาพที่แสดง — เฟรมสุดท้ายตามที่ป้ายบอก และต้นทางตัดสตรีมเอง
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
        // ทิ้งการเชื่อมต่อ multipart ที่ค้างอยู่ (ปิดแผง, สลับสตรีม, เริ่มดูสดรอบใหม่)
        img.src = "";
      }
    };
  }, [urlFor, allowed, cors, session]);

  const restart = () => {
    setSession((x) => x + 1);
    setStatus("connecting");
  };

  return (
    <div data-stream-state={status}>
      <div className="relative mt-2 aspect-video w-full overflow-hidden rounded-lg bg-black/40">
        {/* crossOrigin ให้อ่านพิกเซลเพื่อตรวจเฟรมใหม่ได้ (เฉพาะต้นทางที่ให้ CORS) — ต้องตั้งก่อน src */}
        <img
          ref={imgARef}
          crossOrigin={cors ? "anonymous" : undefined}
          alt={t("stream.mjpeg.alt", { name })}
          className="invisible absolute inset-0 h-full w-full object-cover"
        />
        <img
          ref={imgBRef}
          crossOrigin={cors ? "anonymous" : undefined}
          alt={t("stream.mjpeg.alt", { name })}
          className="invisible absolute inset-0 h-full w-full object-cover"
        />
        {status === "connecting" || status === "failed" ? (
          <p className={FRAME_MSG_CLASS}>{status === "connecting" ? t("stream.mjpeg.connecting") : t("stream.mjpeg.failed")}</p>
        ) : null}
        {status === "live" ? (
          <span className={LIVE_BADGE_CLASS}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" />
            {t("stream.mjpeg.liveBadge")}
          </span>
        ) : null}
        {status === "paused" || status === "reconnecting" ? (
          <span className={BADGE_CLASS}>{t(status === "paused" ? "stream.mjpeg.pausedBadge" : "stream.mjpeg.reconnectingBadge")}</span>
        ) : null}
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-[var(--color-fg-subtle)]">
        {status === "paused" ? t("stream.mjpeg.paused") : status === "reconnecting" ? t("stream.mjpeg.reconnecting") : t("stream.mjpeg.noTime")}
      </p>
      {allowed && (status === "failed" || status === "paused") ? (
        <div className="mt-1 flex justify-end">
          <ActionButton label={t(status === "paused" ? "stream.mjpeg.resume" : "stream.mjpeg.retry")} onClick={restart} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * hls — วิดีโอจากกล้องหนึ่งตัว (E15.2): สตรีมเริ่มตอน mount เท่านั้น (ผู้ใช้เปิดแผง/สลับสตรีม) และถูกตัด
 * ทันทีตอน unmount (`startHlsPlayer` คืนตัวหยุด)
 *
 * - สถานะ loading / live / buffering / suspended / unreachable / unsupported มีข้อความของตัวเอง
 *   ทั้งหมด และไม่มีแบบไหนพูดถึงสภาพถนน การจราจร หรือพื้นที่ — `buffering` แสดงเฟรมที่ค้างอยู่
 *   พร้อมป้ายสีกลาง ไม่ใช่ป้าย "สด" (และไม่ใช่ความล้มเหลว จึงไม่มีปุ่มลองใหม่)
 * - เวลา: EXT-X-PROGRAM-DATE-TIME ของสตรีมเท่านั้น ไม่มี = บอกตรง ๆ ว่าสตรีมไม่มีเวลากำกับ
 * ---------------------------------------------------------------------------------------------- */

function HlsView({
  url,
  allow,
  name,
  lang,
  t,
}: {
  url: string;
  allow: (url: string) => boolean;
  name: string;
  lang: Lang;
  t: TFunction;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<HlsPlayerState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    return startHlsPlayer(video, url, setState, allow);
  }, [url, allow, attempt]);

  const failed = state.status === "suspended" || state.status === "unreachable" || state.status === "unsupported";
  /** มีภาพจากสตรีมแล้ว (กำลังเล่น ค้างรอบัฟเฟอร์ หรือผู้ใช้หยุดเอง) */
  const playing = state.status === "live" || state.status === "buffering" || state.status === "paused";

  return (
    <div data-stream-state={state.status}>
      <div className="relative mt-2 aspect-video w-full overflow-hidden rounded-lg bg-black/60">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          controls={playing}
          aria-label={t("stream.hls.videoLabel", { name })}
          className={`h-full w-full object-contain ${playing ? "" : "invisible"}`}
        />
        {state.status === "buffering" ? (
          <span className={BADGE_CLASS}>{t("stream.hls.bufferingBadge")}</span>
        ) : state.status === "paused" ? (
          <span className={BADGE_CLASS}>{t("stream.hls.pausedBadge")}</span>
        ) : !playing ? (
          <p className={FRAME_MSG_CLASS}>
            {state.status === "loading"
              ? t("stream.hls.loading")
              : state.status === "suspended"
                ? t("stream.hls.suspended", { detail: state.detail })
                : state.status === "unreachable"
                  ? t("stream.hls.unreachable", { detail: state.detail })
                  : t("stream.hls.unsupported", { detail: state.detail })}
          </p>
        ) : (
          <span className={LIVE_BADGE_CLASS}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" />
            {t("stream.hls.liveBadge")}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-0.5">
        {state.status === "buffering" ? (
          <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">{t("stream.hls.buffering")}</p>
        ) : state.status === "paused" ? (
          <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">{t("stream.hls.paused")}</p>
        ) : null}
        {playing ? (
          state.programDateTime ? (
            <Row k={t("stream.hls.streamTime")} v={formatFullDateTime(lang, state.programDateTime)} />
          ) : (
            <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">{t("stream.hls.noStreamTime")}</p>
          )
        ) : null}
      </div>
      {failed && state.detail !== "url rejected" ? (
        <div className="mt-1 flex justify-end">
          <ActionButton label={t("stream.hls.retry")} onClick={() => setAttempt((n) => n + 1)} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * jpeg — ภาพนิ่งที่ขอใหม่ทุก ~5 วินาทีขณะ mount (`startJpegPoll`) และตัดทันทีตอน unmount (`src = ""`)
 *
 * - ป้ายบนภาพคือ "ภาพนิ่งรีเฟรชอัตโนมัติ" เสมอ — ไม่ใช่ "สด"
 * - สถานะ loading / ok / unreachable / paused มีข้อความของตัวเอง ไม่มีแบบไหนพูดถึงสภาพพื้นที่;
 *   `unreachable` หลังเคยได้ภาพ = ภาพเดิมค้างไว้แบบหรี่พร้อมเวลาที่ได้ภาพนั้น
 * - เวลา: แสดงเฉพาะ "ได้ภาพล่าสุดเมื่อ" (นาฬิกาเครื่องตอนได้ภาพ) — เวลาถ่าย (ถ้ามี) พิมพ์ไว้บนภาพเอง
 *   ไม่มีเป็นข้อมูล จึงบอกตรง ๆ และไม่ใช้นาฬิกาเครื่องเป็นเวลาถ่าย
 * ---------------------------------------------------------------------------------------------- */

function JpegView({
  url,
  allow,
  name,
  lang,
  t,
}: {
  url: string;
  allow: (url: string) => boolean;
  name: string;
  lang: Lang;
  t: TFunction;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<JpegPollState>({ status: "loading" });
  const [session, setSession] = useState(0);
  // ข้อความ alt ตามภาษาปัจจุบัน — อ่านผ่าน ref เพื่อไม่ให้การสลับภาษาเริ่มรอบขอภาพใหม่
  const alt = t("stream.jpeg.alt", { name });
  const altRef = useRef(alt);
  useEffect(() => {
    altRef.current = alt;
    const shown = frameRef.current?.querySelector("img");
    if (shown) shown.alt = alt;
  }, [alt]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    return startJpegPoll(
      url,
      setState,
      {
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
      },
      allow,
    );
  }, [url, allow, session]);

  const lastFetchedAt = state.status === "ok" ? state.fetchedAt : state.status === "loading" ? null : state.lastFetchedAt;
  const hasFrame = lastFetchedAt !== null;
  /** ภาพที่แสดงไม่ใช่ผลของรอบล่าสุด (ล้ม) หรือหยุดรีเฟรชแล้ว → หรี่ */
  const dim = state.status === "unreachable" || (state.status === "paused" && (state.lastFailed || !hasFrame));
  const message =
    state.status === "loading"
      ? t("stream.jpeg.loading")
      : state.status === "unreachable"
        ? t("stream.jpeg.unreachable", {
            detail: t(`stream.jpeg.detail.${state.detail === "url rejected" ? "rejected" : state.detail}`),
          })
        : state.status === "paused"
          ? t("stream.jpeg.paused", { min: Math.round(JPEG_POLL_MAX_MS / 60_000) })
          : null;

  return (
    <div data-stream-state={state.status}>
      <div className="relative mt-2 aspect-video w-full overflow-hidden rounded-lg bg-black/60">
        {/* ลูกของ div นี้เป็นของ startJpegPoll (แทนภาพเมื่อได้เฟรมใหม่) — React ไม่เรนเดอร์อะไรในนี้ */}
        <div ref={frameRef} className={`h-full w-full ${dim ? "opacity-45 grayscale-[35%]" : ""}`} />
        {hasFrame ? (
          <span className={BADGE_CLASS}>{state.status === "paused" ? t("stream.jpeg.pausedBadge") : t("stream.jpeg.badge")}</span>
        ) : null}
        {message ? (
          <p
            className={
              hasFrame
                ? "absolute inset-x-0 bottom-0 bg-black/75 px-2 py-1 text-[10px] leading-snug text-[var(--color-fg)]"
                : FRAME_MSG_CLASS
            }
          >
            {message}
          </p>
        ) : null}
      </div>
      <div className="mt-2 flex flex-col gap-0.5">
        <Row k={t("stream.jpeg.fetchedAt")} v={lastFetchedAt ? formatFullDateTime(lang, lastFetchedAt) : t("stream.jpeg.neverFetched")} />
        <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">
          {t("stream.jpeg.captureTime", { s: Math.round(JPEG_POLL_REFRESH_MS / 1000) })}
        </p>
      </div>
      {state.status === "paused" ? (
        <div className="mt-1 flex justify-end">
          <ActionButton label={t("stream.jpeg.resume")} onClick={() => setSession((n) => n + 1)} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * jpeg-fetch — ภาพนิ่งที่ต้อง `fetch()` เพื่ออ่าน `Last-Modified` (E15.3; ยังไม่มีแหล่งใดใช้ 2026-09-26)
 * ขอครั้งเดียวตอน mount + ปุ่มขอใหม่; `observedAt` เฉพาะเมื่อ `captureTime === "last-modified"` และ
 * ต้นทางให้ header จริง — ไม่งั้นบอกตรง ๆ ว่าไม่มีเวลาถ่าย object URL ถูก revoke เมื่อแทน/ปิด
 * ---------------------------------------------------------------------------------------------- */

type JpegFetchView = { status: "loading" } | { status: "done"; result: JpegFetchResult };

function JpegFetchView({
  url,
  allow,
  lastModifiedIsCapture,
  name,
  lang,
  t,
}: {
  url: string;
  allow: (url: string) => boolean;
  lastModifiedIsCapture: boolean;
  name: string;
  lang: Lang;
  t: TFunction;
}) {
  const nowMs = useNow();
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<JpegFetchView>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let blobUrl: string | null = null;
    setView({ status: "loading" });
    fetchJpegOnce(url, controller.signal, allow)
      .then((result) => {
        if (controller.signal.aborted) {
          if (result.kind === "ok") URL.revokeObjectURL(result.blobUrl);
          return;
        }
        if (result.kind === "ok") blobUrl = result.blobUrl;
        setView({ status: "done", result });
      })
      .catch(() => {
        // AbortError เท่านั้น — fetchJpegOnce แปลงความล้มเหลวอื่นเป็นผลลัพธ์แล้ว
      });
    return () => {
      controller.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [url, allow, reload]);

  const result = view.status === "done" ? view.result : null;
  const ok = result?.kind === "ok" ? result : null;
  const observedAt = ok && lastModifiedIsCapture ? ok.observedAt : null;
  const fresh = observedAt ? freshness(observedAt, nowMs, lang) : null;
  const dim = fresh !== null && fresh.level !== "fresh";

  return (
    <div data-stream-state={view.status === "loading" ? "loading" : result?.kind}>
      <div className="relative mt-2 aspect-video w-full overflow-hidden rounded-lg bg-black/40">
        {ok ? (
          <img src={ok.blobUrl} alt={t("stream.jpegFetch.alt", { name })} className={`h-full w-full object-contain ${dim ? "opacity-55 grayscale-[35%]" : ""}`} />
        ) : (
          <p className={FRAME_MSG_CLASS}>
            {view.status === "loading"
              ? t("stream.jpegFetch.loading")
              : result?.kind === "no-image"
                ? t("stream.jpegFetch.noImage")
                : result?.kind === "unreachable"
                  ? t("stream.jpegFetch.unreachable", { detail: result.detail })
                  : null}
          </p>
        )}
        {fresh && fresh.level !== "fresh" ? (
          <span className="absolute top-1.5 left-1.5 rounded bg-[var(--color-risk-medium)]/90 px-1.5 py-px text-[10px] font-medium text-black">
            {t(fresh.level === "old" ? "stream.dwrSnapshot.old" : "stream.dwrSnapshot.stale")}
          </span>
        ) : null}
        {ok ? (
          <span className={BADGE_CLASS}>
            {observedAt ? t("stream.jpegFetch.badge", { time: formatDateTime(lang, observedAt) }) : t("stream.jpegFetch.badgeNoTime")}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-col gap-0.5">
        {ok ? (
          <>
            {observedAt ? (
              <Row k={t("stream.jpegFetch.takenAt")} v={formatFullDateTime(lang, observedAt)} />
            ) : (
              <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">{t("stream.jpegFetch.noTime")}</p>
            )}
            {fresh ? <Row k={t("stream.dwrSnapshot.age")} v={fresh.label} /> : null}
            <Row k={t("stream.jpegFetch.fetchedAt")} v={formatDateTime(lang, ok.fetchedAt)} />
          </>
        ) : null}
      </div>
      {result?.kind !== "unreachable" || result.detail !== "url rejected" ? (
        <div className="mt-1.5 flex justify-end">
          <ActionButton label={t("stream.jpegFetch.refresh")} onClick={() => setReload((n) => n + 1)} disabled={view.status === "loading"} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * สตรีมหนึ่งเส้น → มุมมองตามชนิด (ทุกชนิดตรวจ allowlist ของแหล่งก่อนแตะเครือข่าย)
 * ---------------------------------------------------------------------------------------------- */

function mjpegUrlFactory(url: string): (n: number) => string {
  return (n) => snapshotFrameUrl(url, n, Date.now());
}

function StreamView({
  camera,
  stream,
  ctx,
  name,
  lang,
  t,
}: {
  camera: Camera;
  stream: CameraStream;
  ctx: CameraContext;
  name: string;
  lang: Lang;
  t: TFunction;
}) {
  const allowed = isAllowedStreamUrl(camera, stream);
  const { sourceId } = camera;
  const { kind } = stream;
  // guard/ตัวสร้าง URL ต่อสตรีม — memo เพื่อให้ effect ของตัวเล่นไม่รันซ้ำทุกเรนเดอร์ (StreamView ถูก
  // remount ต่อสตรีมอยู่แล้ว deps จึงนิ่งตลอดอายุ)
  const allow = useMemo(() => (u: string) => isAllowedUrl(sourceId, kind, u), [sourceId, kind]);
  const stationCode = stream.kind === "dwr-mjpeg" ? stream.stationCode : null;
  const mjpegUrl = stream.kind === "mjpeg" ? stream.url : null;
  const urlFor = useMemo(
    () => (stationCode !== null ? (n: number) => dwrLiveUrl(stationCode, n) : mjpegUrl !== null ? mjpegUrlFactory(mjpegUrl) : null),
    [stationCode, mjpegUrl],
  );
  switch (stream.kind) {
    case "dwr-snapshot":
      return <DwrSnapshotView camera={camera} cache={ctx.cache} name={name} allowed={allowed} lang={lang} t={t} />;
    case "dwr-mjpeg":
    case "mjpeg":
      return <MjpegView urlFor={urlFor!} allowed={allowed} cors={stream.probe.cors === true} name={name} t={t} />;
    case "hls":
      return <HlsView url={stream.url} allow={allow} name={name} lang={lang} t={t} />;
    case "jpeg":
      return <JpegView url={stream.url} allow={allow} name={name} lang={lang} t={t} />;
    case "jpeg-fetch":
      return (
        <JpegFetchView
          url={stream.url}
          allow={allow}
          lastModifiedIsCapture={stream.captureTime === "last-modified"}
          name={name}
          lang={lang}
          t={t}
        />
      );
  }
}

/* ------------------------------------------------------------------------------------------------
 * กล้องหนึ่งตัว: หัว (เจ้าของ · รหัส · ที่ตั้ง · ระยะ) → ตัวเลือกสตรีม (เมื่อมีมากกว่าหนึ่ง: DWR ภาพนิ่ง/ดูสด,
 * กรมทางหลวง ขาเข้า/ขาออก) → มุมมองสตรีม → ป้าย probe/พิกัด → เครดิต (เจ้าของ + แหล่งจาก `SOURCES`)
 * ---------------------------------------------------------------------------------------------- */

function ActiveCameraBody({
  camera,
  ctx,
  lang,
  t,
  distanceKm,
  showName,
}: {
  camera: Camera;
  ctx: CameraContext;
  lang: Lang;
  t: TFunction;
  distanceKm: number | null;
  showName: boolean;
}) {
  const [streamIdx, setStreamIdx] = useState(0);
  const name = cameraName(camera, lang, t);
  const stream: CameraStream | undefined = camera.streams[streamIdx] ?? camera.streams[0];
  const source = SOURCES[camera.sourceId];
  const probe = ctx.probes[camera.sourceId];
  const streamLabel = (s: CameraStream) => s.label ?? t(KIND_LABEL[s.kind]);

  return (
    <div data-camera={cameraKey(camera)} data-stream-kind={stream?.kind}>
      {showName ? <p className="pr-6 text-sm leading-snug font-semibold text-white">{name}</p> : null}
      <p className="text-[11px] text-[var(--color-fg-muted)]">
        {[camera.owner, camera.code, camera.placeTh, distanceKm !== null ? `${distanceKm.toFixed(1)} ${t("unit.km")}` : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {camera.streams.length > 1 ? (
        <div className="mt-2 flex rounded-md bg-white/5 p-0.5 text-[10px]" role="group" aria-label={t("popup.camera.streams")}>
          {camera.streams.map((s, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={i === streamIdx}
              onClick={() => setStreamIdx(i)}
              className={`flex-1 cursor-pointer truncate rounded px-1.5 py-0.5 ${
                i === streamIdx ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
              }`}
              title={streamLabel(s)}
            >
              <span className="inline-flex max-w-full items-center gap-1">
                {VIDEO_KINDS.has(s.kind) ? (
                  <Video size={10} aria-label={t("popup.camera.kindVideo")} className="shrink-0" />
                ) : (
                  <CameraIcon size={10} aria-label={t("popup.camera.kindStill")} className="shrink-0" />
                )}
                <span className="truncate">{streamLabel(s)}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {stream ? <StreamView key={streamIdx} camera={camera} stream={stream} ctx={ctx} name={name} lang={lang} t={t} /> : null}
      {/* ผล probe ตอน build — ข้อเท็จจริงของ build นั้น ไม่ใช่สถานะปัจจุบัน และสามกรณีต้องไม่ปนกัน:
          `not-probed` = ไม่ได้ถาม, `unreachable` = ถามไม่ได้จาก vantage นั้น (ไม่ใช่ต้นทางล่ม),
          ที่เหลือ (`empty`/`not-image`/`http-*`) = ต้นทางตอบแล้วแต่ไม่มีของให้ */}
      {stream && stream.probe.result !== "ok" ? (
        <p className="mt-1.5 text-[10px] leading-snug text-[var(--color-risk-medium)]" data-probe={stream.probe.result}>
          {stream.probe.result === "not-probed"
            ? t("popup.camera.notProbed")
            : stream.probe.result === "unreachable"
              ? t("popup.camera.unverified.unreachable", {
                  at: probe?.probedAt ? formatFullDateTime(lang, probe.probedAt) : "—",
                  vantage: probe?.probeVantage ?? "—",
                })
              : t("popup.camera.unverified.answered", {
                  result: stream.probe.result,
                  at: probe?.probedAt ? formatFullDateTime(lang, probe.probedAt) : "—",
                  vantage: probe?.probeVantage ?? "—",
                })}
        </p>
      ) : null}
      {camera.coordSource === "hand-placed" ? (
        <p className="mt-1 text-[10px] leading-snug text-[var(--color-fg-subtle)]">{t("popup.camera.handPlaced")}</p>
      ) : null}
      <div className="mt-1.5 flex flex-col gap-0.5 text-[10px]">
        {camera.owner ? <span className="text-[var(--color-fg-muted)]">{t("popup.camera.owner", { org: camera.owner })}</span> : null}
        <a
          href={source.homepageUrl}
          target="_blank"
          rel="noreferrer noopener"
          title={source.attributionText}
          className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
        >
          <ExternalLink size={10} aria-hidden="true" />
          {lang === "th" ? source.nameTh : source.nameEn}
        </a>
        <p className="text-[var(--color-fg-subtle)]">{t("popup.camera.rights")}</p>
      </div>
    </div>
  );
}

/**
 * เนื้อหาของกล้องที่เลือก (E15.3) — หมุดที่ตั้งซ้อนกัน (`coLocatedCameras`, ข้ามแหล่ง) คลิกได้แค่ตัวเดียว
 * จึงมีปุ่มสลับไปกล้องอื่นที่ตำแหน่งเดียวกัน (ไอคอนบอกชนิดของสตรีมหลัก); ตัวเล่น/ตัวขอภาพยังมีทีละตัว
 * (`ActiveCameraBody` ถูก remount ด้วย key → ตัวเก่าหยุดก่อน)
 *
 * `activeKey`/`onActiveChange` ให้แผงกล้อง (`CameraSheet`) คุมกล้องที่เลือกเอง เพื่อให้หัวแผง
 * แสดงชื่อและแหล่งของกล้องที่กำลังดูอยู่ ไม่ใช่ตัวที่ถูกคลิก
 */
export function CameraBody({
  camera,
  ctx,
  lang,
  t,
  distanceKm = null,
  activeKey: controlledKey,
  onActiveChange,
  showName = true,
}: {
  camera: Camera;
  ctx: CameraContext;
  lang: Lang;
  t: TFunction;
  /** ระยะจากสถานีที่เปิดมา (แถวกล้องใกล้เคียง) — null = เปิดจากหมุดกล้องโดยตรง */
  distanceKm?: number | null;
  activeKey?: string;
  onActiveChange?: (key: string) => void;
  /** false = ชื่อกล้องอยู่ที่หัวของแผงกล้อง (`CameraSheet`) แล้ว ไม่พิมพ์ซ้ำ */
  showName?: boolean;
}) {
  const [ownKey, setOwnKey] = useState(cameraKey(camera));
  const activeKey = controlledKey ?? ownKey;
  const setActiveKey = onActiveChange ?? setOwnKey;
  const cluster = coLocatedCameras(camera, ctx.cameras);
  const active = cluster.find((c) => cameraKey(c) === activeKey) ?? camera;
  const fullNames = cluster.map((c) => cameraName(c, lang, t));
  const labels = distinctLabels(fullNames);
  return (
    <>
      {cluster.length > 1 ? (
        <div className="mb-1.5 pr-6" role="group" aria-label={t("popup.camera.coLocated")} data-camera-cluster={cluster.length}>
          <p className="mb-0.5 text-[10px] text-[var(--color-fg-subtle)]">{t("popup.camera.coLocated")}</p>
          <div className="flex flex-col gap-0.5">
            {cluster.map((c, i) => {
              const k = cameraKey(c);
              const isActive = k === cameraKey(active);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setActiveKey(k)}
                  className={`cursor-pointer truncate rounded px-1.5 py-0.5 text-left text-[10px] ${isActive ? "bg-[var(--color-accent)] text-white" : "bg-white/5 text-[var(--color-fg-muted)] hover:bg-white/10"}`}
                  title={fullNames[i]}
                >
                  <span className="inline-flex max-w-full items-center gap-1">
                    {markerStyle(c).kind === "video" ? (
                      <Video size={10} aria-label={t("popup.camera.kindVideo")} className="shrink-0" />
                    ) : (
                      <CameraIcon size={10} aria-label={t("popup.camera.kindStill")} className="shrink-0" />
                    )}
                    <span className="truncate">{labels[i]}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <ActiveCameraBody
        key={cameraKey(active)}
        camera={active}
        ctx={ctx}
        lang={lang}
        t={t}
        distanceKm={cameraKey(active) === cameraKey(camera) ? distanceKm : null}
        showName={showName}
      />
    </>
  );
}
