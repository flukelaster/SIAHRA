import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGistdaFloodExtent } from "../src/ingestion/gistda";
import { fetchRadarIndex } from "../src/ingestion/tmdRadar";

/**
 * E3.2: `publishedAt` = เวลาที่ "ต้นทางเผยแพร่" ต้องมาจากต้นทางจริงเท่านั้น
 * ต้นทางไม่บอก → null ห้ามเอาเวลาที่เราดึง หรือเวลาที่ตรวจวัด มาสวมแทน
 */
afterEach(() => {
  vi.restoreAllMocks();
});

const RADAR_LIST_LINE =
  'background_THA.png "2026-08-18 18:30" overlay=topo_THA.png,zr0000.png,map_THA_province.png\n';

describe("fetchRadarIndex", () => {
  it("อ่านเวลาเผยแพร่จากส่วนหัว Last-Modified เมื่อต้นทางส่งมา", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(RADAR_LIST_LINE, { headers: { "Last-Modified": "Tue, 18 Aug 2026 18:33:00 GMT" } }),
    );
    const index = await fetchRadarIndex();
    expect(index.slots).toHaveLength(1);
    expect(index.publishedAt).toBe("2026-08-18T18:33:00.000Z");
    // เวลาที่ตรวจวัด (เฟรม) ต้องไม่ถูกกลืนเป็นเวลาเผยแพร่
    expect(new Date(index.slots[0].tsMs).toISOString()).toBe("2026-08-18T18:30:00.000Z");
  });

  it("ไม่มีส่วนหัวนั้น → null (วัดจริง 2026-08-19: weather.tmd.go.th ไม่ส่ง Last-Modified)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(RADAR_LIST_LINE));
    await expect(fetchRadarIndex().then((i) => i.publishedAt)).resolves.toBeNull();
  });
});

describe("fetchGistdaFloodExtent", () => {
  const scene = (extra: Record<string, unknown>) =>
    new Response(JSON.stringify({ ...extra, features: [] }), { headers: { "Content-Type": "application/json" } });

  /**
   * `timeStamp` ของ WFS คือ "เวลาที่ GeoServer สร้าง response" ไม่ใช่เวลาที่ฉาก
   * ถูกเผยแพร่ — วัดจริง 2026-08-19 แล้วมันเดินตามนาฬิกาของคำขอทั้งที่ข้อมูล
   * เหมือนเดิมทุกไบต์ ดังนั้นถึงต้นทางจะส่งมาก็ห้ามเอามาใช้
   */
  it("ไม่เอา timeStamp ของ WFS มาเป็นเวลาเผยแพร่ แม้ต้นทางจะส่งมา", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(scene({ timeStamp: "2026-08-18T10:00:00.000Z" }));
    await expect(fetchGistdaFloodExtent({ attempts: 1 }).then((s) => s.publishedAt)).resolves.toBeNull();
  });

  it("ไม่มี timeStamp ก็ยังเป็น null (ต้นทางไม่มีวันที่ถ่ายภาพ/วันที่เผยแพร่เลย)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(scene({}));
    await expect(fetchGistdaFloodExtent({ attempts: 1 }).then((s) => s.publishedAt)).resolves.toBeNull();
  });
});
