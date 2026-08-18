import { describe, expect, it } from "vitest";
import {
  NEVER_RECEIVED_TH,
  formatAge,
  formatDateTime,
  formatFetchedAt,
  formatFetchedAtWithAge,
  formatFullDateTime,
  formatTime,
} from "./time";

// 2026-08-18T00:30:00Z = 07:30 น. ตามเวลาไทย (UTC+7) — ต่างวันกันด้วยถ้าอยู่โซนอื่น
const ISO = "2026-08-18T00:30:00.000Z";

describe("formatters pinned to Asia/Bangkok", () => {
  it("renders the Bangkok hour regardless of the machine timezone", () => {
    expect(formatTime(ISO)).toBe("07:30");
    expect(formatDateTime(ISO)).toContain("07:30");
    expect(formatFullDateTime(ISO)).toContain("07:30");
  });

  it("crosses the date boundary in Bangkok, not in UTC", () => {
    // 17:30Z ของวันที่ 17 = 00:30 น. ของวันที่ 18 ตามเวลาไทย
    expect(formatDateTime("2026-08-17T17:30:00.000Z")).toContain("18");
    expect(formatTime("2026-08-17T17:30:00.000Z")).toBe("00:30");
  });

  it("returns a placeholder instead of throwing on an unparsable stamp", () => {
    expect(formatTime("not-a-date")).toBe("—");
    expect(formatFetchedAt("not-a-date")).toBe(NEVER_RECEIVED_TH);
  });
});

describe("formatFetchedAt(null) never renders a time", () => {
  it("returns the 'never received' string for null", () => {
    expect(formatFetchedAt(null)).toBe(NEVER_RECEIVED_TH);
    expect(formatFetchedAtWithAge(null)).toBe(NEVER_RECEIVED_TH);
  });

  it("contains no digit at all, so it can never read as a clock time", () => {
    expect(formatFetchedAt(null)).not.toMatch(/[0-9๐-๙]/);
  });

  it("does not say 'เมื่อสักครู่' — that would claim a fetch just succeeded", () => {
    expect(formatAge(null)).toBe(NEVER_RECEIVED_TH);
    expect(formatAge(null)).not.toContain("เมื่อสักครู่");
  });
});

describe("formatAge", () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");
  it("buckets the age from minutes to days", () => {
    expect(formatAge("2026-08-18T11:59:30.000Z", now)).toBe("เมื่อสักครู่");
    expect(formatAge("2026-08-18T11:48:00.000Z", now)).toBe("12 นาทีที่แล้ว");
    expect(formatAge("2026-08-18T09:00:00.000Z", now)).toBe("3 ชม.ที่แล้ว");
    expect(formatAge("2026-08-15T12:00:00.000Z", now)).toBe("3 วันที่แล้ว");
  });
});
