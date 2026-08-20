import { describe, expect, it } from "vitest";
import { localTileSegments, parseTilePath, tileKey } from "./tilePath.ts";

describe("parseTilePath — accepted forms", () => {
  it("อ่าน path แบบมีรุ่น (E9.2)", () => {
    const ref = parseTilePath("/aoi/11/v/2026-08-17/terrain/5/12_34.bin");
    expect(ref).toEqual({ province: "11", version: "2026-08-17", layer: "terrain", z: "5", x: "12", y: "34" });
    expect(tileKey(ref!)).toBe("aoi/11/v/2026-08-17/terrain/5/12_34.bin");
  });

  it("อ่าน path แบบเดิม (ไม่มีรุ่น) ได้เหมือนเดิม", () => {
    const ref = parseTilePath("/aoi/11/terrain/5/12_34.bin");
    expect(ref).toEqual({ province: "11", version: null, layer: "terrain", z: "5", x: "12", y: "34" });
    expect(tileKey(ref!)).toBe("aoi/11/terrain/5/12_34.bin");
  });

  it("รับครบทั้งสี่ชั้น", () => {
    for (const layer of ["terrain", "buildings", "features", "landcover"]) {
      expect(parseTilePath(`/aoi/50/v/2026-08-17/${layer}/0/0_0.bin`)?.layer).toBe(layer);
      expect(parseTilePath(`/aoi/50/${layer}/0/0_0.bin`)?.layer).toBe(layer);
    }
  });

  it("รับรุ่นที่มี serial ต่อท้าย (ปล่อยสองครั้งในวันเดียว)", () => {
    expect(parseTilePath("/aoi/11/v/2026-08-17.2/terrain/0/0_0.bin")?.version).toBe("2026-08-17.2");
  });

  it("ตัด query string ทิ้งก่อน (req.url ของ node มีติดมา ส่วน URL.pathname ไม่มี)", () => {
    expect(parseTilePath("/aoi/11/terrain/0/0_0.bin?v=1")?.province).toBe("11");
  });

  /**
   * คีย์ของสองรุ่นต้องไม่ชนกัน — ถ้าที่ไหนสัก URL แบบมีรุ่นถูกแปลงเป็นคีย์เดิม
   * ชุดข้อมูลสองรุ่นจะกลายเป็นก้อนเดียวกัน ซึ่งเป็นสิ่งที่งานนี้มีไว้เพื่อกัน
   */
  it("รุ่นไม่ถูกตัดทิ้งตอนแปลงเป็นคีย์ R2", () => {
    const a = tileKey(parseTilePath("/aoi/11/v/2026-08-17/terrain/0/0_0.bin")!);
    const b = tileKey(parseTilePath("/aoi/11/v/2026-08-18/terrain/0/0_0.bin")!);
    const legacy = tileKey(parseTilePath("/aoi/11/terrain/0/0_0.bin")!);
    expect(new Set([a, b, legacy]).size).toBe(3);
  });

  it("เส้นทาง dev ทิ้งรุ่นออก (ดิสก์เครื่อง dev มีชุดข้อมูลชุดเดียว)", () => {
    expect(localTileSegments(parseTilePath("/aoi/11/v/2026-08-17/features/3/1_2.bin")!)).toEqual([
      "11",
      "features",
      "3",
      "1_2.bin",
    ]);
  });
});

describe("parseTilePath — path traversal ต้องไม่ผ่าน", () => {
  /**
   * ทุกสตริงนี้ถ้าหลุดเข้าไปเป็นส่วนหนึ่งของคีย์ R2 หรือ path.join() ฝั่ง dev
   * จะอ่านไฟล์นอกต้นไม้ tile ได้ — ต้องคืน null ทั้งหมด
   */
  const rejected = [
    "/aoi/11/v/../terrain/0/0_0.bin",
    "/aoi/11/v/./terrain/0/0_0.bin",
    "/aoi/11/v/../../terrain/0/0_0.bin",
    "/aoi/11/v//terrain/0/0_0.bin",
    "/aoi/11/v/%2e%2e/terrain/0/0_0.bin",
    "/aoi/11/v/%2E%2E/terrain/0/0_0.bin",
    "/aoi/11/v/2026-08-17%2f../terrain/0/0_0.bin",
    "/aoi/11/v/a%2fb/terrain/0/0_0.bin",
    "/aoi/11/v/2026-08-17/../terrain/0/0_0.bin",
    "/aoi/11/v/2026-08-17/terrain/../../../etc/passwd",
    "/aoi/../v/2026-08-17/terrain/0/0_0.bin",
    "/aoi/%2e%2e/terrain/0/0_0.bin",
    "/aoi/11/../terrain/0/0_0.bin",
    "/aoi/11/v/2026-08-17/../../secrets/0/0_0.bin",
    "/aoi/11/v/2026-08-17/terrain/0/..%2f0_0.bin",
    // รูปแบบที่ไม่ใช่ traversal แต่ก็ไม่ใช่ tile — ต้องไม่กลายเป็นคีย์เช่นกัน
    "/aoi/11/v/2026-08-17/terrain/0/0_0.bin.map",
    "/aoi/11/v/2026-08-17/backups/0/0_0.bin",
    "/aoi/1/v/2026-08-17/terrain/0/0_0.bin",
    "/aoi/111/v/2026-08-17/terrain/0/0_0.bin",
    "/aoi/11/v/2026-8-17/terrain/0/0_0.bin",
    "/aoi/11/v/2026-08-17-2/terrain/0/0_0.bin",
    `/aoi/11/v/${"9".repeat(64)}/terrain/0/0_0.bin`,
    "/aoi/11/v/2026-08-17/terrain/0/0_0.bin/",
    "//aoi/11/terrain/0/0_0.bin",
    "/aoi/11/terrain/0/0_0.bin/../../../../aoi/12/terrain/0/0_0.bin",
  ];

  for (const path of rejected) {
    it(`ปฏิเสธ ${path}`, () => {
      expect(parseTilePath(path)).toBeNull();
    });
  }
});

/**
 * สิ่งที่ตัว parser ของ URL จัดการให้ก่อนถึงเรา — วัดจริง ไม่ใช่เดา เพราะคอมเมนต์
 * ในหัวไฟล์ `tilePath.ts` อ้างพฤติกรรมนี้ไว้ ถ้าวันหนึ่งมันเปลี่ยน เทสนี้จะแดง
 * (ฝั่ง Worker อ่านผ่าน `new URL(request.url).pathname` ส่วน dev middleware ใช้
 * `req.url` ดิบ ๆ ที่ไม่ถูก normalise — เคสดิบอยู่ในบล็อกด้านบนแล้ว)
 */
describe("URL parser: ยุบ dot segment ให้ แต่ไม่ถอด %2f", () => {
  const pathnameOf = (p: string) => new URL(p, "https://siahra-radar.co").pathname;

  it("%2e%2e ถูกยุบเป็น dot segment จริง แล้วเดินขึ้นได้อย่างมากที่สุดเป็น path แบบเดิม", () => {
    const pathname = pathnameOf("/aoi/11/v/%2e%2e/terrain/0/0_0.bin");
    expect(pathname).toBe("/aoi/11/terrain/0/0_0.bin");
    // ผลลัพธ์ยังอยู่ใต้ aoi/ และเป็นคีย์ที่ถูกต้องตามกฎ ไม่ใช่การหลุดออกนอก prefix
    expect(tileKey(parseTilePath(pathname)!)).toBe("aoi/11/terrain/0/0_0.bin");
  });

  it("%2E%2E (ตัวใหญ่) ก็เหมือนกัน", () => {
    expect(pathnameOf("/aoi/11/v/%2E%2E/terrain/0/0_0.bin")).toBe("/aoi/11/terrain/0/0_0.bin");
  });

  it("ยุบขึ้นจนไม่เหลือ /aoi/ แล้วไม่แมตช์อะไรเลย", () => {
    const pathname = pathnameOf("/aoi/11/v/2026-08-17/../../../../etc/terrain/0/0_0.bin");
    expect(pathname.startsWith("/aoi/")).toBe(false);
    expect(parseTilePath(pathname)).toBeNull();
  });

  it("%2f ไม่ถูกถอด จึงยังติดอยู่ในเซกเมนต์เดียวและถูกปฏิเสธ", () => {
    const pathname = pathnameOf("/aoi/11/v/a%2fb/terrain/0/0_0.bin");
    expect(pathname).toContain("%2f");
    expect(parseTilePath(pathname)).toBeNull();
  });
});
