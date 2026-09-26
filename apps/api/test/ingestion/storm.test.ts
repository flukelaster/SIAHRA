import { describe, expect, it } from "vitest";
import { UpstreamShapeError } from "../../src/ingestion/errors";
import { inNio, keyToMs, mapGdacsStorm, selectNioEvents } from "../../src/ingestion/gdacsTc";
import { mapJmaStorm, numOrNull } from "../../src/ingestion/jmaTyphoon";
import gdacsList from "../fixtures/storm/gdacs-eventlist.json";
import gdacsGeometry from "../fixtures/storm/gdacs-geometry-1001326.json";
import jmaForecast from "../fixtures/storm/jma-TC2632-forecast.json";
import jmaSpecs from "../fixtures/storm/jma-TC2632-specifications.json";

/** mapper ของสองต้นทางเส้นทางพายุ กับ fixture จริงของ 2026-09-26 — pure ไม่แตะ DO */

describe("JMA", () => {
  it("ตัวเลขที่เป็นสตริง: '-'/ว่าง/หาย = null ไม่ใช่ 0", () => {
    expect(numOrNull("55")).toBe(55);
    expect(numOrNull("-")).toBeNull();
    expect(numOrNull("")).toBeNull();
    expect(numOrNull(undefined)).toBeNull();
    expect(numOrNull("0")).toBe(0);
  });

  it("TC2632: ตำแหน่งวิเคราะห์เป็นจุดสุดท้ายของเส้นทางเดิม, พยากรณ์ 6 จุดเรียงตามเวลา", () => {
    const s = mapJmaStorm("TC2632", jmaSpecs, jmaForecast);
    expect(s.id).toBe("jma:TC2632");
    // preTyphoon (9) + typhoon (24) มีจุดรอยต่อซ้ำหนึ่งจุด และจุดสุดท้ายคือตำแหน่งวิเคราะห์
    expect(s.past).toHaveLength(32);
    expect(s.past.filter((p) => p.observedAt !== null)).toHaveLength(1);
    expect(s.forecast.map((f) => f.validAt)).toEqual([...s.forecast.map((f) => f.validAt)].sort());
    expect(s.forecast.at(-1)).toMatchObject({ lat: 31.9, lon: 138.5, circleRadiusKm: 460, category: "TY" });
  });

  it("specifications ไม่มีส่วนวิเคราะห์ = UpstreamShapeError (ไม่ใช่พายุเปล่า)", () => {
    const noAnalysis = (jmaSpecs as { advancedHours?: number }[]).filter((p) => p.advancedHours !== 0);
    expect(() => mapJmaStorm("TC2632", noAnalysis, jmaForecast)).toThrow(UpstreamShapeError);
  });
});

describe("GDACS", () => {
  it("เลือกเฉพาะ NIO จากพิกัดในรายการ — ไม่ใช่แค่ lon < 100 (แอตแลนติก/แปซิฟิกตะวันออกต้องหลุด)", () => {
    const picked = selectNioEvents(gdacsList);
    expect(picked.map((e) => e.eventId)).toEqual([1001326]);
    expect(inNio(-43.7, 29.7)).toBe(false);
    expect(inNio(126.8, 22.9)).toBe(false);
    expect(inNio(92, 12)).toBe(true);
  });

  it("เหตุการณ์ที่ iscurrent เป็น 'false' ไม่ถูกเลือก", () => {
    const list = structuredClone(gdacsList) as { features: { properties: { iscurrent: string } }[] };
    for (const f of list.features) f.properties.iscurrent = "false";
    expect(selectNioEvents(list)).toEqual([]);
  });

  it("ONE-26: แยกอดีต/พยากรณ์ที่ polygondate, ไม่มีเวลาออกประกาศ, มีกรวย", () => {
    const [event] = selectNioEvents(gdacsList);
    const s = mapGdacsStorm(event!, gdacsGeometry);
    expect(s.past.map((p) => p.observedAt)).toEqual([
      "2026-09-22T18:00:00.000Z",
      "2026-09-23T00:00:00.000Z",
      "2026-09-23T06:00:00.000Z",
      "2026-09-23T12:00:00.000Z",
      "2026-09-23T18:00:00.000Z",
      "2026-09-24T00:00:00.000Z",
    ]);
    expect(s.past.at(-1)).toMatchObject({ lat: 18.1, lon: 83.7 });
    expect(s.forecast.map((f) => [f.validAt, f.lat, f.lon])).toEqual([
      ["2026-09-24T12:00:00.000Z", 19.1, 83.1],
      ["2026-09-25T00:00:00.000Z", 20.1, 82.7],
    ]);
    expect(s.advisoryIssuedAt).toBeNull();
    expect(s.gdacsCone?.type).toBe("Polygon");
  });

  it("key ไม่มีปี: ข้ามปี ธ.ค. → ม.ค. ถูกต้อง", () => {
    const base = Date.parse("2027-01-01T06:00:00Z");
    expect(new Date(keyToMs("12311800", base)).toISOString()).toBe("2026-12-31T18:00:00.000Z");
    expect(new Date(keyToMs("01020000", Date.parse("2026-12-31T18:00:00Z"))).toISOString()).toBe(
      "2027-01-02T00:00:00.000Z",
    );
  });
});
