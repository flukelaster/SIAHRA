import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sniffImageBytes } from "./imageMetadata";

const here = dirname(fileURLToPath(import.meta.url));
/**
 * ผลของ encoder จริง (HeadlessChrome 149 ผ่าน playwright-cli) จากรูป 16×12 ที่พก Exif GPS — วิธีสร้างใหม่อยู่ใน
 * `_comment` ของไฟล์
 */
const fixture = JSON.parse(readFileSync(resolve(here, "__fixtures__/encoder-output.json"), "utf8")) as Record<
  "source" | "canvasJpeg" | "canvasWebp" | "offscreenJpeg" | "offscreenWebp",
  string
>;

const bytes = (b64: string) => Uint8Array.from(Buffer.from(b64, "base64"));

/** JPEG เล็ก ๆ ที่ประกอบเอง: SOI + segment ที่ให้มา + SOS + ข้อมูล 2 ไบต์ + EOI */
function jpeg(...segments: number[][]): Uint8Array {
  const sos = [0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0];
  return Uint8Array.from([0xff, 0xd8, ...segments.flat(), ...sos, 0x12, 0x34, 0xff, 0xd9]);
}
const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
const app1Exif = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0, 0];

/** WebP ที่ประกอบเอง: RIFF + chunk ที่ให้มา */
function webp(...chunks: [string, number][]): Uint8Array {
  const body: number[] = [...Buffer.from("WEBP")];
  for (const [fourcc, size] of chunks) {
    body.push(...Buffer.from(fourcc), size & 0xff, (size >> 8) & 0xff, 0, 0, ...new Array(size + (size & 1)).fill(0));
  }
  return Uint8Array.from([...Buffer.from("RIFF"), body.length & 0xff, (body.length >> 8) & 0xff, 0, 0, ...body]);
}

describe("sniffImageBytes — ฝาแฝดของ sniffImage ใน apps/api/src/community/validate.ts", () => {
  it("JPEG ที่มีแค่ APP0 (JFIF) = ใช้ได้", () => {
    expect(sniffImageBytes(jpeg(app0))).toEqual({ ok: true, contentType: "image/jpeg" });
  });
  it("JPEG ที่มี APP1 (Exif/XMP) = มี metadata", () => {
    expect(sniffImageBytes(jpeg(app0, app1Exif))).toEqual({ ok: false, reason: "image-metadata" });
  });
  it("JPEG ที่ไม่มี SOS / marker พัง = อ่านไม่ได้", () => {
    expect(sniffImageBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toEqual({ ok: false, reason: "image-invalid" });
    expect(sniffImageBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toEqual({ ok: false, reason: "image-invalid" });
  });
  it("WebP ที่มี VP8 = ใช้ได้; มี EXIF หรือ XMP = มี metadata; ไม่มี chunk ภาพ = อ่านไม่ได้", () => {
    expect(sniffImageBytes(webp(["VP8 ", 4]))).toEqual({ ok: true, contentType: "image/webp" });
    expect(sniffImageBytes(webp(["VP8X", 10], ["VP8 ", 4], ["EXIF", 6]))).toEqual({ ok: false, reason: "image-metadata" });
    expect(sniffImageBytes(webp(["VP8X", 10], ["VP8L", 4], ["XMP ", 3]))).toEqual({ ok: false, reason: "image-metadata" });
    expect(sniffImageBytes(webp(["ICCP", 4]))).toEqual({ ok: false, reason: "image-invalid" });
  });
  it("PNG/อื่น ๆ = ชนิดที่ไม่รับ", () => {
    expect(sniffImageBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toEqual({
      ok: false,
      reason: "image-type",
    });
  });
});

describe("การ encode ใหม่ผ่าน canvas ลบ Exif/GPS — ผลของ encoder จริง (fixture จาก Chromium)", () => {
  it("ไฟล์ต้นทางมี Exif (GPS) จริง — ตัวตรวจจับได้", () => {
    const src = bytes(fixture.source);
    expect(Buffer.from(src).includes(Buffer.from("Exif"))).toBe(true);
    expect(sniffImageBytes(src)).toEqual({ ok: false, reason: "image-metadata" });
  });
  it.each([
    ["canvas.toBlob JPEG", fixture.canvasJpeg, "image/jpeg"],
    ["canvas.toBlob WebP", fixture.canvasWebp, "image/webp"],
    ["OffscreenCanvas.convertToBlob JPEG", fixture.offscreenJpeg, "image/jpeg"],
    ["OffscreenCanvas.convertToBlob WebP", fixture.offscreenWebp, "image/webp"],
  ])("%s ไม่มี APP1/EXIF/XMP", (_name, b64, type) => {
    const out = bytes(b64);
    expect(sniffImageBytes(out)).toEqual({ ok: true, contentType: type });
    expect(Buffer.from(out).includes(Buffer.from("Exif"))).toBe(false);
  });
});
