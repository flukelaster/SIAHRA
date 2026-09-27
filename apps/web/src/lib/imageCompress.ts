/**
 * ตรรกะการบีบอัดรูปของรายงานจากประชาชน — ล้วน ๆ ไม่มี DOM/canvas (encoder ถูกฉีดเข้ามา) จึงเทสได้ใน node
 *
 * ขั้นบันได (ตามแผน PR C): ย่อขอบยาวเหลือ 1280 px (`COMMUNITY_MAX_IMAGE_EDGE_PX`) → WebP q 0.75 → 0.6 → 0.45
 * → ถ้ายังเกิน `COMMUNITY_MAX_IMAGE_BYTES` (300 KiB) ย่อเหลือ 960 px แล้วไล่ quality ใหม่ → ยังเกินอีก = ยอมแพ้
 * แล้วบอกผู้ใช้ (ไม่ส่งรูปที่ server จะปฏิเสธอยู่แล้ว) — ตัวเลขเพดาน/ขอบมาจาก `COMPRESS_LIMITS` ใน `compressImage.ts`
 * (ซึ่งอ่านจาก `@siahra/shared-types`) ผ่านพารามิเตอร์: ไฟล์นี้ไม่ import shared-types เพราะ worker import มัน
 * และ index ของ shared-types ลากตาราง `SOURCES` ทั้งก้อนเข้า bundle ของ worker (~15 kB ดิบ)
 *
 * Safari (และเบราว์เซอร์ที่ไม่มี WebP encoder) ไม่ throw เมื่อขอ `image/webp` แต่คืน blob ชนิดอื่น (PNG) มาเงียบ ๆ
 * — จึงดู `type` ของผลทุกครั้ง: ไม่ใช่ `image/webp` = สลับไป JPEG ที่ quality เดิมและใช้ JPEG ต่อจนจบ; JPEG เองก็ต้อง
 * ได้ `image/jpeg` กลับมาจริง ไม่อย่างนั้นถือว่า encoder ใช้ไม่ได้ (server รับแค่ JPEG/WebP)
 *
 * ไม่ขยายรูปที่เล็กกว่าขอบเป้าหมาย และไม่ encode ขนาดเดิมซ้ำ (รูปที่ขอบยาว ≤ 960 px ลองแค่รอบเดียว)
 */

/** ไฟล์ต้นทางใหญ่กว่านี้ถูกปฏิเสธก่อน decode — กันหน่วยความจำของมือถือ (รูป 48 MP ≈ 15–25 MB) */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
/** ขอบยาวสำรองเมื่อขอบเต็ม (`COMMUNITY_MAX_IMAGE_EDGE_PX`) บีบจนสุดแล้วยังเกินเพดาน */
export const FALLBACK_EDGE_PX = 960;
/** quality ที่ลองตามลำดับในแต่ละขนาด */
export const COMPRESS_QUALITIES: readonly number[] = [0.75, 0.6, 0.45];

export type CompressMime = "image/webp" | "image/jpeg";

/** เพดานไบต์ของผล + ขอบยาวที่ลองตามลำดับ (`COMPRESS_LIMITS`) */
export interface CompressLimits {
  maxBytes: number;
  edges: readonly number[];
}

/**
 * เหตุที่บีบอัดไม่ได้ — UI แปลเป็นข้อความตรงตัว
 * - `input-too-large` ไฟล์ต้นทาง > 25 MB (ไม่ decode)
 * - `not-image` ไฟล์ไม่ได้ประกาศตัวเป็นรูป
 * - `decode` เบราว์เซอร์เปิดรูปไม่ได้ (เช่น HEIC บนเบราว์เซอร์ที่ไม่รองรับ) — แนะนำ JPEG
 * - `too-large` ย่อ/บีบจนสุดขั้นบันไดแล้วยังเกิน 300 KiB
 * - `encode` encoder ใช้ไม่ได้ (ไม่มี JPEG/WebP, ผลว่าง, worker ค้าง)
 * - `metadata` ผลที่ได้ยังมี Exif/XMP (`lib/imageMetadata.ts`) — ไม่ส่ง
 */
export type CompressFailure = "input-too-large" | "not-image" | "decode" | "too-large" | "encode" | "metadata";

/** ตรวจไฟล์ก่อน decode — `null` = ไปต่อได้ (ชนิดว่าง = เบราว์เซอร์ไม่รู้ ปล่อยให้ decode ตัดสิน) */
export function checkInputFile(file: { size: number; type: string }): CompressFailure | null {
  if (file.size > MAX_INPUT_BYTES) return "input-too-large";
  if (file.type !== "" && !file.type.startsWith("image/")) return "not-image";
  return null;
}

/** ขนาดหลังย่อให้ขอบยาว ≤ `edge` (คงสัดส่วน ปัดเป็นจำนวนเต็ม ≥ 1) — ไม่ขยาย */
export function fitWithin(width: number, height: number, edge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= edge) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const k = edge / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** ผลของ encoder หนึ่งครั้ง — `Blob` เข้ากับรูปร่างนี้พอดี */
export interface EncodedImage {
  type: string;
  size: number;
}

export type Encode<R extends EncodedImage> = (
  width: number,
  height: number,
  mime: CompressMime,
  quality: number,
) => Promise<R>;

export interface LadderAttempt {
  width: number;
  height: number;
  mime: CompressMime;
  quality: number;
  /** ชนิดที่ encoder คืนมาจริง */
  gotType: string;
  size: number;
}

export type LadderResult<R extends EncodedImage> =
  | { ok: true; image: R; width: number; height: number; mime: CompressMime; quality: number; attempts: LadderAttempt[] }
  | { ok: false; failure: "too-large" | "encode"; attempts: LadderAttempt[] };

/**
 * ไล่ขั้นบันไดจนได้ผล ≤ `maxBytes` — encoder ที่ throw ถูกส่งต่อให้ผู้เรียก (worker/main thread แปลเป็น `encode`)
 */
export async function runLadder<R extends EncodedImage>(
  srcWidth: number,
  srcHeight: number,
  encode: Encode<R>,
  { maxBytes, edges }: CompressLimits,
): Promise<LadderResult<R>> {
  const attempts: LadderAttempt[] = [];
  let mime: CompressMime = "image/webp";
  const tried = new Set<string>();
  const once = async (width: number, height: number, q: number): Promise<R> => {
    const r = await encode(width, height, mime, q);
    attempts.push({ width, height, mime, quality: q, gotType: r.type, size: r.size });
    return r;
  };
  for (const edge of edges) {
    const { width, height } = fitWithin(srcWidth, srcHeight, edge);
    const dims = `${width}x${height}`;
    if (tried.has(dims)) continue;
    tried.add(dims);
    for (const q of COMPRESS_QUALITIES) {
      let r = await once(width, height, q);
      if (mime === "image/webp" && r.type !== "image/webp") {
        // ไม่มี WebP encoder (Safari คืน PNG) — JPEG ตั้งแต่ขั้นนี้ไปจนจบ
        mime = "image/jpeg";
        r = await once(width, height, q);
      }
      if (r.type !== mime || r.size <= 0) return { ok: false, failure: "encode", attempts };
      if (r.size <= maxBytes) return { ok: true, image: r, width, height, mime, quality: q, attempts };
    }
  }
  return { ok: false, failure: "too-large", attempts };
}
