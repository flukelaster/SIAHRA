import { describe, expect, it } from "vitest";
import {
  BASINS_INTERVAL_MS,
  BASINS_RETRY_MS,
  nextBasinsPollDelayMs,
  COMMUNITY_INTERVAL_MS,
  COMMUNITY_RETRY_MS,
  DAMS_INTERVAL_MS,
  FORECAST_INTERVAL_MS,
  FORECAST_RETRY_MS,
  nextCommunityPollDelayMs,
  nextDamsPollDelayMs,
  nextForecastPollDelayMs,
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

describe("nextCommunityPollDelayMs (รายงานจากประชาชน — ข้อจำกัดต้นทุนของ PR A)", () => {
  it("รอบปกติ 2 นาที ไม่ถี่กว่านั้น; retry ไม่ถี่กว่า 60 วิ", () => {
    expect(COMMUNITY_INTERVAL_MS).toBeGreaterThanOrEqual(120_000);
    expect(COMMUNITY_RETRY_MS).toBeGreaterThanOrEqual(60_000);
    expect(nextCommunityPollDelayMs({ ...base, lastSuccessAtMs: NOW })).toBe(COMMUNITY_INTERVAL_MS);
    expect(nextCommunityPollDelayMs({ ...base, lastSuccessAtMs: NOW, lastWasError: true })).toBe(COMMUNITY_RETRY_MS);
  });
  it("ยังไม่เคยสำเร็จ = ยิงทันที; กลับมาเห็นแท็บหลังเกินรอบ = ยิงทันที; ส่วนที่เหลือของรอบถูกเคารพ", () => {
    expect(nextCommunityPollDelayMs({ ...base, lastSuccessAtMs: null })).toBe(0);
    expect(nextCommunityPollDelayMs({ ...base, lastSuccessAtMs: NOW - 10 * 60_000 })).toBe(0);
    expect(nextCommunityPollDelayMs({ ...base, lastSuccessAtMs: NOW - 30_000 })).toBe(90_000);
  });
  it("แท็บซ่อน = ไม่ตั้ง timer", () => {
    expect(nextCommunityPollDelayMs({ ...base, hidden: true, lastSuccessAtMs: null })).toBeNull();
  });
});

describe("nextForecastPollDelayMs (ผลลัพธ์แบบจำลองพยากรณ์ของ HII)", () => {
  it("รอบปกติ 15 นาที นับจากความสำเร็จล่าสุด และไม่เปลี่ยนตาม panelOpen", () => {
    expect(FORECAST_INTERVAL_MS).toBe(900_000);
    expect(nextForecastPollDelayMs({ ...base, lastSuccessAtMs: NOW, panelOpen: true })).toBe(900_000);
    expect(nextForecastPollDelayMs({ ...base, lastSuccessAtMs: NOW, panelOpen: false })).toBe(900_000);
    expect(nextForecastPollDelayMs({ ...base, lastSuccessAtMs: NOW - 300_000, panelOpen: true })).toBe(600_000);
  });

  it("ยังไม่เคยสำเร็จ → ยิงทันที; เกินรอบแล้ว → ยิงทันที", () => {
    expect(nextForecastPollDelayMs({ ...base, lastSuccessAtMs: null, panelOpen: true })).toBe(0);
    expect(nextForecastPollDelayMs({ ...base, lastSuccessAtMs: NOW - 900_000, panelOpen: true })).toBe(0);
    expect(nextForecastPollDelayMs({ ...base, lastSuccessAtMs: NOW - 5_000_000, panelOpen: true })).toBe(0);
  });

  it("แท็บซ่อน → null (ไม่ตั้ง timer) ไม่ว่าสถานะอื่นเป็นอย่างไร", () => {
    expect(nextForecastPollDelayMs({ ...base, hidden: true, lastSuccessAtMs: null, panelOpen: true })).toBeNull();
    expect(nextForecastPollDelayMs({ ...base, hidden: true, lastSuccessAtMs: NOW, lastWasError: true })).toBeNull();
  });

  it("รอบล้มเหลว → 120 วิ (ไม่ถี่กว่า และไม่ใช่ 15 นาที)", () => {
    expect(FORECAST_RETRY_MS).toBe(120_000);
    expect(nextForecastPollDelayMs({ ...base, lastSuccessAtMs: NOW - 3_600_000, lastWasError: true, panelOpen: true })).toBe(120_000);
    expect(nextForecastPollDelayMs({ ...base, lastSuccessAtMs: null, lastWasError: true, panelOpen: true })).toBe(120_000);
  });
});

describe("nextBasinsPollDelayMs (มุมมองตามลุ่มน้ำ, devops C13)", () => {
  it("รอบปกติ 10 นาที นับจากความสำเร็จล่าสุด และไม่เปลี่ยนตาม panelOpen", () => {
    expect(BASINS_INTERVAL_MS).toBe(600_000);
    expect(nextBasinsPollDelayMs({ ...base, lastSuccessAtMs: NOW, panelOpen: true })).toBe(600_000);
    expect(nextBasinsPollDelayMs({ ...base, lastSuccessAtMs: NOW, panelOpen: false })).toBe(600_000);
    expect(nextBasinsPollDelayMs({ ...base, lastSuccessAtMs: NOW - 200_000, panelOpen: true })).toBe(400_000);
  });

  it("ล้มเหลวรอ 120 วิ", () => {
    expect(BASINS_RETRY_MS).toBe(120_000);
    expect(nextBasinsPollDelayMs({ ...base, lastSuccessAtMs: NOW, lastWasError: true })).toBe(120_000);
    expect(nextBasinsPollDelayMs({ ...base, lastSuccessAtMs: null, lastWasError: true })).toBe(120_000);
  });

  it("ยังไม่เคยสำเร็จ / เกินรอบแล้ว → ยิงทันที", () => {
    expect(nextBasinsPollDelayMs({ ...base, lastSuccessAtMs: null })).toBe(0);
    expect(nextBasinsPollDelayMs({ ...base, lastSuccessAtMs: NOW - 600_000 })).toBe(0);
  });

  it("แท็บซ่อน → null (ไม่ตั้ง timer) ไม่ว่าสถานะอื่นเป็นอย่างไร", () => {
    expect(nextBasinsPollDelayMs({ ...base, hidden: true, lastSuccessAtMs: null, panelOpen: true })).toBeNull();
    expect(nextBasinsPollDelayMs({ ...base, hidden: true, lastSuccessAtMs: NOW, lastWasError: true })).toBeNull();
  });
});
