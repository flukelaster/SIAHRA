import { afterEach, describe, expect, it, vi } from "vitest";
import { UpstreamShapeError } from "../src/ingestion/errors";
import { fetchEmscEvents } from "../src/ingestion/emsc";
import { fetchGistdaFloodExtent } from "../src/ingestion/gistda";
import { fetchDams, fetchRainfall, fetchWaterLevel, fetchWaterLevelHistory } from "../src/ingestion/thaiwater";
import { fetchTmdEvents } from "../src/ingestion/tmd";
import { fetchRadarFrame, fetchRadarIndex } from "../src/ingestion/tmdRadar";
import { fetchUsgsEvents } from "../src/ingestion/usgs";
import emscFixture from "./fixtures/emsc-query.json";
import gistdaFixture from "./fixtures/gistda-wfs.json";
import damFixture from "./fixtures/thaiwater-analyst-dam.json";
import rainFixture from "./fixtures/thaiwater-rain24h.json";
import graphFixture from "./fixtures/thaiwater-waterlevel-graph.json";
import waterFixture from "./fixtures/thaiwater-waterlevel-load.json";
import usgsFixture from "./fixtures/usgs-all-hour.json";
import { RADAR_LIST_TEXT, TMD_SEISMIC_XML, truncatedPngFrame, validPngFrame } from "./fixtures/text";

/**
 * E4.3/E4.4 — ทุก adapter ต้องตรวจรูปร่างของ payload ก่อนแปลง
 *
 * ประเด็นของงานนี้ไม่ใช่ "ปฏิเสธข้อมูลเสีย" แต่คือ **ต้นทางที่ส่งของผิดรูปต้องทำให้
 * ระบบเสื่อมแบบมองเห็นได้ ไม่ใช่ไปทับของที่ถืออยู่** — เคสที่อันตรายที่สุดคือ `{}`
 * เพราะโค้ดเดิมแปลงมันเป็น "ศูนย์ระเบียน ดึงสำเร็จ" แล้วประทับ fetchedAt ใหม่ทับ
 * ข้อมูลเก่า ทำให้ /health ขึ้น `ok` ทั้งที่ไม่ได้อะไรมาเลย
 */

const BBOX = { minLat: -2, maxLat: 29, minLon: 90, maxLon: 120 };

afterEach(() => {
  vi.restoreAllMocks();
});

function respondJson(body: unknown, init?: ResponseInit): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, ...init }),
  );
}

function respondText(text: string): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(text));
}

/** ตัดครึ่งของ payload จริง = JSON ที่พังกลางคัน (ต้นทางตัดสาย/proxy ตัดท้าย) */
function truncatedJson(fixture: unknown): string {
  const full = JSON.stringify(fixture);
  return full.slice(0, Math.floor(full.length / 2));
}

const TMD_ENV = { TMD_UID: "test-uid", TMD_UKEY: "test-ukey" };

describe("fixture ของทั้งหกต้นทางผ่านการตรวจ", () => {
  it("USGS: แปลง fixture ได้ และคัดเฉพาะ type=earthquake", async () => {
    respondJson(usgsFixture);
    const events = await fetchUsgsEvents(BBOX);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: "usgs:us7000abcd", lat: 19.44, lon: 98.02, depthKm: 10 });
  });

  it("EMSC: แปลง fixture ได้", async () => {
    respondJson(emscFixture);
    const events = await fetchEmscEvents(BBOX, Date.parse("2026-08-19T00:00:00Z"));
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("emsc:20260819_0000042");
  });

  it("TMD (XML): แปลง fixture ได้ และถอดข้อความไทยออกมาถูก", async () => {
    respondText(TMD_SEISMIC_XML);
    const events = await fetchTmdEvents(BBOX, TMD_ENV, Date.parse("2026-08-19T06:00:00Z"));
    expect(events).toHaveLength(2);
    expect(events[0].place).toContain("เชียงใหม่");
  });

  it("ThaiWater rain_24h / waterlevel_load / waterlevel_graph / analyst-dam: แปลง fixture ได้", async () => {
    respondJson(rainFixture);
    const rain = await fetchRainfall();
    // สถานีที่ไม่มีพิกัดถูกตัดทิ้งเหมือนเดิม (ไม่ใช่ความผิดรูป — เป็นข้อมูลไม่ครบ)
    expect(rain).toHaveLength(1);
    expect(rain[0].rain24h).toBe(12.5);

    respondJson(waterFixture);
    const water = await fetchWaterLevel();
    expect(water).toHaveLength(2);
    expect(water[0].freeboardM).toBeCloseTo(1.46, 3);

    respondJson(graphFixture);
    const points = await fetchWaterLevelHistory(201, 24, Date.parse("2026-08-19T09:30:00Z"));
    expect(points).toHaveLength(2);

    respondJson(damFixture);
    const dams = await fetchDams(Date.parse("2026-08-19T09:30:00Z"));
    expect(dams.map((d) => d.id).sort()).toEqual([3, 91]);
  });

  it("GISTDA: แปลง fixture ได้ และคืนภาษาไทยที่แก้ mojibake แล้ว", async () => {
    respondJson(gistdaFixture);
    const scene = await fetchGistdaFloodExtent({ attempts: 1 });
    expect(scene.features).toHaveLength(2);
    expect(scene.features[0].props.provinceTh).toBe("ลพบุรี");
    expect(scene.publishedAt).toBeNull();
  });

  it("เรดาร์ TMD: ดัชนีและเฟรม PNG ที่สมบูรณ์ผ่านการตรวจ", async () => {
    respondText(RADAR_LIST_TEXT);
    const index = await fetchRadarIndex();
    expect(index.slots.map((s) => s.file)).toEqual(["zr0022.png", "zr0023.png"]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(validPngFrame()));
    await expect(fetchRadarFrame("zr0023.png")).resolves.toBeInstanceOf(ArrayBuffer);
  });
});

describe("payload ที่ผิดรูปโยน UpstreamShapeError พร้อม path", () => {
  /** ทุกข้อความต้องบอก "ต้นทางไหน · path ไหน" และยาวไม่เกิน 200 ตัวอักษร */
  async function expectShapeError(run: () => Promise<unknown>, pathFragment: string): Promise<UpstreamShapeError> {
    const err = await run().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UpstreamShapeError);
    const shapeError = err as UpstreamShapeError;
    expect(shapeError.message.length).toBeLessThanOrEqual(200);
    expect(shapeError.path).toContain(pathFragment);
    expect(shapeError.message).toContain(shapeError.path);
    return shapeError;
  }

  it("USGS: {} และ payload ที่ถูกตัดกลาง", async () => {
    respondJson({});
    await expectShapeError(() => fetchUsgsEvents(BBOX), "features");
    respondText(truncatedJson(usgsFixture));
    await expectShapeError(() => fetchUsgsEvents(BBOX), "<body>");
  });

  it("EMSC: {} และ feature ที่ขาดพิกัด", async () => {
    respondJson({});
    await expectShapeError(() => fetchEmscEvents(BBOX, 0), "features");
    respondJson({ features: [{ properties: { unid: "x", time: "2026-08-19T00:00:00Z", lastupdate: "2026-08-19T00:00:00Z" } }] });
    await expectShapeError(() => fetchEmscEvents(BBOX, 0), "features.0.properties.lat");
  });

  it("TMD: เอกสารว่าง เอกสารที่ไม่มีบล็อกเลย และค่าที่หลุดพิสัย", async () => {
    respondText("");
    await expectShapeError(() => fetchTmdEvents(BBOX, TMD_ENV), "<document>");
    respondText("<html><body>Service Unavailable</body></html>");
    await expectShapeError(() => fetchTmdEvents(BBOX, TMD_ENV), "DailyEarthquakes");
    respondText(TMD_SEISMIC_XML.replace("<Latitude>19.4410</Latitude>", "<Latitude>999</Latitude>"));
    await expectShapeError(() => fetchTmdEvents(BBOX, TMD_ENV), "DailyEarthquakes.0.lat");
  });

  it("ThaiWater: {} ต้องไม่ถูกอ่านเป็น 'ศูนย์สถานีทั่วประเทศ'", async () => {
    respondJson({});
    await expectShapeError(() => fetchRainfall(), "data");
    respondJson({ data: [] });
    await expectShapeError(() => fetchRainfall(), "data");
    respondJson({});
    await expectShapeError(() => fetchWaterLevel(), "waterlevel_data");
    respondJson({});
    await expectShapeError(() => fetchDams(), "data");
    respondJson({ data: { dam_hourly: [], dam_daily: [], dam_medium: [] } });
    await expectShapeError(() => fetchDams(), "data");
    respondText(truncatedJson(rainFixture));
    await expectShapeError(() => fetchRainfall(), "<body>");
  });

  it("ThaiWater waterlevel_graph: คำตอบที่ไม่ใช่ JSON (Go panic ของต้นทาง)", async () => {
    respondText("panic: runtime error: invalid memory address\n\ngoroutine 1 [running]:");
    await expectShapeError(() => fetchWaterLevelHistory(201, 24), "<body>");
  });

  it("ThaiWater: ระเบียนที่ชนิดผิด ชี้ path ถึงดัชนีของแถว", async () => {
    respondJson({ data: [{ station: "not-an-object" }] });
    await expectShapeError(() => fetchRainfall(), "data.0.station");
  });

  it("GISTDA: {} ต้องไม่กลายเป็นฉากว่าง", async () => {
    respondJson({});
    await expectShapeError(() => fetchGistdaFloodExtent({ attempts: 1 }), "features");
    respondText(truncatedJson(gistdaFixture));
    await expectShapeError(() => fetchGistdaFloodExtent({ attempts: 1 }), "<body>");
  });

  it("GISTDA: payload ผิดรูปต้องไม่ถูกยิงซ้ำ (ลองใหม่กี่ครั้งก็ได้รูปเดิม)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
    );
    await expect(fetchGistdaFloodExtent({ attempts: 3 })).rejects.toBeInstanceOf(UpstreamShapeError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("เรดาร์: ดัชนีที่ parse ไม่ได้ และเฟรมที่ถูกตัดกลาง (ลายเซ็นครบแต่ไม่มี IEND)", async () => {
    respondText("nothing here that matches the composite list format\n");
    await expectShapeError(() => fetchRadarIndex(), "slots");

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(truncatedPngFrame()));
    const err = await expectShapeError(() => fetchRadarFrame("zr0023.png"), "frame.zr0023.png");
    expect(err.message).toContain("zr0023.png");

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(200)));
    await expectShapeError(() => fetchRadarFrame("zr0007.png"), "frame.zr0007.png");
  });
});

describe("ต้นทางที่ 'ว่างอย่างถูกต้อง' ต้องไม่ถูกตีว่าผิดรูป", () => {
  it("USGS/EMSC: features: [] คือสภาพปกติของกรอบประเทศไทยในหนึ่งชั่วโมง", async () => {
    respondJson({ type: "FeatureCollection", features: [] });
    await expect(fetchUsgsEvents(BBOX)).resolves.toEqual([]);
    respondJson({ type: "FeatureCollection", features: [] });
    await expect(fetchEmscEvents(BBOX, 0)).resolves.toEqual([]);
  });

  it("EMSC: 204 (ไม่มี body) ต้องลัดออกก่อนถึงจุดตรวจ", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
    await expect(fetchEmscEvents(BBOX, 0)).resolves.toEqual([]);
  });

  it("GISTDA: หน้าแล้งที่ไม่มีพื้นที่น้ำท่วมเลยยังถูกต้อง", async () => {
    respondJson({ type: "FeatureCollection", features: [] });
    const scene = await fetchGistdaFloodExtent({ attempts: 1 });
    expect(scene.features).toEqual([]);
  });

  it("ThaiWater waterlevel_graph: สถานีที่ยังไม่มีอนุกรมเวลาคืนอาเรย์ว่างได้", async () => {
    respondJson({ data: { graph_data: [] } });
    await expect(fetchWaterLevelHistory(201, 24)).resolves.toEqual([]);
  });
});

describe("ค่าใช้จ่ายของการตรวจกับ payload ขนาดจริง", () => {
  /**
   * ThaiWater ส่ง ~5,900 สถานีต่อรอบ (2–4 MB) — เลือกตรวจ **ทีละระเบียนแบบ lazy**
   * ในลูปที่ mapper เดินอยู่แล้ว แทนที่จะ validate ทั้งเอกสารทีเดียว เพราะแบบหลัง
   * ต้อง walk โครงสร้างซ้ำอีกหนึ่งรอบและสร้าง object ผลลัพธ์ทิ้งอีกชุด
   * เทสนี้ยืนยันว่ายังอยู่ในงบ 300 ms ของ roadmap ด้วย (วัดที่ ~6,000 ระเบียน)
   */
  it("6,000 ระเบียนใช้เวลาไม่เกิน 300 ms", async () => {
    const template = rainFixture.data[0];
    const data = Array.from({ length: 6000 }, (_, i) => ({
      ...template,
      id: 1000 + i,
      station: { ...template.station, id: 1000 + i },
    }));
    // ทำ JSON ให้เสร็จนอกช่วงที่จับเวลา — เราวัดต้นทุนของ "การตรวจ + แปลง"
    // ไม่ใช่ต้นทุนของการ serialize fixture ในเทสเอง
    const body = JSON.stringify({ data });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(body, { headers: { "Content-Type": "application/json" } }),
    );
    const startedAt = Date.now();
    const rows = await fetchRainfall();
    const elapsedMs = Date.now() - startedAt;
    expect(rows).toHaveLength(6000);
    expect(elapsedMs).toBeLessThan(300);
  });
});
