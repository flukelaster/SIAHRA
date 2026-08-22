import { describe, expect, it } from "vitest";
import {
  normaliseDlaRecord,
  validateDlaMasterList,
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
});
