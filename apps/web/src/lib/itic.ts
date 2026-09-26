/**
 * วิดีโอสดกล้องถนนของมูลนิธิ iTIC (E15.2) — ตัวเล่น HLS หนึ่งตัวต่อหน้า + ตัวแยกสถานะ
 * (ภาพนิ่งรีเฟรชอัตโนมัติของกล้องที่ไม่มี HLS อยู่ท้ายไฟล์ — `startItiCSnapshots`)
 *
 * เบราว์เซอร์ขอ playlist/segment จาก `camerai1.iticfoundation.org` ตรง ๆ (ACAO *, ไม่ผ่าน
 * Worker ของเรา — ไม่มีค่าใช้จ่าย Cloudflare) **ทีละกล้อง เฉพาะตอนผู้ใช้เปิด popup**
 *
 * - เบราว์เซอร์ที่เล่น HLS เองได้ (`canPlayType('application/vnd.apple.mpegurl')` — Safari/iOS
 *   และ Chromium รุ่นใหม่) ใช้ตัวเล่นในตัวก่อน ส่วนที่เหลือโหลด hls.js ด้วย dynamic import (chunk
 *   แยก ไม่อยู่ใน entry/vendor) และ `enableWorker: false` เพื่อไม่ต้องเปิด `worker-src blob:`
 *   ใน CSP; ตัวเล่นในตัวล้มกับ playlist ที่ตอบ 200 = ลอง hls.js ต่อ (ถ้ามี MediaSource)
 * - ผู้เล่นมีได้ **ตัวเดียว** ทั้งหน้า: เริ่มตัวใหม่ = ทิ้งตัวเก่าก่อน
 * - สถานะความล้มเหลวแยกกันเสมอ และไม่มีแบบไหนพูดถึงสภาพถนน/พื้นที่:
 *     `suspended`   — iTIC ตอบแล้วว่าไม่มีสตรีมนี้ (playlist 4xx / playlist ผิดรูป)
 *     `unreachable` — เราติดต่อ iTIC ไม่ได้ (เครือข่าย/timeout/5xx) บอกอะไรเกี่ยวกับกล้องไม่ได้
 *     `unsupported` — ได้สตรีมมาแล้วแต่เบราว์เซอร์นี้ถอดรหัสไม่ได้ (เช่นไม่มี H.264)
 * - เวลา: `EXT-X-PROGRAM-DATE-TIME` ของสตรีมเท่านั้น ไม่มี = null ("สตรีมไม่มีเวลากำกับ")
 *   ห้ามใช้นาฬิกาเครื่องผู้ใช้แทนเวลาถ่าย
 */
import type HlsType from "hls.js";

/** โฮสต์ HLS เดียวที่ ETL ยอมรับ (`apps/etl/src/build-itic-cctv.ts` HLS_PREFIX) — ตรวจซ้ำก่อนเล่น */
export const ITIC_HLS_PREFIX = "https://camerai1.iticfoundation.org/";
export const ITIC_HOME = "https://iticfoundation.org/";
export const LONGDO_CAMERA_HOME = "https://camera.longdo.com/";
/** บัญชีกล้อง (static asset จาก `npm run build:itic-cctv -w apps/etl`) */
export const ITIC_CATALOGUE_URL = "/cctv/itic-cameras.json";

/** URL ที่ยอมส่งให้ตัวเล่น — prefix + origin ตรง, ไม่มี userinfo, ไม่ใช่ป้าย `tempsus` */
export function isPlayableHlsUrl(url: string): boolean {
  if (!url.startsWith(ITIC_HLS_PREFIX) || url.includes("tempsus")) return false;
  try {
    const u = new URL(url);
    return u.origin + "/" === ITIC_HLS_PREFIX && !u.username && !u.password;
  } catch {
    return false;
  }
}

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
 * ผู้เรียกต้องตรวจ `isPlayableHlsUrl` ก่อน (ฟังก์ชันนี้ตรวจซ้ำและปฏิเสธเช่นกัน)
 */
export function startHlsPlayer(
  video: HTMLVideoElement,
  url: string,
  onState: (s: HlsPlayerState) => void,
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

  if (!isPlayableHlsUrl(url)) {
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
        // chunk ของ hls.js โหลดไม่ได้ (เครือข่ายของเราเอง ไม่ใช่ของ iTIC)
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
 * ภาพนิ่งของกล้อง iTIC ที่ไม่มี HLS (`stream.kind = "jpeg"`) — ขอภาพใหม่ทุก ~5 วินาทีขณะเปิด popup
 *
 * - URL ต้องตรง `ITIC_JPEG_PATTERN` ทุกตัวอักษร (กลุ่มเดียวที่ตอบภาพจริงเมื่อวัด 2026-09-26 — ดู
 *   `apps/etl/src/build-itic-cctv.README.md`) — ETL กรองไว้แล้ว ตรงนี้ตรวจซ้ำ
 * - แต่ละรอบใช้ `Image` ใหม่ (ไม่มี `crossOrigin` — เราไม่อ่านพิกเซล) พร้อมพารามิเตอร์กันแคช
 *   ได้เฟรมแล้วจึงแทนภาพที่แสดงอยู่ — ภาพเดิมค้างไว้ระหว่างรอ ไม่กระพริบ และ event ของรอบก่อน
 *   (รวม `error` ที่ `src = ""` ยิงเอง) ไม่มีทางปนกับรอบใหม่
 * - รอบถัดไปนับจากรอบก่อน *จบ* (ได้ภาพ / error / หมดเวลา `ITIC_SNAPSHOT_TIMEOUT_MS`) — ไม่ซ้อนคำขอ
 *   คำขอที่ค้าง (โฮสต์ timeout) จึงไม่ติด "กำลังโหลด" ตลอดไป
 * - หยุดเองหลัง `ITIC_SNAPSHOT_MAX_MS` (popup ที่ลืมเปิดค้างไว้ต้องไม่ถาม iTIC ไปเรื่อย ๆ — แนว
 *   เดียวกับภาพสด DWR) ผู้ใช้กดรีเฟรชต่อได้
 * - `error` แยกไม่ได้ว่าเครือข่ายล้มหรือ iTIC ตอบของที่ไม่ใช่ภาพ (เช่น "Camera (jpeg) not found"
 *   39 ไบต์) — จึงเป็น `unreachable` สถานะเดียว และข้อความพูดตามนั้น
 * - เวลา: `fetchedAt` = นาฬิกาเครื่องตอนได้ภาพ (เวลาที่ *เรา* ได้ภาพ ไม่ใช่เวลาถ่าย) — เวลาถ่ายกล้อง
 *   พิมพ์ไว้บนภาพเอง ไม่มีเป็นข้อมูลให้อ่าน จึงไม่แสดงเวลาใดเป็นเวลาถ่าย
 * ---------------------------------------------------------------------------------------------- */

/** ต้องตรงกับ `JPEG_PATTERN` ของ `apps/etl/src/build-itic-cctv.ts` */
export const ITIC_JPEG_PATTERN = /^https:\/\/camera1\.iticfoundation\.org\/jpeg2\.php\?camid=10\.8\.0\.\d+:\d+$/;
const ITIC_JPEG_ORIGIN = "https://camera1.iticfoundation.org";
export const ITIC_SNAPSHOT_REFRESH_MS = 5_000;
export const ITIC_SNAPSHOT_TIMEOUT_MS = 15_000;
export const ITIC_SNAPSHOT_MAX_MS = 5 * 60_000;

/** URL ภาพนิ่งที่ยอมขอ — pattern ยึดหัวท้าย + origin ตรง + ไม่มี userinfo */
export function isSnapshotJpegUrl(url: string): boolean {
  if (!ITIC_JPEG_PATTERN.test(url)) return false;
  try {
    const u = new URL(url);
    return u.origin === ITIC_JPEG_ORIGIN && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** URL ของรอบที่ `seq` — พารามิเตอร์ `_` ใหม่ทุกรอบ ให้เบราว์เซอร์/แคชกลางทางขอภาพใหม่จริง */
export function snapshotFrameUrl(url: string, seq: number, nowMs: number): string {
  return `${url}&_=${nowMs.toString(36)}-${seq}`;
}

export type ItiCSnapshotState =
  /** ยังไม่เคยได้เฟรม — รอคำตอบของรอบแรก */
  | { status: "loading" }
  /** รอบล่าสุดได้ภาพ — `fetchedAt` = เวลาที่เบราว์เซอร์ได้ภาพ (ไม่ใช่เวลาถ่าย) */
  | { status: "ok"; fetchedAt: string }
  /**
   * รอบล่าสุดไม่ได้ภาพ (`error` = เครือข่ายล้มหรือคำตอบไม่ใช่ภาพ; `timeout` = ไม่มีคำตอบใน
   * `ITIC_SNAPSHOT_TIMEOUT_MS`) — ยังลองต่อทุก ~5 วินาที; `lastFetchedAt` = เฟรมดีล่าสุด (null = ไม่เคยได้)
   */
  | { status: "unreachable"; detail: "error" | "timeout" | "url rejected"; lastFetchedAt: string | null }
  /** หยุดรีเฟรชเองหลัง `ITIC_SNAPSHOT_MAX_MS` — `lastFailed` = รอบสุดท้ายก่อนหยุดไม่ได้ภาพ */
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
export function startItiCSnapshots<I extends SnapshotImage>(
  url: string,
  onState: (s: ItiCSnapshotState) => void,
  deps: SnapshotDeps<I>,
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

  const emit = (s: ItiCSnapshotState) => {
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
    if (now() - startedAt >= ITIC_SNAPSHOT_MAX_MS) {
      emit({ status: "paused", lastFetchedAt, lastFailed });
      return;
    }
    nextTimer = setTimeout(attempt, ITIC_SNAPSHOT_REFRESH_MS);
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
    watchdog = setTimeout(() => fail("timeout"), ITIC_SNAPSHOT_TIMEOUT_MS);
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

  if (!isSnapshotJpegUrl(url)) {
    emit({ status: "unreachable", detail: "url rejected", lastFetchedAt: null });
    return dispose;
  }
  emit({ status: "loading" });
  attempt();
  return dispose;
}
