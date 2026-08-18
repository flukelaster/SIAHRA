import { describe, expect, it } from "vitest";
import { parsePermalink, serialisePermalink } from "../lib/permalink";

describe("permalink round-trip", () => {
  it("carries p, cam, ex, layers and t through serialise → parse", () => {
    const search = serialisePermalink({
      provinceCode: "10",
      pose: { position: [1200, 800, -400], target: [0, 0, 0] },
      exaggeration: 1.6,
      layers: { terrain: true, water: true, buildings: false },
      atIso: "2026-08-18T09:00:00.000Z",
    });

    // ทุกคีย์ต้องอยู่ในสตริงจริง ไม่ใช่แค่ parse กลับมาได้
    expect(search).toContain("p=10");
    expect(search).toContain("cam=1200%2C800%2C-400%2C0%2C0%2C0");
    expect(search).toContain("ex=1.6");
    expect(search).toContain("layers=terrain%2Cwater");
    expect(search).toContain("t=2026-08-18T09%3A00%3A00.000Z");

    expect(parsePermalink(search)).toEqual({
      provinceCode: "10",
      pose: { position: [1200, 800, -400], target: [0, 0, 0] },
      exaggeration: 1.6,
      layers: ["terrain", "water"],
      atIso: "2026-08-18T09:00:00.000Z",
    });
  });

  it("omits ex at the default exaggeration, and parses that back as null", () => {
    const search = serialisePermalink({
      provinceCode: "50",
      pose: null,
      exaggeration: 1,
      layers: { terrain: true },
      atIso: null,
    });
    expect(search).toBe("?p=50");
    expect(parsePermalink(search).exaggeration).toBeNull();
  });

  it("omits layers while every layer is on", () => {
    const search = serialisePermalink({
      provinceCode: "50",
      pose: null,
      exaggeration: 1,
      layers: { terrain: true, water: true },
      atIso: null,
    });
    expect(search).not.toContain("layers=");
    expect(parsePermalink(search).layers).toBeNull();
  });

  // พฤติกรรมที่มีอยู่จริงวันนี้: ปิดครบทุกเลเยอร์จะได้ `layers=` ว่าง ซึ่ง
  // parse กลับมาเป็น null (= "ใช้ค่า default ของแอป") ไม่ใช่ [] — เทสนี้ตรึงไว้
  // ตามของจริง ไม่ได้แก้ระหว่างแยกโมดูล
  it("writes an empty layers list when every layer is off, which parses back as null", () => {
    const search = serialisePermalink({
      provinceCode: "50",
      pose: null,
      exaggeration: 1,
      layers: { terrain: false, water: false },
      atIso: null,
    });
    expect(search).toContain("layers=");
    expect(parsePermalink(search).layers).toBeNull();
  });

  it("rounds the camera to whole units", () => {
    const search = serialisePermalink({
      provinceCode: "10",
      pose: { position: [1200.4, 800.6, -400.5], target: [0.2, -0.6, 0] },
      exaggeration: 1,
      layers: {},
      atIso: null,
    });
    expect(parsePermalink(search).pose).toEqual({
      position: [1200, 801, -400],
      target: [0, -1, 0],
    });
  });
});

describe("parsePermalink rejects junk", () => {
  it("drops a province code that is not two digits", () => {
    expect(parsePermalink("?p=1").provinceCode).toBeNull();
    expect(parsePermalink("?p=abc").provinceCode).toBeNull();
    expect(parsePermalink("p=10").provinceCode).toBe("10");
  });

  it("drops a camera that is not six finite numbers", () => {
    expect(parsePermalink("?cam=1,2,3").pose).toBeNull();
    expect(parsePermalink("?cam=1,2,3,4,5,x").pose).toBeNull();
  });

  it("drops an unparseable timestamp", () => {
    expect(parsePermalink("?t=yesterday").atIso).toBeNull();
    expect(parsePermalink("?t=2026-08-18T09:00:00.000Z").atIso).toBe("2026-08-18T09:00:00.000Z");
  });

  it("returns all-null for an empty query", () => {
    expect(parsePermalink("")).toEqual({
      provinceCode: null,
      pose: null,
      exaggeration: null,
      layers: null,
      atIso: null,
    });
  });
});
