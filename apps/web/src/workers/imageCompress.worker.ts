/// <reference lib="webworker" />
import { runLadder, type CompressFailure, type CompressLimits, type CompressMime } from "../lib/imageCompress";

/**
 * บีบอัดรูปของรายงานจากประชาชนนอก main thread — หนึ่ง worker ต่อหนึ่งรูป (`lib/compressImage.ts` สร้าง แล้ว
 * terminate ทันทีที่ได้ผล/ถูกยกเลิก) ไม่มี fetch ไม่มี console.* — ข้อผิดพลาดไปอยู่ในผล
 *
 * `createImageBitmap(file, {imageOrientation: "from-image"})` หมุนตาม EXIF orientation ของไฟล์ (รูปมือถือแนวตั้ง
 * ไม่ตะแคง) แล้ววาดลง `OffscreenCanvas` และ `convertToBlob` ใหม่ — ผลคือพิกเซลล้วน: canvas ไม่คัดลอก segment
 * Exif/GPS ของไฟล์ต้นทางไปด้วย (ตรวจซ้ำบน main thread ด้วย `lib/imageMetadata.ts` ก่อนส่งทุกครั้ง)
 *
 * `unsupported` = worker นี้ทำไม่ได้ (ไม่มี OffscreenCanvas 2D / convertToBlob) — ผู้เรียกลองบน main thread แทน
 * ส่วน `decode` = เบราว์เซอร์เปิดไฟล์นี้ไม่ได้เลย (เช่น HEIC) ลองที่อื่นก็ไม่ช่วย
 */
export interface ImageCompressWorkerMessage {
  file: Blob;
  /** `COMPRESS_LIMITS` ของ main thread — worker ไม่ import shared-types (ดูหัว `lib/imageCompress.ts`) */
  limits: CompressLimits;
}

export type ImageCompressWorkerResult =
  | { ok: true; blob: Blob; width: number; height: number; mime: CompressMime; quality: number }
  | { ok: false; failure: Exclude<CompressFailure, "metadata" | "input-too-large" | "not-image"> | "unsupported" };

const post = (msg: ImageCompressWorkerResult) => (self as unknown as Worker).postMessage(msg);

self.onmessage = async (ev: MessageEvent<ImageCompressWorkerMessage>) => {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
    post({ ok: false, failure: "unsupported" });
    return;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(ev.data.file, { imageOrientation: "from-image" });
  } catch {
    post({ ok: false, failure: "decode" });
    return;
  }
  try {
    const probe = new OffscreenCanvas(1, 1);
    if (!probe.getContext("2d") || typeof probe.convertToBlob !== "function") {
      post({ ok: false, failure: "unsupported" });
      return;
    }
    let canvas: OffscreenCanvas | null = null;
    const result = await runLadder(bitmap.width, bitmap.height, async (width, height, mime, quality) => {
      if (!canvas || canvas.width !== width || canvas.height !== height) {
        canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, width, height);
      }
      return canvas.convertToBlob({ type: mime, quality });
    }, ev.data.limits);
    if (!result.ok) {
      post({ ok: false, failure: result.failure });
      return;
    }
    post({
      ok: true,
      blob: result.image,
      width: result.width,
      height: result.height,
      mime: result.mime,
      quality: result.quality,
    });
  } catch {
    post({ ok: false, failure: "encode" });
  } finally {
    bitmap.close();
  }
};
