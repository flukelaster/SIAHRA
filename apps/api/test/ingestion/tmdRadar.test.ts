import { afterEach, describe, expect, it, vi } from "vitest";
import { UpstreamShapeError } from "../../src/ingestion/errors";
import { radarFrameProjection } from "../../src/ingestion/schemas/radar";
import {
  RADAR_GEOREFERENCES,
  RadarFrameNotServedError,
  WEB_MERCATOR_SINCE_MS,
  radarProjectionAt,
  fetchRadarFrame,
  fetchRadarIndex,
} from "../../src/ingestion/tmdRadar";
import {
  RADAR_LIST_TEXT,
  RADAR_LIST_TEXT_2026_09_27,
  legacyPngFrame,
  pngOfSize,
  unknownSizePngFrame,
  validPngFrame,
} from "../fixtures/text";
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

  it("รูปแบบใหม่ (ดัชนีจริง 2026-09-27): 25 ช่อง zr/0…zr/24 ห่างกัน 15 นาที เวลาเป็น UTC", async () => {
    respondText(RADAR_LIST_TEXT_2026_09_27);
    const index = await fetchRadarIndex();

    expect(index.slots).toHaveLength(25);
    expect(index.slots[0]).toEqual({ tsMs: Date.parse("2026-09-27T10:30:00Z"), file: "zr/0.png" });
    expect(index.slots[24]).toEqual({ tsMs: Date.parse("2026-09-27T16:30:00Z"), file: "zr/24.png" });
    for (let i = 1; i < index.slots.length; i++) {
      expect(index.slots[i].tsMs - index.slots[i - 1].tsMs).toBe(15 * 60_000);
      expect(index.slots[i].file).toBe(`zr/${i}.png`);
    }
  });

  it("ดัชนีที่ปนสองรูปแบบ: เก็บทั้ง zrNNNN.png และ zr/N.png ตามลำดับที่ปรากฏ", async () => {
    respondText(
      [
        RADAR_LIST_TEXT.split("\n")[1],
        `background_THA.png "2026-09-27 16:30" overlay=zr/24.png`,
        "",
      ].join("\n"),
    );
    const index = await fetchRadarIndex();
    expect(index.slots).toEqual([
      { tsMs: Date.parse("2026-08-19T08:45:00Z"), file: "zr0023.png" },
      { tsMs: Date.parse("2026-09-27T16:30:00Z"), file: "zr/24.png" },
    ]);
  });

  it("ชื่อที่คล้ายแต่ไม่ใช่ทั้งสองรูปแบบ (เช่น path ซ้อน) ไม่ถูกนับ → ศูนย์ช่อง = รูปแบบเปลี่ยน", async () => {
    respondText(
      [
        `background_THA.png "2026-09-27 16:30" overlay=zr/../24.png`,
        `background_THA.png "2026-09-27 16:15" overlay=zr/x.png`,
        `background_THA.png "2026-09-27 16:00" overlay=radar/24.png`,
        "",
      ].join("\n"),
    );
    const err = await fetchRadarIndex().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamShapeError);
    expect(String(err)).toContain("slots");
  });

  it("georeference สองรูปแบบเป็นค่าคงที่ — ถ้าตัวเลขขยับ ภาพเรดาร์จะวางผิดที่ทั้งแผ่น", () => {
    // web-mercator: RADAR_COORDS ของ viewer TMD (ตรวจ 2026-09-27)
    expect(RADAR_GEOREFERENCES["web-mercator"]).toMatchObject({
      bounds: { minLon: 95, minLat: 4, maxLon: 108, maxLat: 22.5 },
      widthPx: 1800,
      heightPx: 2644,
    });
    // legacy: กรอบที่ ingest เดิมใช้กับภาพ 1173×1668
    expect(RADAR_GEOREFERENCES.equirectangular).toMatchObject({
      bounds: { minLon: 95.005, minLat: 3.995, maxLon: 108.005, maxLat: 22.495 },
      widthPx: 1173,
      heightPx: 1668,
    });
  });

  it("aspect ของ 1800×2644 ตรงกับกรอบใน Web Mercator ไม่ใช่ plate carrée", () => {
    const merc = (deg: number) => Math.log(Math.tan(Math.PI / 4 + (deg * Math.PI) / 360));
    const g = RADAR_GEOREFERENCES["web-mercator"];
    const mercAspect =
      ((g.bounds.maxLon - g.bounds.minLon) * Math.PI) / 180 / (merc(g.bounds.maxLat) - merc(g.bounds.minLat));
    const plateAspect = (g.bounds.maxLon - g.bounds.minLon) / (g.bounds.maxLat - g.bounds.minLat);
    const pngAspect = g.widthPx / g.heightPx;
    expect(Math.abs(mercAspect / pngAspect - 1)).toBeLessThan(0.0005);
    expect(Math.abs(plateAspect / pngAspect - 1)).toBeGreaterThan(0.03);
  });

  it("ขนาดใน georeference ตรงกับตารางขนาดที่ตัวตรวจ PNG ยอมรับ", () => {
    for (const g of Object.values(RADAR_GEOREFERENCES)) {
      expect(radarFrameProjection(pngOfSize(g.widthPx, g.heightPx), "x.png")).toBe(g.projection);
    }
  });

  it("จุดแบ่ง projection ตามเวลาอยู่ระหว่างเฟรมเก่าสุดท้าย (≤ 2026-09-02T15:40:39Z) กับรูปแบบใหม่ (2026-09-27)", () => {
    expect(WEB_MERCATOR_SINCE_MS).toBeGreaterThan(Date.parse("2026-09-02T15:40:39Z"));
    expect(WEB_MERCATOR_SINCE_MS).toBeLessThan(Date.parse("2026-09-27T00:00:00Z"));
    expect(radarProjectionAt(Date.parse("2026-09-02T15:30:00Z"))).toBe("equirectangular");
    expect(radarProjectionAt(Date.parse("2026-09-27T16:30:00Z"))).toBe("web-mercator");
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

  it("ชื่อไฟล์รูปแบบใหม่ต่อเป็น path ตามที่ให้มา: images/zr/24.png", async () => {
    respondBytes(validPngFrame());
    await fetchRadarFrame("zr/24.png");
    const url = lastRequestUrl();
    expect(url).toContain("/composite/images/zr/24.png?t=");
  });

  it("404 = ต้นทางลงเวลาไว้แต่ไม่ให้บริการภาพ → error คนละชนิดกับความล้มเหลวจริง", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("Not Found", { status: 404 }));
    const notServed = await fetchRadarFrame("zr/3.png").catch((e: unknown) => e);
    expect(notServed).toBeInstanceOf(RadarFrameNotServedError);
    expect((notServed as RadarFrameNotServedError).file).toBe("zr/3.png");

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("oops", { status: 503 }));
    const failed = await fetchRadarFrame("zr/24.png").catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(Error);
    expect(failed).not.toBeInstanceOf(RadarFrameNotServedError);
    expect(String(failed)).toContain("503");
  });

  it("ภาพที่ไม่ใช่ PNG จากชื่อรูปแบบใหม่ยังถูกปฏิเสธด้วยลายเซ็น", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(200)));
    await expect(fetchRadarFrame("zr/24.png")).rejects.toBeInstanceOf(UpstreamShapeError);
  });

  it("ขนาดที่ไม่รู้ georeference ถูกปฏิเสธ (ห้ามวาดด้วยกรอบที่เดาเอา)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(unknownSizePngFrame()));
    const err = await fetchRadarFrame("zr/24.png").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamShapeError);
    expect(String(err)).toContain("unexpected size 1x1");

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(pngOfSize(1800, 2600)));
    await expect(fetchRadarFrame("zr/24.png")).rejects.toThrow(/unexpected size 1800x2600/);
  });

  it("ขนาดที่รู้จักทั้งสองผ่าน และบอก projection ตามขนาด", async () => {
    expect(radarFrameProjection(validPngFrame(), "zr/24.png")).toBe("web-mercator");
    expect(radarFrameProjection(legacyPngFrame(), "zr0023.png")).toBe("equirectangular");
  });
});
