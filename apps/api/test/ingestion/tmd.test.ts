import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTmdEvents } from "../../src/ingestion/tmd";
import { TMD_SEISMIC_XML } from "../fixtures/text";
import { lastRequestUrl, respondText } from "./mockFetch";

/**
 * E5.6 — TMD DailySeismicEvent (XML): ฟีดที่ "แปลก" ที่สุดในหกต้นทาง
 *
 *   - เป็น XML แต่ workerd ไม่มี DOM parser → อ่านด้วย regex ที่เราเขียนเอง
 *   - ข้อความไทยมาเป็น numeric character reference (`&#xE1B;`) ต้องถอดเอง
 *   - `<DateTimeUTC>` ไม่มีเครื่องหมายโซนเวลา ("2026-08-19 04:12:33.000")
 *     แต่เอกสารระบุว่าเป็น UTC — **ตรงนี้คือจุดที่พลาดแล้วเวลาคลาด 7 ชั่วโมง**
 *     จึงยึดค่า ISO ที่ออกมาเป๊ะ ๆ ไว้ที่นี่
 *   - ไม่มี id ในฟีด → id ของเราสังเคราะห์จาก (เวลา, lat, lon) และต้องคงที่
 *   - ไม่มีมาตราขนาด ไม่มีสถานะการตรวจสอบ ไม่มี URL → null ทั้งหมด ห้ามเดา
 *
 * ทุกเทสส่ง `nowMs` เข้าไปเอง เพราะ adapter ตัดเหตุการณ์ที่เก่ากว่า 30 วันทิ้ง —
 * ถ้าปล่อยให้อ่านนาฬิกาจริง fixture ที่ตรึงวันที่ไว้จะหมดอายุไปเองในอีกเดือนหนึ่ง
 */
const BBOX = { minLat: -2, maxLat: 29, minLon: 90, maxLon: 120 };
const ENV = { TMD_UID: "test-uid", TMD_UKEY: "test-ukey" };
/** เวลาอ้างอิง = ไม่กี่นาทีหลังเหตุการณ์ใหม่สุดใน fixture */
const NOW_MS = Date.parse("2026-08-19T05:00:00Z");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchTmdEvents", () => {
  it("แปลงทั้งสองระเบียน พร้อมเวลาที่ตีความเป็น UTC ตามเอกสารของต้นทาง", async () => {
    respondText(TMD_SEISMIC_XML);
    const events = await fetchTmdEvents(BBOX, ENV, NOW_MS);

    expect(events).toHaveLength(2);
    // "2026-08-19 04:12:33.000" (ไม่มีโซนเวลา) → 04:12:33Z ไม่ใช่ 21:12:33Z ของวันก่อน
    expect(events[0].time).toBe("2026-08-19T04:12:33.000Z");
    expect(events[1].time).toBe("2026-08-18T21:03:10.000Z");
    // ไม่มีเวลาแก้ไขในฟีด → ใช้เวลาต้นกำเนิดเป็น updated (last-write-wins จึงปลอดภัย)
    expect(events[0].updated).toBe(events[0].time);
  });

  it("ถอดข้อความไทยจาก numeric character reference", async () => {
    respondText(TMD_SEISMIC_XML);
    const events = await fetchTmdEvents(BBOX, ENV, NOW_MS);
    expect(events[0].place).toBe("อ.แม่ลาน้อย จ.เชียงใหม่");
    expect(events[1].place).toBe("ประเทศเมียนมา");
  });

  it("หน่วยและฟิลด์ที่ฟีดนี้ 'ไม่มี' ต้องเป็น null ไม่ใช่ค่าที่เดาเอา", async () => {
    respondText(TMD_SEISMIC_XML);
    const [event] = await fetchTmdEvents(BBOX, ENV, NOW_MS);
    expect(event).toMatchObject({
      sources: ["tmd"],
      mag: 3.1,
      lat: 19.441,
      lon: 98.023,
      // <Depth unit="km."> → ตัวเลขล้วนในหน่วยกิโลเมตร
      depthKm: 5,
      magType: null,
      status: "automatic",
      tsunami: false,
      url: null,
    });
  });

  it("id สังเคราะห์คงที่ระหว่าง poll ซ้ำ — poll สองรอบต้องได้ id เดิม", async () => {
    respondText(TMD_SEISMIC_XML);
    const first = await fetchTmdEvents(BBOX, ENV, NOW_MS);
    const second = await fetchTmdEvents(BBOX, ENV, NOW_MS + 60_000);
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
    expect(first[0].id).toBe(`tmd:${Date.parse("2026-08-19T04:12:33Z")}_19.441_98.023`);
    expect(first[0].clusterId).toBe(first[0].id);
  });

  it("เหตุการณ์ที่เก่ากว่า 30 วันจากเวลาอ้างอิงถูกตัดออก", async () => {
    respondText(TMD_SEISMIC_XML);
    const events = await fetchTmdEvents(BBOX, ENV, NOW_MS + 31 * 24 * 3600_000);
    expect(events).toEqual([]);
  });

  it("เหตุการณ์นอกกรอบพิกัดถูกตัดออก", async () => {
    respondText(TMD_SEISMIC_XML);
    const narrow = { minLat: 19.0, maxLat: 19.9, minLon: 97.5, maxLon: 98.5 };
    const events = await fetchTmdEvents(narrow, ENV, NOW_MS);
    expect(events.map((e) => e.place)).toEqual(["อ.แม่ลาน้อย จ.เชียงใหม่"]);
  });

  it("ไม่มีคีย์ = ไม่ยิงต้นทางเลย และโยนข้อความเดียวกับที่ /health แสดง", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(fetchTmdEvents(BBOX, {}, NOW_MS)).rejects.toThrow("TMD credentials not configured");
    expect(spy).not.toHaveBeenCalled();
  });

  it("คีย์ถูกส่งเป็นพารามิเตอร์ของ URL และไม่มีคีย์จริงอยู่ใน fixture", async () => {
    respondText(TMD_SEISMIC_XML);
    await fetchTmdEvents(BBOX, ENV, NOW_MS);
    const url = new URL(lastRequestUrl());
    expect(url.searchParams.get("uid")).toBe("test-uid");
    expect(url.searchParams.get("ukey")).toBe("test-ukey");
    // fixture ต้องไม่พกคีย์ของจริงติดมาด้วย (E5.6 AC 3)
    expect(TMD_SEISMIC_XML).not.toContain("uid=");
    expect(TMD_SEISMIC_XML).not.toContain("ukey=");
  });
});
