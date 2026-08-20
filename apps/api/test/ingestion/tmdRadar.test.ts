import { afterEach, describe, expect, it, vi } from "vitest";
import { RADAR_BOUNDS, RADAR_SIZE, fetchRadarFrame, fetchRadarIndex } from "../../src/ingestion/tmdRadar";
import { RADAR_LIST_TEXT, validPngFrame } from "../fixtures/text";
import { lastRequestUrl, respondBytes, respondText } from "./mockFetch";

/**
 * E5.6 — ดัชนีและเฟรมของเรดาร์รวม TMD
 *
 * กับดักของต้นทางนี้:
 *   - ไฟล์ดัชนีเป็น **ข้อความล้วน** ไม่ใช่ JSON และหนึ่งบรรทัดมีทั้งภาพพื้นหลัง
 *     และรายการ overlay — ต้องหยิบเฉพาะ `zrNNNN.png`
 *   - เวลาในบรรทัด ("2026-08-19 08:30") ไม่มีเครื่องหมายโซนเวลา และเป็น **UTC**
 *     ถ้าตีความเป็นเวลาไทย ทุกเฟรมจะเลื่อนไป 7 ชั่วโมง — จึงยึด epoch เป๊ะ ๆ ไว้
 *   - ต้นทาง (หลัง Imperva) ไม่ส่ง `Last-Modified` → `publishedAt` เป็น null
 *     ห้ามเอาเวลาเฟรมล่าสุดมาสวมแทน (คนละความหมายกับ "เวลาที่เผยแพร่")
 *   - ช่องเก็บภาพเป็นวงแหวน 24 ช่องที่ถูกเขียนทับ → คีย์เวลาคือสิ่งเดียวที่บอกได้
 *     ว่าภาพไหนคือเวลาไหน
 */
afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchRadarIndex", () => {
  it("แปลงบรรทัดของ fixture เป็นช่องเวลา + ชื่อไฟล์ ตามลำดับที่ปรากฏ", async () => {
    respondText(RADAR_LIST_TEXT);
    const index = await fetchRadarIndex();

    expect(index.slots).toEqual([
      { tsMs: Date.parse("2026-08-19T08:30:00Z"), file: "zr0022.png" },
      { tsMs: Date.parse("2026-08-19T08:45:00Z"), file: "zr0023.png" },
    ]);
  });

  it("publishedAt มาจากส่วนหัว Last-Modified เท่านั้น — ไม่มีหัวนี้คือ null", async () => {
    respondText(RADAR_LIST_TEXT);
    await expect(fetchRadarIndex()).resolves.toMatchObject({ publishedAt: null });

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(RADAR_LIST_TEXT, { headers: { "Last-Modified": "Wed, 19 Aug 2026 08:47:00 GMT" } }),
    );
    const withHeader = await fetchRadarIndex();
    expect(withHeader.publishedAt).toBe("2026-08-19T08:47:00.000Z");
    // เวลาเผยแพร่ต้องไม่ใช่เวลาของเฟรมล่าสุด — คนละความหมาย
    expect(withHeader.publishedAt).not.toBe(new Date(withHeader.slots[1].tsMs).toISOString());
  });

  it("บรรทัดที่ไม่มีไฟล์ zrNNNN.png ถูกข้าม แต่บรรทัดที่ดีในไฟล์เดียวกันยังอยู่", async () => {
    respondText(
      [
        `background_THA.png "2026-08-19 08:30" overlay=topo_THA.png,map_THA_province.png`,
        RADAR_LIST_TEXT.split("\n")[1],
        "",
      ].join("\n"),
    );
    const index = await fetchRadarIndex();
    expect(index.slots).toHaveLength(1);
    expect(index.slots[0].file).toBe("zr0023.png");
  });

  it("กรอบพิกัดและขนาดภาพเป็นค่าคงที่ที่ georeference ทั้งชั้นข้อมูล", () => {
    // ค่าจากหัวกริด QPE ของ TMD — ถ้าตัวเลขเหล่านี้ขยับ ภาพเรดาร์จะวางผิดที่ทั้งแผ่น
    expect(RADAR_BOUNDS).toEqual({ minLon: 95.005, minLat: 3.995, maxLon: 108.005, maxLat: 22.495 });
    expect(RADAR_SIZE).toEqual({ widthPx: 1173, heightPx: 1668 });
  });
});

describe("fetchRadarFrame", () => {
  it("คืนไบต์ PNG ตามที่ต้นทางส่งมา และแนบตัวกันแคชไปกับคำขอ", async () => {
    respondBytes(validPngFrame());
    const frame = await fetchRadarFrame("zr0023.png");

    expect(new Uint8Array(frame)).toEqual(new Uint8Array(validPngFrame()));
    const url = lastRequestUrl();
    expect(url).toContain("/composite/images/zr0023.png");
    // ต้นทางเขียนทับไฟล์เดิมในที่เดิม — ถ้าไม่กันแคชจะได้ภาพของช่องก่อนหน้า
    expect(url).toMatch(/[?&]t=\d+/);
  });
});
