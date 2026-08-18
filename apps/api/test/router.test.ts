import { createExecutionContext } from "cloudflare:test";
import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { allowHeader, createRouter, json, type Route } from "../src/router";
import type { AppEnv } from "../src/types";

/**
 * Router-level เทส: จุดสำคัญคือ "เจอ path ก่อน แล้วค่อยเช็ค method" — ถ้ากลับ
 * ลำดับ path ที่รู้จักแต่เรียกผิด method จะตอบ 404 แทน 405 + Allow และลำดับของ
 * same-origin guard กับ rate limit ต้องไม่ขยับ (guard มาก่อนเสมอ, limit นับ
 * เฉพาะคำขอที่จะเข้า handler จริง)
 */
const testEnv = { ALLOWED_ORIGINS: "" } as unknown as AppEnv;

function call(routes: Route[], url: string, init: RequestInit = {}) {
  const route = createRouter(routes);
  return route(new Request(url, init), testEnv, createExecutionContext());
}

/** เรียก entrypoint จริงของ Worker (src/index.ts) ในรันไทม์ workerd */
const workerFetch = (url: string, init: RequestInit = {}) =>
  workerExports.default.fetch(new Request(url, init));

const okRoute = (pattern: RegExp): Route => ({
  method: "GET",
  pattern,
  handler: () => json({ ok: true }, { cacheControl: "public, max-age=15" }),
});

describe("allowHeader", () => {
  it("adds HEAD to a GET route and keeps a stable order", () => {
    expect(allowHeader([okRoute(/^\/a$/)])).toBe("GET, HEAD");
    expect(
      allowHeader([
        { method: "POST", pattern: /^\/a$/, handler: () => json({}) },
        okRoute(/^\/a$/),
      ]),
    ).toBe("GET, HEAD, POST");
  });

  it("never claims HEAD for a POST-only route", () => {
    expect(allowHeader([{ method: "POST", pattern: /^\/a$/, handler: () => json({}) }])).toBe("POST");
  });
});

describe("method guard", () => {
  it("answers 405 with Allow when the path exists but the method does not", async () => {
    const res = await call([okRoute(/^\/t\/405$/)], "https://siahra-radar.co/t/405", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
    await expect(res.json()).resolves.toMatchObject({ allow: "GET, HEAD" });
  });

  it("still answers 404 for a path no route matches", async () => {
    const res = await call([okRoute(/^\/t\/404$/)], "https://siahra-radar.co/t/nope", { method: "POST" });
    expect(res.status).toBe(404);
    expect(res.headers.get("Allow")).toBeNull();
  });

  it("keeps the same-origin guard ahead of everything else", async () => {
    const res = await call([okRoute(/^\/t\/guard$/)], "https://siahra-radar.co/t/guard", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    // 403 ไม่ใช่ 405 — คำขอข้ามโดเมนต้องถูกปฏิเสธก่อนที่ router จะบอกใบ้ว่า
    // path นี้มีอยู่จริงหรือรับ method ไหน
    expect(res.status).toBe(403);
  });
});

describe("HEAD", () => {
  it("returns the GET status and headers with no body", async () => {
    const routes = [okRoute(/^\/t\/head$/)];
    const url = "https://siahra-radar.co/t/head";
    const get = await call(routes, url);
    const head = await call(routes, url, { method: "HEAD" });

    expect(head.status).toBe(get.status);
    expect(head.headers.get("content-type")).toBe(get.headers.get("content-type"));
    expect(head.headers.get("cache-control")).toBe(get.headers.get("cache-control"));
    expect(head.body).toBeNull();
    await expect(head.text()).resolves.toBe("");
    await expect(get.json()).resolves.toEqual({ ok: true });
  });

  it("is dispatched to the GET route, not answered with 405", async () => {
    const res = await call([okRoute(/^\/t\/head2$/)], "https://siahra-radar.co/t/head2", { method: "HEAD" });
    expect(res.status).toBe(200);
  });

  it("strips the body of error responses too", async () => {
    const res = await call([okRoute(/^\/t\/head3$/)], "https://siahra-radar.co/t/missing", { method: "HEAD" });
    expect(res.status).toBe(404);
    expect(res.body).toBeNull();
  });
});

/**
 * ผ่าน Worker จริง เฉพาะเส้นทางที่จบก่อนแตะ Durable Object หรือ upstream — 405
 * ตอบจาก router เอง และ 426 ตอบจาก handler ก่อนเรียก DO
 *
 * ยิงผ่าน `exports.default.fetch()` ของ "cloudflare:workers" ไม่ใช่ `SELF` ของ
 * "cloudflare:test" ซึ่ง deprecated ไปแล้วใน pool 0.22
 */
describe("the deployed route table", () => {
  it("refuses POST /api/v1/health with 405 and Allow: GET, HEAD", async () => {
    const res = await workerFetch("https://example.com/api/v1/health", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
  });

  it("answers 426 on the live earthquake route without an Upgrade header", async () => {
    const res = await workerFetch("https://example.com/api/v1/earthquakes/live");
    expect(res.status).toBe(426);
  });

  it("answers 405, not 426, when that route is called with the wrong method", async () => {
    const res = await workerFetch("https://example.com/api/v1/earthquakes/live", { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
  });
});
