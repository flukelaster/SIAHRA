import { describe, expect, it } from "vitest";
import type { LocalAuthorityRef } from "@siahra/shared-types";
import {
  hasCoordinates,
  matchOsmToRegistry,
  osmMatchKey,
  pointInRings,
  registryMatchKey,
  representativePoint,
  resolveProvince,
  type OsmAdminFeature,
  type ProvinceRingSet,
} from "./buildLocalAuthorityBoundaries.js";

describe("registryMatchKey / OSM_NAME_PREFIX", () => {
  const base = { provinceCode: "10", nameTh: "ทดสอบ" };

  it("provincial_admin_org is never matched — an อบจ.'s jurisdiction is the whole province", () => {
    expect(registryMatchKey({ ...base, type: "provincial_admin_org" })).toBeNull();
  });

  it("concatenates the full OSM prefix with the registry's stripped nameTh", () => {
    expect(registryMatchKey({ ...base, type: "city_municipality" })).toBe("10::เทศบาลนครทดสอบ");
    expect(registryMatchKey({ ...base, type: "town_municipality" })).toBe("10::เทศบาลเมืองทดสอบ");
    expect(registryMatchKey({ ...base, type: "subdistrict_municipality" })).toBe(
      "10::เทศบาลตำบลทดสอบ",
    );
    expect(registryMatchKey({ ...base, type: "subdistrict_admin_org" })).toBe(
      "10::องค์การบริหารส่วนตำบลทดสอบ",
    );
  });

  it("special_admin_area (Pattaya) carries the full name already — no prefix to add", () => {
    expect(registryMatchKey({ provinceCode: "20", nameTh: "เมืองพัทยา", type: "special_admin_area" })).toBe(
      "20::เมืองพัทยา",
    );
  });
});

describe("osmMatchKey", () => {
  it("pairs the resolved province with OSM's own full name, no decomposition needed", () => {
    expect(osmMatchKey("10", "เทศบาลนครทดสอบ")).toBe("10::เทศบาลนครทดสอบ");
  });
});

// สี่เหลี่ยมสมมติ ไม่ใช่พิกัดจริง — พอสำหรับทดสอบตรรกะ even-odd / จังหวัดซ้อนทับ
const PROVINCE_A: ProvinceRingSet = { code: "A", rings: [[0, 0, 10, 0, 10, 10, 0, 10]] };
const PROVINCE_B: ProvinceRingSet = { code: "B", rings: [[20, 0, 30, 0, 30, 10, 20, 10]] };
// C ทับ A ในช่วง lon 5–10 โดยตั้งใจ เพื่อทดสอบกรณี "ตกสองจังหวัด"
const PROVINCE_C: ProvinceRingSet = { code: "C", rings: [[5, 0, 15, 0, 15, 10, 5, 10]] };
const PROVINCES = [PROVINCE_A, PROVINCE_B, PROVINCE_C];

describe("pointInRings", () => {
  it("inside / outside a simple square", () => {
    expect(pointInRings(2, 2, PROVINCE_A.rings)).toBe(true);
    expect(pointInRings(50, 50, PROVINCE_A.rings)).toBe(false);
  });
});

describe("resolveProvince", () => {
  it("resolves to the single province containing the point", () => {
    expect(resolveProvince(2.5, 2.5, PROVINCES)).toEqual({ code: "A" });
    expect(resolveProvince(25, 5, PROVINCES)).toEqual({ code: "B" });
  });

  it("rejects a point outside every province as no-match, not a guess", () => {
    const r = resolveProvince(50, 50, PROVINCES);
    expect(r).toEqual({ code: null, reason: "no-match", matches: [] });
  });

  it("rejects a point inside two provinces as ambiguous, not the first hit", () => {
    const r = resolveProvince(7, 5, PROVINCES);
    expect(r.code).toBeNull();
    if (r.code === null) {
      expect(r.reason).toBe("ambiguous");
      expect(r.matches.sort()).toEqual(["A", "C"]);
    }
  });
});

describe("representativePoint / hasCoordinates", () => {
  it("returns a point guaranteed to lie on a real polygon", () => {
    const geom = { type: "Polygon", coordinates: [[[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]]] };
    expect(hasCoordinates(geom)).toBe(true);
    const pt = representativePoint(geom);
    expect(pt).not.toBeNull();
  });

  it("flags geometry that -simplify collapsed to an empty ring", () => {
    const geom = { type: "Polygon", coordinates: [[]] };
    expect(hasCoordinates(geom)).toBe(false);
  });

  it("flags a MultiPolygon with no populated part", () => {
    const geom = { type: "MultiPolygon", coordinates: [] };
    expect(hasCoordinates(geom)).toBe(false);
  });
});

function square(x0: number, y0: number, x1: number, y1: number) {
  return {
    type: "Polygon" as const,
    coordinates: [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]],
  };
}

function ref(over: Partial<LocalAuthorityRef> & Pick<LocalAuthorityRef, "id" | "provinceCode" | "type" | "nameTh">): LocalAuthorityRef {
  return {
    dlaCode: over.id.replace("TH-LAO-", ""),
    nameEn: null,
    districtNameTh: null,
    centerLat: null,
    centerLon: null,
    areaKm2: null,
    ...over,
  };
}

describe("matchOsmToRegistry", () => {
  const registry: LocalAuthorityRef[] = [
    ref({ id: "TH-LAO-1", provinceCode: "A", type: "city_municipality", nameTh: "หนึ่ง" }),
    // สองระเบียนชนกันที่คีย์เดียวกันโดยตั้งใจ (จำลอง collision ในทะเบียนจริง)
    ref({ id: "TH-LAO-2a", provinceCode: "A", type: "town_municipality", nameTh: "ชนกัน" }),
    ref({ id: "TH-LAO-2b", provinceCode: "A", type: "town_municipality", nameTh: "ชนกัน" }),
    ref({ id: "TH-LAO-3", provinceCode: "B", type: "subdistrict_admin_org", nameTh: "ซ้ำ" }),
    // อบจ. — ต้องไม่ถูกจับคู่แม้ชื่อ+จังหวัดจะตรงเป๊ะ
    ref({ id: "TH-LAO-4", provinceCode: "A", type: "provincial_admin_org", nameTh: "จังหวัดเอ" }),
  ];

  it("matches a clean (province, type-prefix+name) pair", () => {
    const feature: OsmAdminFeature = {
      osmId: "1",
      name: "เทศบาลนครหนึ่ง",
      geometry: square(1, 1, 3, 3), // ใน A เท่านั้น
    };
    const result = matchOsmToRegistry([feature], registry, PROVINCES);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].ref.id).toBe("TH-LAO-1");
    expect(result.matched[0].provinceCode).toBe("A");
    expect(result.rejected).toHaveLength(0);
  });

  it("never matches provincial_admin_org even with an exact name+province hit", () => {
    const feature: OsmAdminFeature = {
      osmId: "4",
      name: "จังหวัดเอ", // ไม่มี prefix ให้จับคู่ (อบจ. ไม่อยู่ใน OSM_NAME_PREFIX)
      geometry: square(1, 1, 3, 3),
    };
    const result = matchOsmToRegistry([feature], registry, PROVINCES);
    expect(result.matched).toHaveLength(0);
    expect(result.rejected[0].reason).toBe("no-registry-match");
  });

  it("rejects a registry-side key collision rather than guessing which record", () => {
    const feature: OsmAdminFeature = {
      osmId: "2",
      name: "เทศบาลเมืองชนกัน",
      geometry: square(1, 1, 3, 3),
    };
    const result = matchOsmToRegistry([feature], registry, PROVINCES);
    expect(result.registryKeyCollisions).toBe(1);
    expect(result.matched).toHaveLength(0);
    expect(result.rejected[0].reason).toBe("ambiguous-registry-key");
  });

  it("rejects both sides of a duplicate OSM match to the same registry record", () => {
    const featureA: OsmAdminFeature = {
      osmId: "3a",
      name: "องค์การบริหารส่วนตำบลซ้ำ",
      geometry: square(24, 4, 26, 6), // ใน B
    };
    const featureB: OsmAdminFeature = {
      osmId: "3b",
      name: "องค์การบริหารส่วนตำบลซ้ำ",
      geometry: square(26, 4, 28, 6), // ใน B เช่นกัน — geometry คนละชิ้น
    };
    const result = matchOsmToRegistry([featureA, featureB], registry, PROVINCES);
    expect(result.matched).toHaveLength(0);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      "duplicate-osm-match",
      "duplicate-osm-match",
    ]);
  });

  it("rejects a feature whose representative point resolves to two provinces", () => {
    const feature: OsmAdminFeature = {
      osmId: "5",
      name: "เทศบาลนครหนึ่ง",
      geometry: square(6, 4, 9, 6), // ในโซนที่ A กับ C ทับกัน
    };
    const result = matchOsmToRegistry([feature], registry, PROVINCES);
    expect(result.matched).toHaveLength(0);
    expect(result.rejected[0].reason).toBe("ambiguous-province");
  });

  it("rejects a feature with no province match", () => {
    const feature: OsmAdminFeature = {
      osmId: "6",
      name: "เทศบาลนครหนึ่ง",
      geometry: square(50, 50, 53, 53),
    };
    const result = matchOsmToRegistry([feature], registry, PROVINCES);
    expect(result.rejected[0].reason).toBe("no-province");
  });

  it("rejects degenerate geometry (collapsed by -simplify) without crashing", () => {
    const feature: OsmAdminFeature = {
      osmId: "7",
      name: "เทศบาลนครหนึ่ง",
      geometry: { type: "Polygon", coordinates: [[]] },
    };
    const result = matchOsmToRegistry([feature], registry, PROVINCES);
    expect(result.rejected[0].reason).toBe("degenerate-geometry");
  });

  it("rejects a name with no registry counterpart at all", () => {
    const feature: OsmAdminFeature = {
      osmId: "8",
      name: "เทศบาลนครไม่มีจริง",
      geometry: square(1, 1, 3, 3),
    };
    const result = matchOsmToRegistry([feature], registry, PROVINCES);
    expect(result.rejected[0].reason).toBe("no-registry-match");
  });
});
