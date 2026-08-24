import { describe, expect, it } from "vitest";
import { parsePermalink, serialisePermalink } from "../lib/permalink";

describe("permalink round-trip", () => {
  it("carries p, cam, ex, layers and t through serialise → parse", () => {
    const search = serialisePermalink({
      provinceCode: "10",
      pose: { position: [1200, 800, -400], target: [0, 0, 0] },
      exaggeration: 1.6,
      layers: { terrain: true, water: true, buildings: false },
      defaultLayers: { terrain: true, water: true, buildings: true },
      atIso: "2026-08-18T09:00:00.000Z",
      forecastAtIso: null,
      lang: "th",
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
      forecastAtIso: null,
      lang: null,
    });
  });

  it("omits ex at the default exaggeration, and parses that back as null", () => {
    const search = serialisePermalink({
      provinceCode: "50",
      pose: null,
      exaggeration: 1,
      layers: { terrain: true },
      defaultLayers: { terrain: true },
      atIso: null,
      forecastAtIso: null,
      lang: "th",
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
      defaultLayers: { terrain: true, water: true },
      atIso: null,
      forecastAtIso: null,
      lang: "th",
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
      defaultLayers: { terrain: true, water: true },
      atIso: null,
      forecastAtIso: null,
      lang: "th",
    });
    expect(search).toContain("layers=");
    expect(parsePermalink(search).layers).toBeNull();
  });

  /**
   * E10.4 — ชั้น `exposure` ปิดไว้เป็นค่าเริ่มต้น ลิงก์จึงต้องพาสถานะของมันไปได้
   * ทั้งสองทิศ ไม่ใช่รีเซ็ตกลับเป็นค่าเริ่มต้นเงียบ ๆ ตอนเปิดลิงก์
   */
  it("carries the flood-exposure layer through in both states", () => {
    const defaultLayers = { lowland: true, exposure: false, buildings: true };

    // เปิดชั้นที่ปิดไว้เป็นค่าเริ่มต้น = ทุกชั้นเปิดหมดพอดี ซึ่งเป็นกรณีที่กฎเดิม
    // ("เขียนเมื่อมีชั้นไหนปิด") ทิ้ง `layers` ไปแล้วสถานะหายเงียบ ๆ
    const on = serialisePermalink({
      provinceCode: "14",
      pose: null,
      exaggeration: 1,
      layers: { lowland: true, exposure: true, buildings: true },
      defaultLayers,
      atIso: null,
      forecastAtIso: null,
      lang: "th",
    });
    expect(on).toContain("layers=");
    expect(parsePermalink(on).layers).toContain("exposure");

    // ปิดอยู่ = ตรงกับค่าเริ่มต้น จึงไม่ต้องเขียนอะไรลงลิงก์ และการอ่านกลับได้ null
    // ซึ่งแอปแปลว่า "ใช้ค่าเริ่มต้น" = ยังปิดอยู่เหมือนเดิม
    const off = serialisePermalink({
      provinceCode: "14",
      pose: null,
      exaggeration: 1,
      layers: { ...defaultLayers },
      defaultLayers,
      atIso: null,
      forecastAtIso: null,
      lang: "th",
    });
    expect(off).not.toContain("layers=");
    expect(parsePermalink(off).layers).toBeNull();

    // ปิดชั้นอื่นด้วย = ต่างจากค่าเริ่มต้น จึงถูกเขียน และ exposure ยังไม่ติดไปด้วย
    const mixed = serialisePermalink({
      provinceCode: "14",
      pose: null,
      exaggeration: 1,
      layers: { lowland: true, exposure: false, buildings: false },
      defaultLayers,
      atIso: null,
      forecastAtIso: null,
      lang: "th",
    });
    expect(parsePermalink(mixed).layers).toEqual(["lowland"]);
  });

  it("rounds the camera to whole units", () => {
    const search = serialisePermalink({
      provinceCode: "10",
      pose: { position: [1200.4, 800.6, -400.5], target: [0.2, -0.6, 0] },
      exaggeration: 1,
      layers: {},
      defaultLayers: {},
      atIso: null,
      forecastAtIso: null,
      lang: "th",
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

  it("drops an unparseable forecast timestamp", () => {
    expect(parsePermalink("?f=yesterday").forecastAtIso).toBeNull();
    expect(parsePermalink("?f=2026-08-18T09:00:00.000Z").forecastAtIso).toBe(
      "2026-08-18T09:00:00.000Z",
    );
  });

  /**
   * E12.4a — `t` (observed history) และ `f` (พยากรณ์ที่กำลังเลื่อนดู) ต้องไม่ถูก
   * ยอมรับพร้อมกันทั้งคู่ ไม่ว่าจะทาง `serialisePermalink` (เขียนแค่ตัวเดียว)
   * หรือทาง `parsePermalink` ตอนอ่านลิงก์ที่ถูกแก้มือให้มีทั้งสองคีย์ — `t`
   * ชนะเสมอเพราะเป็นพารามิเตอร์เดิมที่มีมาก่อน และการย้อนกลับไปที่ค่าตรวจวัดจริง
   * ปลอดภัยกว่าการค้างอยู่ที่ขั้นพยากรณ์ที่ยังไม่ได้ยืนยัน
   */
  it("t wins over f when a hand-edited URL carries both", () => {
    // ทั้งคู่ parse ได้จริง — t ชนะ, f หายไป
    expect(
      parsePermalink("?t=2026-08-18T09:00:00.000Z&f=2026-08-19T00:00:00.000Z"),
    ).toMatchObject({
      atIso: "2026-08-18T09:00:00.000Z",
      forecastAtIso: null,
    });

    // t มีอยู่แต่ parse ไม่ขึ้น (ขยะ) — ยังชนะอยู่ดี เพราะการมีคีย์ t เท่ากับ
    // ผู้เขียนลิงก์ตั้งใจอ้างค่าตรวจวัดจริง แม้ค่าจะพังก็ตาม
    expect(parsePermalink("?t=yesterday&f=2026-08-19T00:00:00.000Z")).toMatchObject({
      atIso: null,
      forecastAtIso: null,
    });

    // ไม่มี t เลย — f ใช้ได้ตามปกติ
    expect(parsePermalink("?f=2026-08-19T00:00:00.000Z")).toMatchObject({
      atIso: null,
      forecastAtIso: "2026-08-19T00:00:00.000Z",
    });
  });

  it("serialisePermalink never writes both t and f, even if both are passed non-null", () => {
    const search = serialisePermalink({
      provinceCode: "10",
      pose: null,
      exaggeration: 1,
      layers: {},
      defaultLayers: {},
      atIso: "2026-08-18T09:00:00.000Z",
      forecastAtIso: "2026-08-19T00:00:00.000Z",
      lang: "th",
    });
    expect(search).toContain("t=2026-08-18T09%3A00%3A00.000Z");
    expect(search).not.toContain("f=");
    expect(parsePermalink(search).forecastAtIso).toBeNull();
  });

  it("writes f when only forecastAtIso is set", () => {
    const search = serialisePermalink({
      provinceCode: "10",
      pose: null,
      exaggeration: 1,
      layers: {},
      defaultLayers: {},
      atIso: null,
      forecastAtIso: "2026-08-19T00:00:00.000Z",
      lang: "th",
    });
    expect(search).toContain("f=2026-08-19T00%3A00%3A00.000Z");
    expect(search).not.toContain("t=");
    expect(parsePermalink(search).forecastAtIso).toBe("2026-08-19T00:00:00.000Z");
  });

  it("returns all-null for an empty query", () => {
    expect(parsePermalink("")).toEqual({
      provinceCode: null,
      pose: null,
      exaggeration: null,
      layers: null,
      atIso: null,
      forecastAtIso: null,
      lang: null,
    });
  });
});
