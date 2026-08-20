import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDams, fetchRainfall, fetchWaterLevel, fetchWaterLevelHistory } from "../../src/ingestion/thaiwater";
import damFixture from "../fixtures/thaiwater-analyst-dam.json";
import graphFixture from "../fixtures/thaiwater-waterlevel-graph.json";
import rainFixture from "../fixtures/thaiwater-rain24h.json";
import waterFixture from "../fixtures/thaiwater-waterlevel-load.json";
import { lastRequestUrl, respondJson } from "./mockFetch";

/**
 * E5.6 — ThaiWater (สสน./HII) สี่ปลายทาง: rain_24h, waterlevel_load,
 * waterlevel_graph, analyst/dam
 *
 * กับดักที่ต้นทางนี้ผลิตจริง และเทสนี้ยึดไว้ทีละข้อ:
 *   - **เวลาเป็นเวลาไทย ไม่มี offset** ("2026-08-19 09:20") → ต้องปัก +07:00
 *     ไม่ใช่ปล่อยให้รันไทม์เดา (พลาด = คลาด 7 ชั่วโมงทุกค่า)
 *   - ตัวเลขมาเป็นสตริงสลับกับตัวเลขในระเบียนเดียวกัน ("12.5" กับ 0)
 *   - `province_code` มาทั้ง 16 และ "10" → ต้องเป็นสตริงสองหลักเสมอ
 *   - `min_bank: 0` คือ "ไม่มีค่าสำรวจ" ไม่ใช่ตลิ่งที่ระดับน้ำทะเล — ถ้าเชื่อ
 *     ตามตัวอักษร สถานีจะถูกรายงานว่าน้ำล้นตลิ่งทั้งที่ปกติ
 *   - `situation_level` ต้องส่งผ่านตรง ๆ (1..5) ห้ามคำนวณใหม่
 *   - สถานีที่ไม่มีพิกัดต้องถูกทิ้ง ไม่ใช่ปักหมุดที่ (0,0)
 *   - อาเรย์เขื่อนไม่เคยถูกตัดที่ต้นทาง (ย้อนถึงปี 1970) → ตัดตามอายุเอง
 */
afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchRainfall", () => {
  it("แปลงระเบียนที่มีพิกัดครบ พร้อมหน่วยและเวลาไทยที่ปักโซนแล้ว", async () => {
    respondJson(rainFixture);
    const rows = await fetchRainfall();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      station: {
        id: 101,
        nameTh: "สถานีเชียงใหม่",
        nameEn: "Chiang Mai",
        lat: 18.79,
        lon: 98.98,
        provinceCode: "50",
        provinceNameTh: "เชียงใหม่",
        amphoeNameTh: "เมืองเชียงใหม่",
        basinNameTh: "ปิง",
        agencyShortTh: "สสน.",
      },
      // "12.5" (สตริง) → 12.5 มิลลิเมตร และ 0 ต้องคงเป็น 0 ไม่ใช่ null
      rain24h: 12.5,
      rain1h: 0,
      // "2026-08-19 09:00" เวลาไทย → 02:00Z
      observedAt: "2026-08-19T02:00:00.000Z",
    });
  });

  it("สถานีที่ไม่มีพิกัดถูกทิ้งทั้งระเบียน ไม่ใช่ปักที่ (0,0)", async () => {
    respondJson(rainFixture);
    const rows = await fetchRainfall();
    expect(rows.map((r) => r.station.id)).not.toContain(102);
  });
});

describe("fetchWaterLevel", () => {
  it("คำนวณ freeboard จากระดับตลิ่งจริง และส่ง situationLevel ผ่านตรง ๆ", async () => {
    respondJson(waterFixture);
    const rows = await fetchWaterLevel();

    expect(rows).toHaveLength(2);
    const [ok] = rows;
    expect(ok.station.provinceCode).toBe("16");
    expect(ok.waterlevelMsl).toBe(13.44);
    expect(ok.waterlevelLocalM).toBe(3.24);
    expect(ok.minBankMsl).toBe(14.9);
    expect(ok.groundLevelMsl).toBe(10.2);
    // freeboard = ตลิ่ง − ระดับน้ำ (เมตร) ปัดเป็นมิลลิเมตร
    expect(ok.freeboardM).toBe(1.46);
    // ระดับสถานการณ์มาจากต้นทาง ห้ามคำนวณเอง (AGENTS.md: ห้ามกุตัวเลขพยากรณ์)
    expect(ok.situationLevel).toBe(2);
    expect(ok.observedAt).toBe("2026-08-19T02:20:00.000Z");
  });

  it("min_bank = 0 คือค่าที่ขาด ไม่ใช่ตลิ่งที่ระดับ 0 — ต้องไม่มี freeboard", async () => {
    respondJson(waterFixture);
    const [, canal] = await fetchWaterLevel();
    expect(canal.minBankMsl).toBeNull();
    // ถ้าเชื่อ 0 ตามตัวอักษร ค่านี้จะกลายเป็น −1.02 = "น้ำล้นตลิ่ง 1 เมตร"
    expect(canal.freeboardM).toBeNull();
    expect(canal.groundLevelMsl).toBeNull();
    expect(canal.situationLevel).toBeNull();
  });

  it("พิกัดที่มาเป็นสตริงถูกแปลงเป็นตัวเลข", async () => {
    respondJson(waterFixture);
    const [ok] = await fetchWaterLevel();
    expect(ok.station.lat).toBe(15.12);
    expect(ok.station.lon).toBe(100.11);
  });

  it("situation_level นอกพิสัย 1–5 ถือว่าไม่มีค่า ไม่ใช่ค่าที่ตัดขอบ", async () => {
    respondJson({
      ...waterFixture,
      waterlevel_data: {
        data: [
          {
            ...waterFixture.waterlevel_data.data[0],
            situation_level: 9,
          },
        ],
      },
    });
    const [row] = await fetchWaterLevel();
    expect(row.situationLevel).toBeNull();
  });
});

describe("fetchWaterLevelHistory", () => {
  it("เรียงตามเวลา แปลงค่าสตริง และทิ้งจุดที่ไม่มีเวลา", async () => {
    respondJson(graphFixture);
    const points = await fetchWaterLevelHistory(201, 24, Date.parse("2026-08-19T03:00:00Z"));

    expect(points).toEqual([
      { t: "2026-08-19T01:00:00.000Z", value: 13.41, discharge: 220.5 },
      { t: "2026-08-19T01:10:00.000Z", value: 13.42, discharge: null },
    ]);
  });

  it("ประกอบ query ด้วยเวลาไทย ไม่ใช่ UTC (ต้นทางอ่านเป็นเวลาท้องถิ่น)", async () => {
    respondJson(graphFixture);
    const nowMs = Date.parse("2026-08-19T03:00:00Z"); // = 10:00 เวลาไทย
    await fetchWaterLevelHistory(201, 24, nowMs);

    const url = lastRequestUrl();
    expect(url).toContain("station_type=tele_waterlevel");
    expect(url).toContain("station_id=201");
    expect(decodeURIComponent(url)).toContain("end_date=2026-08-19 10:00");
    expect(decodeURIComponent(url)).toContain("start_date=2026-08-18");
    // ช่องว่างต้องเป็น %20 ไม่ใช่ "+" — ต้นทางไม่ถอด "+" แล้วคืนอนุกรมว่างเงียบ ๆ
    expect(url).not.toContain("+");
  });
});

describe("fetchDams", () => {
  it("แปลงระเบียนเขื่อนพร้อมชนิด หน่วย ล้าน ลบ.ม. และรหัสจังหวัดสองหลัก", async () => {
    respondJson(damFixture);
    const dams = await fetchDams(Date.parse("2026-08-19T03:00:00Z"));

    const large = dams.find((d) => d.id === 3)!;
    expect(large).toEqual({
      id: 3,
      nameTh: "เขื่อนภูมิพล",
      nameEn: "Bhumibol Dam",
      lat: 17.24,
      lon: 98.97,
      provinceCode: "63",
      provinceNameTh: "ตาก",
      basinNameTh: "ปิง",
      agencyShortTh: "กฟผ.",
      kind: "large",
      storageMcm: 4560.2,
      // "46.3" (สตริง) → 46.3 เปอร์เซ็นต์
      storagePercent: 46.3,
      maxStorageMcm: 13462,
      normalStorageMcm: 13462,
      inflowMcm: 12.1,
      releasedMcm: 8.4,
      observedAt: "2026-08-18T23:00:00.000Z",
    });

    const medium = dams.find((d) => d.id === 91)!;
    expect(medium.kind).toBe("medium");
    expect(medium.provinceCode).toBe("66");
    expect(medium.lat).toBe(16.44);
    expect(medium.agencyShortTh).toBeNull();
  });

  it("ระเบียนที่เก่ากว่า 48 ชั่วโมงถูกตัดทิ้ง ไม่ปนมากับค่าปัจจุบัน", async () => {
    respondJson(damFixture);
    // เลื่อนเวลาอ้างอิงไปสามวัน — ทั้งสองแถวในไฟล์กลายเป็นของเก่า
    const dams = await fetchDams(Date.parse("2026-08-22T03:00:00Z"));
    expect(dams).toEqual([]);
  });

  it("ไม่มีฟิลด์ `_p` ที่ใช้จัดลำดับภายในหลุดออกไปกับผลลัพธ์", async () => {
    respondJson(damFixture);
    const dams = await fetchDams(Date.parse("2026-08-19T03:00:00Z"));
    for (const dam of dams) expect(Object.keys(dam)).not.toContain("_p");
  });

  it("แถวรายชั่วโมงชนะแถวรายวันของเขื่อนเดียวกัน", async () => {
    respondJson({
      ...damFixture,
      data: {
        ...damFixture.data,
        dam_hourly: [
          {
            ...damFixture.data.dam_daily[0],
            dam_date: "2026-08-19 09:00",
            dam_storage: 4599.9,
            station_type: "dam_hourly",
          },
        ],
      },
    });
    const dams = await fetchDams(Date.parse("2026-08-19T03:00:00Z"));
    const large = dams.find((d) => d.id === 3)!;
    expect(large.storageMcm).toBe(4599.9);
    expect(large.observedAt).toBe("2026-08-19T02:00:00.000Z");
  });
});
