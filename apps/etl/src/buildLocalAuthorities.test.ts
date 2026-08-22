import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  groupByCode,
  parseCsv,
  parseDlaCsv,
  parseNumberOrNull,
  stripBom,
  toLocalAuthorityRef,
  type RawDlaRow,
} from "./buildLocalAuthorities.js";
import type { ProvinceEntry } from "./provinceBoundaries.js";
import type { HazardLayerDescriptor } from "@siahra/shared-types";

const PROVINCES: ProvinceEntry[] = [
  { code: "81", nameTh: "กระบี่", nameEn: "Krabi" },
  { code: "90", nameTh: "สงขลา", nameEn: "Songkhla" },
];

const HEADER =
  "จังหวัด,อำเภอ,ตำบล,รหัส อปท.,ประเภท อปท.,อปท.,ที่ตั้งสำนักงานเลขที่,หมู่ที่,รหัสไปรษณีย์,ขนาดพื้นที่,LAT,LONG,เว็ปไซต์ของอปท";

function csvOf(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

const DESCRIPTOR: HazardLayerDescriptor = {
  id: "local-authorities",
  epistemicClass: "static-reference",
  liveOrStatic: "static",
  publishedAt: "2026-06-10T00:00:00Z",
  fetchedAt: "2026-08-23T00:00:00Z",
  sourceIds: ["dla"],
};

describe("stripBom", () => {
  it("removes a leading UTF-8 BOM but leaves the rest untouched", () => {
    expect(stripBom("﻿จังหวัด,x")).toBe("จังหวัด,x");
    expect(stripBom("จังหวัด,x")).toBe("จังหวัด,x");
  });
});

describe("parseCsv (RFC 4180)", () => {
  it("does not misalign columns on a quoted field containing a literal comma", () => {
    const text = `a,b,c\n1,"www,tlpm.go.th",3`;
    const rows = parseCsv(text);
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "www,tlpm.go.th", "3"],
    ]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    const text = `a\n"""-"""`;
    const rows = parseCsv(text);
    expect(rows).toEqual([["a"], ['"-"']]);
  });

  it("drops fully blank trailing lines", () => {
    const text = "a,b\n1,2\n";
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseNumberOrNull", () => {
  it("empty / dash / undefined become null, never 0", () => {
    expect(parseNumberOrNull("")).toBeNull();
    expect(parseNumberOrNull("-")).toBeNull();
    expect(parseNumberOrNull(undefined)).toBeNull();
    expect(parseNumberOrNull("  ")).toBeNull();
  });

  it("parses a real number", () => {
    expect(parseNumberOrNull("7.952981685")).toBeCloseTo(7.952981685);
    expect(parseNumberOrNull("0")).toBe(0);
  });
});

describe("parseDlaCsv + groupByCode", () => {
  it("dedupes multiple rows sharing a รหัส อปท. into one group", () => {
    const csv = csvOf([
      "กระบี่,คลองท่อม,คลองท่อมเหนือ,5810401,เทศบาลตำบล,คลองท่อมใต้,-,2,81120,2.7,7.95,99.15,http://x",
      "กระบี่,คลองท่อม,คลองท่อมใต้,5810401,เทศบาลตำบล,คลองท่อมใต้,-,2,81120,2.7,7.95,99.15,http://x",
      "กระบี่,คลองท่อม,เพหลา,5810401,เทศบาลตำบล,คลองท่อมใต้,-,2,81120,2.7,7.95,99.15,http://x",
    ]);
    const rows = parseDlaCsv(csv);
    expect(rows).toHaveLength(3);
    const { groups, rejectedEmptyCode } = groupByCode(rows);
    expect(groups.size).toBe(1);
    expect(rejectedEmptyCode).toBe(0);
    expect(groups.get("5810401")?.districtTh).toBe("คลองท่อม");
  });

  it("skips a row with an empty รหัส อปท. and counts it", () => {
    const csv = csvOf([
      "กระบี่,คลองท่อม,คลองท่อมเหนือ,,เทศบาลตำบล,ไม่มีรหัส,-,2,81120,2.7,7.95,99.15,http://x",
      "กระบี่,คลองท่อม,คลองท่อมใต้,5810401,เทศบาลตำบล,คลองท่อมใต้,-,2,81120,2.7,7.95,99.15,http://x",
    ]);
    const rows = parseDlaCsv(csv);
    const { groups, rejectedEmptyCode } = groupByCode(rows);
    expect(groups.size).toBe(1);
    expect(rejectedEmptyCode).toBe(1);
  });
});

describe("toLocalAuthorityRef", () => {
  const base: RawDlaRow = {
    provinceTh: "กระบี่",
    districtTh: "คลองท่อม",
    dlaCode: "5810401",
    typeTh: "เทศบาลตำบล",
    nameTh: "คลองท่อมใต้",
    areaKm2Raw: "2.7",
    latRaw: "7.952981685",
    lonRaw: "99.15039092",
  };

  it("maps a valid row to a LocalAuthorityRef", () => {
    const result = toLocalAuthorityRef(base, PROVINCES);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.ref).toEqual({
      id: "TH-LAO-5810401",
      dlaCode: "5810401",
      nameTh: "คลองท่อมใต้",
      nameEn: null,
      type: "subdistrict_municipality",
      provinceCode: "81",
      districtNameTh: "คลองท่อม",
      centerLat: 7.952981685,
      centerLon: 99.15039092,
      areaKm2: 2.7,
    });
  });

  it("rejects an unknown ประเภท อปท. instead of defaulting to any type", () => {
    const result = toLocalAuthorityRef({ ...base, typeTh: "หน่วยงานลึกลับ" }, PROVINCES);
    expect(result).toEqual({ ok: false, reason: "unknown-type" });
  });

  it("rejects a province name that matches none of the 77", () => {
    const result = toLocalAuthorityRef({ ...base, provinceTh: "ไม่มีจังหวัดนี้" }, PROVINCES);
    expect(result).toEqual({ ok: false, reason: "unmatched-province" });
  });

  it("carries empty LAT/LONG/ขนาดพื้นที่ through as null, not 0", () => {
    const result = toLocalAuthorityRef({ ...base, latRaw: "", lonRaw: "", areaKm2Raw: "" }, PROVINCES);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.ref.centerLat).toBeNull();
    expect(result.ref.centerLon).toBeNull();
    expect(result.ref.areaKm2).toBeNull();
  });
});

describe("buildRegistry (end-to-end on a small fixture)", () => {
  it("produces the right coverage report and honest null handling", () => {
    const csv = csvOf([
      // code 5810401: two rows, dedupe to one record, has coordinates
      "กระบี่,คลองท่อม,คลองท่อมเหนือ,5810401,เทศบาลตำบล,คลองท่อมใต้,-,2,81120,2.7,7.95,99.15,http://x",
      "กระบี่,คลองท่อม,คลองท่อมใต้,5810401,เทศบาลตำบล,คลองท่อมใต้,-,2,81120,2.7,7.95,99.15,http://x",
      // code 9000001: valid, but no coordinates on record
      "สงขลา,หาดใหญ่,หาดใหญ่,9000001,เทศบาลนคร,หาดใหญ่,-,1,90110,,,,http://y",
      // code 9000002: unknown type → rejected
      "สงขลา,หาดใหญ่,คอหงส์,9000002,หน่วยงานลึกลับ,คอหงส์,-,1,90110,7.0,100.5,,http://z",
      // code 9000003: unmatched province → rejected
      "ไม่มีจริง,x,y,9000003,อบต.,z,-,1,90110,,,,http://w",
      // empty code row → rejected as empty-code
      "สงขลา,หาดใหญ่,คลองแห,,อบต.,ไม่มีรหัส,-,1,90110,,,,http://v",
    ]);
    const { registry, report } = buildRegistry(csv, PROVINCES, {
      sourceSha256: "deadbeef",
      descriptor: DESCRIPTOR,
    });

    expect(report).toEqual({
      totalRows: 6,
      uniqueCodes: 4, // 5810401, 9000001, 9000002, 9000003 (empty code excluded)
      written: 2,
      rejectedEmptyCode: 1,
      rejectedUnknownType: 1,
      rejectedUnmatchedProvince: 1,
    });
    expect(registry.recordCount).toBe(2);
    expect(registry.sourceSha256).toBe("deadbeef");
    expect(registry.descriptor).toEqual(DESCRIPTOR);

    const krabi = registry.localAuthorities.find((a) => a.dlaCode === "5810401");
    expect(krabi?.centerLat).toBeCloseTo(7.95);
    const songkhla = registry.localAuthorities.find((a) => a.dlaCode === "9000001");
    expect(songkhla?.centerLat).toBeNull();
    expect(songkhla?.areaKm2).toBeNull();
  });
});
