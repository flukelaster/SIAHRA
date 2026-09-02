import { describe, expect, it } from "vitest";
import { floodHeaders, floodKey, localFloodSegments, parseFloodPath } from "./floodPath.ts";

const SCENE = "20240913T112151-AS020M";

describe("parseFloodPath — accepted forms", () => {
  it("อ่าน index.json ของจังหวัด", () => {
    const ref = parseFloodPath("/aoi/57/flood/index.json");
    expect(ref).toEqual({ province: "57", sceneId: null, file: "index.json" });
    expect(floodKey(ref!)).toBe("aoi/57/flood/index.json");
    expect(localFloodSegments(ref!)).toEqual(["57", "flood", "index.json"]);
  });

  it("อ่าน field.bin และ meta.json ของฉาก", () => {
    const field = parseFloodPath(`/aoi/57/flood/${SCENE}/field.bin`);
    expect(field).toEqual({ province: "57", sceneId: SCENE, file: "field.bin" });
    expect(floodKey(field!)).toBe(`aoi/57/flood/${SCENE}/field.bin`);
    expect(localFloodSegments(field!)).toEqual(["57", "flood", SCENE, "field.bin"]);
    const meta = parseFloodPath(`/aoi/57/flood/${SCENE}/meta.json`);
    expect(meta).toEqual({ province: "57", sceneId: SCENE, file: "meta.json" });
    expect(floodKey(meta!)).toBe(`aoi/57/flood/${SCENE}/meta.json`);
  });

  it("ตัด query string ทิ้งก่อน (req.url ของ node มีติดมา ส่วน URL.pathname ไม่มี)", () => {
    expect(parseFloodPath("/aoi/57/flood/index.json?v=1")?.file).toBe("index.json");
    expect(parseFloodPath(`/aoi/57/flood/${SCENE}/field.bin?x=../..`)?.sceneId).toBe(SCENE);
  });

  it("คีย์ประกอบจากส่วนที่แมตช์เท่านั้น — สองจังหวัด/สองฉากไม่ชนกัน", () => {
    const a = floodKey(parseFloodPath(`/aoi/57/flood/${SCENE}/field.bin`)!);
    const b = floodKey(parseFloodPath(`/aoi/58/flood/${SCENE}/field.bin`)!);
    const c = floodKey(parseFloodPath("/aoi/57/flood/20240901T112151-AS020M/field.bin")!);
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("floodHeaders", () => {
  it("index.json: JSON แคชสั้น + serve-stale (ถูกเขียนทับเมื่อมีฉากใหม่)", () => {
    expect(floodHeaders(parseFloodPath("/aoi/57/flood/index.json")!)).toEqual({
      contentType: "application/json",
      cacheControl: "public, max-age=300, stale-while-revalidate=600",
      contentEncoding: null,
    });
  });

  it("meta.json: JSON immutable หนึ่งปี", () => {
    expect(floodHeaders(parseFloodPath(`/aoi/57/flood/${SCENE}/meta.json`)!)).toEqual({
      contentType: "application/json",
      cacheControl: "public, max-age=31536000, immutable",
      contentEncoding: null,
    });
  });

  it("field.bin: octet-stream immutable และ content-encoding: gzip (pipeline gzip เสมอ)", () => {
    expect(floodHeaders(parseFloodPath(`/aoi/57/flood/${SCENE}/field.bin`)!)).toEqual({
      contentType: "application/octet-stream",
      cacheControl: "public, max-age=31536000, immutable",
      contentEncoding: "gzip",
    });
  });
});

describe("parseFloodPath — path traversal และรูปที่ไม่ใช่ไฟล์ฉากต้องไม่ผ่าน", () => {
  /**
   * ทุกสตริงนี้ถ้าหลุดเข้าไปเป็นส่วนหนึ่งของคีย์ R2 หรือ path.join() ฝั่ง dev
   * จะอ่านไฟล์นอกต้นไม้ฉากได้ — ต้องคืน null ทั้งหมด
   */
  const rejected = [
    "/aoi/57/flood/../index.json",
    "/aoi/57/flood/./index.json",
    "/aoi/57/flood/../../index.json",
    "/aoi/57/flood//index.json",
    "/aoi/57/flood/%2e%2e/index.json",
    "/aoi/57/flood/%2E%2E/field.bin",
    `/aoi/57/flood/${SCENE}%2f../field.bin`,
    `/aoi/57/flood/${SCENE}/..%2ffield.bin`,
    `/aoi/57/flood/${SCENE}/../field.bin`,
    `/aoi/57/flood/${SCENE}/../../../etc/passwd`,
    "/aoi/../flood/index.json",
    "/aoi/%2e%2e/flood/index.json",
    "/aoi/57/../flood/index.json",
    `/aoi/57/flood/a%2fb/field.bin`,
    // รูปแบบที่ไม่ใช่ traversal แต่ก็ไม่ใช่ไฟล์ฉาก — ต้องไม่กลายเป็นคีย์เช่นกัน
    "/aoi/57/flood/index.json.bak",
    "/aoi/57/flood/index.json/",
    "/aoi/57/flood/",
    "/aoi/57/flood",
    `/aoi/57/flood/${SCENE}`,
    `/aoi/57/flood/${SCENE}/`,
    `/aoi/57/flood/${SCENE}/field.bin.gz`,
    `/aoi/57/flood/${SCENE}/other.json`,
    `/aoi/57/flood/${SCENE}/FIELD.BIN`,
    `/aoi/57/flood/${SCENE}/field.bin/`,
    "/aoi/57/flood/2024091T112151-AS020M/field.bin", // วันสั้นไปหนึ่งหลัก
    "/aoi/57/flood/20240913T112151-AS20M/field.bin", // กลุ่มไทล์ผิดรูป
    "/aoi/57/flood/20240913T112151-as020M/field.bin",
    "/aoi/57/flood/20240913T112151_AS020M/field.bin",
    "/aoi/57/flood/20240913T112151-AS020M-x/field.bin",
    "/aoi/5/flood/index.json",
    "/aoi/577/flood/index.json",
    "/aoi/5a/flood/index.json",
    "/aoi/57/floods/index.json",
    "/aoi/57/Flood/index.json",
    "/aoi/57/terrain/index.json",
    "//aoi/57/flood/index.json",
    "/aoi/57/flood/index.json/../../../../aoi/58/flood/index.json",
    `/aoi/57/flood/${"9".repeat(64)}/field.bin`,
  ];

  for (const path of rejected) {
    it(`ปฏิเสธ ${path}`, () => {
      expect(parseFloodPath(path)).toBeNull();
    });
  }

  it("ไม่แย่งเส้นทางไทล์ — ชื่อชั้นไทล์ทั้งสี่ไม่ใช่ flood", () => {
    for (const layer of ["terrain", "buildings", "features", "landcover"]) {
      expect(parseFloodPath(`/aoi/57/${layer}/0/0_0.bin`)).toBeNull();
      expect(parseFloodPath(`/aoi/57/v/2026-08-17/${layer}/0/0_0.bin`)).toBeNull();
    }
  });
});

/**
 * สิ่งที่ตัว parser ของ URL จัดการให้ก่อนถึงเรา (ฝั่ง Worker อ่าน `new URL(request.url).pathname`)
 * — วัดจริงเหมือน tilePath.test.ts: dot segment ถูกยุบ (เดินขึ้นได้อย่างมากคือหลุด prefix แล้ว
 * ไม่แมตช์) ส่วน %2f ไม่ถูกถอด จึงติดอยู่ในเซกเมนต์เดียวและถูกปฏิเสธ
 */
describe("URL parser: ยุบ dot segment ให้ แต่ไม่ถอด %2f", () => {
  const pathnameOf = (p: string) => new URL(p, "https://siahra-radar.co").pathname;

  it("%2e%2e ถูกยุบแล้วเดินขึ้นจนไม่เหลือรูปไฟล์ฉาก → ไม่แมตช์", () => {
    const pathname = pathnameOf(`/aoi/57/flood/${SCENE}/%2e%2e/field.bin`);
    expect(pathname).toBe("/aoi/57/flood/field.bin");
    expect(parseFloodPath(pathname)).toBeNull();
  });

  it("ยุบขึ้นจนไม่เหลือ /aoi/ แล้วไม่แมตช์อะไรเลย", () => {
    const pathname = pathnameOf("/aoi/57/flood/../../../../etc/flood/index.json");
    expect(pathname.startsWith("/aoi/")).toBe(false);
    expect(parseFloodPath(pathname)).toBeNull();
  });

  it("%2f ไม่ถูกถอด จึงยังติดอยู่ในเซกเมนต์เดียวและถูกปฏิเสธ", () => {
    const pathname = pathnameOf(`/aoi/57/flood/${SCENE}%2f..%2ffield.bin`);
    expect(pathname).toContain("%2f");
    expect(parseFloodPath(pathname)).toBeNull();
  });
});
