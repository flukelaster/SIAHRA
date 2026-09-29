import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UpstreamHttpError,
  UpstreamNetworkError,
  UpstreamPausedError,
  UpstreamShapeError,
  isUpstreamOverload,
  parseRetryAfter,
} from "../src/ingestion/errors";
import { UpstreamQueue, type BreakerPersistence } from "../src/upstream/limiter";

/**
 * คิวต้นทางของ ThaiWater: breaker ต่อ endpoint, บันไดพัก 5→10→20→40→60 นาที, probe ตัวเดียว,
 * Retry-After และการ persist — ทั้งหมดใช้นาฬิกาปลอม (ไม่มี sleep) และคิวแบบ minGap 0
 * เพื่อไม่ต้องรอ timer ของ drain
 */

const T0 = Date.parse("2026-09-29T12:00:00.000Z");
const MIN = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

const http = (status: number, retryAfterMs: number | null = null, message = `HTTP ${status}`) =>
  new UpstreamHttpError(message, { status, retryAfterMs });

function memoryStore(): BreakerPersistence & { data: Map<string, string>; writes: string[] } {
  const data = new Map<string, string>();
  const writes: string[] = [];
  return {
    data,
    writes,
    read: (k) => data.get(k) ?? null,
    write: (k, v) => {
      writes.push(k);
      if (v === null) data.delete(k);
      else data.set(k, v);
    },
  };
}

function makeQueue(persist?: BreakerPersistence) {
  return new UpstreamQueue({ concurrency: 3, minGapMs: 0, perMinute: 0, tripAfter: 3, persist });
}

/** รันงานที่ล้มเหลว/สำเร็จแล้วรอให้ผลกลับมา (ไม่ throw) */
async function fail(q: UpstreamQueue, key: string, err: unknown = http(429)): Promise<unknown> {
  return q.run(() => Promise.reject(err), 0, key).catch((e: unknown) => e);
}
const ok = (q: UpstreamQueue, key: string) => q.run(() => Promise.resolve("ok"), 0, key);

async function trip(q: UpstreamQueue, key: string, err: unknown = http(429)): Promise<void> {
  for (let i = 0; i < 3; i++) await fail(q, key, err);
}

describe("บันไดพักของ breaker", () => {
  it("ล้มเหลวสองครั้งยังไม่พัก — ครั้งที่สามพัก 5 นาที (เท่าเดิมของรอบสั้น ๆ ที่ต้นทางสะดุด)", async () => {
    const q = makeQueue();
    await fail(q, "rain_24h");
    await fail(q, "rain_24h");
    expect(q.pausedUntilMs("rain_24h")).toBe(0);
    await fail(q, "rain_24h");
    expect(q.pausedUntilMs("rain_24h")).toBe(T0 + 5 * MIN);
  });

  it("ระหว่างพัก งานถูกปฏิเสธโดยไม่ยิงต้นทาง; probe ที่ล้มไปขั้นถัดไปทันที 5→10→20→40→60→60", async () => {
    const q = makeQueue();
    await trip(q, "rain_24h");
    const fn = vi.fn(() => Promise.resolve("never"));
    const during = await q.run(fn, 0, "rain_24h").catch((e: unknown) => e);
    expect(during).toBeInstanceOf(UpstreamPausedError);
    expect(fn).not.toHaveBeenCalled();

    let expected = 5;
    for (const next of [10, 20, 40, 60, 60]) {
      vi.setSystemTime(q.pausedUntilMs("rain_24h") + 1);
      const probeCalls = vi.fn(() => Promise.reject(http(429)));
      await q.run(probeCalls, 0, "rain_24h").catch(() => undefined);
      // probe ตัวเดียวเท่านั้น และไม่ต้องรอความล้มเหลวสามครั้งอีก
      expect(probeCalls).toHaveBeenCalledTimes(1);
      const pausedFor = q.pausedUntilMs("rain_24h") - Date.now();
      expect(pausedFor, `หลัง ${expected} นาที ต้องขยับไป ${next}`).toBe(next * MIN);
      expected = next;
    }
  });

  it("probe สำเร็จ → กลับ level 0 และต้องล้มสามครั้งอีกถึงจะพักใหม่ (ที่ 5 นาที ไม่ใช่ขั้นเดิม)", async () => {
    const q = makeQueue();
    await trip(q, "rain_24h");
    vi.setSystemTime(T0 + 5 * MIN + 1);
    await expect(ok(q, "rain_24h")).resolves.toBe("ok");
    expect(q.pausedUntilMs("rain_24h")).toBe(0);
    expect(q.snapshot()).toEqual({});
    await fail(q, "rain_24h");
    await fail(q, "rain_24h");
    expect(q.pausedUntilMs("rain_24h")).toBe(0);
    await fail(q, "rain_24h");
    expect(q.pausedUntilMs("rain_24h") - Date.now()).toBe(5 * MIN);
  });

  it("half-open ปล่อย probe ตัวเดียวทั้งคิว — งานอื่นทั้ง key เดียวกันและ key อื่นถูกปฏิเสธระหว่างที่ probe ค้าง", async () => {
    const q = makeQueue();
    await trip(q, "rain_24h");
    await trip(q, "waterlevel_load");
    vi.setSystemTime(T0 + 5 * MIN + 1);

    let release!: () => void;
    const probeFn = vi.fn(() => new Promise<string>((resolve) => (release = () => resolve("ok"))));
    const probe = q.run(probeFn, 0, "rain_24h");
    const second = vi.fn(() => Promise.resolve("no"));
    const third = vi.fn(() => Promise.resolve("no"));
    const r2 = await q.run(second, 0, "rain_24h").catch((e: unknown) => e);
    const r3 = await q.run(third, 0, "waterlevel_load").catch((e: unknown) => e);
    expect(r2).toBeInstanceOf(UpstreamPausedError);
    expect(r3).toBeInstanceOf(UpstreamPausedError);
    expect((r3 as UpstreamPausedError).until).toBe(0); // ไม่ได้พักตามเวลา — มี probe ค้าง
    expect(second).not.toHaveBeenCalled();
    expect(third).not.toHaveBeenCalled();
    expect(probeFn).toHaveBeenCalledTimes(1);
    release();
    await expect(probe).resolves.toBe("ok");
    // probe เสร็จแล้ว ช่องว่าง — key อื่นที่ half-open ได้ probe ของตัวเอง
    await expect(ok(q, "waterlevel_load")).resolves.toBe("ok");
  });

  it("probe ที่ค้างเกินเพดาน (fetch ไม่ตอบ) ไม่ทำให้ half-open ค้างตลอดไป", async () => {
    const q = makeQueue();
    await trip(q, "rain_24h");
    vi.setSystemTime(T0 + 5 * MIN + 1);
    void q.run(() => new Promise<string>(() => undefined), 0, "rain_24h"); // ไม่มีวันจบ
    vi.setSystemTime(T0 + 5 * MIN + 1 + 4 * MIN);
    await expect(ok(q, "rain_24h")).resolves.toBe("ok");
  });

  it("probe เก่าที่ถูกแทนแล้วมาจบทีหลังด้วยความล้มเหลว ไม่เลื่อนบันไดซ้ำและไม่เคลียร์ช่อง probe ของตัวใหม่", async () => {
    const q = makeQueue();
    await trip(q, "rain_24h");
    vi.setSystemTime(T0 + 5 * MIN + 1);
    let failOld!: () => void;
    const oldProbe = q.run(() => new Promise<string>((_, reject) => (failOld = () => reject(http(429)))), 0, "rain_24h");
    void oldProbe.catch(() => undefined);
    // ตัวเก่าค้างเกินเพดาน → probe ตัวใหม่ได้ช่อง แล้วล้ม → ขั้น 2 (10 นาที)
    vi.setSystemTime(T0 + 5 * MIN + 1 + 4 * MIN);
    let releaseNew!: () => void;
    const newProbe = q.run(() => new Promise<string>((_, reject) => (releaseNew = () => reject(http(429)))), 0, "rain_24h");
    void newProbe.catch(() => undefined);
    // ระหว่างที่ probe ตัวใหม่ค้าง ตัวเก่าจบแบบล้ม: ต้องไม่นับเป็น probe (ไม่เลื่อนขั้น) และไม่ปล่อยช่องของตัวใหม่
    failOld();
    await oldProbe.catch(() => undefined);
    const blocked = await q.run(() => Promise.resolve("no"), 0, "rain_24h").catch((e: unknown) => e);
    expect(blocked).toBeInstanceOf(UpstreamPausedError);
    expect((blocked as UpstreamPausedError).until).toBe(0); // ยังมี probe ตัวใหม่ค้างอยู่
    releaseNew();
    await newProbe.catch(() => undefined);
    // เลื่อนขั้นครั้งเดียว: 5 → 10 นาที (ไม่ใช่ 20)
    expect(q.pausedUntilMs("rain_24h") - Date.now()).toBe(10 * MIN);
  });
});

describe("ปิด/เปิดต่อ endpoint — ไม่ใช่ตัวนับรวมทั้งคิว", () => {
  it("สลับ analyst/dam สำเร็จกับ rain_24h 429: บันไดของ rain ยังไต่ต่อ ไม่ถูกความสำเร็จของ dam รีเซ็ต", async () => {
    const q = makeQueue();
    for (let i = 0; i < 3; i++) {
      await fail(q, "rain_24h");
      await expect(ok(q, "analyst/dam")).resolves.toBe("ok");
      await expect(ok(q, "waterlevel_graph")).resolves.toBe("ok");
    }
    expect(q.pausedUntilMs("rain_24h")).toBe(T0 + 5 * MIN);
    // dam ยังยิงได้ตามปกติ
    await expect(ok(q, "analyst/dam")).resolves.toBe("ok");
    expect(q.pausedUntilMs("analyst/dam")).toBe(0);

    // ขั้นถัดไปก็ไต่ต่อแม้ dam สำเร็จคั่น
    vi.setSystemTime(T0 + 5 * MIN + 1);
    await q.run(() => Promise.reject(http(503)), 0, "rain_24h").catch(() => undefined);
    await expect(ok(q, "analyst/dam")).resolves.toBe("ok");
    expect(q.pausedUntilMs("rain_24h") - Date.now()).toBe(10 * MIN);
  });

  it("ความสำเร็จของ rain_24h ปิดเฉพาะ rain_24h — waterlevel_load ที่กำลังพักยังพักอยู่", async () => {
    const q = makeQueue();
    await trip(q, "waterlevel_load");
    await expect(ok(q, "rain_24h")).resolves.toBe("ok");
    expect(q.pausedUntilMs("waterlevel_load")).toBe(T0 + 5 * MIN);
    expect(q.pausedUntilMs("rain_24h")).toBe(0);
    expect(q.pausedUntilMs()).toBe(T0 + 5 * MIN);
  });

  it("allPausedUntilMs: มีค่าก็ต่อเมื่อ *ทุก* key ถูกพัก (รอบ refresh ที่ทำได้บางส่วนไม่ถูกกั้น)", async () => {
    const q = makeQueue();
    const keys = ["rain_24h", "waterlevel_load"];
    expect(q.allPausedUntilMs(keys)).toBe(0);
    await trip(q, "rain_24h");
    expect(q.allPausedUntilMs(keys)).toBe(0);
    vi.setSystemTime(T0 + 30_000);
    await trip(q, "waterlevel_load");
    expect(q.allPausedUntilMs(keys)).toBe(T0 + 5 * MIN); // แรกสุดที่ key ใดจะยิงได้
  });
});

describe("จำแนกความล้มเหลวจากชนิด ไม่ใช่ข้อความ", () => {
  it("403/404 ที่ข้อความมี '503' / 'network' ไม่นับ — 429 ที่ body ว่างนับ", async () => {
    const q = makeQueue();
    for (let i = 0; i < 6; i++) await fail(q, "rain_24h", http(403, null, "ThaiWater rain_24h failed: 403 | HTTP 503 network fetch failed ECONN"));
    for (let i = 0; i < 6; i++) await fail(q, "rain_24h", http(404, null, "timed out 502 504"));
    expect(q.pausedUntilMs("rain_24h")).toBe(0);
    await trip(q, "rain_24h", http(429, null, ""));
    expect(q.pausedUntilMs("rain_24h")).toBe(T0 + 5 * MIN);
  });

  it("isUpstreamOverload: 429/502/503/504 และ UpstreamNetworkError เท่านั้น", () => {
    for (const s of [429, 502, 503, 504]) expect(isUpstreamOverload(http(s))).toBe(true);
    for (const s of [400, 401, 403, 404, 422, 500, 501]) expect(isUpstreamOverload(http(s))).toBe(false);
    expect(isUpstreamOverload(new UpstreamNetworkError("x"))).toBe(true);
    // รูปร่างผิด / error ทั่วไปที่ข้อความบังเอิญมีคำเหล่านั้น ไม่ใช่สัญญาณแออัด
    expect(isUpstreamOverload(new UpstreamShapeError("s", "p", "429 network 503"))).toBe(false);
    expect(isUpstreamOverload(new Error("fetch failed 503"))).toBe(false);
    expect(isUpstreamOverload(new TypeError("network"))).toBe(false);
    expect(isUpstreamOverload("429")).toBe(false);
  });

  it("network error นับเป็น overload และ probe ที่ตอบ 403 (ต้นทางตอบแล้ว) ไม่เลื่อนขั้น", async () => {
    const q = makeQueue();
    await trip(q, "rain_24h", new UpstreamNetworkError("ThaiWater rain_24h failed: network error: boom"));
    expect(q.pausedUntilMs("rain_24h")).toBe(T0 + 5 * MIN);
    vi.setSystemTime(T0 + 5 * MIN + 1);
    await fail(q, "rain_24h", http(403));
    // ยังไม่เลื่อนไป 10 นาที และ probe ถูกคืนช่อง — งานถัดไปได้ probe ใหม่
    expect(q.pausedUntilMs("rain_24h")).toBe(0);
    await expect(ok(q, "rain_24h")).resolves.toBe("ok");
  });
});

describe("Retry-After", () => {
  it("parseRetryAfter: ตัวเลข / HTTP-date / ค่าที่อ่านไม่ออก / เพดาน 60 นาที", () => {
    const now = T0;
    expect(parseRetryAfter("120", now)).toBe(120_000);
    expect(parseRetryAfter("0", now)).toBe(0); // "0" คือค่าจริง (ลองได้เลย) ไม่ใช่ไม่มีค่า
    expect(parseRetryAfter("-5", now)).toBeNull();
    expect(parseRetryAfter("abc", now)).toBeNull();
    expect(parseRetryAfter("", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter(undefined, now)).toBeNull();
    expect(parseRetryAfter("12.5", now)).toBeNull();
    expect(parseRetryAfter(new Date(now - 60_000).toUTCString(), now)).toBe(0); // วันที่ในอดีต
    expect(parseRetryAfter(new Date(now + 90_000).toUTCString(), now)).toBe(90_000);
    expect(parseRetryAfter("999999999", now)).toBe(60 * MIN);
    expect(parseRetryAfter("7200", now)).toBe(60 * MIN);
    expect(parseRetryAfter(new Date(now + 6 * 3600_000).toUTCString(), now)).toBe(60 * MIN);
  });

  it("พัก = max(บันได, Retry-After) — ไม่สั้นกว่าบันไดเลย", async () => {
    // Retry-After ก่อนถึงเกณฑ์ก็ถูกเชื่อฟัง (ดูเคสถัดไป) จึงต้องเว้นให้พ้นเวลานั้นระหว่างความล้มเหลวสามครั้ง
    const shorter = makeQueue();
    for (let i = 0; i < 3; i++) {
      await fail(shorter, "rain_24h", http(429, 60_000));
      vi.setSystemTime(Date.now() + 61_000);
    }
    vi.setSystemTime(Date.now() - 61_000);
    expect(shorter.pausedUntilMs("rain_24h") - Date.now()).toBe(5 * MIN);

    const longer = makeQueue();
    for (let i = 0; i < 3; i++) {
      await fail(longer, "rain_24h", http(429, 20 * MIN));
      vi.setSystemTime(Date.now() + 20 * MIN + 1000);
    }
    vi.setSystemTime(Date.now() - (20 * MIN + 1000));
    expect(longer.pausedUntilMs("rain_24h") - Date.now()).toBe(20 * MIN);
  });

  it("Retry-After บนความล้มเหลวครั้งแรก (ยังไม่ถึงเกณฑ์พัก) ถูกเชื่อฟัง: งานถัดไปถูกปฏิเสธจนครบเวลา", async () => {
    const store = memoryStore();
    const q = makeQueue(store);
    await fail(q, "rain_24h", http(429, 120_000));
    expect(q.pausedUntilMs("rain_24h")).toBe(T0 + 120_000);
    const fn = vi.fn(() => Promise.resolve("x"));
    await expect(q.run(fn, 0, "rain_24h")).rejects.toBeInstanceOf(UpstreamPausedError);
    expect(fn).not.toHaveBeenCalled();
    expect(store.data.get("breaker:rain_24h")).toContain('"retryAfterMs":120000');
    vi.setSystemTime(T0 + 120_001);
    await expect(ok(q, "rain_24h")).resolves.toBe("ok");
    expect(store.data.has("breaker:rain_24h")).toBe(false);
  });
});

describe("persist / rehydrate", () => {
  it("DO ที่ถูกถอดกลางการพักสร้างคิวใหม่จาก meta แล้วยังพักที่ขั้นเดิม (และ probe ที่ล้มไปขั้นถัดไป)", async () => {
    const store = memoryStore();
    const q1 = makeQueue(store);
    await trip(q1, "rain_24h");
    vi.setSystemTime(T0 + 5 * MIN + 1);
    await q1.run(() => Promise.reject(http(429)), 0, "rain_24h").catch(() => undefined); // → level 2
    const pausedUntil = q1.pausedUntilMs("rain_24h");
    expect(pausedUntil - Date.now()).toBe(10 * MIN);

    // เวลาผ่านไปเล็กน้อยแล้ว "ถอด" DO — คิวใหม่ ไม่มีอะไรในหน่วยความจำ
    vi.setSystemTime(T0 + 6 * MIN);
    const q2 = makeQueue(store);
    expect(q2.pausedUntilMs("rain_24h")).toBe(0); // ยังไม่ hydrate
    q2.hydrate(["rain_24h", "waterlevel_load", "analyst/dam", "waterlevel_graph"]);
    expect(q2.pausedUntilMs("rain_24h")).toBe(pausedUntil);
    expect(q2.snapshot()["rain_24h"]).toMatchObject({ level: 2, pausedUntil });
    const fn = vi.fn(() => Promise.resolve("x"));
    await expect(q2.run(fn, 0, "rain_24h")).rejects.toBeInstanceOf(UpstreamPausedError);
    expect(fn).not.toHaveBeenCalled();

    // พ้นเวลาพัก: probe ล้ม = ขั้น 3 (20 นาที) — บันไดต่อจากขั้นเดิม ไม่ใช่เริ่มใหม่
    vi.setSystemTime(pausedUntil + 1);
    await q2.run(() => Promise.reject(http(503)), 0, "rain_24h").catch(() => undefined);
    expect(q2.pausedUntilMs("rain_24h") - Date.now()).toBe(20 * MIN);
  });

  it("เขียนหนึ่งครั้งต่อการเปิด/เลื่อนขั้น และหนึ่งครั้งตอนปิด (เฉพาะที่เคยเปิด) — ความสำเร็จตอนปิดอยู่แล้วไม่เขียน", async () => {
    const store = memoryStore();
    const q = makeQueue(store);
    await ok(q, "rain_24h");
    await fail(q, "rain_24h");
    await fail(q, "rain_24h");
    expect(store.writes).toEqual([]); // ยังไม่ถึงเกณฑ์ ไม่มี Retry-After → ไม่เขียน
    await fail(q, "rain_24h");
    expect(store.writes).toEqual(["breaker:rain_24h"]);
    vi.setSystemTime(T0 + 5 * MIN + 1);
    await ok(q, "rain_24h");
    expect(store.writes).toEqual(["breaker:rain_24h", "breaker:rain_24h"]);
    expect(store.data.size).toBe(0);
    await ok(q, "rain_24h");
    expect(store.writes.length).toBe(2);
  });

  it("ค่าใน meta ที่ผิดรูปถูกมองว่าไม่มี (ปิด) ไม่ทำให้ hydrate โยน", () => {
    const store = memoryStore();
    store.data.set("breaker:rain_24h", "{not json");
    store.data.set("breaker:waterlevel_load", JSON.stringify({ level: 99, pausedUntil: 1, retryAfterUntil: 0 }));
    const q = makeQueue(store);
    expect(() => q.hydrate(["rain_24h", "waterlevel_load"])).not.toThrow();
    expect(q.snapshot()).toEqual({});
  });
});
