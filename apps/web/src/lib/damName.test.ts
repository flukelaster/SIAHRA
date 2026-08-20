import { describe, expect, it } from "vitest";
import { damDisplayName } from "./damName";
import { translator } from "../i18n";

const t = { th: translator("th"), en: translator("en") };

/** ชื่อจริงจาก `GET /api/v1/dams` — ต้นทางใส่คำว่า "เขื่อน"/"DAM" มาไม่สม่ำเสมอ */
const bhumibol = { nameTh: "ภูมิพล", nameEn: "BHUMIBOL DAM", kind: "large" as const };
const lowerPing = { nameTh: "เขื่อนแม่ปิงตอนล่าง", nameEn: "LOWER PING DAM", kind: "large" as const };

describe("damDisplayName", () => {
  it("ไม่ติดป้ายซ้ำเมื่อชื่อจากต้นทางมีคำนั้นอยู่แล้ว", () => {
    expect(damDisplayName(bhumibol, "en", t.en)).toBe("BHUMIBOL DAM");
    expect(damDisplayName(lowerPing, "en", t.en)).toBe("LOWER PING DAM");
    expect(damDisplayName(lowerPing, "th", t.th)).toBe("เขื่อนแม่ปิงตอนล่าง");
  });

  it("ยังเติมคำนำหน้าให้ชื่อที่ต้นทางส่งมาเปล่า ๆ", () => {
    expect(damDisplayName(bhumibol, "th", t.th)).toBe("เขื่อนภูมิพล");
  });

  it("ตกกลับไปอีกภาษาแล้วตรวจด้วยรูปแบบของภาษานั้น", () => {
    // อังกฤษไม่มีชื่อ → ใช้ชื่อไทย และตรวจ "เขื่อน" ไม่ใช่ /dam/
    expect(damDisplayName({ ...lowerPing, nameEn: null }, "en", t.en)).toBe("เขื่อนแม่ปิงตอนล่าง");
    expect(damDisplayName({ ...bhumibol, nameEn: null }, "en", t.en)).toBe("Dam ภูมิพล");
    expect(damDisplayName({ ...bhumibol, nameTh: null }, "th", t.th)).toBe("BHUMIBOL DAM");
    // ชื่อไทยที่นำหน้าด้วย "อ่างเก็บน้ำ" ถือว่าติดป้ายแล้ว แม้จะแสดงในหน้าอังกฤษ
    // — แสดงชื่อจากต้นทางตามจริง ดีกว่าเติม "Dam " ทับคำที่มีความหมายเดียวกัน
    expect(
      damDisplayName({ nameTh: "อ่างเก็บน้ำห้วยแม่ท้อ", nameEn: null, kind: "large" }, "en", t.en),
    ).toBe("อ่างเก็บน้ำห้วยแม่ท้อ");
  });

  it("เขื่อนขนาดกลางไม่ติดป้ายนำหน้า และไม่มีชื่อเลยก็บอกตามจริง", () => {
    expect(damDisplayName({ nameTh: "ห้วยแม่ท้อ", nameEn: null, kind: "medium" }, "th", t.th)).toBe(
      "ห้วยแม่ท้อ",
    );
    expect(damDisplayName({ nameTh: null, nameEn: null, kind: "large" }, "en", t.en)).toBe(
      "Reservoir",
    );
  });
});
