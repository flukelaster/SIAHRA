import { describe, expect, it } from "vitest";
import {
  neverReceived,
  formatAge,
  formatDateTime,
  formatFetchedAt,
  formatFetchedAtWithAge,
  formatFullDateTime,
  formatTime,
  formatWeekday,
} from "./time";
import { LANGS } from "../i18n";

// 2026-08-18T00:30:00Z = 07:30 น. ตามเวลาไทย (UTC+7) — ต่างวันกันด้วยถ้าอยู่โซนอื่น
const ISO = "2026-08-18T00:30:00.000Z";

describe("formatters pinned to Asia/Bangkok", () => {
  it.each(LANGS)("renders the Bangkok hour regardless of the machine timezone (%s)", (lang) => {
    expect(formatTime(lang, ISO)).toBe("07:30");
    expect(formatDateTime(lang, ISO)).toContain("07:30");
    expect(formatFullDateTime(lang, ISO)).toContain("07:30");
  });

  it.each(LANGS)("crosses the date boundary in Bangkok, not in UTC (%s)", (lang) => {
    // 17:30Z ของวันที่ 17 = 00:30 น. ของวันที่ 18 ตามเวลาไทย
    expect(formatDateTime(lang, "2026-08-17T17:30:00.000Z")).toContain("18");
    expect(formatTime(lang, "2026-08-17T17:30:00.000Z")).toBe("00:30");
  });

  it.each(LANGS)("returns a placeholder instead of throwing on an unparsable stamp (%s)", (lang) => {
    expect(formatTime(lang, "not-a-date")).toBe("—");
    expect(formatFetchedAt(lang, "not-a-date")).toBe(neverReceived(lang));
  });

  // 2026-08-17T17:30Z (จันทร์ตาม UTC) = 2026-08-18 00:30 ตามเวลาไทย ซึ่งเป็นวันอังคาร
  // — กรณีนี้จำเป็นสำหรับแถบพยากรณ์รายวัน (E12.3): ถ้า formatWeekday อ่านวันจาก
  // UTC จะติดป้ายแท่งผิดวันไปหนึ่งวันเต็มโดยไม่มีอาการอื่นใดให้จับผิดได้เลย
  it("formatWeekday crosses the date boundary in Bangkok, not in UTC", () => {
    expect(formatWeekday("en", "2026-08-17T17:30:00.000Z")).toBe("Tue");
    expect(formatWeekday("th", "2026-08-17T17:30:00.000Z")).toBe("อังคาร");
  });

  it.each(LANGS)("formatWeekday returns a placeholder instead of throwing on an unparsable stamp (%s)", (lang) => {
    expect(formatWeekday(lang, "not-a-date")).toBe("—");
  });
});

describe("formatFetchedAt(null) never renders a time", () => {
  it.each(LANGS)("returns the 'never received' string for null (%s)", (lang) => {
    expect(formatFetchedAt(lang, null)).toBe(neverReceived(lang));
    expect(formatFetchedAtWithAge(lang, null)).toBe(neverReceived(lang));
  });

  it.each(LANGS)("contains no digit at all, so it can never read as a clock time (%s)", (lang) => {
    expect(formatFetchedAt(lang, null)).not.toMatch(/[0-9๐-๙]/);
  });

  it.each(LANGS)("never claims a fetch just succeeded (%s)", (lang) => {
    expect(formatAge(lang, null)).toBe(neverReceived(lang));
    expect(formatAge(lang, null)).not.toContain("เมื่อสักครู่");
    expect(formatAge(lang, null)).not.toMatch(/just now/i);
  });

  /** "ไม่มีข้อมูล" / "no data" อ่านได้ว่า "ไม่มีอะไรต้องรายงาน" ซึ่งคนละความหมาย */
  it("says 'never received', not merely 'no data'", () => {
    expect(neverReceived("th")).toBe("ยังไม่เคยได้รับข้อมูล");
    expect(neverReceived("en")).toMatch(/never received/i);
  });
});

describe("formatAge", () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");
  it("buckets the age from minutes to days (th)", () => {
    expect(formatAge("th", "2026-08-18T11:59:30.000Z", now)).toBe("เมื่อสักครู่");
    expect(formatAge("th", "2026-08-18T11:48:00.000Z", now)).toBe("12 นาทีที่แล้ว");
    expect(formatAge("th", "2026-08-18T09:00:00.000Z", now)).toBe("3 ชม.ที่แล้ว");
    expect(formatAge("th", "2026-08-15T12:00:00.000Z", now)).toBe("3 วันที่แล้ว");
  });

  it("buckets the age from minutes to days (en)", () => {
    expect(formatAge("en", "2026-08-18T11:59:30.000Z", now)).toBe("just now");
    expect(formatAge("en", "2026-08-18T11:48:00.000Z", now)).toBe("12 min ago");
    expect(formatAge("en", "2026-08-18T09:00:00.000Z", now)).toBe("3 h ago");
    expect(formatAge("en", "2026-08-15T12:00:00.000Z", now)).toBe("3 d ago");
  });
});
