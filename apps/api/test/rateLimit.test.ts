import { describe, expect, it } from "vitest";
import { checkLimit, originAllowed } from "../src/rateLimit";

/**
 * ถังโทเคนเก็บไว้ที่ module scope และไม่มีทางรีเซ็ต (ตั้งใจ — มันคือ state
 * ของ isolate จริง) เทสแต่ละเคสจึงต้องใช้คู่ scope:key ของตัวเอง และส่ง `now`
 * เข้าไปเองทุกครั้ง ไม่พึ่ง Date.now()
 */
const T0 = Date.UTC(2026, 7, 18, 12, 0, 0);

describe("checkLimit", () => {
  it("allows a full bucket then refuses when it runs dry", () => {
    const limit = { perMinute: 10, burst: 0 }; // capacity = 10
    for (let i = 0; i < 10; i++) {
      expect(checkLimit("t-drain", "a", limit, T0)).toBeNull();
    }
    expect(checkLimit("t-drain", "a", limit, T0)).toBeGreaterThan(0);
  });

  it("defaults burst to half the sustained rate", () => {
    const limit = { perMinute: 10 }; // capacity = 10 + ceil(5) = 15
    for (let i = 0; i < 15; i++) {
      expect(checkLimit("t-burst", "a", limit, T0)).toBeNull();
    }
    expect(checkLimit("t-burst", "a", limit, T0)).not.toBeNull();
  });

  it("refills at perMinute/60000 tokens per ms", () => {
    const limit = { perMinute: 60, burst: 0 }; // 1 token per 1000 ms
    for (let i = 0; i < 60; i++) checkLimit("t-refill", "a", limit, T0);
    expect(checkLimit("t-refill", "a", limit, T0)).not.toBeNull();
    // 999 ms ยังไม่ครบหนึ่งโทเคน
    expect(checkLimit("t-refill", "a", limit, T0 + 999)).not.toBeNull();
    // ผ่านไปครบวินาที โทเคนที่เติมกลับมาพอให้ผ่าน
    expect(checkLimit("t-refill", "a", limit, T0 + 3000)).toBeNull();
  });

  it("never refills above capacity", () => {
    const limit = { perMinute: 10, burst: 0 };
    checkLimit("t-cap", "a", limit, T0);
    // ปล่อยว่างหนึ่งชั่วโมง — ยังเบิกได้แค่ capacity ครั้ง ไม่ใช่ 600
    for (let i = 0; i < 10; i++) {
      expect(checkLimit("t-cap", "a", limit, T0 + 3600000)).toBeNull();
    }
    expect(checkLimit("t-cap", "a", limit, T0 + 3600000)).not.toBeNull();
  });

  it("keeps one client's bucket separate from another's", () => {
    const limit = { perMinute: 5, burst: 0 };
    for (let i = 0; i < 5; i++) checkLimit("t-split", "a", limit, T0);
    expect(checkLimit("t-split", "a", limit, T0)).not.toBeNull();
    expect(checkLimit("t-split", "b", limit, T0)).toBeNull();
  });

  it("returns retryAfter in whole seconds, scaled to how slow the refill is", () => {
    const slow = { perMinute: 6, burst: 0 }; // 1 token per 10 s
    for (let i = 0; i < 6; i++) expect(checkLimit("t-retry", "a", slow, T0)).toBeNull();

    const dry = checkLimit("t-retry", "a", slow, T0);
    expect(dry).toBe(10); // ขาดเต็มโทเคน = 10 วินาที
    expect(Number.isInteger(dry)).toBe(true);

    // ครึ่งทาง (5 s) เหลือหนี้ครึ่งโทเคน → 5 วินาที
    expect(checkLimit("t-retry", "a", slow, T0 + 5000)).toBe(5);

    // คำขอที่ถูกปฏิเสธไม่หักโทเคนเพิ่ม — ยิงซ้ำที่เวลาเดิมได้คำตอบเดิม
    expect(checkLimit("t-retry", "a", slow, T0 + 5000)).toBe(5);
  });

  it("still asks for a whole second when the refill is sub-second", () => {
    const limit = { perMinute: 6000, burst: 0 }; // 100 tokens/s = 10 ms per token
    for (let i = 0; i < 6000; i++) checkLimit("t-floor", "a", limit, T0);
    expect(checkLimit("t-floor", "a", limit, T0)).toBe(1);
  });
});

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe("originAllowed", () => {
  const url = "https://siahra-radar.co/api/v1/health";

  it("allows a request with no Origin and no Sec-Fetch-Site (curl, server-side)", () => {
    expect(originAllowed(req(url), "")).toBe(true);
  });

  it("allows same-origin and navigation fetches without an Origin", () => {
    expect(originAllowed(req(url, { "Sec-Fetch-Site": "same-origin" }), "")).toBe(true);
    expect(originAllowed(req(url, { "Sec-Fetch-Site": "none" }), "")).toBe(true);
  });

  it("refuses a cross-site fetch that stripped its Origin", () => {
    expect(originAllowed(req(url, { "Sec-Fetch-Site": "cross-site" }), "")).toBe(false);
  });

  it("allows an Origin on our own host", () => {
    expect(originAllowed(req(url, { Origin: "https://siahra-radar.co" }), "")).toBe(true);
  });

  it("refuses a third-party Origin", () => {
    expect(originAllowed(req(url, { Origin: "https://evil.example" }), "")).toBe(false);
  });

  it("refuses a look-alike host", () => {
    expect(originAllowed(req(url, { Origin: "https://siahra-radar.co.evil.example" }), "")).toBe(false);
  });

  it("allows an origin listed in ALLOWED_ORIGINS, ignoring whitespace and blanks", () => {
    const allow = " https://partner.example , ,https://other.example ";
    expect(originAllowed(req(url, { Origin: "https://partner.example" }), allow)).toBe(true);
    expect(originAllowed(req(url, { Origin: "https://other.example" }), allow)).toBe(true);
    expect(originAllowed(req(url, { Origin: "https://nope.example" }), allow)).toBe(false);
  });

  it("matches ALLOWED_ORIGINS by full origin, so a different scheme or port is refused", () => {
    const allow = "https://partner.example";
    expect(originAllowed(req(url, { Origin: "http://partner.example" }), allow)).toBe(false);
    expect(originAllowed(req(url, { Origin: "https://partner.example:8443" }), allow)).toBe(false);
  });

  it("accepts the X-Forwarded-Host the Vite dev proxy sets", () => {
    const r = req("http://127.0.0.1:8787/api/v1/health", {
      Origin: "http://localhost:5173",
      "X-Forwarded-Host": "localhost:5173",
    });
    expect(originAllowed(r, "")).toBe(true);
  });

  it("pairs any loopback origin with a loopback worker host", () => {
    const r = req("http://127.0.0.1:8787/api/v1/health", { Origin: "http://localhost:5175" });
    expect(originAllowed(r, "")).toBe(true);
  });

  it("does not pair a loopback origin with a public worker host", () => {
    expect(originAllowed(req(url, { Origin: "http://localhost:5173" }), "")).toBe(false);
  });

  it("refuses an unparseable Origin", () => {
    expect(originAllowed(req(url, { Origin: "not a url" }), "")).toBe(false);
  });

  it("refuses the opaque Origin: null", () => {
    expect(originAllowed(req(url, { Origin: "null" }), "")).toBe(false);
  });
});
