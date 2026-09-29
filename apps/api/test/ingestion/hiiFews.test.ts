import { afterEach, describe, expect, it, vi } from "vitest";
import { UpstreamShapeError } from "../../src/ingestion/errors";
import {
  HII_STATIONS,
  fetchConditional,
  fetchStationFile,
  forecastUrl,
  metadataUrl,
  parseCsvRows,
  parseForecastCsv,
  parseMetadataCsv,
  thaiLocalToMs,
  thresholdNumber,
} from "../../src/ingestion/hiiFews";
import { NORTH_ROUTE_STATIONS } from "../../src/data/northRoute";
import c2 from "../fixtures/hii/forecast-C2.txt?raw";
import c13 from "../fixtures/hii/forecast-C13.txt?raw";
import cpy014 from "../fixtures/hii/forecast-CPY014.txt?raw";
import ridMeta from "../fixtures/hii/rid_discharge.csv?raw";
import wlMeta from "../fixtures/hii/hii_waterlevel.csv?raw";

/**
 * ตัวแปลงไฟล์ FEWS ของ สสน. กับไฟล์จริงของ 2026-09-29 (ดู fixtures/hii/README.md) — pure ไม่แตะ DO
 * สิ่งที่ตรึงไว้: เวลาในไฟล์เป็นเวลาไทย (+07:00), แถวเสียถูกข้ามไม่ใช่ NaN, body ผิดรูป/HTML/ว่าง = error
 * (ไม่ใช่ชุดว่างที่จะไปทับชุดเดิม), เกณฑ์ที่ช่องว่าง/ไม่ใช่ตัวเลข = null
 */

const HEADER = "station,date,time,value \r\n";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("thaiLocalToMs — เวลาในไฟล์คือเวลาไทย +07:00", () => {
  it("05:00 เวลาไทย = 22:00Z ของวันก่อนหน้า", () => {
    expect(thaiLocalToMs("2026-09-29", "05:00:00")).toBe(Date.UTC(2026, 8, 28, 22, 0, 0));
    expect(thaiLocalToMs("2026-09-29", "05:00:00")).toBe(Date.parse("2026-09-29T05:00:00+07:00"));
  });

  it.each([
    ["2026-02-30", "05:00:00"], // Date ปัดเป็น 03-02 — ต้องไม่รับ
    ["2026-13-01", "05:00:00"],
    ["2026-09-29", "24:00:00"],
    ["2026-09-29", "05:60:00"],
    ["2026-9-29", "05:00:00"],
    ["2026-09-29", "5:00"],
    ["", ""],
  ])("ปฏิเสธ %s %s", (d, t) => {
    expect(Number.isNaN(thaiLocalToMs(d, t))).toBe(true);
  });
});

describe("parseForecastCsv (ไฟล์จริง)", () => {
  it("C2: 337 แถว รายชั่วโมงไม่มีช่องว่าง เวลาแรก/สุดท้ายแปลงจากเวลาไทย", () => {
    const { series, skipped } = parseForecastCsv(c2, "C2");
    expect(skipped).toBe(0);
    expect(series).toHaveLength(337);
    expect(series[0]).toEqual([Date.parse("2026-09-22T06:00:00+07:00"), 1684]);
    expect(series[series.length - 1]).toEqual([Date.parse("2026-10-06T06:00:00+07:00"), 2228.17]);
    for (let i = 1; i < series.length; i++) expect(series[i]![0] - series[i - 1]![0]).toBe(3_600_000);
    // ค่าที่นาฬิกาเดียวกับไฟล์ observe (2031 ที่ 05:00) — ไฟล์สองไฟล์ใช้เวลาไทยเหมือนกัน
    const at0500 = series.find(([t]) => t === Date.parse("2026-09-29T05:00:00+07:00"));
    expect(at0500?.[1]).toBe(2030.99);
    expect(series.every(([t, v]) => Number.isFinite(t) && Number.isFinite(v))).toBe(true);
  });

  it("C13 (ท้ายเขื่อนเจ้าพระยา) และ CPY014 (ระดับน้ำ เมตร) อ่านได้ด้วยตัวแปลงเดียวกัน", () => {
    const a = parseForecastCsv(c13, "C13");
    expect(a.series).toHaveLength(337);
    expect(a.skipped).toBe(0);
    const b = parseForecastCsv(cpy014, "CPY014");
    expect(b.series).toHaveLength(337);
    expect(b.series[0]).toEqual([Date.parse("2026-09-22T06:00:00+07:00"), 1.37]);
    expect(b.series[b.series.length - 1]![1]).toBe(2.05);
  });

  it("ไฟล์ของสถานีอื่น (รหัสไม่ตรง) ถูกข้ามทั้งไฟล์ = ไม่มีแถวอ่านได้ → error ไม่ใช่ชุดว่าง", () => {
    expect(() => parseForecastCsv(c2, "C13")).toThrow(UpstreamShapeError);
  });

  it("แถวเสียถูกข้ามและนับ — ไม่มี NaN, ไม่มี 0 แทนค่าที่หาย", () => {
    const text =
      HEADER +
      [
        "C2,2026-09-22,06:00:00,1684",
        "C2,2026-09-22,07:00:00,", // ค่าว่าง
        "C2,2026-09-22,08:00:00,NaN",
        "C2,2026-09-22,09:00:00,abc",
        "C2,2026-02-30,10:00:00,5", // วันที่ไม่มีจริง
        "C13,2026-09-22,11:00:00,7", // รหัสสถานีไม่ตรง
        "C2,2026-09-22,12:00:00", // ช่องไม่ครบ
        "C2,2026-09-22,13:00:00,1590.6",
        "",
      ].join("\r\n");
    const { series, skipped } = parseForecastCsv(text, "C2");
    expect(skipped).toBe(6);
    expect(series).toEqual([
      [Date.parse("2026-09-22T06:00:00+07:00"), 1684],
      [Date.parse("2026-09-22T13:00:00+07:00"), 1590.6],
    ]);
  });

  it("แถวไม่เรียงเวลา: เรียงให้; เวลาซ้ำ: เก็บแถวหลัง และนับเป็นแถวที่ข้าม", () => {
    const text = HEADER + ["C2,2026-09-22,08:00:00,3", "C2,2026-09-22,07:00:00,2", "C2,2026-09-22,07:00:00,9"].join("\n");
    const { series, skipped } = parseForecastCsv(text, "C2");
    expect(series.map(([, v]) => v)).toEqual([9, 3]);
    expect(skipped).toBe(1);
  });

  it("เลขทศนิยมลบ / e-notation ผ่าน แต่ค่าที่ไม่ใช่ตัวเลขล้วนไม่ผ่าน", () => {
    const text = HEADER + ["C2,2026-09-22,06:00:00,-0.82", "C2,2026-09-22,07:00:00,1e3", "C2,2026-09-22,08:00:00,1,5"].join("\n");
    const { series, skipped } = parseForecastCsv(text, "C2");
    expect(series.map(([, v]) => v)).toEqual([-0.82, 1000]);
    expect(skipped).toBe(1);
  });

  it.each([
    ["body ว่าง", ""],
    ["มีแต่ช่องว่าง", "  \r\n \n"],
    ["HTML ของหน้า error", "<html><body>502 Bad Gateway</body></html>"],
    ["หัวคอลัมน์ผิด", "code,when,val\nC2,2026-09-22 06:00,1\n"],
    ["มีแต่หัวคอลัมน์", HEADER],
    ["ทุกแถวเสีย", HEADER + "C2,x,y,z\nC2,a,b,c\n"],
  ])("%s = UpstreamShapeError (ไม่ใช่ชุดว่าง)", (_name, text) => {
    expect(() => parseForecastCsv(text, "C2")).toThrow(UpstreamShapeError);
    try {
      parseForecastCsv(text, "C2");
    } catch (e) {
      expect((e as Error).message).toContain("hii-fews shape: C2.txt");
    }
  });

  it("เกินเพดานแถว = UpstreamShapeError (กัน body ใน DO บวม)", () => {
    const rows = Array.from({ length: 2_020 }, (_, i) => `C2,2026-09-22,06:00:00,${i}`);
    expect(() => parseForecastCsv(HEADER + rows.join("\n"), "C2")).toThrow(/more than/);
  });

  it("BOM หน้าไฟล์ไม่ทำให้หัวคอลัมน์พัง", () => {
    expect(parseForecastCsv("﻿" + c2, "C2").series).toHaveLength(337);
  });
});

describe("เกณฑ์ (metadata CSV)", () => {
  it("rid_discharge: อ่านตามชื่อคอลัมน์ เก็บเฉพาะรหัสที่ขอ (N1 ไม่ติดมา)", () => {
    const wanted = HII_STATIONS.filter((s) => s.kind === "discharge").map((s) => s.hiiCode);
    const m = parseMetadataCsv(ridMeta, wanted, "rid_discharge");
    expect([...m.keys()].sort()).toEqual(["C13", "C2", "C3", "C35", "C7A"]);
    expect(m.get("C2")).toEqual({
      nameTh: "ค่ายจิรประวัติ",
      province: "จ.นครสวรรค์",
      thresholds: { alarm: 2988, warning: 3362, critical: 3735 },
    });
    expect(m.get("C35")!.thresholds).toEqual({ alarm: 927.2, warning: 1043.1, critical: 1159 });
  });

  it("hii_waterlevel CPY014: เกณฑ์ที่เป็นค่าระดับน้ำ (ติดลบได้) เก็บตรงตามที่เผยแพร่", () => {
    const m = parseMetadataCsv(wlMeta, ["CPY014"], "hii_waterlevel");
    expect([...m.keys()]).toEqual(["CPY014"]);
    expect(m.get("CPY014")).toEqual({
      nameTh: "สะพานนวลฉวี",
      province: "จ.นนทบุรี",
      thresholds: { alarm: -0.82, warning: 0.74, critical: 2.3 },
    });
  });

  it("ช่องว่าง / '-' / ข้อความ = null (ไม่ใช่ 0) และเครื่องหมายคำพูดห่อจุลภาคได้", () => {
    const csv = [
      "code,station.name.TH,province,alarm,warning,critical",
      'X1,"สถานี, ทดสอบ",จ.เชียงใหม่,,-,abc',
      "X2,ชื่อ,,10,20,30",
      "X3,ช่องไม่ครบ,จ.ก,1,2", // จำนวนช่องไม่เท่าหัว — ข้าม
    ].join("\r\n");
    const m = parseMetadataCsv(csv, ["X1", "X2", "X3"], "rid_discharge");
    expect(m.get("X1")).toEqual({
      nameTh: "สถานี, ทดสอบ",
      province: "จ.เชียงใหม่",
      thresholds: { alarm: null, warning: null, critical: null },
    });
    expect(m.get("X2")!.province).toBeNull();
    expect(m.get("X2")!.thresholds).toEqual({ alarm: 10, warning: 20, critical: 30 });
    expect(m.has("X3")).toBe(false);
  });

  it("ค่าเกณฑ์ที่ไม่สอดคล้องกันเอง (warning > critical ของ N1) ส่งต่อตามที่เผยแพร่ ไม่ถูกแก้", () => {
    const m = parseMetadataCsv(ridMeta, ["N1"], "rid_discharge");
    expect(m.get("N1")!.thresholds).toEqual({ alarm: 973.6, warning: 1095.3, critical: 1066 });
  });

  it("คอลัมน์ที่ต้องมีหาย / HTML / ว่าง = UpstreamShapeError", () => {
    expect(() => parseMetadataCsv("code,alarm\nC2,1\n", ["C2"], "rid_discharge")).toThrow(/missing column/);
    expect(() => parseMetadataCsv("<html></html>", ["C2"], "rid_discharge")).toThrow(UpstreamShapeError);
    expect(() => parseMetadataCsv("", ["C2"], "rid_discharge")).toThrow(UpstreamShapeError);
  });

  it("thresholdNumber / parseCsvRows", () => {
    expect(thresholdNumber("2.3")).toBe(2.3);
    expect(thresholdNumber(" -0.82 ")).toBe(-0.82);
    expect(thresholdNumber("")).toBeNull();
    expect(thresholdNumber(undefined)).toBeNull();
    expect(thresholdNumber("NaN")).toBeNull();
    expect(parseCsvRows('a,"b ""q"" c",d\n\n1,2,3')).toEqual([["a", 'b "q" c', "d"], ["1", "2", "3"]]);
  });
});

describe("ตารางผูกรหัส", () => {
  it("รหัสเส้นทาง (มีจุด) ทุกตัวมีอยู่ใน northRouteStations และรหัส HII = รหัสเส้นทางไม่มีจุด", () => {
    const route = new Set(NORTH_ROUTE_STATIONS.map((s) => s.ridCode));
    for (const s of HII_STATIONS.filter((x) => x.kind === "discharge")) {
      expect(route.has(s.code), `${s.code} ไม่อยู่ในเส้นทางน้ำเหนือ`).toBe(true);
      expect(s.hiiCode).toBe(s.code.replace(".", ""));
    }
    const water = HII_STATIONS.filter((x) => x.kind === "waterlevel");
    expect(water.map((s) => s.code)).toEqual(["CPY014"]);
    expect(route.has("CPY014")).toBe(false);
    expect(HII_STATIONS.map((s) => s.hiiCode)).toEqual(["C2", "C13", "C3", "C7A", "C35", "CPY014"]);
  });

  it("URL ของไฟล์: discharge ใต้ rid_discharge, ระดับน้ำใต้ hii_waterlevel, metadata ใต้ /metadata/", () => {
    const [c2Def, , , , , cpy] = HII_STATIONS;
    expect(forecastUrl(c2Def!)).toBe("https://fews2.hii.or.th/model-output/data_portal/rid_discharge/forecast/C2.txt");
    expect(forecastUrl(cpy!)).toBe("https://fews2.hii.or.th/model-output/data_portal/hii_waterlevel/forecast/CPY014.txt");
    expect(metadataUrl("hii_waterlevel")).toBe("https://fews2.hii.or.th/model-output/data_portal/metadata/hii_waterlevel.csv");
  });
});

describe("fetchConditional", () => {
  const url = "https://fews2.hii.or.th/model-output/data_portal/rid_discharge/forecast/C2.txt";
  const spy = (res: Response) => vi.spyOn(globalThis, "fetch").mockImplementation(async () => res);
  const sentHeaders = () => new Headers((vi.mocked(globalThis.fetch).mock.calls[0]![1] as RequestInit).headers);

  it("แนบ validator ที่เก็บไว้ และไม่แนบเมื่อไม่มี", async () => {
    spy(new Response("x", { status: 200, headers: { "content-type": "text/plain" } }));
    await fetchConditional(url, { etag: '"abc"', lastModified: "Tue, 29 Sep 2026 03:05:01 GMT" });
    expect(sentHeaders().get("if-none-match")).toBe('"abc"');
    expect(sentHeaders().get("if-modified-since")).toBe("Tue, 29 Sep 2026 03:05:01 GMT");
    expect(sentHeaders().get("user-agent")).toContain("siahra-api");
    vi.restoreAllMocks();
    spy(new Response("x", { status: 200 }));
    await fetchConditional(url, null);
    expect(sentHeaders().has("if-none-match")).toBe(false);
    expect(sentHeaders().has("if-modified-since")).toBe(false);
  });

  it("200: publishedAt = Last-Modified เป็น ISO; ไม่มี Last-Modified = null (ไม่ใช่เวลาที่ดึง)", async () => {
    spy(new Response("body", { status: 200, headers: { "last-modified": "Tue, 29 Sep 2026 03:05:01 GMT", etag: '"e"' } }));
    const r = await fetchConditional(url, null);
    expect(r).toMatchObject({
      status: "ok",
      text: "body",
      publishedAt: "2026-09-29T03:05:01.000Z",
      validators: { etag: '"e"', lastModified: "Tue, 29 Sep 2026 03:05:01 GMT" },
    });
    vi.restoreAllMocks();
    spy(new Response("body", { status: 200 }));
    const bare = await fetchConditional(url, null);
    expect(bare).toMatchObject({ status: "ok", publishedAt: null, validators: { etag: null, lastModified: null } });
  });

  it("Last-Modified ที่อ่านไม่ออก = null และไม่ถูกส่งกลับเป็น validator", async () => {
    spy(new Response("body", { status: 200, headers: { "last-modified": "yesterday-ish" } }));
    const r = await fetchConditional(url, null);
    expect(r).toMatchObject({ publishedAt: null, validators: { lastModified: null } });
  });

  it("304 ที่ตอบคำขอมี validator = not-modified; 304 ที่ไม่ได้ขอแบบมีเงื่อนไข = error", async () => {
    spy(new Response(null, { status: 304 }));
    expect(await fetchConditional(url, { etag: '"e"', lastModified: null })).toEqual({ status: "not-modified" });
    vi.restoreAllMocks();
    spy(new Response(null, { status: 304 }));
    await expect(fetchConditional(url, null)).rejects.toThrow(UpstreamShapeError);
  });

  it("5xx ไม่ถึงตัวแปลง: error บอก HTTP status และ path; content-type HTML = UpstreamShapeError", async () => {
    spy(new Response("<html>boom</html>", { status: 503 }));
    await expect(fetchConditional(url, null)).rejects.toThrow("hii-fews HTTP 503 for /rid_discharge/forecast/C2.txt");
    vi.restoreAllMocks();
    spy(new Response("<html>ok?</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
    await expect(fetchConditional(url, null)).rejects.toThrow(UpstreamShapeError);
  });

  it("fetchStationFile: 200 ที่แปลงไม่ได้ = โยน (ผู้เรียกเก็บชุดเดิม); 304 = verified", async () => {
    spy(new Response("<html>no</html>", { status: 200, headers: { "content-type": "text/plain" } }));
    await expect(fetchStationFile(HII_STATIONS[0]!, null)).rejects.toThrow(UpstreamShapeError);
    vi.restoreAllMocks();
    spy(new Response(null, { status: 304 }));
    expect(await fetchStationFile(HII_STATIONS[0]!, { etag: '"e"', lastModified: null })).toEqual({ kind: "verified" });
  });
});
