import { describe, expect, it } from "vitest";
import { offersBackToLive, timeChipState, type TimeChipObservations } from "./timeChip";

const OK: TimeChipObservations = {
  hasData: true,
  loading: false,
  failed: false,
  fetchedAt: "2026-09-27T07:25:00.000Z",
  latestObservedAt: "2026-09-27T07:20:00.000Z",
};

describe("timeChipState — สามสถานะแยกกันเด็ดขาด", () => {
  it("atIso → ย้อนหลัง (ชนะ forecastAtIso ตามกติกา permalink)", () => {
    expect(timeChipState("2026-09-20T00:00:00.000Z", null, OK)).toEqual({
      kind: "historical",
      iso: "2026-09-20T00:00:00.000Z",
    });
    expect(timeChipState("2026-09-20T00:00:00.000Z", "2026-09-28T00:00:00Z", OK).kind).toBe("historical");
  });

  it("forecastAtIso → ขั้นของแบบจำลอง TMD", () => {
    expect(timeChipState(null, "2026-09-28T00:00:00Z", OK)).toEqual({ kind: "forecast", iso: "2026-09-28T00:00:00Z" });
  });

  it("live → เวลาตรวจวัดล่าสุด (latestObservedAt) ไม่ใช่ fetchedAt", () => {
    expect(timeChipState(null, null, OK)).toEqual({ kind: "live", status: "time", iso: OK.latestObservedAt });
  });

  it("offersBackToLive เฉพาะเมื่อไม่ใช่ live", () => {
    expect(offersBackToLive(timeChipState(null, null, OK))).toBe(false);
    expect(offersBackToLive(timeChipState("2026-09-20T00:00:00.000Z", null, OK))).toBe(true);
    expect(offersBackToLive(timeChipState(null, "2026-09-28T00:00:00Z", OK))).toBe(true);
  });
});

describe("timeChipState — live ไม่มีวันแสดงเวลาที่ไม่มีจริง", () => {
  it("fetchedAt null → never (ยังไม่เคยได้รับข้อมูล) ไม่ใช่เวลา", () => {
    const s = timeChipState(null, null, { ...OK, fetchedAt: null });
    expect(s).toEqual({ kind: "live", status: "never", iso: null });
  });

  it("fetchedAt มีแต่ latestObservedAt null → ไม่แทนด้วย fetchedAt", () => {
    const s = timeChipState(null, null, { ...OK, latestObservedAt: null });
    expect(s).toEqual({ kind: "live", status: "noObservationTime", iso: null });
  });

  it("กำลังโหลด (เช่นเพิ่งกลับจากย้อนหลัง — ข้อมูลในมืออาจเป็นเฟรมเก่า) → loading ไม่ใช่เวลาของเฟรมนั้น", () => {
    expect(timeChipState(null, null, { ...OK, loading: true })).toEqual({ kind: "live", status: "loading", iso: null });
  });

  it("คำขอล้มเหลว → failed; ยังไม่มีคำตอบเลย → loading (ไม่ใช่ never)", () => {
    expect(timeChipState(null, null, { ...OK, failed: true })).toEqual({ kind: "live", status: "failed", iso: null });
    expect(
      timeChipState(null, null, { hasData: false, loading: false, failed: false, fetchedAt: null, latestObservedAt: null }),
    ).toEqual({ kind: "live", status: "loading", iso: null });
  });
});
