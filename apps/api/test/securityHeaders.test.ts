import { createExecutionContext } from "cloudflare:test";
import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import * as cachePolicy from "../src/cachePolicy";
import { createRouter, json, type Route } from "../src/router";
import { SECURITY_HEADERS, withSecurityHeaders } from "../src/securityHeaders";
import type { AppEnv } from "../src/types";

/**
 * เทสเฮดเดอร์ความปลอดภัยของ API (E4.2) — จุดที่ต้องกันไว้คือ "route ใหม่ลืมใส่"
 * จึงยิงผ่าน router จริงแทนที่จะเรียก withSecurityHeaders ตรง ๆ อย่างเดียว
 *
 * HSTS ต้องเป็น `max-age` ล้วน ๆ: includeSubDomains/preload เป็นการตัดสินใจของ
 * เจ้าของ repo ที่ปิดไปแล้ว (docs/roadmap.md §4) การเผลอเติมทีหลังคือ regression
 */
const testEnv = { ALLOWED_ORIGINS: "" } as unknown as AppEnv;

function call(routes: Route[], url: string, init: RequestInit = {}) {
  return createRouter(routes)(new Request(url, init), testEnv, createExecutionContext());
}

const okRoute: Route = {
  method: "GET",
  pattern: /^\/t\/sec$/,
  handler: () => json({ ok: true }, { cache: cachePolicy.health }),
};

describe("SECURITY_HEADERS", () => {
  it("HSTS เป็น max-age เท่านั้น", () => {
    const hsts = SECURITY_HEADERS["Strict-Transport-Security"];
    expect(hsts).toBe("max-age=31536000");
    expect(hsts).not.toMatch(/includeSubDomains|preload/i);
  });

  it("CSP ของ API แคบที่สุด และไม่มี unsafe-*", () => {
    const csp = SECURITY_HEADERS["Content-Security-Policy"];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-(inline|eval)/);
  });
});

describe("ทุกคำตอบที่ออกจาก router", () => {
  it("ได้เฮดเดอร์ครบทุกตัว", async () => {
    const res = await call([okRoute], "https://siahra-radar.co/t/sec");
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers.get(name)).toBe(value);
    }
  });

  it("รวมถึง 404/405/403 ที่ router ตอบเอง", async () => {
    const urls: [string, RequestInit][] = [
      ["https://siahra-radar.co/t/nope", {}],
      ["https://siahra-radar.co/t/sec", { method: "POST" }],
      ["https://siahra-radar.co/t/sec", { headers: { Origin: "https://evil.example" } }],
    ];
    for (const [url, init] of urls) {
      const res = await call([okRoute], url, init);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
    }
  });

  it("HEAD ได้เฮดเดอร์ชุดเดียวกับ GET", async () => {
    const get = await call([okRoute], "https://siahra-radar.co/t/sec");
    const head = await call([okRoute], "https://siahra-radar.co/t/sec", { method: "HEAD" });
    for (const name of Object.keys(SECURITY_HEADERS)) {
      expect(head.headers.get(name)).toBe(get.headers.get(name));
    }
    expect(head.body).toBeNull();
  });

  it("ตารางเส้นทางจริงของ Worker ก็ได้ด้วย", async () => {
    const res = await workerExports.default.fetch(
      new Request("https://example.com/api/v1/health", { method: "POST" }),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});

describe("withSecurityHeaders", () => {
  it("ไม่แตะคำตอบ 101 (WebSocket upgrade สร้างใหม่ไม่ได้)", () => {
    // 101 สร้างได้เฉพาะคู่กับ WebSocket จริงในรันไทม์ workerd
    const pair = new WebSocketPair();
    const upgrade = new Response(null, { status: 101, webSocket: pair[0] });
    expect(withSecurityHeaders(upgrade)).toBe(upgrade);
    expect(withSecurityHeaders(upgrade).webSocket).toBe(pair[0]);
  });

  it("ทับของเดิมแทนที่จะต่อท้าย — CSP ซ้ำสองอันจะถูกเบราว์เซอร์ตัดเป็นส่วนร่วม", () => {
    const res = withSecurityHeaders(
      new Response("x", { headers: { "Content-Security-Policy": "default-src *" } }),
    );
    expect(res.headers.get("Content-Security-Policy")).toBe(SECURITY_HEADERS["Content-Security-Policy"]);
  });

  it("รักษาสถานะ null-body ไว้ได้ (304)", () => {
    const res = withSecurityHeaders(new Response(null, { status: 304 }));
    expect(res.status).toBe(304);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
