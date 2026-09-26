import { afterEach, describe, expect, it, vi } from "vitest";
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

/*
 * GISTDA (E16.PR0): ต้นทางใหม่มี `_createdAt` ต่อเซลล์ = เวลาที่ GISTDA สร้างระเบียนจริง
 * `publishedAt` ของชั้นจึงเป็น `_createdAt` ใหม่สุด ไม่ใช่ null อีกต่อไป (และไม่ใช่ `timeStamp`
 * ของซอง ซึ่งยังเป็นเวลาที่สร้าง response) — เทสอยู่ที่ floodExtentDO.test.ts / floodLayer.test.ts
 */
