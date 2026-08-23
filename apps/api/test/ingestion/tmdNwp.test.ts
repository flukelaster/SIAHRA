import { afterEach, describe, expect, it, vi } from "vitest";
import { UpstreamShapeError } from "../../src/ingestion/errors";
import {
  TMD_NWP_MISSING_TOKEN,
  fetchDailyAvailability,
  fetchRegionForecast,
  mapRegionDocument,
  nwpToken,
} from "../../src/ingestion/tmdNwp";
import dailyFixture from "../fixtures/tmdNwp/daily-region-S.json";
import hourlyFixture from "../fixtures/tmdNwp/hourly-region-S.json";
import { lastRequestUrl, respondJson } from "./mockFetch";

/**
 * E12.2 — การแปลง payload ของ TMD NWP
 *
 * fixture ทั้งสองไฟล์คือคำตอบจริงของต้นทาง (ภาคใต้ ตัดเหลือ 5 จังหวัด) ที่เก็บไว้เมื่อ
 * 2026-08-23 จึงยึดกับสิ่งที่ต้นทางส่งจริง ไม่ใช่สิ่งที่เอกสารบอก — เอกสารของ TMD
 * ผิดเรื่องคีย์บนสุดทั้งสอง endpoint (ดูหัวไฟล์ `schemas/tmdNwp.ts`)
 */
const NO_QUOTA = { datapointRemaining: null, rateLimitRemaining: null };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mapRegionDocument", () => {
  it("แปลงชุดรายชั่วโมงครบทุกจังหวัดของภาค และใช้ geocode เป็นรหัสจังหวัด", () => {
    const result = mapRegionDocument(hourlyFixture, NO_QUOTA);
    expect([...result.byProvince.keys()].sort()).toEqual(["90", "91", "92", "93", "94"]);
    expect(result.unknownGeocodes).toEqual([]);

    const songkhla = result.byProvince.get("90")!;
    expect(songkhla.steps).toHaveLength(48);
    // queryPoint คือจุดที่ TMD ใช้ตอบ ไม่ใช่จุดที่เราส่งไป (เราไม่ได้ส่งพิกัดเลย)
    expect(songkhla.queryPoint).toEqual({ lat: 7.207486, lon: 100.596251 });
    expect(songkhla.steps[0]).toEqual({
      // เก็บสตริงของต้นทางทั้งดุ้น รวม offset +07:00 — ห้ามแปลงเป็น Z เพราะขั้นรายวัน
      // จะข้ามวัน (ดูเหตุผลใน tmdNwp.ts)
      validAt: "2026-08-23T23:00:00+07:00",
      rainMm: 0,
      tempC: 29.2,
      cond: 2,
    });
    for (const step of songkhla.steps) expect(Number.isFinite(Date.parse(step.validAt))).toBe(true);
  });

  it("ชุดรายวันไม่มี tc เดี่ยว → tempC เป็น null ทุกขั้น ตามความจริงของต้นทาง", () => {
    const result = mapRegionDocument(dailyFixture, NO_QUOTA);
    const songkhla = result.byProvince.get("90")!;
    expect(songkhla.steps).toHaveLength(7);
    expect(songkhla.steps.every((s) => s.tempC === null)).toBe(true);
    // แต่ rain/cond ยังมาครบ — null ของ tempC ไม่ใช่ "ต้นทางพัง"
    expect(songkhla.steps.every((s) => s.rainMm !== null && s.cond !== null)).toBe(true);
  });

  it("rain: 0 คือค่าจริง ส่วนคีย์ที่ไม่มีมาเลยจึงจะเป็น null", () => {
    const doc = {
      WeatherForecasts: [
        {
          location: { province: "สงขลา", geocode: "90", lat: 7.2, lon: 100.6 },
          forecasts: [
            { time: "2026-08-23T23:00:00+07:00", data: { rain: 0, tc: 0, cond: 0 } },
            // มีแต่ cond — rain/tc ไม่ได้ส่งมาเลย จึงต้องเป็น null ไม่ใช่ 0
            { time: "2026-08-24T00:00:00+07:00", data: { cond: 3 } },
          ],
        },
      ],
    };
    const [zeros, missing] = mapRegionDocument(doc, NO_QUOTA).byProvince.get("90")!.steps;
    expect(zeros).toMatchObject({ rainMm: 0, tempC: 0, cond: 0 });
    // ถ้าโค้ดเช็คด้วย falsy แทนการเช็คว่า "มีคีย์ไหม" บรรทัดบนจะกลายเป็น null ทั้งแถว
    expect(missing).toMatchObject({ rainMm: null, tempC: null, cond: 3 });
  });

  it("geocode ที่ไม่อยู่ในทะเบียน 77 จังหวัดถูกข้าม แต่ต้องถูกบันทึกไว้ ไม่ใช่หายเงียบ", () => {
    const doc = {
      WeatherForecasts: [
        { location: { geocode: "90", lat: 7.2, lon: 100.6 }, forecasts: [] },
        { location: { geocode: "999", lat: 0, lon: 0 }, forecasts: [] },
      ],
    };
    const result = mapRegionDocument(doc, NO_QUOTA);
    expect([...result.byProvince.keys()]).toEqual(["90"]);
    expect(result.unknownGeocodes).toEqual(["999"]);
  });

  it("อาเรย์ว่าง = รูปร่างเปลี่ยน ไม่ใช่ 'ภาคนี้ไม่มีพยากรณ์'", () => {
    expect(() => mapRegionDocument({ WeatherForecasts: [] }, NO_QUOTA)).toThrow(UpstreamShapeError);
  });

  it("คีย์บนสุดที่สะกดตามเอกสาร (WeatherForcasts) ถือว่าผิดรูป", () => {
    expect(() => mapRegionDocument({ WeatherForcasts: [{ location: {}, forecasts: [] }] }, NO_QUOTA)).toThrow(
      UpstreamShapeError,
    );
  });
});

describe("fetchRegionForecast", () => {
  it("ขอ field และ duration ตามที่คิดโควตาไว้ และอ่าน header โควตากลับมา", async () => {
    respondJson(hourlyFixture, {
      headers: { "x-datapoint-remaining": "87834", "x-ratelimit-remaining": "48" },
    });
    const result = await fetchRegionForecast("hourly", "S", "token-123");
    const url = lastRequestUrl();
    expect(url).toContain("/forecast/location/hourly/region");
    expect(url).toContain("region=S");
    expect(url).toContain("fields=tc,rain,cond");
    expect(url).toContain("duration=48");
    expect(result.quota).toEqual({ datapointRemaining: 87834, rateLimitRemaining: 48 });
  });

  it("ชุดรายวันขอแค่ rain,cond (ต้นทางไม่มี tc เดี่ยว) และ duration 7", async () => {
    respondJson(dailyFixture);
    await fetchRegionForecast("daily", "N", "token-123");
    const url = lastRequestUrl();
    expect(url).toContain("/forecast/location/daily/region");
    expect(url).toContain("fields=rain,cond");
    expect(url).toContain("duration=7");
  });

  it("401 บอกว่า 'กุญแจถูกปฏิเสธ' ไม่ใช่ 'ต้นทางล่ม' — คนละเรื่อง คนละการแก้", async () => {
    respondJson({ message: "Unauthorized" }, { status: 401 });
    await expect(fetchRegionForecast("hourly", "S", "expired-token")).rejects.toThrow(
      "TMD NWP token rejected (401)",
    );
  });
});

describe("fetchDailyAvailability", () => {
  it("อ่านช่วงวันที่ต้นทางประกาศ", async () => {
    respondJson({ daily_data: { min: "2026-08-23", max: "2026-09-02" } });
    await expect(fetchDailyAvailability("token-123")).resolves.toEqual({
      min: "2026-08-23",
      max: "2026-09-02",
    });
  });
});

describe("nwpToken", () => {
  it("ไม่มี secret = null ไม่มี fallback (ห้ามยิงต้นทางในนามคนอื่น)", () => {
    expect(nwpToken({})).toBeNull();
    expect(nwpToken({ TMD_NWP_TOKEN: "   " })).toBeNull();
    expect(nwpToken({ TMD_NWP_TOKEN: " abc " })).toBe("abc");
    // ถ้อยคำต้องอยู่ตระกูลเดียวกับ TMD_UID/TMD_UKEY ของฟีดแผ่นดินไหว
    expect(TMD_NWP_MISSING_TOKEN).toBe("TMD NWP token not configured");
  });
});
