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

/**
 * ตัด metadata ออกจากรูปที่ **encode ใหม่แล้ว** — JPEG: ทิ้งทุก APP1 (`FF E1`, Exif/XMP) ก่อน SOS แล้วคัดลอก
 * ตั้งแต่ SOS ถึงท้ายไฟล์ตามเดิม; WebP: ทิ้ง chunk `EXIF`/`XMP `, ล้างบิต EXIF (0x08) / XMP (0x04) ของ VP8X และ
 * คำนวณขนาด RIFF ใหม่ — ไม่แตะพิกเซลเลย
 *
 * ทำไมต้องมี: canvas มีแค่พิกเซล แต่ encoder บางตัวแทรก segment ของมันเองลงไฟล์ผล — ImageIO ของ Apple (iOS/
 * macOS Safari: `toBlob("image/webp")` ไม่รองรับ จึงถอยมา JPEG) เขียน APP1 Exif ที่มีแค่ขนาดภาพ/color space
 * ไม่มี GPS หรือค่าใด ๆ จากไฟล์ต้นทาง แต่ `sniffImageBytes` และ server ปฏิเสธ APP1 ทุกอัน รูปจาก iPhone จึงส่ง
 * ไม่ได้เลย — ตัดทิ้งก่อนตรวจซ้ำ (การตรวจของ server ยังเข้มเท่าเดิม)
 *
 * คืน `null` เมื่ออ่านโครงไฟล์ไม่ได้ (ผู้เรียกปล่อยให้ `sniffImageBytes` ตัดสินจากไบต์เดิม) ชนิดอื่นคืนตามเดิม
 */
export function stripImageMetadata(b: Uint8Array): Uint8Array | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return stripJpeg(b);
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return stripWebp(b);
  return b;
}

function stripJpeg(b: Uint8Array): Uint8Array | null {
  const keep: Array<[number, number]> = [[0, 2]]; // SOI
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return null;
    let marker = b[i + 1]!;
    while (marker === 0xff && i + 2 < b.length) {
      i++; // ไบต์เติม 0xFF ระหว่าง segment — ไม่ต้องเก็บ
      marker = b[i + 1]!;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      keep.push([i, i + 2]);
      i += 2;
      continue;
    }
    if (marker === 0xd9 || i + 3 >= b.length) return null; // จบก่อนเจอ SOS
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2) return null;
    if (marker === 0xda) {
      keep.push([i, b.length]); // SOS + ข้อมูลภาพ + EOI คัดลอกตามเดิม
      return concat(b, keep);
    }
    if (marker !== 0xe1) keep.push([i, i + 2 + len]);
    i += 2 + len;
  }
  return null;
}

function stripWebp(b: Uint8Array): Uint8Array | null {
  const keep: Array<[number, number]> = [[0, 12]];
  let vp8xFlagsAt = -1;
  let out = 12;
  let i = 12;
  while (i + 8 <= b.length) {
    const fourcc = ascii(b, i, 4);
    const size = (b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24)) >>> 0;
    const end = i + 8 + size + (size & 1);
    if (end > b.length) return null;
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      if (fourcc === "VP8X") vp8xFlagsAt = out + 8;
      keep.push([i, end]);
      out += end - i;
    }
    i = end;
  }
  if (i !== b.length) return null;
  const res = concat(b, keep);
  const riff = res.length - 8;
  res[4] = riff & 0xff;
  res[5] = (riff >>> 8) & 0xff;
  res[6] = (riff >>> 16) & 0xff;
  res[7] = (riff >>> 24) & 0xff;
  if (vp8xFlagsAt >= 0) res[vp8xFlagsAt] = res[vp8xFlagsAt]! & ~(0x08 | 0x04);
  return res;
}

function concat(b: Uint8Array, ranges: Array<[number, number]>): Uint8Array {
  const out = new Uint8Array(ranges.reduce((n, [s, e]) => n + (e - s), 0));
  let o = 0;
  for (const [s, e] of ranges) {
    out.set(b.subarray(s, e), o);
    o += e - s;
  }
  return out;
}
