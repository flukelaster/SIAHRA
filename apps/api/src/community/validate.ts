import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_MAX_DESCRIPTION,
  COMMUNITY_MAX_IMAGE_BYTES,
  isCommunityCategory,
  type CommunityCategory,
  type CommunityRejectReason,
} from "@siahra/shared-types";
import { randomToken } from "./tokens.js";

/**
 * การตรวจ input ของรายงานจากประชาชนฝั่ง Worker — โมดูลบริสุทธิ์ ไม่แตะ DO/R2 เทสยิงตรงได้
 *
 * id ของรายงาน = `YYYYMMDD-<128 บิตสุ่ม base64url>` (วันที่ UTC ตอนรับ) เพื่อให้ **คีย์ R2 ของรูปคิดได้จาก
 * path ล้วน** (`community/YYYY-MM-DD/{id}`) — เส้นทางรูปจึงไม่ต้องถาม DO เลย (devops IMAGE-1) และ
 * content-type มาจาก `httpMetadata` ของ object ไม่ใช่นามสกุลในคีย์
 */
export const REPORT_ID_RE = /^([0-9]{4})([0-9]{2})([0-9]{2})-[A-Za-z0-9_-]{22}$/;

export function newReportId(nowMs: number): string {
  return `${new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, "")}-${randomToken(16)}`;
}

/** คีย์ R2 ของรูป — `null` เมื่อ id ผิดรูป (ผู้เรียกตอบ 404 ก่อนแตะ R2) */
export function imageKeyFor(id: string): string | null {
  const m = REPORT_ID_RE.exec(id);
  return m ? `community/${m[1]}-${m[2]}-${m[3]}/${id}` : null;
}

export function imageUrlFor(id: string): string {
  return `/api/v1/community/image/${id}`;
}

export interface Rejection {
  ok: false;
  status: number;
  reason: CommunityRejectReason;
  error: string;
}

const reject = (status: number, reason: CommunityRejectReason, error: string): Rejection => ({
  ok: false,
  status,
  reason,
  error,
});

/**
 * อ่าน body ไม่เกิน `cap` ไบต์ — `null` = เกิน (ผู้เรียกตอบ 413) ตรวจซ้ำหลัง buffer ทุกไบต์
 * เพราะ `Content-Length` เป็นแค่คำอ้างของ client
 */
export async function readCappedBody(request: Request, cap: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** `Content-Length` ที่อ้างมา — `null` เมื่อไม่มี/ไม่ใช่จำนวนเต็มบวก หรือเกิน `cap` (ตอบ 413 ก่อนอ่าน body) */
export function declaredLengthWithin(request: Request, cap: number): boolean {
  const raw = request.headers.get("content-length");
  if (raw === null || !/^[0-9]+$/.test(raw)) return false;
  return Number(raw) <= cap;
}

export interface SniffedImage {
  ok: true;
  contentType: "image/jpeg" | "image/webp";
}

/**
 * ตรวจรูปจาก magic bytes (ไม่เชื่อ `type` ของ File) — JPEG `FF D8 FF` หรือ WebP `RIFF....WEBP` เท่านั้น
 *
 * ปฏิเสธรูปที่พก metadata: JPEG ที่มี segment APP1 (Exif/XMP — พิกัด GPS อยู่ที่นี่) และ WebP ที่มี chunk
 * `EXIF`/`XMP ` — client ของแอปบีบอัดผ่าน canvas ซึ่งไม่เขียนสองอย่างนี้ รูปที่มีจึงมาจาก client อื่น
 * และอาจพาพิกัดบ้านของผู้ถ่ายขึ้นเผยแพร่สาธารณะ
 */
export function sniffImage(b: Uint8Array): SniffedImage | Rejection {
  if (b.length > COMMUNITY_MAX_IMAGE_BYTES) {
    return reject(413, "image-too-large", `Image must be at most ${COMMUNITY_MAX_IMAGE_BYTES} bytes`);
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return sniffJpeg(b);
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return sniffWebp(b);
  return reject(415, "image-type", "Only JPEG or WebP images are accepted");
}

function ascii(b: Uint8Array, at: number, n: number): string {
  let s = "";
  for (let i = at; i < at + n && i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
}

const METADATA = (): Rejection =>
  reject(422, "image-metadata", "Image carries Exif/XMP metadata — re-encode it without metadata");
const INVALID = (): Rejection => reject(422, "image-invalid", "Image data is malformed");

/** เดิน marker segment ตั้งแต่หลัง SOI จนถึง SOS (ข้อมูลภาพเริ่ม) — Exif อยู่ก่อน SOS เสมอตามสเปก */
function sniffJpeg(b: Uint8Array): SniffedImage | Rejection {
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return INVALID();
    let marker = b[i + 1]!;
    // fill bytes (0xFF ซ้ำ) ก่อน marker จริง
    while (marker === 0xff && i + 2 < b.length) {
      i++;
      marker = b[i + 1]!;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // marker เดี่ยว ไม่มีความยาว
      continue;
    }
    if (marker === 0xd9) break; // EOI
    if (i + 3 >= b.length) return INVALID();
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2) return INVALID();
    if (marker === 0xe1) return METADATA();
    if (marker === 0xda) return { ok: true, contentType: "image/jpeg" }; // SOS
    i += 2 + len;
  }
  return INVALID(); // ไม่มี SOS = ไม่มีภาพ
}

/** เดิน chunk ของ RIFF — ต้องมี chunk ภาพ (VP8/VP8L/VP8X) และห้ามมี EXIF/XMP */
function sniffWebp(b: Uint8Array): SniffedImage | Rejection {
  let i = 12;
  let hasImage = false;
  while (i + 8 <= b.length) {
    const fourcc = ascii(b, i, 4);
    const size = (b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24)) >>> 0;
    if (fourcc === "EXIF" || fourcc === "XMP ") return METADATA();
    if (fourcc === "VP8 " || fourcc === "VP8L" || fourcc === "VP8X") hasImage = true;
    i += 8 + size + (size & 1);
  }
  return hasImage ? { ok: true, contentType: "image/webp" } : INVALID();
}

export interface ReportFields {
  lat: number;
  lon: number;
  categories: CommunityCategory[];
  description: string;
  image: { bytes: Uint8Array; contentType: "image/jpeg" | "image/webp" } | null;
}

/** `categories` ส่งมาได้สองแบบ: ฟิลด์ซ้ำหลายตัว หรือฟิลด์เดียวเป็น JSON array */
function readCategories(form: FormData): unknown[] | null {
  const all = form.getAll("categories").filter((v): v is string => typeof v === "string");
  if (all.length === 1 && all[0]!.trim().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(all[0]!);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return all;
}

/** ฟิลด์ทุกตัวยกเว้น turnstileToken (ตรวจก่อนแล้วที่ Worker) — ลำดับ: หมวด → ข้อความ → พิกัด → รูป */
export async function parseReportFields(form: FormData): Promise<ReportFields | Rejection> {
  const rawCats = readCategories(form);
  if (!rawCats || rawCats.length === 0 || rawCats.length > COMMUNITY_CATEGORIES.length || !rawCats.every(isCommunityCategory)) {
    return reject(422, "invalid-categories", `categories must be 1..${COMMUNITY_CATEGORIES.length} of ${COMMUNITY_CATEGORIES.join(", ")}`);
  }
  // เรียงตามลำดับที่ประกาศและตัดซ้ำ — แถวที่เก็บจึงเทียบกันได้ตรง ๆ
  const categories = COMMUNITY_CATEGORIES.filter((c) => rawCats.includes(c));

  const rawDesc = form.get("description");
  if (rawDesc !== null && typeof rawDesc !== "string") return reject(400, "bad-request", "description must be text");
  const description = (rawDesc ?? "").trim();
  if (description.length > COMMUNITY_MAX_DESCRIPTION) {
    return reject(422, "description-too-long", `description must be at most ${COMMUNITY_MAX_DESCRIPTION} characters`);
  }

  const latRaw = form.get("lat");
  const lonRaw = form.get("lon");
  const lat = typeof latRaw === "string" && latRaw.trim() !== "" ? Number(latRaw) : NaN;
  const lon = typeof lonRaw === "string" && lonRaw.trim() !== "" ? Number(lonRaw) : NaN;
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return reject(422, "invalid-location", "lat and lon must be finite decimal degrees");
  }

  const file = form.get("image");
  let image: ReportFields["image"] = null;
  if (file !== null && typeof file !== "string" && file.size > 0) {
    if (file.size > COMMUNITY_MAX_IMAGE_BYTES) {
      return reject(413, "image-too-large", `Image must be at most ${COMMUNITY_MAX_IMAGE_BYTES} bytes`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffImage(bytes);
    if (!sniffed.ok) return sniffed;
    image = { bytes, contentType: sniffed.contentType };
  } else if (typeof file === "string" && file !== "") {
    return reject(415, "image-type", "image must be a file upload");
  }

  return { lat, lon, categories, description, image };
}
