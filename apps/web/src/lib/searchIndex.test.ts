import { describe, expect, it } from "vitest";
import type { DamObservation, ObservationsResponse, StationRef } from "@siahra/shared-types";
import { translator } from "../i18n";
import { buildSearchIndex } from "./searchIndex";

const station = (over: Partial<StationRef>): StationRef => ({
  id: 1,
  nameTh: null,
  nameEn: null,
  lat: 13.75,
  lon: 100.5,
  provinceCode: "10",
  provinceNameTh: "กรุงเทพมหานคร",
  amphoeNameTh: null,
  basinNameTh: null,
  agencyShortTh: null,
  ...over,
});

const observations = (waterlevel: StationRef[], rainfall: StationRef[]): ObservationsResponse =>
  ({
    waterlevel: waterlevel.map((s) => ({ station: s })),
    rainfall: rainfall.map((s) => ({ station: s })),
  }) as unknown as ObservationsResponse;

const dam = (over: Partial<DamObservation>): DamObservation =>
  ({
    id: 7,
    nameTh: "ภูมิพล",
    nameEn: "Bhumibol",
    lat: 17.24,
    lon: 98.97,
    basinNameTh: null,
    ...over,
  }) as unknown as DamObservation;

const t = translator("th");
const base = { provinceName: "น่าน", provinceCode: "55", lang: "th" as const, t };

describe("searchIndex — buildSearchIndex", () => {
  it("ไม่มีข้อมูลเลย → รายการว่าง", () => {
    expect(buildSearchIndex({ ...base, observations: null, dams: [] })).toEqual([]);
  });

  it("สถานีซ้ำกันระหว่างฝน/ระดับน้ำ (id ชนกันที่ต้นทาง) ถูกตัดซ้ำด้วยชื่อ+พิกัด ไม่ใช่ id", () => {
    const a = station({ id: 1, nameTh: "สถานี ก", lat: 18.8, lon: 100.7, amphoeNameTh: "เมืองน่าน" });
    const sameNameSameSpotOtherId = station({ id: 2, nameTh: "สถานี ก", lat: 18.8, lon: 100.7, amphoeNameTh: "เมืองน่าน" });
    const sameIdOtherPlace = station({ id: 1, nameTh: "สถานี ข", lat: 19.2, lon: 100.9, amphoeNameTh: "ปัว" });
    const idx = buildSearchIndex({
      ...base,
      observations: observations([a], [sameNameSameSpotOtherId, sameIdOtherPlace]),
      dams: [],
    });
    const stations = idx.filter((p) => p.kind === "station");
    expect(stations.map((p) => p.label)).toEqual(["สถานี ก", "สถานี ข"]);
    expect(stations[0].sub).toBe("เมืองน่าน");
  });

  it("สถานีไม่มีชื่อไทยไม่ถูกใส่ในรายการ แต่ยังนับเข้าจุดกึ่งกลางอำเภอ", () => {
    const named = station({ id: 1, nameTh: "สถานี ก", lat: 18.0, lon: 100.0, amphoeNameTh: "ท่าวังผา" });
    const unnamed = station({ id: 2, nameTh: null, lat: 20.0, lon: 102.0, amphoeNameTh: "ท่าวังผา" });
    const idx = buildSearchIndex({ ...base, observations: observations([named, unnamed], []), dams: [] });
    expect(idx.filter((p) => p.kind === "station")).toHaveLength(1);
    const amphoe = idx.find((p) => p.kind === "amphoe");
    expect(amphoe).toMatchObject({ key: "a:ท่าวังผา", label: "อ.ท่าวังผา", sub: "น่าน", lat: 19.0, lon: 101.0 });
  });

  it("กรุงเทพฯ ใช้คำนำหน้า 'เขต' แทน 'อ.'", () => {
    const s = station({ id: 1, nameTh: "สถานี ก", amphoeNameTh: "บางรัก" });
    const idx = buildSearchIndex({
      ...base,
      provinceCode: "10",
      provinceName: "กรุงเทพมหานคร",
      observations: observations([s], []),
      dams: [],
    });
    expect(idx.find((p) => p.kind === "amphoe")?.label).toBe("เขตบางรัก");
  });

  it("สถานีที่ไม่มีอำเภอใช้ชื่อจังหวัดเป็นบรรทัดรอง และเขื่อนใช้ลุ่มน้ำหรือจังหวัด", () => {
    const s = station({ id: 3, nameTh: "สถานี ค", amphoeNameTh: null });
    const idx = buildSearchIndex({
      ...base,
      observations: observations([], [s]),
      dams: [dam({ id: 7, basinNameTh: "ลุ่มน้ำน่าน" }), dam({ id: 8, nameTh: "สิริกิติ์", basinNameTh: null })],
    });
    expect(idx.find((p) => p.kind === "station")?.sub).toBe("น่าน");
    const dams = idx.filter((p) => p.kind === "dam");
    expect(dams.map((p) => p.key)).toEqual(["d:7", "d:8"]);
    expect(dams[0].sub).toBe("ลุ่มน้ำน่าน");
    expect(dams[1].sub).toBe("น่าน");
    expect(dams[0]).toMatchObject({ lat: 17.24, lon: 98.97 });
  });
});
