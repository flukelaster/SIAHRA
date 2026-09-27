import { describe, expect, it, vi } from "vitest";
import type { ForecastStep } from "@siahra/shared-types";
import { forecastAutoSelectTarget, runForecastAutoSelect } from "./forecastAutoSelect";

/**
 * devops C1 (E18.4): การเลือกขั้นพยากรณ์อัตโนมัติเมื่อมีขั้นเดียว ห้ามเกิดขณะกำลังดูค่าย้อนหลัง
 *
 * เทสฝั่ง web ไม่มี DOM (vitest environment "node" โดยตั้งใจ — ไม่มี jsdom/RTL) จึง mount
 * `ForecastStrip` จริงไม่ได้ effect ของมันเป็นหนึ่งบรรทัดที่เรียก `runForecastAutoSelect`
 * ด้วยค่าเดียวกันนี้ตอน mount (และเมื่อชุดขั้นเปลี่ยน) — เทสนี้คือ "mount" ครั้งนั้นกับ spy
 */
const step = (validAt: string): ForecastStep => ({ validAt, rainMm: 1.2, tempC: 30, cond: 2 });
const ONE = [step("2026-09-27T09:00:00Z")];

describe("forecastAutoSelect — ชุดขั้นเดียว", () => {
  it("mount ขณะดูค่าย้อนหลัง (atIso ตั้งอยู่) → ไม่เรียก onChange เลย", () => {
    const onChange = vi.fn();
    runForecastAutoSelect(ONE, null, "2026-09-26T12:00:00.000Z", onChange);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("mount ขณะดูค่าปัจจุบัน (atIso null) → เรียก onChange ครั้งเดียวด้วยขั้นนั้น", () => {
    const onChange = vi.fn();
    runForecastAutoSelect(ONE, null, null, onChange);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-09-27T09:00:00Z");
  });

  it("เลือกขั้นนั้นอยู่แล้ว → ไม่เรียกซ้ำ", () => {
    const onChange = vi.fn();
    runForecastAutoSelect(ONE, "2026-09-27T09:00:00Z", null, onChange);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ศูนย์ขั้นหรือหลายขั้น → ไม่เลือกอะไรเอง (ผู้ใช้เลื่อนเอง)", () => {
    expect(forecastAutoSelectTarget([], null, null)).toBeNull();
    expect(forecastAutoSelectTarget([step("2026-09-27T09:00:00Z"), step("2026-09-27T10:00:00Z")], null, null)).toBeNull();
  });

  it("โพลรอบใหม่ส่งชุดขั้นเดิม (array ใหม่) หลังผู้ใช้ล้าง → ไม่เลือกกลับเอง", () => {
    const onChange = vi.fn();
    const seen = { current: null as string | null };
    runForecastAutoSelect(ONE, null, null, onChange, seen); // mount
    runForecastAutoSelect([step("2026-09-27T09:00:00Z")], null, null, onChange, seen); // โพลถัดไป หลังกดล้าง
    expect(onChange).toHaveBeenCalledTimes(1);
    // ชุดใหม่ที่ขั้นเปลี่ยนจริง = พิจารณาใหม่
    runForecastAutoSelect([step("2026-09-27T10:00:00Z")], null, null, onChange, seen);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("ข้ามไปตอนดูค่าย้อนหลังแล้ว → กลับเป็นค่าปัจจุบันในชุดเดิมก็ไม่ถูกดีดเข้าโหมดพยากรณ์", () => {
    const onChange = vi.fn();
    const seen = { current: null as string | null };
    runForecastAutoSelect(ONE, null, "2026-09-26T12:00:00.000Z", onChange, seen);
    runForecastAutoSelect([step("2026-09-27T09:00:00Z")], null, null, onChange, seen);
    expect(onChange).not.toHaveBeenCalled();
  });
});
