/**
 * ตรวจรูปที่บีบอัดแล้วก่อนส่ง — ชนิดจาก magic bytes และ "มี metadata ไหม" (pure ไม่มี DOM)
 *
 * **ฝาแฝดของ `sniffImage` ใน `apps/api/src/community/validate.ts`** (กฎเดียวกันทุกข้อ): JPEG `FF D8 FF` เดิน
 * marker segment ตั้งแต่หลัง SOI ถึง SOS — มี APP1 (`FF E1`: Exif/XMP ซึ่งพิกัด GPS อยู่ที่นี่) = มี metadata;
 * WebP `RIFF....WEBP` เดิน chunk — มี `EXIF`/`XMP ` = มี metadata และต้องมี chunk ภาพ (VP8/VP8L/VP8X)
 * ถ้าแก้กฎฝั่งใดฝั่งหนึ่ง ต้องแก้อีกฝั่งด้วย — server ปฏิเสธ (422 image-metadata) สิ่งที่ฟังก์ชันนี้ตอบว่ามี
 * metadata อยู่แล้ว ฝั่งเว็บตรวจซ้ำเพื่อบอกผู้ใช้ก่อนส่ง และเพื่อไม่ส่งรูปที่พาพิกัดไปเลยแม้แต่ครั้งเดียว
 *
 * ทำไมรูปจาก `lib/compressImage.ts` จึงไม่ควรมี: การวาดลง canvas แล้ว encode ใหม่ (`convertToBlob`/`toBlob`)
 * เขียนเฉพาะพิกเซล — เบราว์เซอร์ไม่คัดลอก Exif/GPS ของไฟล์ต้นทางไปด้วย (`imageMetadata.test.ts` ยืนยันกับ
 * ผลของ encoder จริงที่เก็บเป็น fixture)
 */

export type ImageSniff =
  | { ok: true; contentType: "image/jpeg" | "image/webp" }
  | { ok: false; reason: "image-type" | "image-metadata" | "image-invalid" };

const META: ImageSniff = { ok: false, reason: "image-metadata" };
const INVALID: ImageSniff = { ok: false, reason: "image-invalid" };

function ascii(b: Uint8Array, at: number, n: number): string {
  let s = "";
  for (let i = at; i < at + n && i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
}

export function sniffImageBytes(b: Uint8Array): ImageSniff {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return sniffJpeg(b);
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return sniffWebp(b);
  return { ok: false, reason: "image-type" };
}

function sniffJpeg(b: Uint8Array): ImageSniff {
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return INVALID;
    let marker = b[i + 1]!;
    while (marker === 0xff && i + 2 < b.length) {
      i++;
      marker = b[i + 1]!;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9) break;
    if (i + 3 >= b.length) return INVALID;
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2) return INVALID;
    if (marker === 0xe1) return META;
    if (marker === 0xda) return { ok: true, contentType: "image/jpeg" };
    i += 2 + len;
  }
  return INVALID;
}

function sniffWebp(b: Uint8Array): ImageSniff {
  let i = 12;
  let hasImage = false;
  while (i + 8 <= b.length) {
    const fourcc = ascii(b, i, 4);
    const size = (b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24)) >>> 0;
    if (fourcc === "EXIF" || fourcc === "XMP ") return META;
    if (fourcc === "VP8 " || fourcc === "VP8L" || fourcc === "VP8X") hasImage = true;
    i += 8 + size + (size & 1);
  }
  return hasImage ? { ok: true, contentType: "image/webp" } : INVALID;
}
