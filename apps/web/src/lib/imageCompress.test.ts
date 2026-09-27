import { describe, expect, it } from "vitest";
import { COMMUNITY_MAX_IMAGE_BYTES, COMMUNITY_MAX_IMAGE_EDGE_PX } from "@siahra/shared-types";
import { COMPRESS_LIMITS } from "./compressImage";
import {
  COMPRESS_QUALITIES,
  MAX_INPUT_BYTES,
  checkInputFile,
  fitWithin,
  runLadder,
  type CompressMime,
  type EncodedImage,
} from "./imageCompress";

/** encoder ปลอม: ขนาด = พิกเซล × bytesPerPx(quality) — ชนิดตามที่ขอ เว้นแต่ `webpAs` บอกให้คืนอย่างอื่น (Safari) */
function fakeEncoder(opts: { bytesPerPx: (q: number, mime: CompressMime) => number; webpAs?: string; jpegAs?: string }) {
  const calls: { width: number; height: number; mime: CompressMime; quality: number }[] = [];
  const encode = async (width: number, height: number, mime: CompressMime, quality: number): Promise<EncodedImage> => {
    calls.push({ width, height, mime, quality });
    const type = mime === "image/webp" ? (opts.webpAs ?? mime) : (opts.jpegAs ?? mime);
    return { type, size: Math.round(width * height * opts.bytesPerPx(quality, mime)) };
  };
  return { encode, calls };
}

describe("checkInputFile — ปฏิเสธก่อน decode", () => {
  it("ไฟล์ > 25 MB ถูกปฏิเสธ แม้เป็นรูป", () => {
    expect(checkInputFile({ size: MAX_INPUT_BYTES + 1, type: "image/jpeg" })).toBe("input-too-large");
    expect(checkInputFile({ size: MAX_INPUT_BYTES, type: "image/jpeg" })).toBeNull();
  });
  it("ไฟล์ที่ประกาศชนิดอื่นไม่ใช่รูป; ชนิดว่าง (เบราว์เซอร์ไม่รู้) และ HEIC ปล่อยให้ decode ตัดสิน", () => {
    expect(checkInputFile({ size: 10, type: "application/pdf" })).toBe("not-image");
    expect(checkInputFile({ size: 10, type: "" })).toBeNull();
    expect(checkInputFile({ size: 10, type: "image/heic" })).toBeNull();
  });
});

describe("fitWithin", () => {
  it("ย่อขอบยาวลงเหลือ edge และคงสัดส่วน", () => {
    expect(fitWithin(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin(3000, 4000, 1280)).toEqual({ width: 960, height: 1280 });
    expect(fitWithin(4000, 3000, 960)).toEqual({ width: 960, height: 720 });
  });
  it("ไม่ขยายรูปเล็ก", () => {
    expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 });
  });
});

describe("runLadder — ขั้นบันไดขนาด × quality", () => {
  it("ลำดับคือ 1280 px ที่ WebP 0.75 → 0.6 → 0.45 แล้ว 960 px", async () => {
    expect(COMPRESS_LIMITS).toEqual({ maxBytes: COMMUNITY_MAX_IMAGE_BYTES, edges: [COMMUNITY_MAX_IMAGE_EDGE_PX, 960] });
    expect(COMPRESS_LIMITS.edges).toEqual([1280, 960]);
    expect(COMPRESS_QUALITIES).toEqual([0.75, 0.6, 0.45]);
  });

  it("หยุดทันทีที่ขั้นแรกผ่านเพดาน", async () => {
    const { encode, calls } = fakeEncoder({ bytesPerPx: () => 0.1 });
    const r = await runLadder(4000, 3000, encode, COMPRESS_LIMITS);
    expect(r.ok).toBe(true);
    expect(calls).toEqual([{ width: 1280, height: 960, mime: "image/webp", quality: 0.75 }]);
    if (r.ok) {
      expect(r.mime).toBe("image/webp");
      expect(r.image.size).toBeLessThanOrEqual(COMMUNITY_MAX_IMAGE_BYTES);
    }
  });

  it("ไล่ quality ลงจนผ่าน (ไม่ข้ามขั้น)", async () => {
    // 1280×960 = 1,228,800 px: 0.75 → 0.4 B/px (491 KB), 0.6 → 0.3 (369 KB), 0.45 → 0.2 (246 KB ✓)
    const { encode, calls } = fakeEncoder({ bytesPerPx: (q) => (q > 0.7 ? 0.4 : q > 0.5 ? 0.3 : 0.2) });
    const r = await runLadder(4000, 3000, encode, COMPRESS_LIMITS);
    expect(calls.map((c) => c.quality)).toEqual([0.75, 0.6, 0.45]);
    expect(r.ok && r.quality).toBe(0.45);
    expect(r.ok && r.width).toBe(1280);
  });

  it("1280 เกินทุก quality → ย่อเหลือ 960 แล้วไล่ quality ใหม่", async () => {
    // 1280×960 ที่ 0.26 B/px = 319 KB (เกินทุกขั้น), 960×720 = 691,200 px ที่ 0.26 = 180 KB ✓
    const { encode, calls } = fakeEncoder({ bytesPerPx: () => 0.26 });
    const r = await runLadder(4000, 3000, encode, COMPRESS_LIMITS);
    expect(calls.map((c) => `${c.width}@${c.quality}`)).toEqual(["1280@0.75", "1280@0.6", "1280@0.45", "960@0.75"]);
    expect(r.ok && { w: r.width, h: r.height }).toEqual({ w: 960, h: 720 });
  });

  it("ยอมแพ้พร้อมเหตุ `too-large` เมื่อสุดขั้นบันไดแล้วยังเกิน — ไม่ส่งรูปที่ server จะปฏิเสธ", async () => {
    const { encode, calls } = fakeEncoder({ bytesPerPx: () => 2 });
    const r = await runLadder(4000, 3000, encode, COMPRESS_LIMITS);
    expect(r).toMatchObject({ ok: false, failure: "too-large" });
    expect(calls).toHaveLength(6);
  });

  it("รูปที่เล็กกว่า 960 px ไม่ถูก encode ขนาดเดิมซ้ำในรอบ 960", async () => {
    const { encode, calls } = fakeEncoder({ bytesPerPx: () => 5 });
    const r = await runLadder(640, 480, encode, COMPRESS_LIMITS);
    expect(r.ok).toBe(false);
    expect(calls.map((c) => `${c.width}x${c.height}`)).toEqual(["640x480", "640x480", "640x480"]);
  });

  it("Safari: ขอ WebP แล้วได้ PNG → JPEG ที่ quality เดิม และใช้ JPEG ต่อจนจบ", async () => {
    const { encode, calls } = fakeEncoder({ bytesPerPx: (q) => (q > 0.7 ? 0.4 : 0.2), webpAs: "image/png" });
    const r = await runLadder(4000, 3000, encode, COMPRESS_LIMITS);
    expect(calls.map((c) => `${c.mime}@${c.quality}`)).toEqual([
      "image/webp@0.75",
      "image/jpeg@0.75",
      "image/jpeg@0.6",
    ]);
    expect(r.ok && r.mime).toBe("image/jpeg");
    expect(r.ok && r.image.type).toBe("image/jpeg");
  });

  it("encoder ที่ไม่มีทั้ง WebP และ JPEG = `encode` (ไม่ส่ง PNG ที่ server ไม่รับ)", async () => {
    const { encode } = fakeEncoder({ bytesPerPx: () => 0.1, webpAs: "image/png", jpegAs: "image/png" });
    await expect(runLadder(4000, 3000, encode, COMPRESS_LIMITS)).resolves.toMatchObject({ ok: false, failure: "encode" });
  });

  it("ผลว่าง (0 ไบต์) = `encode` ไม่ใช่ 'ผ่านเพดาน'", async () => {
    const { encode } = fakeEncoder({ bytesPerPx: () => 0 });
    await expect(runLadder(4000, 3000, encode, COMPRESS_LIMITS)).resolves.toMatchObject({ ok: false, failure: "encode" });
  });

  it("encoder ที่ throw ถูกส่งต่อให้ผู้เรียก", async () => {
    await expect(
      runLadder(
        100,
        100,
        async () => {
          throw new Error("boom");
        },
        COMPRESS_LIMITS,
      ),
    ).rejects.toThrow("boom");
  });
});
