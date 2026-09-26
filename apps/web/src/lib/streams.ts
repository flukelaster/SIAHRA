/**
 * ตัวเล่นสตรีมกล้องที่ไม่ผูกกับแหล่ง (E15.3) — ตัวเล่น HLS หนึ่งตัวต่อหน้า, ภาพนิ่งที่ขอใหม่เป็น
 * รอบ ๆ ด้วย `<img src>` (`startJpegPoll`) และภาพนิ่งที่ต้อง `fetch()` เพื่ออ่าน `Last-Modified`
 * (`fetchJpegOnce`) โฮสต์ที่ยอมเปิดไม่ได้อยู่ในไฟล์นี้: ผู้เรียก inject `allow` (=
 * `isAllowedUrl` ของ `lib/cameraSources.ts` ซึ่งอ่าน `CAMERA_SOURCES[sourceId].hosts`) และทุก
 * ตัวเริ่มด้วยการเรียก guard นั้นก่อนแตะเครือข่าย
 *
 * เบราว์เซอร์ขอ playlist/segment/ภาพจากต้นทางตรง ๆ (ไม่ผ่าน Worker ของเรา — ไม่มีค่าใช้จ่าย
 * Cloudflare) **ทีละกล้อง เฉพาะตอนผู้ใช้เปิดแผงกล้อง**
 *
 * HLS:
 * - เบราว์เซอร์ที่เล่น HLS เองได้ (`canPlayType('application/vnd.apple.mpegurl')` — Safari/iOS
 *   และ Chromium รุ่นใหม่) ใช้ตัวเล่นในตัวก่อน ส่วนที่เหลือโหลด hls.js ด้วย dynamic import (chunk
 *   แยก ไม่อยู่ใน entry/vendor — และไม่ถูก import เลยเมื่อ build ไม่มีแหล่งที่เล่น HLS ได้,
 *   `hasEnabledKind("hls")`) และ `enableWorker: false` เพื่อไม่ต้องเปิด `worker-src blob:`
 *   ใน CSP; ตัวเล่นในตัวล้มกับ playlist ที่ตอบ 200 = ลอง hls.js ต่อ (ถ้ามี MediaSource)
 * - ผู้เล่นมีได้ **ตัวเดียว** ทั้งหน้า: เริ่มตัวใหม่ = ทิ้งตัวเก่าก่อน
 * - สถานะความล้มเหลวแยกกันเสมอ และไม่มีแบบไหนพูดถึงสภาพถนน/พื้นที่:
 *     `suspended`   — ต้นทางตอบแล้วว่าไม่มีสตรีมนี้ (playlist 4xx / playlist ผิดรูป)
 *     `unreachable` — เราติดต่อต้นทางไม่ได้ (เครือข่าย/timeout/5xx) บอกอะไรเกี่ยวกับกล้องไม่ได้
 *     `unsupported` — ได้สตรีมมาแล้วแต่เบราว์เซอร์นี้ถอดรหัสไม่ได้ (เช่นไม่มี H.264)
 * - เวลา: `EXT-X-PROGRAM-DATE-TIME` ของสตรีมเท่านั้น ไม่มี = null ("สตรีมไม่มีเวลากำกับ")
 *   ห้ามใช้นาฬิกาเครื่องผู้ใช้แทนเวลาถ่าย
 */
import type HlsType from "hls.js";
import { hasEnabledKind } from "./cameraSources";

/** url นี้เปิดได้ไหม — inject จากผู้เรียก (`isAllowedUrl(sourceId, kind, url)`) ตัวเล่นไม่รู้จักโฮสต์เอง */
export type UrlGuard = (url: string) => boolean;

export type HlsPlayerState =
  | { status: "loading" }
  /** `programDateTime` = ISO จาก EXT-X-PROGRAM-DATE-TIME ของ segment ที่กำลังเล่น — null = สตรีมไม่มี */
  | { status: "live"; programDateTime: string | null }
  /**
   * เคยเล่นได้แล้วแต่ภาพหยุดรอข้อมูล (`waiting` / `stalled` ที่บัฟเฟอร์หมดจริง) — เฟรมที่ค้างอยู่
   * ไม่ใช่ภาพสด แต่ก็ไม่ใช่ความล้มเหลว; กลับเป็น `live` เมื่อ `playing` อีกครั้ง
   */
  | { status: "buffering"; programDateTime: string | null }
  /**
   * ผู้ใช้กดหยุดเองบน controls — เฟรมที่ค้างอยู่ไม่ใช่ภาพสด; กลับเป็น `live` ได้ทางเดียวคือ `playing`
   * (ตอนกดเล่นต่อจะกระโดดไปขอบสดก่อน ป้าย "สด" จึงไม่ติดบนภาพที่ช้ากว่าเวลาจริง)
   */
  | { status: "paused"; programDateTime: string | null }
  | { status: "suspended"; detail: string }
  | { status: "unreachable"; detail: string }
  | { status: "unsupported"; detail: string };

export type HlsFailure = Extract<HlsPlayerState, { status: "suspended" | "unreachable" | "unsupported" }>;

const CODEC_DETAILS = new Set([
  "manifestIncompatibleCodecsError",
  "bufferAddCodecError",
  "bufferIncompatibleCodecsError",
]);
const EMPTY_OR_MALFORMED = new Set(["manifestParsingError", "levelEmptyError"]);

/**
 * ข้อผิดพลาด **fatal** ของ hls.js → สถานะที่แสดง (ฟังก์ชันล้วน ทดสอบได้โดยไม่มี DOM)
 * `responseCode` 0/undefined = เบราว์เซอร์อ่านคำตอบไม่ได้ — เครือข่ายล้ม **หรือ** เซิร์ฟเวอร์ตอบ
 * โดยไม่มี `Access-Control-Allow-Origin` (วัด 2026-09-26: 404 ของ nginx บน `/hls/…` ไม่มี ACAO
 * ส่วน 404 ของ Wowza บน `/pass/…` มี) สองกรณีนี้แยกจากเบราว์เซอร์ไม่ได้ จึงเป็น `unreachable`
 * ที่ข้อความบอกตามนั้น — ไม่เดาว่าเป็น "ระงับ"
 */
export function classifyHlsFatal(e: { type: string; details: string; responseCode?: number }): HlsFailure {
  if (e.type === "networkError") {
    if (EMPTY_OR_MALFORMED.has(e.details)) return { status: "suspended", detail: e.details };
    const code = e.responseCode ?? 0;
    if (code >= 400 && code < 500) return { status: "suspended", detail: `HTTP ${code}` };
    return { status: "unreachable", detail: code >= 500 ? `HTTP ${code}` : e.details };
  }
  if (e.type === "mediaError" && CODEC_DETAILS.has(e.details)) return { status: "unsupported", detail: e.details };
  return { status: "unsupported", detail: `${e.type}/${e.details}` };
}

/** ผลการลอง GET playlist ครั้งเดียว (ใช้แยกสาเหตุเมื่อตัวเล่นในตัวของ Safari ล้ม) */
export function classifyProbe(result: { status: number } | "network-error"): HlsFailure {
  if (result === "network-error") return { status: "unreachable", detail: "network" };
  if (result.status >= 400 && result.status < 500) return { status: "suspended", detail: `HTTP ${result.status}` };
  if (result.status >= 500) return { status: "unreachable", detail: `HTTP ${result.status}` };
  return { status: "unsupported", detail: "native playback failed" };
}

function isoOrNull(ms: number | null | undefined): string | null {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** มี MSE ให้ hls.js ใช้ไหม (`ManagedMediaSource` = iOS 17.1+) */
function hasMediaSource(): boolean {
  return typeof globalThis !== "undefined" && ("MediaSource" in globalThis || "ManagedMediaSource" in globalThis);
}

/** ตัวเล่นที่กำลังทำงานอยู่ทั้งหน้า — มีได้ตัวเดียว */
let activeDispose: (() => void) | null = null;

/**
 * เริ่มเล่น `url` บน `video` — คืนฟังก์ชันหยุดที่ตัดการเชื่อมต่อทั้งหมด (เรียกซ้ำได้)
 * `allow(url)` เท็จ = ไม่แตะเครือข่ายเลย สถานะ `unsupported` "url rejected"
 */
export function startHlsPlayer(
  video: HTMLVideoElement,
  url: string,
  onState: (s: HlsPlayerState) => void,
  allow: UrlGuard,
): () => void {
  activeDispose?.();
  let disposed = false;
  let hls: HlsType | null = null;
  let programDateTime: string | null = null;
  /** ระยะของตัวเล่นที่ยังไม่ล้มเหลว — `FRAG_CHANGED`/`timeupdate` ส่งสถานะปัจจุบันซ้ำพร้อมเวลาใหม่ */
  let phase: "loading" | "live" | "buffering" | "paused" = "loading";
  let failed = false;
  const probe = new AbortController();
  const listeners: [keyof HTMLVideoElementEventMap, EventListener][] = [];
  const on = (type: keyof HTMLVideoElementEventMap, fn: EventListener) => {
    video.addEventListener(type, fn);
    listeners.push([type, fn]);
  };
  const emit = (s: HlsPlayerState) => {
    if (!disposed) onState(s);
  };
  const fail = (s: HlsFailure) => {
    if (failed) return;
    failed = true;
    phase = "loading";
    emit(s);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    probe.abort();
    for (const [type, fn] of listeners) video.removeEventListener(type, fn);
    hls?.destroy();
    hls = null;
    video.pause();
    video.removeAttribute("src");
    // โหลดใหม่หลังถอด src = ปล่อยการเชื่อมต่อ/บัฟเฟอร์ที่ค้างอยู่ทันที
    video.load();
    if (activeDispose === dispose) activeDispose = null;
  };
  activeDispose = dispose;

  if (!allow(url)) {
    fail({ status: "unsupported", detail: "url rejected" });
    return dispose;
  }

  emit({ status: "loading" });
  on("playing", () => {
    if (failed) return;
    phase = "live";
    emit({ status: "live", programDateTime });
  });
  // `waiting` ยิงตอนโหลดครั้งแรกด้วย — นับเป็นบัฟเฟอร์เฉพาะหลังเคยเล่นได้แล้ว (ก่อนนั้นยัง "กำลังเชื่อมต่อ")
  const toBuffering = () => {
    if (failed || phase !== "live") return;
    phase = "buffering";
    emit({ status: "buffering", programDateTime });
  };
  on("waiting", toBuffering);
  // หยุดเอง — `pause` ของ dispose() เองไม่ถูกส่ง (emit ตรวจ `disposed`) และก่อนเฟรมแรกยังเป็น "กำลังเชื่อมต่อ"
  on("pause", () => {
    if (failed || disposed || phase === "loading") return;
    phase = "paused";
    emit({ status: "paused", programDateTime });
  });
  // เล่นต่อหลังหยุด: สตรีมสดไม่รอ — กระโดดไปขอบสดก่อน แล้วค่อยเป็น `live` เมื่อ `playing` ยิง
  on("play", () => {
    if (failed || phase !== "paused") return;
    if (hls) {
      const edge = hls.liveSyncPosition;
      if (typeof edge === "number" && Number.isFinite(edge)) video.currentTime = edge;
    } else if (video.seekable.length > 0) {
      video.currentTime = video.seekable.end(video.seekable.length - 1);
    }
  });
  // Chromium ยิง `stalled` เมื่อเครือข่ายเงียบไปครู่หนึ่ง แม้ยังเล่นจากบัฟเฟอร์ได้ต่อ — นับเฉพาะเมื่อ
  // ไม่มีข้อมูลสำหรับเฟรมถัดไปจริง (readyState ≤ HAVE_CURRENT_DATA) ไม่งั้นป้ายจะบอกบัฟเฟอร์ทับภาพที่เล่นอยู่
  on("stalled", () => {
    if (video.readyState <= 2) toBuffering();
  });

  const startHlsJs = () => {
    // build ที่ไม่มีแหล่ง HLS เปิดอยู่เลยต้องไม่ดึง chunk ของ hls.js — และ `allow` ผ่านมาแล้ว
    // หมายความว่ามีแหล่งเช่นนั้น เงื่อนไขนี้จึงเป็นสายกันตก ไม่ใช่ทางที่คาดว่าจะเกิด
    if (!hasEnabledKind("hls")) {
      fail({ status: "unsupported", detail: "no HLS source enabled" });
      return;
    }
    void import("hls.js").then(
      ({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) {
          fail({ status: "unsupported", detail: "no MediaSource" });
          return;
        }
        const h = new Hls({ enableWorker: false, lowLatencyMode: false });
        hls = h;
        let recovered = false;
        h.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          // ข้อผิดพลาดสื่อที่ไม่ใช่ codec ลองกู้หนึ่งครั้งตามคำแนะนำของ hls.js
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !CODEC_DETAILS.has(data.details) && !recovered) {
            recovered = true;
            h.recoverMediaError();
            return;
          }
          fail(classifyHlsFatal({ type: data.type, details: data.details, responseCode: data.response?.code }));
          h.destroy();
          if (hls === h) hls = null;
        });
        h.on(Hls.Events.MANIFEST_PARSED, () => {
          void video.play().catch(() => {});
        });
        h.on(Hls.Events.FRAG_CHANGED, (_e, data) => {
          programDateTime = isoOrNull(data.frag.programDateTime);
          // หยุดอยู่ = เฟรมค้าง ไม่ส่งซ้ำ (เวลาใหม่จะไปกับ `playing`)
          if (!failed && (phase === "live" || phase === "buffering")) emit({ status: phase, programDateTime });
        });
        h.loadSource(url);
        h.attachMedia(video);
      },
      () => {
        // chunk ของ hls.js โหลดไม่ได้ (เครือข่ายของเราเอง ไม่ใช่ของต้นทางกล้อง)
        fail({ status: "unsupported", detail: "player failed to load" });
      },
    );
  };

  if (!video.canPlayType("application/vnd.apple.mpegurl")) {
    startHlsJs();
    return dispose;
  }

  // ตัวเล่น HLS ในตัวของเบราว์เซอร์ (Safari/iOS และ Chromium รุ่นใหม่ที่ตอบ "maybe" ด้วย)
  // Safari: `getStartDate()` = EXT-X-PROGRAM-DATE-TIME ของ segment แรก (NaN ถ้าไม่มี)
  const nativePdt = (): string | null => {
    const start = (video as HTMLVideoElement & { getStartDate?: () => Date }).getStartDate?.();
    const ms = start ? start.getTime() : NaN;
    return Number.isFinite(ms) ? isoOrNull(ms + video.currentTime * 1000) : null;
  };
  let lastSecond = -1;
  const onTime: EventListener = () => {
    const sec = Math.floor(video.currentTime);
    if (failed || phase !== "live" || sec === lastSecond) return;
    lastSecond = sec;
    programDateTime = nativePdt();
    emit({ status: "live", programDateTime });
  };
  const onNativeError: EventListener = () => {
    // MediaError ของตัวเล่นในตัวไม่บอกว่า 404 หรือเครือข่าย — ถาม playlist หนึ่งครั้งเพื่อแยก
    fetch(url, { cache: "no-store", signal: probe.signal })
      .then((res) => {
        const verdict = classifyProbe({ status: res.status });
        // playlist ตอบปกติแต่ตัวเล่นในตัวแปลงไม่ได้ (วัด 2026-09-26: HLS ในตัวของ Chromium 149
        // ล้มด้วย DEMUXER_ERROR_COULD_NOT_PARSE กับสตรีม Wowza ของกรมทางหลวงบางตัว ที่ hls.js
        // เล่นได้) — มี MediaSource ก็ลอง hls.js ก่อนจะบอกว่าเล่นไม่ได้
        if (verdict.status === "unsupported" && hasMediaSource() && !disposed) {
          video.removeEventListener("timeupdate", onTime);
          video.removeEventListener("error", onNativeError);
          video.removeAttribute("src");
          video.load();
          startHlsJs();
          return;
        }
        fail(verdict);
      })
      .catch(() => {
        if (!probe.signal.aborted) fail(classifyProbe("network-error"));
      });
  };
  on("timeupdate", onTime);
  on("error", onNativeError);
  video.src = url;
  void video.play().catch(() => {
    // autoplay ถูกปฏิเสธ — ผู้ใช้กด play บน controls เองได้ ไม่ใช่ความล้มเหลวของสตรีม
  });
  return dispose;
}

/* ------------------------------------------------------------------------------------------------
 * ภาพนิ่งที่ขอใหม่เป็นรอบ ๆ ด้วย `<img src>` (`stream.kind = "jpeg"`) — ขอภาพใหม่ทุก ~5 วินาทีขณะเปิด
 *
 * - URL ต้องผ่าน `allow` (origin ใน `hosts.img` ของแหล่ง + `urlPattern` ถ้ามี — เช่นกลุ่ม
 *   `jpeg2.php?camid=10.8.0.x:port` ของ iTIC ที่ตอบภาพจริงเมื่อวัด 2026-09-26) — ETL กรองไว้แล้ว ตรงนี้ตรวจซ้ำ
 * - แต่ละรอบใช้ `Image` ใหม่ (ไม่มี `crossOrigin` — เราไม่อ่านพิกเซล) พร้อมพารามิเตอร์กันแคช
 *   ได้เฟรมแล้วจึงแทนภาพที่แสดงอยู่ — ภาพเดิมค้างไว้ระหว่างรอ ไม่กระพริบ และ event ของรอบก่อน
 *   (รวม `error` ที่ `src = ""` ยิงเอง) ไม่มีทางปนกับรอบใหม่
 * - รอบถัดไปนับจากรอบก่อน *จบ* (ได้ภาพ / error / หมดเวลา `JPEG_POLL_TIMEOUT_MS`) — ไม่ซ้อนคำขอ
 *   คำขอที่ค้าง (โฮสต์ timeout) จึงไม่ติด "กำลังโหลด" ตลอดไป
 * - หยุดเองหลัง `JPEG_POLL_MAX_MS` (แผงที่ลืมเปิดค้างไว้ต้องไม่ถามต้นทางไปเรื่อย ๆ — แนวเดียวกับ
 *   ภาพสด DWR) ผู้ใช้กดรีเฟรชต่อได้
 * - `error` แยกไม่ได้ว่าเครือข่ายล้มหรือต้นทางตอบของที่ไม่ใช่ภาพ (เช่น "Camera (jpeg) not found"
 *   39 ไบต์) — จึงเป็น `unreachable` สถานะเดียว และข้อความพูดตามนั้น
 * - เวลา: `fetchedAt` = นาฬิกาเครื่องตอนได้ภาพ (เวลาที่ *เรา* ได้ภาพ ไม่ใช่เวลาถ่าย) — เวลาถ่าย
 *   (ถ้ามี) พิมพ์อยู่บนภาพเอง ไม่มีเป็นข้อมูลให้อ่าน จึงไม่แสดงเวลาใดเป็นเวลาถ่าย
 * ---------------------------------------------------------------------------------------------- */

export const JPEG_POLL_REFRESH_MS = 5_000;
export const JPEG_POLL_TIMEOUT_MS = 15_000;
export const JPEG_POLL_MAX_MS = 5 * 60_000;

/** URL ของรอบที่ `seq` — พารามิเตอร์ `_` ใหม่ทุกรอบ ให้เบราว์เซอร์/แคชกลางทางขอภาพใหม่จริง */
export function snapshotFrameUrl(url: string, seq: number, nowMs: number): string {
  return `${url}${url.includes("?") ? "&" : "?"}_=${nowMs.toString(36)}-${seq}`;
}

export type JpegPollState =
  /** ยังไม่เคยได้เฟรม — รอคำตอบของรอบแรก */
  | { status: "loading" }
  /** รอบล่าสุดได้ภาพ — `fetchedAt` = เวลาที่เบราว์เซอร์ได้ภาพ (ไม่ใช่เวลาถ่าย) */
  | { status: "ok"; fetchedAt: string }
  /**
   * รอบล่าสุดไม่ได้ภาพ (`error` = เครือข่ายล้มหรือคำตอบไม่ใช่ภาพ; `timeout` = ไม่มีคำตอบใน
   * `JPEG_POLL_TIMEOUT_MS`) — ยังลองต่อทุก ~5 วินาที; `lastFetchedAt` = เฟรมดีล่าสุด (null = ไม่เคยได้)
   */
  | { status: "unreachable"; detail: "error" | "timeout" | "url rejected"; lastFetchedAt: string | null }
  /** หยุดรีเฟรชเองหลัง `JPEG_POLL_MAX_MS` — `lastFailed` = รอบสุดท้ายก่อนหยุดไม่ได้ภาพ */
  | { status: "paused"; lastFetchedAt: string | null; lastFailed: boolean };

/** ส่วนของ `HTMLImageElement` ที่ใช้ (ทดสอบได้โดยไม่มี DOM) */
export interface SnapshotImage {
  src: string;
  addEventListener(type: "load" | "error", fn: () => void): void;
  removeEventListener(type: "load" | "error", fn: () => void): void;
}

export interface SnapshotDeps<I extends SnapshotImage> {
  /** สร้าง `Image` ของรอบหนึ่ง (ไม่ตั้ง `crossOrigin`) */
  createImage: () => I;
  /** ได้เฟรมแล้ว — แสดง `img` แทนภาพเดิม (null = ล้างภาพออก) */
  show: (img: I | null) => void;
  now?: () => number;
}

/**
 * เริ่มขอภาพนิ่งเป็นรอบ ๆ — คืนฟังก์ชันหยุดที่ตัดคำขอที่ค้างและตั้ง `src = ""` ให้ทั้งภาพที่รออยู่
 * และภาพที่แสดงอยู่ (เรียกซ้ำได้)
 */
export function startJpegPoll<I extends SnapshotImage>(
  url: string,
  onState: (s: JpegPollState) => void,
  deps: SnapshotDeps<I>,
  allow: UrlGuard,
): () => void {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  let disposed = false;
  let seq = 0;
  let lastFetchedAt: string | null = null;
  let shown: I | null = null;
  let pending: { img: I; detach: () => void } | null = null;
  let nextTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const emit = (s: JpegPollState) => {
    if (!disposed) onState(s);
  };
  /** ทิ้งคำขอที่ค้าง — ถอด listener ก่อน `src = ""` เพื่อไม่ให้ `error` ที่ตามมาถูกนับ */
  const dropPending = () => {
    if (watchdog !== null) clearTimeout(watchdog);
    watchdog = null;
    if (!pending) return;
    pending.detach();
    pending.img.src = "";
    pending = null;
  };
  const scheduleNext = (lastFailed: boolean) => {
    if (disposed) return;
    if (now() - startedAt >= JPEG_POLL_MAX_MS) {
      emit({ status: "paused", lastFetchedAt, lastFailed });
      return;
    }
    nextTimer = setTimeout(attempt, JPEG_POLL_REFRESH_MS);
  };
  const fail = (detail: "error" | "timeout") => {
    dropPending();
    emit({ status: "unreachable", detail, lastFetchedAt });
    scheduleNext(true);
  };
  function attempt() {
    nextTimer = null;
    if (disposed) return;
    seq += 1;
    const img = deps.createImage();
    const onLoad = () => {
      if (pending?.img !== img) return;
      if (watchdog !== null) clearTimeout(watchdog);
      watchdog = null;
      pending.detach();
      pending = null;
      const prev = shown;
      shown = img;
      deps.show(img);
      if (prev && prev !== img) prev.src = "";
      lastFetchedAt = new Date(now()).toISOString();
      emit({ status: "ok", fetchedAt: lastFetchedAt });
      scheduleNext(false);
    };
    const onError = () => {
      if (pending?.img !== img) return;
      fail("error");
    };
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
    pending = {
      img,
      detach: () => {
        img.removeEventListener("load", onLoad);
        img.removeEventListener("error", onError);
      },
    };
    watchdog = setTimeout(() => fail("timeout"), JPEG_POLL_TIMEOUT_MS);
    img.src = snapshotFrameUrl(url, seq, now());
  }

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (nextTimer !== null) clearTimeout(nextTimer);
    nextTimer = null;
    dropPending();
    if (shown) {
      shown.src = "";
      shown = null;
    }
    deps.show(null);
  };

  if (!allow(url)) {
    emit({ status: "unreachable", detail: "url rejected", lastFetchedAt: null });
    return dispose;
  }
  emit({ status: "loading" });
  attempt();
  return dispose;
}

/* ------------------------------------------------------------------------------------------------
 * ภาพนิ่งที่ต้อง `fetch()` (`stream.kind = "jpeg-fetch"`, `connect-src`, ต้อง CORS) — ครั้งละหนึ่งภาพ
 *
 * เหตุที่ไม่ใช้ `<img src>`: ต้นทางบางแห่ง (เช่นภาพนิ่งของสำนักการระบายน้ำ กทม.) ให้เวลาภาพผ่าน
 * `Last-Modified` เท่านั้น ซึ่งอ่านได้จากคำตอบของ `fetch` ไม่ใช่จาก `<img>`
 * - `observedAt` = `Last-Modified` แปลงเป็น ISO — null เมื่อไม่มี/อ่านไม่ได้ ผู้เรียกต้องบอกว่า
 *   "ไม่มีเวลาถ่าย" ห้ามแทนด้วย `fetchedAt` หรือนาฬิกาเครื่อง
 * - ความล้มเหลวสองแบบแยกกันเสมอ: `unreachable` (ถามไม่ได้/5xx/CORS) ≠ `no-image` (ตอบแล้วแต่ไม่มีภาพ:
 *   404, 0 ไบต์, ไม่ใช่ image/*)
 * - object URL ที่คืนเป็นของผู้เรียก (revoke เองตอนแทนภาพ/ปิด)
 * ยังไม่มีแหล่งใดในบัญชีใช้ชนิดนี้ (2026-09-26) — มีไว้เพราะสัญญา `CameraStream` ประกาศชนิดนี้แล้ว
 * ---------------------------------------------------------------------------------------------- */

export type JpegFetchResult =
  | { kind: "ok"; blobUrl: string; observedAt: string | null; fetchedAt: string }
  | { kind: "no-image" }
  | { kind: "unreachable"; detail: string };

export interface JpegFetchDeps {
  fetch: typeof fetch;
  createObjectURL: (blob: Blob) => string;
  now: () => number;
}

const defaultJpegFetchDeps = (): JpegFetchDeps => ({
  fetch: (...a) => fetch(...a),
  createObjectURL: (b) => URL.createObjectURL(b),
  now: () => Date.now(),
});

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** `Last-Modified` (RFC 7231 HTTP-date) → ISO — null เมื่อไม่มีหรือแปลงไม่ได้ */
export function parseLastModified(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * ดึงภาพนิ่งหนึ่งครั้ง — `allow(url)` เท็จ = ไม่แตะเครือข่าย (`unreachable` "url rejected");
 * การยกเลิก (`signal`) โยน AbortError ต่อ ไม่ถูกนับเป็น `unreachable`
 */
export async function fetchJpegOnce(
  url: string,
  signal: AbortSignal,
  allow: UrlGuard,
  deps: JpegFetchDeps = defaultJpegFetchDeps(),
): Promise<JpegFetchResult> {
  if (!allow(url)) return { kind: "unreachable", detail: "url rejected" };
  try {
    const res = await deps.fetch(snapshotFrameUrl(url, 0, deps.now()), { signal, cache: "no-store" });
    if (res.status === 404) return { kind: "no-image" };
    if (!res.ok) return { kind: "unreachable", detail: `HTTP ${res.status}` };
    const blob = await res.blob();
    if (blob.size === 0 || (blob.type !== "" && !blob.type.startsWith("image/"))) return { kind: "no-image" };
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return {
      kind: "ok",
      blobUrl: deps.createObjectURL(blob),
      observedAt: parseLastModified(res.headers.get("last-modified")),
      fetchedAt: new Date(deps.now()).toISOString(),
    };
  } catch (err) {
    if (isAbort(err) || signal.aborted) throw err;
    return { kind: "unreachable", detail: "network" };
  }
}
