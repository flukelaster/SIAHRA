import { PROVINCE_CODES } from "@siahra/shared-types";
import { describe, expect, it } from "vitest";
import { PROVINCES } from "./provinces";

/**
 * รหัสจังหวัดถูกเก็บไว้สองที่โดยตั้งใจ: **ชื่อ** อยู่ที่นี่ (เว็บใช้แสดงผล) ส่วน
 * **เซตของรหัส** อยู่ใน `packages/shared-types` เพราะ Worker ของ API ต้องใช้มัน
 * ตอบ 404 ให้รหัสที่ไม่มีอยู่จริง โดยอ่านไฟล์ใน `public/` ตอนรันไม่ได้
 *
 * เทสนี้คือสิ่งเดียวที่กันสองรายการนั้นไม่ให้ห่างกัน — จังหวัดที่โผล่ในรายการเดียว
 * แปลว่า `/api/v1/provinces/{NN}/exposure/latest` กับตัวเลือกจังหวัดบนหน้าเว็บ
 * เห็นประเทศไทยคนละแบบ
 */
describe("รหัสจังหวัด", () => {
  it("ตรงกับทะเบียนใน shared-types ทุกรหัส", () => {
    expect([...PROVINCES.map((p) => p.code)].sort()).toEqual([...PROVINCE_CODES].sort());
  });

  it("มี 77 จังหวัด และไม่มีรหัสซ้ำ", () => {
    expect(PROVINCE_CODES).toHaveLength(77);
    expect(new Set(PROVINCE_CODES).size).toBe(77);
  });
});
