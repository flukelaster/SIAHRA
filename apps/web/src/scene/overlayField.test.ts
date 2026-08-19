import { describe, expect, it } from "vitest";
import { computeOverlayField, type OverlayGrid } from "./overlayField";

/**
 * DEM สังเคราะห์: ที่ราบกว้างมีร่องต่ำพาดกลาง — พอที่จะแยก "พื้นที่ลุ่มต่ำ" ออก
 * จากพื้นรอบข้างได้โดยไม่ต้องโหลด terrain.bin จริง
 */
const GRID: OverlayGrid = { width: 96, height: 64, cellSizeM: 200 };

function syntheticDem(): Float32Array {
  const { width, height } = GRID;
  const h = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const ridge = 40 + 30 * Math.sin((c / width) * Math.PI * 2);
      const valley = Math.exp(-((r - height / 2) ** 2) / (2 * 4 ** 2)) * 35;
      h[r * width + c] = ridge - valley;
    }
  }
  return h;
}

function insideMask(): Uint8Array {
  const { width, height } = GRID;
  const m = new Uint8Array(width * height);
  for (let r = 4; r < height - 4; r++) for (let c = 4; c < width - 4; c++) m[r * width + c] = 1;
  return m;
}

/** FNV-1a — พอสำหรับเทียบว่า "ไบต์ต่อไบต์เหมือนกัน" */
function hash(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

describe("computeOverlayField", () => {
  it("ให้ผลไบต์ต่อไบต์เท่าเดิมทุกครั้ง — worker กับ main thread จึงตรงกันเสมอ", () => {
    const a = computeOverlayField(GRID, syntheticDem(), insideMask());
    const b = computeOverlayField(GRID, syntheticDem(), insideMask());
    expect(hash(a.data)).toBe(hash(b.data));
    expect(a.lowlandShare).toBe(b.lowlandShare);
  });

  it("ไม่แก้ไขอาร์เรย์ที่รับเข้ามา — main thread ยังใช้ heights ตัวเดิมต่อได้", () => {
    const heights = syntheticDem();
    const mask = insideMask();
    const before = hash(new Uint8Array(heights.buffer.slice(0)));
    computeOverlayField(GRID, heights, mask);
    expect(hash(new Uint8Array(heights.buffer.slice(0)))).toBe(before);
    expect(mask).toEqual(insideMask());
  });

  it("ผ่าน structured clone แล้วยังได้ผลเดิม (นี่คือสิ่งที่ worker ทำจริง)", () => {
    const heights = syntheticDem();
    const mask = insideMask();
    const direct = computeOverlayField(GRID, heights, mask);
    const cloned = computeOverlayField(
      structuredClone(GRID),
      structuredClone(heights),
      structuredClone(mask),
    );
    expect(hash(cloned.data)).toBe(hash(direct.data));
  });

  it("ร่องกลางถูกจัดเป็นพื้นที่ลุ่มต่ำ ส่วนสันไม่ถูกจัด", () => {
    const { width, height } = GRID;
    const f = computeOverlayField(GRID, syntheticDem(), insideMask());
    const at = (r: number, c: number) => f.data[((height - 1 - r) * width + c) * 4];
    expect(at(Math.floor(height / 2), Math.floor(width / 2))).toBeGreaterThan(200);
    expect(at(6, Math.floor(width / 2))).toBeLessThan(60);
    expect(f.lowlandShare).toBeGreaterThan(0);
    expect(f.lowlandShare).toBeLessThan(1);
  });

  it("แชนแนล G ยังเป็นศูนย์ — ฮาโลที่ตรวจวัดจริงถูกเขียนบน main thread เท่านั้น", () => {
    const f = computeOverlayField(GRID, syntheticDem(), insideMask());
    for (let i = 1; i < f.data.length; i += 4) expect(f.data[i]).toBe(0);
  });
});
