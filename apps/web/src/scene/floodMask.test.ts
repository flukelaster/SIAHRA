import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AoiManifest } from "@siahra/shared-types";
import { rasterizeBoundaryMask, type Ring } from "./boundaryMask";
import { buildFloodMask, rasterizeRingsBucketed } from "./floodMask";

/**
 * E16.PR0 — ชั้น GISTDA เป็นเซลล์ H3 หลายพันเซลล์ต่อจังหวัด ตัว rasterise ของ flood mask
 * จึงจัดขอบเป็นถังตามแถวแทนการทดสอบทุกขอบทุกแถว — ผลต้องตรงกับ `rasterizeBoundaryMask`
 * ทุกเซลล์ (การสุ่มตัวอย่างเดียวกัน: กึ่งกลางเซลล์, even-odd, half-open)
 */
const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(here, "../../public/aoi/14/manifest.json"), "utf8"),
) as AoiManifest;

/** หกเหลี่ยมคร่าว ๆ ขนาดเซลล์ H3 res-9 (~340 ม.) กระจายทั่วจังหวัด + หนึ่งรูมีรู */
function cells(): Ring[] {
  const rings: Ring[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 400; i++) {
    const lon = 100.35 + rnd() * 0.5;
    const lat = 14.1 + rnd() * 0.5;
    const r = 0.0015 + rnd() * 0.002;
    const ring: Ring = [];
    for (let k = 0; k < 6; k++) ring.push([lon + r * Math.cos((k * Math.PI) / 3), lat + r * Math.sin((k * Math.PI) / 3)]);
    ring.push(ring[0]!);
    rings.push(ring);
  }
  rings.push([[100.5, 14.3], [100.56, 14.3], [100.56, 14.36], [100.5, 14.36], [100.5, 14.3]]);
  rings.push([[100.52, 14.32], [100.54, 14.32], [100.54, 14.34], [100.52, 14.34], [100.52, 14.32]]);
  return rings;
}

describe("rasterizeRingsBucketed", () => {
  it("ได้ผลเท่ากับ rasterizeBoundaryMask ทุกเซลล์", () => {
    const rings = cells();
    const expected = rasterizeBoundaryMask(manifest, rings);
    const actual = rasterizeRingsBucketed(manifest, rings);
    let filled = 0;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      if (expected[i]) filled++;
      if (expected[i] !== actual[i]) diff++;
    }
    expect(filled).toBeGreaterThan(100);
    expect(diff).toBe(0);
  });
});

describe("buildFloodMask — มาสก์ไม่เบลอสำหรับ FwDET (E16 B-2)", () => {
  it("`raw` = ผลของ rasterizeRingsBucketed ทุกเซลล์ (0/1 ล้วน) ส่วน texture ถูกเบลอ", () => {
    const rings = cells();
    const features = rings.map((ring, i) => ({
      type: "Feature" as const,
      id: String(i),
      properties: {} as never,
      geometry: { type: "Polygon" as const, coordinates: [ring] },
    }));
    const mask = buildFloodMask(manifest, features, null)!;
    const expected = rasterizeRingsBucketed(manifest, rings);
    expect(mask.raw.length).toBe(expected.length);
    let diff = 0;
    for (let i = 0; i < expected.length; i++) if (mask.raw[i] !== expected[i]) diff++;
    expect(diff).toBe(0);
    expect([...new Set(mask.raw)].sort()).toEqual([0, 1]);
    const tex = mask.texture.image.data as Uint8Array;
    expect(tex.some((v) => v > 0 && v < 255)).toBe(true);
    mask.dispose();
  });
});
