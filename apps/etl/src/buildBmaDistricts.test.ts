import { describe, expect, it } from "vitest";
import {
  assertBmaDistrictSet,
  bmaDistrictId,
  selectBmaDistricts,
  type OsmAdmin6Feature,
} from "./buildBmaDistricts.js";
import type { ProvinceRingSet } from "./buildLocalAuthorityBoundaries.js";

// สี่เหลี่ยมสมมติ ไม่ใช่พิกัดจริง — "10" = กรุงเทพฯ, "11" = จังหวัดข้างเคียง
const BANGKOK: ProvinceRingSet = { code: "10", rings: [[0, 0, 10, 0, 10, 10, 0, 10]] };
const NEIGHBOUR: ProvinceRingSet = { code: "11", rings: [[20, 0, 30, 0, 30, 10, 20, 10]] };
const PROVINCES = [BANGKOK, NEIGHBOUR];

function square(x0: number, y0: number, x1: number, y1: number) {
  return { type: "Polygon", coordinates: [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]] };
}

function feature(over: Partial<OsmAdmin6Feature> & Pick<OsmAdmin6Feature, "name">): OsmAdmin6Feature {
  return { osmRelationId: "1", nameEn: null, geometry: square(1, 1, 2, 2), ...over };
}

describe("bmaDistrictId", () => {
  it("keys on the OSM relation id — never a DLA code (Bangkok has none) or an invented one", () => {
    expect(bmaDistrictId("92053")).toBe("TH-BMA-osm92053");
  });
});

describe("selectBmaDistricts", () => {
  it("keeps a เขต inside Bangkok, verbatim OSM names, every undeclared field null", () => {
    const { districts, rejected } = selectBmaDistricts(
      [feature({ osmRelationId: "92053", name: "เขตพระนคร", nameEn: "Phra Nakhon District" })],
      PROVINCES,
    );
    expect(rejected).toEqual([]);
    expect(districts).toHaveLength(1);
    expect(districts[0].osmRelationId).toBe("92053");
    expect(districts[0].ref).toEqual({
      id: "TH-BMA-osm92053",
      dlaCode: null,
      nameTh: "เขตพระนคร",
      nameEn: "Phra Nakhon District",
      type: "bma_district",
      provinceCode: "10",
      districtNameTh: null,
      centerLat: null,
      centerLon: null,
      areaKm2: null,
    });
  });

  it("ignores admin_level=6 features that are not named เขต (the country's อำเภอ) — not counted as rejected", () => {
    const { districts, rejected } = selectBmaDistricts([feature({ name: "อำเภอเมือง" })], PROVINCES);
    expect(districts).toEqual([]);
    expect(rejected).toEqual([]);
  });

  it("rejects a เขต whose polygon falls outside Bangkok — the province comes from geometry, never the name", () => {
    const { districts, rejected } = selectBmaDistricts(
      [feature({ name: "เขตนอกกรุง", geometry: square(21, 1, 22, 2) })],
      PROVINCES,
    );
    expect(districts).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual(["outside-bangkok"]);
  });

  it("rejects closed-way features (no relation id) and degenerate geometry", () => {
    const { rejected } = selectBmaDistricts(
      [
        feature({ name: "เขตหนึ่ง", osmRelationId: null }),
        feature({ name: "เขตสอง", geometry: { type: "Polygon", coordinates: [] } }),
      ],
      PROVINCES,
    );
    expect(rejected.map((r) => r.reason)).toEqual(["not-a-relation", "degenerate-geometry"]);
  });

  it("sorts by relation id so the committed file diffs readably", () => {
    const { districts } = selectBmaDistricts(
      [feature({ name: "เขตข", osmRelationId: "300" }), feature({ name: "เขตก", osmRelationId: "20" })],
      PROVINCES,
    );
    expect(districts.map((d) => d.osmRelationId)).toEqual(["20", "300"]);
  });
});

describe("assertBmaDistrictSet", () => {
  const make = (n: number) =>
    selectBmaDistricts(
      Array.from({ length: n }, (_, i) => feature({ name: `เขต${i}`, osmRelationId: String(i + 1) })),
      PROVINCES,
    ).districts;

  it("passes on exactly the expected count of distinct districts", () => {
    expect(() => assertBmaDistrictSet(make(50))).not.toThrow();
  });

  it("refuses to write 49 or 51 — Bangkok has 50 districts by law", () => {
    expect(() => assertBmaDistrictSet(make(49))).toThrow(/expected 50/);
    expect(() => assertBmaDistrictSet(make(51))).toThrow(/expected 50/);
  });

  it("refuses duplicate names even when the count is right", () => {
    const d = make(3);
    d[2] = { ...d[2], ref: { ...d[2].ref, nameTh: d[0].ref.nameTh } };
    expect(() => assertBmaDistrictSet(d, 3)).toThrow(/duplicate names/);
  });
});
