import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { translator } from "../../i18n";
import { LanguageContext } from "../../i18n/context";
import { THAIWATER_STALE_AFTER_SECONDS } from "../../lib/thaiwaterFreshness";
import { ApiStatusFooter, isApiDataStale } from "./ApiStatusFooter";

/**
 * แถบสถานะข้อมูลท้ายแผงอ่านงบ "ค้าง" จาก descriptor ของ API (`staleAfterSeconds`) — API ดึงทุก 10 นาที งบคือ 30 นาที
 * ท่อที่ปกติดี (อายุบนจอ ≈ 18 นาที) ต้องไม่ถูกบอกว่าค้าง; ไม่เคยดึง (null) ก็ไม่ใช่ "ค้าง" และไม่ใช่เวลาปัจจุบัน
 */
const NOW = Date.parse("2026-09-29T12:00:00.000Z");
const MIN = 60_000;
const iso = (ageMs: number) => new Date(NOW - ageMs).toISOString();

function render(fetchedAt: string | null, staleAfterSeconds?: number | null): string {
  return renderToStaticMarkup(
    createElement(
      LanguageContext.Provider,
      { value: { lang: "th", setLang: () => {}, t: translator("th") } },
      createElement(ApiStatusFooter, { fetchedAt, attribution: null, staleAfterSeconds }),
    ),
  );
}

describe("isApiDataStale", () => {
  it("งบตั้งต้น 30 นาที: 18 นาที (ท่อที่ปกติดี) และ 30 นาทีพอดี ไม่ค้าง — เกินนั้นค้าง", () => {
    expect(THAIWATER_STALE_AFTER_SECONDS).toBe(30 * 60);
    expect(isApiDataStale(iso(18 * MIN), undefined, NOW)).toBe(false);
    expect(isApiDataStale(iso(30 * MIN), null, NOW)).toBe(false);
    expect(isApiDataStale(iso(30 * MIN + 1), null, NOW)).toBe(true);
  });

  it("ใช้งบจาก descriptor เมื่อมี", () => {
    expect(isApiDataStale(iso(20 * MIN), 900, NOW)).toBe(true);
    expect(isApiDataStale(iso(20 * MIN), 1800, NOW)).toBe(false);
  });

  it("fetchedAt เป็น null / อ่านไม่ได้ = ไม่รู้อายุ ไม่ตัดสินว่าค้าง", () => {
    expect(isApiDataStale(null, 1800, NOW)).toBe(false);
    expect(isApiDataStale("garbage", 1800, NOW)).toBe(false);
  });
});

describe("ApiStatusFooter", () => {
  it("ยังไม่เคยดึง: บอกว่ายังไม่เชื่อมต่อ ไม่ใช่ 'ปกติ' และไม่ใช่เวลาปัจจุบัน", () => {
    const html = render(null, 1800);
    expect(html).toContain(translator("th")("footer.notConnected"));
    expect(html).not.toContain(translator("th")("footer.stale"));
  });

  it("เก่ากว่างบของ descriptor: 'ข้อมูลค้าง' (ยังแสดงเวลาดึง ไม่ซ่อน)", () => {
    const html = render(new Date(Date.now() - 40 * MIN).toISOString(), 1800);
    expect(html).toContain(translator("th")("footer.stale"));
  });

  it("ภายในงบ: ปกติ", () => {
    const html = render(new Date(Date.now() - 20 * MIN).toISOString(), 1800);
    expect(html).toContain(translator("th")("footer.ok"));
    expect(html).not.toContain(translator("th")("footer.stale"));
  });
});
