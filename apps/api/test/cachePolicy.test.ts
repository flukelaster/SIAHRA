import { createExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import * as cachePolicy from "../src/cachePolicy";
import { createRouter, json, type Route } from "../src/router";
import type { AppEnv } from "../src/types";

/**
 * เทสของโมดูลนโยบายแคช (E4.6) — สองข้อที่เป็นหัวใจ:
 * 1. คำตอบที่ผิดพลาด (4xx/5xx) ต้องเป็น `no-store` เสมอ แม้ route จะขอนโยบายอื่น
 *    ไม่อย่างนั้น 503 ตอนต้นทางล่มจะถูก CDN แจกต่อจนต้นทางกลับมาแล้วผู้ใช้ยังเห็นล่ม
 * 2. `frozenArtifact` (immutable หนึ่งปี) ต้องรับเฉพาะคีย์ที่ content-addressed
 *    เพราะถ้าติด immutable ให้คีย์ที่เขียนทับได้ ผู้ใช้จะค้างกับของเก่าทั้งปี
 */
const testEnv = { ALLOWED_ORIGINS: "" } as unknown as AppEnv;

function call(routes: Route[], url: string, init: RequestInit = {}) {
  return createRouter(routes)(new Request(url, init), testEnv, createExecutionContext());
}

const route = (pattern: RegExp, handler: Route["handler"]): Route => ({ method: "GET", pattern, handler });

describe("json() + นโยบายแคช", () => {
  it("observations ไม่มี stale-while-revalidate (หน้าเว็บอ่านอายุจาก fetchedAt ในตัว payload)", () => {
    expect(cachePolicy.observations.value).toBe("public, max-age=60, s-maxage=120");
  });

  it("ใช้ค่าจากนโยบายที่ระบุ", async () => {
    const res = await call([route(/^\/t\/ok$/, () => json({ ok: true }, { cache: cachePolicy.health }))], "https://siahra-radar.co/t/ok");
    expect(res.headers.get("cache-control")).toBe("public, max-age=15");
  });

  it("ไม่ระบุนโยบาย = no-store", async () => {
    const res = await call([route(/^\/t\/plain$/, () => json({ ok: true }))], "https://siahra-radar.co/t/plain");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it.each([400, 404, 429, 500, 503])("บังคับ no-store ที่สถานะ %i แม้ route ขอแคชมา", async (status) => {
    const res = await call(
      [route(/^\/t\/err$/, () => json({ error: "x" }, { status, cache: cachePolicy.archivedSnapshot }))],
      "https://siahra-radar.co/t/err",
    );
    expect(res.status).toBe(status);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("404 และ 405 ของ router เองก็เป็น no-store", async () => {
    const routes = [route(/^\/t\/known$/, () => json({ ok: true }, { cache: cachePolicy.health }))];
    const notFound = await call(routes, "https://siahra-radar.co/t/nope");
    const wrongMethod = await call(routes, "https://siahra-radar.co/t/known", { method: "POST" });
    expect(notFound.headers.get("cache-control")).toBe("no-store");
    expect(wrongMethod.headers.get("cache-control")).toBe("no-store");
  });
});

describe("floodExtent", () => {
  it("แคชได้เมื่อเคยดึงสำเร็จ", () => {
    expect(cachePolicy.floodExtent("2026-08-19T00:00:00.000Z").value).toBe("public, max-age=300, s-maxage=600");
  });

  it("ยังไม่เคยดึงสำเร็จ = no-store (ห้ามให้ 'ต้นทางไม่ตอบสนอง' ค้างในแคช)", () => {
    expect(cachePolicy.floodExtent(null)).toBe(cachePolicy.noStore);
  });
});

describe("frozenArtifact", () => {
  it.each([
    "exposure/runs/9f2c1ab34de56780.json",
    "exposure/runs/9f2c1ab3-4de5-6789-abcd-ef0123456789.json", // UUID-shaped runId
    "exposure/runs/run-9f2c1ab34de56780.json", // มีคำนำหน้า
    // รูปคีย์จริงของ E10.3: `{runId}.json.gz` (ไบต์ที่เก็บเป็น gzip)
    "exposure/runs/20260819T090000Z-9f2c1ab34de56780.json.gz",
  ])("รับคีย์ที่มี hash อยู่ในคีย์: %s", (key) => {
    expect(cachePolicy.frozenArtifact(key).value).toBe("public, max-age=31536000, immutable");
  });

  it.each([
    "exposure/runs/latest.json",
    "exposure/runs/2026-08-19.json",
    "aoi/10/terrain/0/0_0.bin",
    "9f2c1ab3.json", // hex สั้นเกินไปที่จะเป็น content address
  ])("ปฏิเสธคีย์ที่เขียนทับได้: %s", (key) => {
    expect(() => cachePolicy.frozenArtifact(key)).toThrow(/content-addressed/);
  });
});
