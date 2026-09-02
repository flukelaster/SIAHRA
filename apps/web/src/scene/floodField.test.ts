import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  FLOOD_FIELD_CELL_BYTES,
  FLOOD_FIELD_HEADER_BYTES,
  FLOOD_FIELD_MAGIC,
  FLOOD_FIELD_NO_DEPTH,
  FLOOD_FIELD_NO_LIKELIHOOD,
  FLOOD_FIELD_VERSION,
  FloodFieldClass,
} from "@siahra/shared-types";
import {
  FLOOD_TEX_CLASS_STEP,
  FloodFieldFormatError,
  buildFloodFieldTexture,
  decodeFloodField,
  encodeFloodFieldRgba,
  floodFieldDepthBounds,
  floodFieldGlsl,
  inflateFloodFieldBytes,
  isGzipBytes,
  summarizeFloodField,
} from "./floodField";

interface Cell {
  cls: number;
  depthCm: number;
  likelihood: number;
}

/** เขียน field.bin รุ่น 1 จากเซลล์ที่เรียง **ตามไฟล์** (แถวแรก = ขอบใต้) */
function encode(width: number, height: number, cells: Cell[], opts: { magic?: number; version?: number } = {}): ArrayBuffer {
  const buf = new ArrayBuffer(FLOOD_FIELD_HEADER_BYTES + cells.length * FLOOD_FIELD_CELL_BYTES);
  const v = new DataView(buf);
  v.setUint32(0, opts.magic ?? FLOOD_FIELD_MAGIC, true);
  v.setUint16(4, opts.version ?? FLOOD_FIELD_VERSION, true);
  v.setUint16(6, width, true);
  v.setUint16(8, height, true);
  cells.forEach((c, i) => {
    const o = FLOOD_FIELD_HEADER_BYTES + i * FLOOD_FIELD_CELL_BYTES;
    v.setUint8(o, c.cls);
    v.setUint16(o + 1, c.depthCm, true);
    v.setUint8(o + 3, c.likelihood);
  });
  return buf;
}

const C = FloodFieldClass;
const dry = (): Cell => ({ cls: C.DRY, depthCm: FLOOD_FIELD_NO_DEPTH, likelihood: 3 });
const flooded = (depthCm: number, likelihood = 90): Cell => ({ cls: C.FLOODED, depthCm, likelihood });

describe("decodeFloodField", () => {
  it("ปฏิเสธ magic ที่ไม่ตรง", () => {
    const buf = encode(1, 1, [dry()], { magic: 0x12345678 });
    expect(() => decodeFloodField(buf)).toThrow(FloodFieldFormatError);
    expect(() => decodeFloodField(buf)).toThrow(/magic/);
  });

  it("ปฏิเสธรุ่นที่ไม่รู้จัก", () => {
    const buf = encode(1, 1, [dry()], { version: FLOOD_FIELD_VERSION + 1 });
    expect(() => decodeFloodField(buf)).toThrow(/รุ่น/);
  });

  it("ปฏิเสธบัฟเฟอร์ที่สั้นกว่า header หรือความยาวไม่ตรงกับ width × height", () => {
    expect(() => decodeFloodField(new ArrayBuffer(4))).toThrow(FloodFieldFormatError);
    const ok = encode(3, 2, [dry(), dry(), dry(), dry(), dry(), dry()]);
    expect(() => decodeFloodField(ok.slice(0, ok.byteLength - 1))).toThrow(/ความยาว/);
    // header อ้าง 3×2 แต่มีเซลล์ 3×3 — ยาวเกินก็ผิดเหมือนกัน ไม่ใช่อ่านแค่ส่วนแรก
    const long = encode(3, 2, Array.from({ length: 9 }, dry));
    expect(() => decodeFloodField(long)).toThrow(/ความยาว/);
    // ตารางขนาดศูนย์
    expect(() => decodeFloodField(encode(0, 2, []))).toThrow(/ศูนย์/);
  });

  it("ถอด 3×2 ครบทุกช่อง และคงลำดับแถวของไฟล์ (แถว 0 = ขอบใต้) ไว้ใน texture โดยไม่พลิก", () => {
    // แถวไฟล์ 0 (ใต้): DRY, FLOODED 150 ซม., NOT_ESTIMATED
    // แถวไฟล์ 1 (เหนือ): NO_OBSERVATION, REFERENCE_WATER, EXCLUDED
    const cells: Cell[] = [
      dry(),
      flooded(150, 88),
      { cls: C.FLOODED_DEPTH_NOT_ESTIMATED, depthCm: FLOOD_FIELD_NO_DEPTH, likelihood: 70 },
      { cls: C.NO_OBSERVATION, depthCm: FLOOD_FIELD_NO_DEPTH, likelihood: FLOOD_FIELD_NO_LIKELIHOOD },
      { cls: C.REFERENCE_WATER, depthCm: FLOOD_FIELD_NO_DEPTH, likelihood: 0 },
      { cls: C.EXCLUDED, depthCm: FLOOD_FIELD_NO_DEPTH, likelihood: FLOOD_FIELD_NO_LIKELIHOOD },
    ];
    const f = decodeFloodField(encode(3, 2, cells));
    expect(f.width).toBe(3);
    expect(f.height).toBe(2);
    expect([...f.cls]).toEqual(cells.map((c) => c.cls));
    expect([...f.depthCm]).toEqual(cells.map((c) => c.depthCm));
    expect([...f.likelihood]).toEqual(cells.map((c) => c.likelihood));

    const rgba = encodeFloodFieldRgba(f);
    // texture แถว 0 = ไฟล์แถว 0 = ขอบใต้ (DataTexture เรียงล่างขึ้นบนอยู่แล้ว)
    const px = (i: number) => [...rgba.subarray(i * 4, i * 4 + 4)];
    expect(px(0)).toEqual([C.DRY * FLOOD_TEX_CLASS_STEP, 0, Math.round(3 * 2.55), 0]);
    expect(px(1)).toEqual([C.FLOODED * FLOOD_TEX_CLASS_STEP, Math.round((150 / 1000) * 255), Math.round(88 * 2.55), 255]);
    // "ไม่ได้ประมาณ" ต้องไม่กลายเป็นความลึก 0 ที่ "มีค่า" — G = 0 และ A = 0
    expect(px(2)).toEqual([C.FLOODED_DEPTH_NOT_ESTIMATED * FLOOD_TEX_CLASS_STEP, 0, Math.round(70 * 2.55), 0]);
    expect(px(3)).toEqual([C.NO_OBSERVATION * FLOOD_TEX_CLASS_STEP, 0, 0, 0]);
    expect(px(4)).toEqual([C.REFERENCE_WATER * FLOOD_TEX_CLASS_STEP, 0, 0, 0]);
    expect(px(5)).toEqual([C.EXCLUDED * FLOOD_TEX_CLASS_STEP, 0, 0, 0]);

    const tex = buildFloodFieldTexture(f);
    expect(tex.texture.flipY).toBe(false);
    expect(tex.texture.image.width).toBe(3);
    expect(tex.texture.image.height).toBe(2);
    expect(tex.texture.image.data).toEqual(rgba);
    tex.dispose();

    expect(summarizeFloodField(f)).toEqual({ floodedCells: 2, depthEstimatedCells: 1, maxDepthCm: 150 });
    // กรอบของเซลล์ที่มีความลึก (คอลัมน์ 1 แถว 0) + ขอบ 1 เซลล์ ตัดที่ขอบตาราง
    expect(floodFieldDepthBounds(f)).toEqual({ c0: 0, c1: 2, r0: 0, r1: 1 });
  });

  it("ความลึกเกิน 10 ม. ถูกตัดที่เต็มสเกลของช่อง G, ฉากแห้งไม่มี maxDepth และไม่มีกรอบ", () => {
    const f = decodeFloodField(encode(2, 1, [flooded(2500), dry()]));
    expect(encodeFloodFieldRgba(f)[1]).toBe(255);
    const dryScene = decodeFloodField(encode(2, 1, [dry(), dry()]));
    expect(summarizeFloodField(dryScene)).toEqual({ floodedCells: 0, depthEstimatedCells: 0, maxDepthCm: null });
    expect(floodFieldDepthBounds(dryScene)).toBeNull();
  });

  /**
   * cache HIT ของ Cloudflare อาจส่ง body ที่ยังเป็น gzip มาโดยไม่มี
   * `content-encoding` (วัดบน prod 2026-09-02) — เส้นทางโหลดต้องดูที่ไบต์ ไม่ใช่
   * header: `1f 8b` → แกะในเบราว์เซอร์ก่อน ไม่งั้นส่งต่อตามเดิม
   */
  it("ไบต์ที่ยังเป็น gzip (1f 8b) ถูกแกะก่อนถอด; ไบต์ SFLD ดิบผ่านไปตามเดิม", async () => {
    const cells: Cell[] = [dry(), flooded(150, 88), dry(), dry()];
    const raw = encode(2, 2, cells);
    const gz = gzipSync(new Uint8Array(raw));
    const gzBuf = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer;
    expect(isGzipBytes(gzBuf)).toBe(true);
    expect(isGzipBytes(raw)).toBe(false);
    // magic ของ gzip ไม่ผ่านตัวถอดที่เข้มงวด — ต้องแกะก่อนเสมอ
    expect(() => decodeFloodField(gzBuf)).toThrow(/magic/);
    const inflated = await inflateFloodFieldBytes(gzBuf);
    expect(new Uint8Array(inflated)).toEqual(new Uint8Array(raw));
    const f = decodeFloodField(inflated);
    expect([...f.cls]).toEqual(cells.map((c) => c.cls));
    expect([...f.depthCm]).toEqual(cells.map((c) => c.depthCm));
    // ไม่ใช่ gzip = คืนบัฟเฟอร์เดิม ไม่แตะต้อง
    expect(await inflateFloodFieldBytes(raw)).toBe(raw);
    // สตรีม gzip ที่ถูกตัดกลางทาง → reject ที่ขั้นแกะ ไม่หลุดไปเป็น "magic ไม่ตรง"
    await expect(inflateFloodFieldBytes(gzBuf.slice(0, gzBuf.byteLength - 6))).rejects.toThrow();
  });

  it("GLSL ฝังค่าคงที่ชุดเดียวกับตัวเข้ารหัส", () => {
    const src = floodFieldGlsl();
    expect(src).toContain(`SIAHRA_FLOOD_CLASS_STEP = ${FLOOD_TEX_CLASS_STEP.toFixed(6)}`);
    expect(src).toContain(`SIAHRA_FLOOD_CLS_FLOODED = ${C.FLOODED.toFixed(6)}`);
    expect(src).toContain(`SIAHRA_FLOOD_CLS_NOT_EST = ${C.FLOODED_DEPTH_NOT_ESTIMATED.toFixed(6)}`);
    expect(src).toContain("texelFetch");
  });
});

/**
 * ฉากทอง (golden) ของ pipeline Python — ไบต์จริงที่ etl เขียน ไม่ใช่ที่เทสสร้างเอง:
 * ถ้าฝั่ง Python เปลี่ยน layout โดยไม่บวก version ทั้งสองฝั่ง เทสนี้จะแดงก่อน
 * เบราว์เซอร์จะวาดอะไรผิด ๆ
 */
describe("golden fixture (apps/etl/gfm/tests/fixtures/57)", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const root = resolve(here, "../../../etl/gfm/tests/fixtures/57");
  const sceneDirs = existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()) : [];

  it("มีฉากทองหนึ่งฉาก", () => {
    expect(sceneDirs.length).toBe(1);
  });

  it("ถอดได้ 686×802 — FLOODED มีค่าความลึกเสมอ คลาสอื่นไม่มีเลย และตัวเลขตรงกับ meta.json", () => {
    const dir = resolve(root, sceneDirs[0].name);
    const raw = gunzipSync(readFileSync(resolve(dir, "field.bin")));
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    const f = decodeFloodField(buf);
    expect(f.width).toBe(686);
    expect(f.height).toBe(802);
    // นับใน JS ล้วนแล้ว assert ครั้งเดียว — `expect()` 550k ครั้งในลูปกิน ~6 วิบน runner
    // ของ GitHub (เกิน timeout 5 วิ) ทั้งที่ในเครื่อง dev ใช้ไม่ถึงวิ
    let flooded = 0;
    let notEstimated = 0;
    let floodedWithoutDepth = 0;
    let floodedOverCap = 0;
    let depthOnNonFlooded = 0;
    for (let i = 0; i < f.cls.length; i++) {
      const c = f.cls[i];
      const d = f.depthCm[i];
      if (c === C.FLOODED) {
        flooded++;
        if (d === FLOOD_FIELD_NO_DEPTH) floodedWithoutDepth++;
        else if (d > 1000) floodedOverCap++;
      } else {
        if (c === C.FLOODED_DEPTH_NOT_ESTIMATED) notEstimated++;
        if (d !== FLOOD_FIELD_NO_DEPTH) depthOnNonFlooded++;
      }
    }
    expect(flooded).toBeGreaterThan(0);
    expect({ floodedWithoutDepth, floodedOverCap, depthOnNonFlooded }).toEqual({
      floodedWithoutDepth: 0,
      floodedOverCap: 0,
      depthOnNonFlooded: 0,
    });
    const meta = JSON.parse(readFileSync(resolve(dir, "meta.json"), "utf8")) as {
      sceneId: string;
      floodedCells: number;
      maxDepthCm: number | null;
      depthEstimatedFraction: number;
    };
    expect(meta.sceneId).toBe(sceneDirs[0].name);
    const s = summarizeFloodField(f);
    expect(s.floodedCells).toBe(flooded + notEstimated);
    expect(s.floodedCells).toBe(meta.floodedCells);
    expect(s.depthEstimatedCells).toBe(flooded);
    expect(s.maxDepthCm).toBe(meta.maxDepthCm);
    expect(s.depthEstimatedCells / s.floodedCells).toBeCloseTo(meta.depthEstimatedFraction, 3);
  });
});
