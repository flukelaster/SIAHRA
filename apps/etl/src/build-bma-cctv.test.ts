import { describe, expect, it } from "vitest";
import {
  BMA_TRAFFIC_URL,
  buildCameras,
  csvRecords,
  parseCoord,
  parseCsv,
  pickCsvResource,
  placeFromDistrict,
  SOURCE_ID,
} from "./build-bma-cctv.js";
import { assembleCatalogue, serializeCatalogue } from "./cameraCatalogue.js";
import { PROVINCES } from "./cameraCatalogue.testUtils.js";
import { CREDENTIAL_PATTERN } from "./provincePolygons.js";

/**
 * fixture แต่งขึ้นทั้งหมด — รูปเดียวกับ CSV จริงของชุดข้อมูล `bma-cctv` (ตรวจ 2026-09-27): UTF-8 มี BOM,
 * หัวคอลัมน์ ` ID Camera` มีช่องว่างนำ; รหัส DVR/ชื่อโครงการในนี้ไม่ใช่ค่าจริง
 */
const DVR = "TF-ZZ-99-01-01";
const PROJECT = "งานโครงการทดสอบ, สัญญาเลขที่ 1/2566";
const HEADER = "ID,District,location,Code DVR, ID Camera,project,lat,long";
const CSV =
  "﻿" +
  [
    HEADER,
    `1,บางพลัด,"ทางด่วนยกระดับ, ขาเข้า",${DVR},TF-ZZ-99-02-01,"${PROJECT}",13.5,100.5`,
    // รหัสกล้องซ้ำกับแถว 1 ที่ตำแหน่งอื่น — ทั้งสองแถวต้องอยู่ (id = คอลัมน์ ID)
    `2, เขตสาธร ,แยกทดสอบ,${DVR},TF-ZZ-99-02-01,${PROJECT.replace(",", "")},13.6,100.6`,
    // longitude สองจุดทศนิยม — ตัดทิ้ง ไม่ซ่อม
    `3,จตจักร,แยกพิกัดผิด,${DVR},TF-ZZ-99-02-03,x, 13.7, 100.468.312`,
    `4,ดุสิต,นอกจังหวัด,${DVR},TF-ZZ-99-02-04,x,15.5,102.5`,
  ].join("\r\n") +
  "\r\n";

describe("parseCsv / csvRecords", () => {
  it("strips the BOM, keeps a quoted comma inside its field, handles CRLF and trims the ' ID Camera' header", () => {
    const rows = parseCsv(CSV);
    expect(rows).toHaveLength(5);
    expect(rows[0]![0]).toBe("ID");
    expect(rows[1]![2]).toBe("ทางด่วนยกระดับ, ขาเข้า");
    const recs = csvRecords(rows);
    expect(Object.keys(recs[0]!)).toContain("ID Camera");
    expect(Object.keys(recs[0]!)).not.toContain(" ID Camera");
    expect(recs[0]!["ID Camera"]).toBe("TF-ZZ-99-02-01");
  });

  it("unescapes doubled quotes and keeps a newline inside a quoted field; skips blank lines", () => {
    expect(parseCsv('a,b\n"say ""hi""","x\ny"\n\n')).toEqual([
      ["a", "b"],
      ['say "hi"', "x\ny"],
    ]);
  });
});

describe("parseCoord / placeFromDistrict", () => {
  it("accepts plain decimals only — a doubled decimal point is dropped, never repaired", () => {
    expect(parseCoord(" 13.769933 ")).toBe(13.769933);
    expect(parseCoord(" 100.468.312")).toBeNull();
    expect(parseCoord("")).toBeNull();
    expect(parseCoord("1e3")).toBeNull();
  });

  it("prefixes เขต unless the value already has it, and keeps the spelling as given", () => {
    expect(placeFromDistrict("บางพลัด")).toBe("เขตบางพลัด");
    expect(placeFromDistrict(" เขตสาธร ")).toBe("เขตสาธร");
    expect(placeFromDistrict("จตจักร")).toBe("เขตจตจักร");
    expect(placeFromDistrict(" ")).toBeNull();
  });
});

describe("pickCsvResource", () => {
  const pkg = (formats: (string | null)[]) => ({
    success: true,
    result: {
      metadata_modified: "2024-06-07T21:00:34.054497",
      resources: formats.map((format, i) => ({
        format,
        url: `https://data.bangkok.go.th/dataset/x/resource/${i}/download/bma-cctv.csv`,
        created: "2023-10-05T08:42:30.262365",
        last_modified: null,
      })),
    },
  });

  it("picks the single CSV resource by format and keeps the dataset/resource dates", () => {
    const r = pickCsvResource(pkg(["PDF", "csv"]));
    expect(r.url).toMatch(/resource\/1\//);
    expect(r).toMatchObject({ created: "2023-10-05T08:42:30.262365", lastModified: null, datasetModified: "2024-06-07T21:00:34.054497" });
  });

  it("refuses zero or two CSV resources — it does not guess which file is the list", () => {
    expect(() => pickCsvResource(pkg(["XLSX"]))).toThrow(/exactly one CSV resource.*found 0/);
    expect(() => pickCsvResource(pkg(["CSV", "CSV"]))).toThrow(/exactly one CSV resource.*found 2/);
    expect(() => pickCsvResource({ success: false, result: { resources: [] } })).toThrow(/CKAN package/);
  });

  it("refuses a non-https resource url", () => {
    const p = pkg(["CSV"]);
    p.result.resources[0]!.url = "http://data.bangkok.go.th/x.csv";
    expect(() => pickCsvResource(p)).toThrow(/plain https/);
  });
});

describe("build-bma-cctv projection", () => {
  const { cameras, stats } = buildCameras(csvRecords(parseCsv(CSV)), PROVINCES);

  it("allowlists id/code/name/district/coordinates and gives every camera one never-probed external-link stream", () => {
    expect(cameras.map((c) => c.id)).toEqual(["1", "2", "4"]);
    expect(cameras[0]).toEqual({
      id: "1",
      sourceId: SOURCE_ID,
      nameTh: "ทางด่วนยกระดับ, ขาเข้า",
      nameEn: null,
      lat: 13.5,
      lon: 100.5,
      coordSource: "upstream",
      provinceCode: "99",
      owner: null,
      code: "TF-ZZ-99-02-01",
      placeTh: "เขตบางพลัด",
      streams: [{ kind: "external-link", url: BMA_TRAFFIC_URL, label: null, captureTime: "none", probe: { result: "not-probed", cors: null } }],
    });
    expect(cameras[1]!.placeTh).toBe("เขตสาธร");
  });

  it("drops and counts unusable coordinates, counts a shared camera code without dropping either row, and counts cameras outside Bangkok", () => {
    // PROVINCES ของเทสต์มีแค่ 99 — สองตัวที่ตกในนั้นนับเป็น "จังหวัดอื่นที่ไม่ใช่ 10" (นับ ไม่ตัด)
    expect(stats).toEqual({ rows: 4, malformed: 0, badCoordinates: 1, badId: 0, codeCollisions: 1, noProvince: 1, otherProvince: 2, cameras: 3 });
  });

  it("the serialized catalogue carries neither the DVR code nor the project name", () => {
    const { catalogue } = assembleCatalogue(SOURCE_ID, cameras, {
      builtAt: "2026-09-27T00:00:00.000Z",
      sourceUrl: "https://data.bangkok.go.th/api/3/action/package_show?id=bma-cctv",
      probedAt: null,
      probeVantage: null,
    });
    const json = serializeCatalogue(catalogue);
    expect(json).not.toContain(DVR);
    expect(json).not.toContain("DVR");
    expect(json).not.toContain("project");
    expect(json).not.toContain("งานโครงการ");
    expect(CREDENTIAL_PATTERN.test(json)).toBe(false);
  });
});
