import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ERROR_BODY_PEEK_MAX,
  UpstreamHttpError,
  UpstreamNetworkError,
  allowedHeaders,
  fullReason,
  sanitizeSnippet,
  shortReason,
  upstreamHttpError,
} from "../src/ingestion/errors";
import rainFixture from "./fixtures/thaiwater-rain24h.json";
import { fetchDams, fetchRainfall, fetchWaterLevel, fetchWaterLevelHistory } from "../src/ingestion/thaiwater";

/**
 * ThaiWater ตอบ 429 โดยข้อความ error เดิมมีแค่ "429 Too Many Requests" — ทางวินิจฉัยต้องบอก Retry-After, snippet ของ body
 * และ header ที่เกี่ยวข้อง โดย (1) อ่าน body ไม่เกิน 2 KiB แล้ว cancel (2) ไม่หลุด header ลับ (3) ข้อความขึ้นต้นด้วย
 * status เสมอเพราะ `lastError` ตัดจากท้าย
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** สตรีม byte ขนาด `total` ที่นับไบต์ที่ผู้อ่านดึงไปจริง (BYOB หรือ chunk ปกติ) และจำว่าถูก cancel หรือไม่ */
function countingBody(total: number, chunk = 512): { body: ReadableStream<Uint8Array>; pulled: () => number; cancelled: () => boolean } {
  let pulled = 0;
  let cancelled = false;
  // ชนิด `type: "bytes"` ไม่อยู่ใน lib ของ workers-types ที่ tsconfig ของเทสใช้ — cast ผ่าน unknown
  const source = {
    type: "bytes",
    pull(controller: ReadableByteStreamController) {
      const req = controller.byobRequest;
      if (req && req.view) {
        const view = req.view as Uint8Array;
        const n = Math.min(view.byteLength, total - pulled);
        if (n <= 0) {
          controller.close();
          req.respond(0);
          return;
        }
        view.fill(65, 0, n);
        pulled += n;
        req.respond(n);
        return;
      }
      const n = Math.min(chunk, total - pulled);
      if (n <= 0) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(n).fill(65));
      pulled += n;
    },
    cancel() {
      cancelled = true;
    },
  };
  const body = new ReadableStream<Uint8Array>(source as unknown as UnderlyingSource<Uint8Array>);
  return { body, pulled: () => pulled, cancelled: () => cancelled };
}

describe("upstreamHttpError — อ่าน body เฉพาะทางล้มเหลวและไม่เกินเพดาน", () => {
  it("body > 1 MiB: ไบต์ที่ดึงจริงไม่เกิน 2 KiB (+ highWaterMark ของสตรีม) และสตรีมถูก cancel — ไม่ buffer ทั้งก้อน", async () => {
    const src = countingBody(5 * 1024 * 1024, 512);
    const res = new Response(src.body, { status: 429, headers: { "retry-after": "120" } });
    const err = await upstreamHttpError("ThaiWater rain_24h", res);
    // สตรีมอาจ pre-fetch ตาม highWaterMark ของมันเอง (ไม่ใช่ตัวผู้อ่านของเรา) แต่ต้องอยู่ห่างจาก 5 MiB มาก
    expect(src.pulled()).toBeLessThanOrEqual(ERROR_BODY_PEEK_MAX + 64 * 1024);
    expect(src.pulled()).toBeLessThan(1024 * 1024);
    expect(src.cancelled()).toBe(true);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(120_000);
  });

  it("ผู้อ่านของเราเองไม่ดึงเกินเพดาน: body ที่ enqueue ทีละ 512 B ถูกอ่านไม่เกิน 2 KiB จริง ๆ", async () => {
    let enqueued = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array(512).fill(66));
          enqueued += 512;
        },
      },
      { highWaterMark: 0 }, // ไม่ pre-fetch: pull เกิดตามที่ผู้อ่านขอเท่านั้น
    );
    const err = await upstreamHttpError("ThaiWater rain_24h", new Response(body, { status: 429 }));
    expect(enqueued).toBeLessThanOrEqual(ERROR_BODY_PEEK_MAX);
    expect(err.message).toContain("B".repeat(50));
  });

  it("body เป็น null (เช่น 429 ไม่มี body) ไม่โยน และยังมีส่วนหัวของข้อความครบ", async () => {
    const res = new Response(null, { status: 429, headers: { "retry-after": "30" } });
    expect(res.body).toBeNull();
    const err = await upstreamHttpError("ThaiWater waterlevel_load", res);
    expect(err.message).toBe("ThaiWater waterlevel_load failed: 429 retry-after=30");
    expect(err.retryAfterMs).toBe(30_000);
  });

  it("ไม่มี Retry-After → retry-after=none และ retryAfterMs = null", async () => {
    const err = await upstreamHttpError("ThaiWater rain_24h", new Response("", { status: 503 }));
    expect(err.message.startsWith("ThaiWater rain_24h failed: 503 retry-after=none")).toBe(true);
    expect(err.retryAfterMs).toBeNull();
  });

  it("snippet: ตัด tag / control char / ช่องว่างซ้ำ และไม่เกิน 200 ตัวอักษร; ข้อความยาวรวม ≤ 300", async () => {
    const html = `<html><head><title>Blocked</title></head><body>\u0000\u0007<h1>Too   Many\n\nRequests</h1>${"x".repeat(1500)}</body></html>`;
    const err = await upstreamHttpError("ThaiWater rain_24h", new Response(html, { status: 429 }));
    expect(err.message).not.toMatch(/[<>\u0000-\u001f]/);
    expect(err.message).toContain("Blocked Too Many Requests");
    expect(err.message.length).toBeLessThanOrEqual(300);
    expect(sanitizeSnippet("a".repeat(500)).length).toBe(200);
    expect(sanitizeSnippet("<b>ok</b> trailing <div cla")).toBe("ok trailing");
  });

  it("header: allowlist เท่านั้น (ไม่มี set-cookie / authorization) และค่าถูกตัดที่ 64 ตัวอักษร", async () => {
    const res = new Response("slow down", {
      status: 429,
      headers: {
        "retry-after": "90",
        server: "cloudflare",
        via: "1.1 varnish",
        "cf-ray": "abc123-BKK",
        "content-type": "text/html",
        "x-ratelimit-remaining": "0",
        "x-rate-limit-reset": "17",
        "x-request-id": "not-allowed",
        "set-cookie": "session=SECRET",
        authorization: "Bearer SECRET",
        "x-long": "n",
      },
    });
    res.headers.append("x-ratelimit-limit", "y".repeat(200));
    const headers = allowedHeaders(res.headers);
    expect(Object.keys(headers).sort()).toEqual(
      ["cf-ray", "content-type", "retry-after", "server", "via", "x-rate-limit-reset", "x-ratelimit-limit", "x-ratelimit-remaining"].sort(),
    );
    expect(headers["x-ratelimit-limit"]!.length).toBeLessThanOrEqual(64);
    const err = await upstreamHttpError("ThaiWater rain_24h", res);
    expect(JSON.stringify(err.headers)).not.toMatch(/SECRET|session|Bearer/);
    expect(err.message).not.toMatch(/SECRET|session|Bearer/);
    // ท้ายข้อความ: snippet ก่อน แล้วค่อยเป็น header
    expect(err.message.indexOf("slow down")).toBeLessThan(err.message.indexOf("server=cloudflare"));
  });

  it("สองฟีดล้ม 429 พร้อม snippet 200 ตัวอักษร: lastError (สั้น ≤ 95 ต่อฟีด) ยังเห็น status ของทั้งสอง ใน 200 ตัวอักษร", async () => {
    const body = "z".repeat(400);
    const a = await upstreamHttpError("ThaiWater rain_24h", new Response(body, { status: 429, headers: { "retry-after": "120" } }));
    const b = await upstreamHttpError("ThaiWater waterlevel_load", new Response(body, { status: 429 }));
    const lastError = [shortReason(a), shortReason(b)].join("; ").slice(0, 200);
    expect(shortReason(a).length).toBeLessThanOrEqual(95);
    expect(shortReason(b).length).toBeLessThanOrEqual(95);
    expect(lastError).toContain("rain_24h failed: 429 retry-after=120");
    expect(lastError).toContain("waterlevel_load failed: 429 retry-after=none");
    // ฟีดของตัวเองเก็บข้อความเต็ม (≤ 300) ที่มี snippet
    expect(fullReason(a).length).toBeLessThanOrEqual(300);
    expect(fullReason(a)).toContain("zzzz");
  });

  it("NetworkError: ข้อความสั้นก็ขึ้นต้นด้วย path", () => {
    const e = new UpstreamNetworkError("ThaiWater rain_24h failed: network error: Network connection lost");
    expect(shortReason(e)).toContain("rain_24h failed: network error");
  });
});

describe("fetchers ของ ThaiWater โยน error ที่มีชนิด (ทั้งสี่ตัวใช้ helper เดียวกัน)", () => {
  const cases: [string, () => Promise<unknown>, string][] = [
    ["rain_24h", () => fetchRainfall(), "ThaiWater rain_24h failed: 429 retry-after=45"],
    ["waterlevel_load", () => fetchWaterLevel(), "ThaiWater waterlevel_load failed: 429 retry-after=45"],
    ["waterlevel_graph", () => fetchWaterLevelHistory(1234, 72), "ThaiWater waterlevel_graph 1234 failed: 429 retry-after=45"],
    ["analyst/dam", () => fetchDams(), "ThaiWater analyst/dam failed: 429 retry-after=45"],
  ];

  it.each(cases)("%s: 429 → UpstreamHttpError(status, retryAfterMs) และอ่าน body ไม่เกินเพดาน", async (_name, call, head) => {
    const src = countingBody(6 * 1024 * 1024);
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(src.body, { status: 429, statusText: "Too Many Requests", headers: { "retry-after": "45" } }),
    );
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamHttpError);
    expect((err as UpstreamHttpError).status).toBe(429);
    expect((err as UpstreamHttpError).retryAfterMs).toBe(45_000);
    expect((err as UpstreamHttpError).message.startsWith(head)).toBe(true);
    expect(src.pulled()).toBeLessThan(1024 * 1024);
    expect(src.cancelled()).toBe(true);
  });

  it.each(cases)("%s: fetch() ที่โยนเอง → UpstreamNetworkError (จำแนกจากชนิด ไม่ใช่ regex บนข้อความ)", async (_name, call, head) => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Network connection lost."));
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamNetworkError);
    expect((err as Error).message.startsWith(head.split(" failed:")[0] + " failed: network error")).toBe(true);
  });

  it("ทางสำเร็จไม่ผ่านตัวอ่านวินิจฉัย: 200 ไม่ถูกอ่านซ้ำ (parse ปกติ)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(rainFixture), { status: 200 }));
    await expect(fetchRainfall()).resolves.toHaveLength(1);
  });
});
