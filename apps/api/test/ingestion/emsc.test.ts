import { afterEach, describe, expect, it, vi } from "vitest";
import type { EarthquakeEvent } from "@siahra/shared-types";
import { fetchEmscEvents } from "../../src/ingestion/emsc";
import emscFixture from "../fixtures/emsc-query.json";
import { lastRequestUrl, respondJson, respondText } from "./mockFetch";

/**
 * E5.6 — EMSC (seismicportal.eu FDSN): การแปลงและกับดักของฟีดนี้โดยเฉพาะ
 *
 *   - พิกัดอยู่ใน `properties.lat/lon` **ไม่ใช่** `geometry.coordinates`
 *     (มี geometry มาด้วย แต่เราไม่ได้ใช้ — ถ้าไปหยิบผิดที่ค่าจะสลับ lat/lon)
 *   - `time`/`lastupdate` เป็น ISO ที่มีทศนิยมหนึ่งตำแหน่ง ("…04:12:33.0Z")
 *   - ไม่มีสถานะ reviewed/automatic ในฟีดนี้เลย → ต้องเป็น "automatic" เสมอ
 *     ห้ามเดาว่ามีคนตรวจแล้ว
 *   - id ของเราอิงจาก `unid` ไม่ใช่ `id` ของ feature
 */
const BBOX = { minLat: -2, maxLat: 29, minLon: 90, maxLon: 120 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchEmscEvents", () => {
  it("แปลง feature ออกมาครบทุกฟิลด์ตามที่ฟีดนี้ให้ได้จริง", async () => {
    respondJson(emscFixture);
    const events = await fetchEmscEvents(BBOX, Date.parse("2026-08-19T00:00:00Z"));

    const expected: EarthquakeEvent = {
      id: "emsc:20260819_0000042",
      clusterId: "emsc:20260819_0000042",
      sources: ["emsc"],
      mag: 4.1,
      magType: "mb",
      place: "MYANMAR",
      lat: 20.11,
      lon: 96.28,
      depthKm: 33,
      // ".0Z" ถูกทำให้เป็นรูปแบบเดียวกับทุกแหล่ง (".000Z")
      time: "2026-08-19T04:12:33.000Z",
      updated: "2026-08-19T04:31:02.000Z",
      // ฟีดนี้ไม่ประกาศสถานะการตรวจสอบ — ค่าอนุรักษ์นิยมเสมอ
      status: "automatic",
      tsunami: false,
      url: "https://www.seismicportal.eu/eventdetails.html?unid=20260819_0000042",
    };
    expect(events).toEqual([expected]);
  });

  it("`start` ที่ยิงไปต้องเป็นเวลาที่ผู้เรียกสั่ง และไม่มีเศษมิลลิวินาที", async () => {
    respondJson({ type: "FeatureCollection", features: [] });
    const since = Date.parse("2026-08-19T03:00:00.123Z");
    await fetchEmscEvents(BBOX, since);

    const url = new URL(lastRequestUrl());
    expect(url.searchParams.get("start")).toBe("2026-08-19T03:00:00");
    expect(url.searchParams.get("minlat")).toBe("-2");
    expect(url.searchParams.get("maxlon")).toBe("120");
  });

  it("204 (ไม่มี body) คือ 'ไม่มีเหตุการณ์' ไม่ใช่ความผิดพลาด", async () => {
    respondText(null as unknown as string, { status: 204 });
    await expect(fetchEmscEvents(BBOX, 0)).resolves.toEqual([]);
  });

  it("magnitude/magtype ที่เป็น null ยังเป็น null ไม่ถูกแทนด้วย 0", async () => {
    respondJson({
      ...emscFixture,
      features: [
        {
          ...emscFixture.features[0],
          properties: { ...emscFixture.features[0].properties, mag: null, magtype: null, flynn_region: null },
        },
      ],
    });
    const [event] = await fetchEmscEvents(BBOX, 0);
    expect(event.mag).toBeNull();
    expect(event.magType).toBeNull();
    expect(event.place).toBeNull();
  });
});
