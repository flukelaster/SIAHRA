import { describe, expect, it } from "vitest";
import type { NearestProvince } from "@siahra/shared-types";
import { translator } from "../i18n";
import { nearestProvinceLabel } from "./nearestProvince";

const th = translator("th");
const en = translator("en");

const inside: NearestProvince = {
  provinceCode: "57",
  nameTh: "เชียงราย",
  nameEn: "Chiang Rai",
  distanceKm: 0,
  inside: true,
};
const outside: NearestProvince = {
  provinceCode: "58",
  nameTh: "แม่ฮ่องสอน",
  nameEn: "Mae Hong Son",
  distanceKm: 42.3,
  inside: false,
};

describe("nearestProvinceLabel", () => {
  it("จุดในเขตจังหวัด อ่านว่า 'ในเขต' ไม่ใช่ระยะทาง", () => {
    expect(nearestProvinceLabel(th, "th", inside)).toBe("ในเขตเชียงราย");
    expect(nearestProvinceLabel(en, "en", inside)).toBe("within Chiang Rai");
    expect(nearestProvinceLabel(th, "th", inside)).not.toMatch(/กม\./);
  });

  it("จุดนอกเขต อ่านเป็นระยะโดยประมาณ", () => {
    expect(nearestProvinceLabel(th, "th", outside)).toBe("ห่างจากแม่ฮ่องสอน ≈ 42 กม.");
    expect(nearestProvinceLabel(en, "en", outside)).toBe("≈ 42 km from Mae Hong Son");
  });

  /** ปัดเป็นจำนวนเต็มที่ระยะสั้น ๆ จะอ่านเป็น "0 กม." = เข้าใจผิดว่าอยู่ในเขต */
  it("ระยะต่ำกว่า 10 กม. คงทศนิยมหนึ่งตำแหน่ง จึงไม่กลายเป็นศูนย์", () => {
    const near = { ...outside, distanceKm: 0.4 };
    expect(nearestProvinceLabel(th, "th", near)).toBe("ห่างจากแม่ฮ่องสอน ≈ 0.4 กม.");
    expect(nearestProvinceLabel(en, "en", near)).toBe("≈ 0.4 km from Mae Hong Son");
  });

  it("ไม่มีข้อมูล = ไม่มีข้อความ (ไม่ใช่ระยะ 0)", () => {
    expect(nearestProvinceLabel(th, "th", undefined)).toBeNull();
  });
});
