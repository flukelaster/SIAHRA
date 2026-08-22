import { describe, expect, it } from "vitest";
import {
  cleanPolygonRing,
  normaliseDlaRecord,
  validateDlaMasterList,
  validatePolygonRingTopology,
  type RawDlaRecord,
} from "./buildLocalAuthorities.js";

describe("buildLocalAuthorities ETL", () => {
  it("normalises valid raw DLA record", () => {
    const raw: RawDlaRecord = {
      dla_code: "901101",
      name_th: "เทศบาลนครหาดใหญ่",
      name_en: "Hat Yai City",
      type: "เทศบาลนคร",
      province_code: "90",
      district_code: "9011",
      lat: 7.0084,
      lon: 100.4767,
      area_km2: 21.0,
    };

    const result = normaliseDlaRecord(raw);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("TH-LAO-901101");
    expect(result?.dlaCode).toBe("901101");
    expect(result?.type).toBe("city_municipality");
    expect(result?.provinceCode).toBe("90");
  });

  it("returns null for invalid province or missing code", () => {
    expect(
      normaliseDlaRecord({
        dla_code: "999999",
        name_th: "Unknown",
        type: "อบต.",
        province_code: "999",
      }),
    ).toBeNull();

    expect(
      normaliseDlaRecord({
        dla_code: "",
        name_th: "No Code",
        type: "อบต.",
        province_code: "10",
      }),
    ).toBeNull();
  });

  it("deduplicates and validates master list", () => {
    const records: RawDlaRecord[] = [
      { dla_code: "901101", name_th: "เทศบาลนครหาดใหญ่", type: "เทศบาลนคร", province_code: "90" },
      { dla_code: "901101", name_th: "เทศบาลนครหาดใหญ่ duplicate", type: "เทศบาลนคร", province_code: "90" },
      { dla_code: "100000", name_th: "กรุงเทพมหานคร", type: "กรุงเทพมหานคร", province_code: "10" },
    ];

    const result = validateDlaMasterList(records);
    expect(result).toHaveLength(2);
    expect(result[0].dlaCode).toBe("100000");
    expect(result[1].dlaCode).toBe("901101");
  });

  it("validates valid closed polygon ring topology", () => {
    const ring: [number, number][] = [
      [100.45, 7.00],
      [100.50, 7.00],
      [100.50, 7.05],
      [100.45, 7.05],
      [100.45, 7.00],
    ];

    const qa = validatePolygonRingTopology(ring);
    expect(qa.valid).toBe(true);
    expect(qa.vertexCount).toBe(5);
    expect(qa.areaApproxKm2).toBeGreaterThan(0);
  });

  it("flags unclosed or invalid polygon rings", () => {
    const unclosedRing: [number, number][] = [
      [100.45, 7.00],
      [100.50, 7.00],
      [100.50, 7.05],
      [100.45, 7.05],
    ];

    const qa = validatePolygonRingTopology(unclosedRing);
    expect(qa.valid).toBe(false);
    expect(qa.reason).toContain("not closed");
  });

  it("cleans duplicate vertices and ensures ring closure", () => {
    const dirtyRing: [number, number][] = [
      [100.45, 7.00],
      [100.45, 7.00], // duplicate
      [100.50, 7.00],
      [100.50, 7.05],
      [100.45, 7.05],
      // missing closure
    ];

    const cleaned = cleanPolygonRing(dirtyRing);
    expect(cleaned).toHaveLength(5);
    expect(cleaned[0]).toEqual(cleaned[cleaned.length - 1]);
  });
});
