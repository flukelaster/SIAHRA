import { describe, expect, it } from "vitest";
import {
  DAMS_INTERVAL_MS,
  nextDamsPollDelayMs,
  nextRoutePollDelayMs,
  routeIntervalMs,
  ROUTE_RETRY_MS,
} from "./pollSchedule";

const NOW = 1_800_000_000_000;
const base = { nowMs: NOW, hidden: false, panelOpen: false, lastWasError: false };

describe("routeIntervalMs (C2)", () => {
  it("600000 เมื่อเปิดเฉพาะชั้น 3 มิติ, 300000 เมื่อแผงเปิดอยู่", () => {
    expect(routeIntervalMs(false)).toBe(600000);
    expect(routeIntervalMs(true)).toBe(300000);
  });
});

describe("nextRoutePollDelayMs", () => {
  it("รอบปกติ: 600000 เมื่อแผงปิด, 300000 เมื่อแผงเปิด (นับจากความสำเร็จที่เพิ่งได้)", () => {
    expect(nextRoutePollDelayMs({ ...base, lastSuccessAtMs: NOW, panelOpen: false })).toBe(600000);
    expect(nextRoutePollDelayMs({ ...base, lastSuccessAtMs: NOW, panelOpen: true })).toBe(300000);
  });

  it("แท็บซ่อน → null (ไม่ตั้ง timer) ไม่ว่าสถานะอื่นเป็นอย่างไร", () => {
    expect(nextRoutePollDelayMs({ ...base, hidden: true, lastSuccessAtMs: null })).toBeNull();
    expect(nextRoutePollDelayMs({ ...base, hidden: true, lastSuccessAtMs: NOW, lastWasError: true })).toBeNull();
  });

  it("ยังไม่เคยสำเร็จ → ยิงทันที", () => {
    expect(nextRoutePollDelayMs({ ...base, lastSuccessAtMs: null })).toBe(0);
  });

  it("กลับมาเห็นแท็บ: ค่าอายุ ≥ รอบ → ยิงทันที, ยังไม่ครบรอบ → รอส่วนที่เหลือ", () => {
    expect(nextRoutePollDelayMs({ ...base, lastSuccessAtMs: NOW - 600_000 })).toBe(0);
    expect(nextRoutePollDelayMs({ ...base, lastSuccessAtMs: NOW - 3_600_000 })).toBe(0);
    expect(nextRoutePollDelayMs({ ...base, lastSuccessAtMs: NOW - 200_000 })).toBe(400_000);
    expect(nextRoutePollDelayMs({ ...base, lastSuccessAtMs: NOW - 200_000, panelOpen: true })).toBe(100_000);
  });

  it("รอบล้มเหลว → ถามซ้ำไม่ถี่กว่า 120 วิ", () => {
    expect(ROUTE_RETRY_MS).toBeGreaterThanOrEqual(120_000);
    expect(nextRoutePollDelayMs({ ...base, lastSuccessAtMs: NOW - 3_600_000, lastWasError: true })).toBe(ROUTE_RETRY_MS);
    expect(nextRoutePollDelayMs({ ...base, lastSuccessAtMs: null, lastWasError: true, panelOpen: true })).toBe(ROUTE_RETRY_MS);
  });
});

describe("nextDamsPollDelayMs (C5)", () => {
  it("15 นาที ไม่ขึ้นกับแผง, หยุดเมื่อแท็บซ่อน, ล้มเหลวก็ 15 นาที", () => {
    expect(nextDamsPollDelayMs({ ...base, lastSuccessAtMs: NOW, panelOpen: true })).toBe(DAMS_INTERVAL_MS);
    expect(DAMS_INTERVAL_MS).toBe(900_000);
    expect(nextDamsPollDelayMs({ ...base, lastSuccessAtMs: NOW, hidden: true })).toBeNull();
    expect(nextDamsPollDelayMs({ ...base, lastSuccessAtMs: NOW - 1_000_000 })).toBe(0);
    expect(nextDamsPollDelayMs({ ...base, lastSuccessAtMs: NOW, lastWasError: true })).toBe(DAMS_INTERVAL_MS);
  });
});
