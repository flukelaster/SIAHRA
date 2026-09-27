import { COMMUNITY_MAX_IMAGE_BYTES, COMMUNITY_MAX_IMAGE_EDGE_PX } from "@siahra/shared-types";
import {
  FALLBACK_EDGE_PX,
  checkInputFile,
  runLadder,
  type CompressFailure,
  type CompressLimits,
  type CompressMime,
} from "./imageCompress";
import { sniffImageBytes } from "./imageMetadata";
import type { ImageCompressWorkerMessage, ImageCompressWorkerResult } from "../workers/imageCompress.worker";

/**
 * บีบอัดรูปหนึ่งรูปก่อนแนบรายงาน — อยู่ใน chunk ของฟอร์มรายงาน (`ReportCompose`) เท่านั้น ไม่อยู่ใน entry
 *
 * 1. ตรวจไฟล์ก่อน decode (> 25 MB / ไม่ใช่รูป = ปฏิเสธทันที)
 * 2. worker (`workers/imageCompress.worker.ts`: `createImageBitmap` + `OffscreenCanvas.convertToBlob`) — สร้างใหม่
 *    ต่อรูปด้วย `new Worker(new URL(…), {type: "module"})` แบบเดียวกับ `scene/StationSheet.ts` และ terminate ทันที
 *    ที่ได้ผล/ล้ม/ถูกยกเลิก
 * 3. ไม่มี Worker/OffscreenCanvas, worker โหลดไม่ขึ้น (`onerror`) หรือบอกว่าทำไม่ได้ (`unsupported`) → ขั้นบันได
 *    เดียวกันบน main thread ด้วย `<canvas>.toBlob` (`decode` จาก worker ไม่ถูกลองซ้ำ — เบราว์เซอร์เดียวกัน)
 * 4. ผลต้องผ่าน `sniffImageBytes` (JPEG/WebP ไม่มี APP1/EXIF/XMP) ก่อนคืน — การ encode ใหม่ผ่าน canvas ลบ
 *    Exif/GPS อยู่แล้ว นี่คือการยืนยันซ้ำ ไม่ใช่การพึ่งพา
 */

export type CompressOutcome =
  | {
      ok: true;
      blob: Blob;
      width: number;
      height: number;
      mime: CompressMime;
      quality: number;
      inputBytes: number;
    }
  | { ok: false; failure: CompressFailure };

/** เพดานของ server (`COMMUNITY_MAX_IMAGE_BYTES`) + ขอบ 1280 → 960 px — ส่งให้ worker ทาง postMessage */
export const COMPRESS_LIMITS: CompressLimits = {
  maxBytes: COMMUNITY_MAX_IMAGE_BYTES,
  edges: [COMMUNITY_MAX_IMAGE_EDGE_PX, FALLBACK_EDGE_PX],
};

/** worker ไม่ตอบภายในนี้ = ถือว่าล้ม (`encode`) — กันฟอร์มค้างที่ "กำลังย่อรูป" ตลอดไป */
export const COMPRESS_TIMEOUT_MS = 60_000;

type Encoded = { ok: true; blob: Blob; width: number; height: number; mime: CompressMime; quality: number };
type Attempt = Encoded | { ok: false; failure: CompressFailure | "unsupported" };

class Aborted extends Error {}

function viaWorker(file: Blob, signal: AbortSignal): Promise<Attempt> {
  return new Promise<Attempt>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../workers/imageCompress.worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve({ ok: false, failure: "unsupported" });
      return;
    }
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      worker.terminate();
      fn();
    };
    const onAbort = () => finish(() => reject(new Aborted()));
    const timer = window.setTimeout(() => finish(() => resolve({ ok: false, failure: "encode" })), COMPRESS_TIMEOUT_MS);
    signal.addEventListener("abort", onAbort);
    worker.onmessage = (ev: MessageEvent<ImageCompressWorkerResult>) => finish(() => resolve(ev.data));
    // โหลดสคริปต์ของ worker ไม่ขึ้น (module worker ไม่รองรับ / chunk หาย) — ลองบน main thread
    worker.onerror = (ev) => {
      ev.preventDefault();
      finish(() => resolve({ ok: false, failure: "unsupported" }));
    };
    worker.onmessageerror = () => finish(() => resolve({ ok: false, failure: "unsupported" }));
    worker.postMessage({ file, limits: COMPRESS_LIMITS } satisfies ImageCompressWorkerMessage);
  });
}

async function decodeOnMain(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  }
  // ไม่มี createImageBitmap (เบราว์เซอร์เก่า) — <img> หมุนตาม EXIF เองตามค่าเริ่มต้นของ CSS image-orientation
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

async function viaMainThread(file: Blob, signal: AbortSignal): Promise<Attempt> {
  let decoded: Awaited<ReturnType<typeof decodeOnMain>>;
  try {
    decoded = await decodeOnMain(file);
  } catch {
    return { ok: false, failure: "decode" };
  }
  try {
    const canvas = document.createElement("canvas");
    const result = await runLadder(decoded.width, decoded.height, async (width, height, mime, quality) => {
      if (signal.aborted) throw new Aborted();
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(decoded.source, 0, 0, width, height);
      }
      return new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))), mime, quality),
      );
    }, COMPRESS_LIMITS);
    canvas.width = 0;
    canvas.height = 0;
    if (!result.ok) return { ok: false, failure: result.failure };
    return { ok: true, blob: result.image, width: result.width, height: result.height, mime: result.mime, quality: result.quality };
  } catch (err) {
    if (err instanceof Aborted) throw err;
    return { ok: false, failure: "encode" };
  } finally {
    decoded.close();
  }
}

/**
 * บีบอัด `file` — ยกเลิกด้วย `signal` ได้ (ผู้ใช้เลือกรูปใหม่/ปิดฟอร์ม): ถูกยกเลิก = คืน `null`
 */
export async function compressImage(file: File, signal: AbortSignal): Promise<CompressOutcome | null> {
  const bad = checkInputFile(file);
  if (bad) return { ok: false, failure: bad };
  let attempt: Attempt;
  try {
    attempt =
      typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined"
        ? await viaWorker(file, signal)
        : { ok: false, failure: "unsupported" };
    if (!attempt.ok && attempt.failure === "unsupported") attempt = await viaMainThread(file, signal);
  } catch (err) {
    if (err instanceof Aborted) return null;
    return { ok: false, failure: "encode" };
  }
  if (signal.aborted) return null;
  if (!attempt.ok) return { ok: false, failure: attempt.failure === "unsupported" ? "encode" : attempt.failure };
  const sniff = sniffImageBytes(new Uint8Array(await attempt.blob.arrayBuffer()));
  if (!sniff.ok) return { ok: false, failure: sniff.reason === "image-metadata" ? "metadata" : "encode" };
  return { ...attempt, inputBytes: file.size };
}
