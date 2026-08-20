import { afterEach, describe, expect, it, vi } from "vitest";
import type { EarthquakeEvent } from "@siahra/shared-types";
import { backfillUsgsEvents, fetchUsgsEvents } from "../../src/ingestion/usgs";
import usgsFixture from "../fixtures/usgs-all-hour.json";
import { lastRequestUrl, respondJson } from "./mockFetch";

/**
 * E5.6 — USGS: การแปลงจาก payload ดิบเป็นชนิดข้อมูลของเรา
 *
 * แบ่งงานกับ upstreamShape.test.ts อย่างชัดเจน: ไฟล์นั้นพิสูจน์ว่า payload
 * ผิดรูป (`{}`, `[]`, JSON ที่ถูกตัดกลาง) ถูกปฏิเสธ — ไฟล์นี้พิสูจน์ว่า payload
 * ที่ *ถูกรูป* ถูกแปลงออกมาถูกทุกฟิลด์ ทุกหน่วย และทุกเวลา
 *
 * เคสที่ USGS ปล่อยออกมาจริงและเคยทำให้เพี้ยน:
 *   - `time`/`updated` เป็น epoch **มิลลิวินาที** ไม่ใช่วินาที — พลาดคือคลาดไป 55 ปี
 *   - coordinates เรียง [lon, lat, depth] ไม่ใช่ [lat, lon]
 *   - `type` มีทั้ง "quarry blast" และ "explosion" ปนมา — ไม่ใช่แผ่นดินไหวทั้งหมด
 *   - `mag`, `magType`, `place`, `url` เป็น null ได้ทั้งหมด
 */
const BBOX = { minLat: -2, maxLat: 29, minLon: 90, maxLon: 120 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchUsgsEvents", () => {
  it("แปลง feature ที่เป็นแผ่นดินไหวออกมาครบทุกฟิลด์", async () => {
    respondJson(usgsFixture);
    const events = await fetchUsgsEvents(BBOX);

    const expected: EarthquakeEvent = {
      id: "usgs:us7000abcd",
      clusterId: "usgs:us7000abcd",
      sources: ["usgs"],
      mag: 4.6,
      magType: "mb",
      place: "22 km NNW of Mae Hong Son, Thailand",
      // [lon, lat, depthKm] → lat/lon แยกกันคนละฟิลด์ ห้ามสลับ
      lat: 19.44,
      lon: 98.02,
      depthKm: 10,
      // epoch ms → ISO UTC (1755599400000 = 2025-08-19T10:30:00Z)
      time: "2025-08-19T10:30:00.000Z",
      updated: "2025-08-19T10:38:20.000Z",
      status: "reviewed",
      tsunami: false,
      url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
    };
    expect(events).toEqual([expected]);
  });

  it("คัดสิ่งที่ไม่ใช่แผ่นดินไหวทิ้ง (quarry blast)", async () => {
    respondJson(usgsFixture);
    const events = await fetchUsgsEvents(BBOX);
    expect(events.map((e) => e.id)).not.toContain("usgs:us7000abce");
  });

  it("`status` ที่ไม่ใช่ reviewed ถูกลดเป็น automatic ไม่ใช่ส่งผ่านดิบ ๆ", async () => {
    respondJson({
      ...usgsFixture,
      features: [
        {
          ...usgsFixture.features[0],
          properties: { ...usgsFixture.features[0].properties, status: "in-review" },
        },
      ],
    });
    const [event] = await fetchUsgsEvents(BBOX);
    expect(event.status).toBe("automatic");
  });

  it("ค่าที่ต้นทางไม่ระบุยังเป็น null ไม่ถูกแทนด้วย 0 หรือสตริงว่าง", async () => {
    respondJson({
      ...usgsFixture,
      features: [
        {
          ...usgsFixture.features[0],
          properties: {
            ...usgsFixture.features[0].properties,
            mag: null,
            magType: null,
            place: null,
            url: null,
          },
        },
      ],
    });
    const [event] = await fetchUsgsEvents(BBOX);
    expect(event.mag).toBeNull();
    expect(event.magType).toBeNull();
    expect(event.place).toBeNull();
    expect(event.url).toBeNull();
    // ...แต่พิกัดและเวลาต้องยังอยู่ครบ ไม่งั้นเหตุการณ์นี้ไม่ควรถูกเก็บตั้งแต่แรก
    expect(event.lat).toBe(19.44);
    expect(event.time).toBe("2025-08-19T10:30:00.000Z");
  });

  it("`tsunami: 1` เป็น true, `0` เป็น false (เลขไม่ใช่ boolean มาแต่ต้นทาง)", async () => {
    respondJson({
      ...usgsFixture,
      features: [
        {
          ...usgsFixture.features[0],
          properties: { ...usgsFixture.features[0].properties, tsunami: 1 },
        },
      ],
    });
    const [event] = await fetchUsgsEvents(BBOX);
    expect(event.tsunami).toBe(true);
  });

  it("เหตุการณ์นอกกรอบพิกัดถูกตัดออก", async () => {
    respondJson({
      ...usgsFixture,
      features: [
        {
          ...usgsFixture.features[0],
          // อลาสก้า: อยู่นอกกรอบเอเชียตะวันออกเฉียงใต้ทั้ง lat และ lon
          geometry: { type: "Point", coordinates: [-150.0, 61.2, 40.0] },
        },
      ],
    });
    await expect(fetchUsgsEvents(BBOX)).resolves.toEqual([]);
  });

  it("feature ที่ไม่มี geometry ถูกข้าม ไม่ใช่โผล่ที่ (0,0)", async () => {
    respondJson({
      ...usgsFixture,
      features: [{ ...usgsFixture.features[0], geometry: null }],
    });
    await expect(fetchUsgsEvents(BBOX)).resolves.toEqual([]);
  });
});

describe("backfillUsgsEvents", () => {
  it("ประกอบ query ของ FDSN ครบทั้งกรอบพิกัด ขนาดขั้นต่ำ และช่วงเวลา", async () => {
    respondJson({ type: "FeatureCollection", features: [] });
    await backfillUsgsEvents(BBOX, 7, 3.5);

    const url = new URL(lastRequestUrl());
    expect(url.pathname).toContain("/fdsnws/event/1/query");
    expect(url.searchParams.get("format")).toBe("geojson");
    expect(url.searchParams.get("minlatitude")).toBe("-2");
    expect(url.searchParams.get("maxlatitude")).toBe("29");
    expect(url.searchParams.get("minlongitude")).toBe("90");
    expect(url.searchParams.get("maxlongitude")).toBe("120");
    expect(url.searchParams.get("minmagnitude")).toBe("3.5");
    const start = Date.parse(url.searchParams.get("starttime")!);
    expect(Date.now() - start).toBeGreaterThanOrEqual(7 * 86400_000 - 5_000);
    expect(Date.now() - start).toBeLessThanOrEqual(7 * 86400_000 + 5_000);
  });

  it("แปลงผลลัพธ์ด้วยกฎเดียวกับฟีดรายชั่วโมง (id เดิม ไม่มีคำนำหน้าอื่น)", async () => {
    respondJson(usgsFixture);
    const events = await backfillUsgsEvents(BBOX, 7, 0);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("usgs:us7000abcd");
    expect(events[0].sources).toEqual(["usgs"]);
  });
});
