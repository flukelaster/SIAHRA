import { env } from "cloudflare:workers";
import { abortAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceStatus } from "@siahra/shared-types";
import { BASINS_STALE_AFTER_SECONDS } from "../src/basins/build";
import type { AppEnv } from "../src/types";
import rainFixture from "./fixtures/thaiwater-rain24h.json";
import waterFixture from "./fixtures/thaiwater-waterlevel-load.json";

/**
 * ThaiWater ตอบ 429 ต่อ `rain_24h` / `waterlevel_load` ตั้งแต่ 2026-09-29 (แอปค้างที่ข้อมูลเก่า) — ไฟล์นี้พิสูจน์ว่า
 * ระหว่างที่ต้นทางแออัด **DO ไม่เริ่มรอบ refresh เลย** (cron ทุกนาที / แคชขอบพลาด / alarm ที่มาก่อนเวลา), ว่า breaker
 * ไต่บันไดและ persist ใน meta (DO ที่ถูกถอดกลับมาพักต่อ), ว่านัด alarm ชี้ไปที่เวลาที่ probe ได้จริง และว่างบเวลาใหม่
 * (TTL 10 / stale 30 นาที) เป็นค่าเดียวกันทุกที่
 *
 * ใช้นาฬิกาปลอมทั้งชุด: `vi.setSystemTime` ทะลุถึง `Date.now()` ใน DO (ดู sourceStatus.test.ts) และ alarm ถูกเรียกตรง ๆ
 */

const appEnv = env as unknown as AppEnv;
const MIN = 60_000;
/**
 * นาฬิกาปลอมเริ่มที่ **03:00 UTC (10:00 น. ไทย) ของพรุ่งนี้** ตามนาฬิกาจริง — สองเหตุผลที่ห้ามใช้ "ตอนนี้ + 24 ชม." ตรง ๆ:
 * (1) workerd ตั้งเวลา alarm ตามนาฬิกาจริง: `setAlarm(เวลาในอดีต)` ถูกอ่านกลับเป็น "ตอนนี้จริง" (และยิงทันที) เทสที่ยืนยัน
 *     `getAlarm()` จึงต้องอยู่ในอนาคตจริงเสมอ
 * (2) `archiveTick()` (waitUntil จาก ensureFresh/alarm) เขียน meta เมื่อชั่วโมงไทยเปลี่ยนหรือข้าม 00:20 น. เทสที่ยืนยันว่า
 *     "ไม่มี meta ใดถูกเขียน" ระหว่างพักจึงต้องอยู่ในชั่วโมงเดียวของวันเดียวเสมอ ไม่ขึ้นกับนาทีที่ CI เริ่มรัน (เทสทั้งชุดยาว ≈ 45 นาที)
 */
const tomorrow = new Date();
const T0 = Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate() + 1, 3, 0, 0);
const at = (offsetMs: number) => vi.setSystemTime(T0 + offsetMs);

interface Internals {
  refresh(nowMs: number): Promise<void>;
  publishExposure(nowMs: number): Promise<void>;
  alarm(): Promise<void>;
  ensureFresh(): Promise<void>;
  getObservations(province?: string | null): Promise<unknown>;
  status(): Promise<SourceStatus>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Mode = "ok" | "429";
const SNIPPET = "s".repeat(220);

/** mock fetch: rain/water ตาม mode, ที่เหลือ (ประวัติ/เขื่อน) ไม่ควรถูกเรียกในไฟล์นี้ */
function mockThaiwater(state: { mode: Mode; calls: string[]; retryAfter?: string }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    state.calls.push(url);
    const path = url.includes("rain_24h") ? "rain" : url.includes("waterlevel_load") ? "water" : null;
    if (!path) throw new Error(`unexpected fetch in test: ${url}`);
    if (state.mode === "429") {
      return new Response(SNIPPET, {
        status: 429,
        statusText: "Too Many Requests",
        headers: state.retryAfter ? { "retry-after": state.retryAfter } : {},
      });
    }
    return new Response(JSON.stringify(path === "rain" ? rainFixture : waterFixture), {
      headers: { "content-type": "application/json" },
    });
  });
}

function put(ctx: DurableObjectState, key: string, value: string): void {
  ctx.storage.sql.exec(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}
function get(ctx: DurableObjectState, key: string): string | null {
  return ctx.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value ?? null;
}
function metaDump(ctx: DurableObjectState): string {
  return JSON.stringify(ctx.storage.sql.exec<{ key: string; value: string }>("SELECT key, value FROM meta ORDER BY key").toArray());
}
const breaker = (level: number, pausedUntil: number) =>
  JSON.stringify({ v: 1, level, pausedUntil, retryAfterMs: null, retryAfterUntil: 0 });

/** เรียกเมธอดของ DO แล้วเดินนาฬิกาปลอมให้ minGap ของคิวต้นทาง (250 ms) ผ่านไป */
async function drive<T>(call: () => Promise<T>): Promise<T> {
  const p = call();
  await vi.advanceTimersByTimeAsync(1000);
  return p;
}

describe("ด่านของ refresh — breaker ที่ persist ไว้กั้นทุกทางเข้า", () => {
  it("DO ที่ถูกถอดกลางการพัก: N × getObservations + N × ensureFresh ไม่ยิงต้นทาง ไม่คำนวณ exposure ไม่เขียน meta และ alarm ชี้ที่ pausedUntil", async () => {
    const stub = appEnv.OBSERVATION_CACHE.getByName("obs-gate-persisted");
    const pausedUntil = T0 + 40 * MIN;
    await runInDurableObject(stub, (_i, ctx) => {
      put(ctx, "breaker:rain_24h", breaker(4, pausedUntil));
      put(ctx, "breaker:waterlevel_load", breaker(4, pausedUntil));
      put(ctx, "lastRoutePullMs", String(T0));
    });
    // instance ใหม่ = สร้างจาก meta (ไม่มีอะไรค้างในหน่วยความจำ)
    await abortAllDurableObjects();
    const state = { mode: "429" as Mode, calls: [] as string[] };
    const fetchSpy = mockThaiwater(state);

    await runInDurableObject(appEnv.OBSERVATION_CACHE.getByName("obs-gate-persisted"), async (instance, ctx) => {
      const internals = instance as unknown as Internals;
      const refreshSpy = vi.spyOn(internals, "refresh");
      const publishSpy = vi.spyOn(internals, "publishExposure");
      await ctx.storage.deleteAlarm();
      const before = metaDump(ctx);
      for (let i = 0; i < 20; i++) {
        at(i * 1000);
        await internals.getObservations(null);
        await internals.ensureFresh();
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(refreshSpy).not.toHaveBeenCalled();
      expect(publishSpy).not.toHaveBeenCalled();
      expect(metaDump(ctx), "การข้ามต้องไม่เขียน meta ใด ๆ").toBe(before);
      // ensureFresh() ตั้งนัดไว้ที่เวลาที่ probe ได้จริง (max(TTL, pausedUntil)) — ไม่ใช่ TTL
      expect(await ctx.storage.getAlarm()).toBe(pausedUntil);
      const status = await internals.status();
      expect(status.detail.upstreamPausedUntil).toBe(new Date(pausedUntil).toISOString());
      expect(status.nextAttemptAt).toBe(new Date(pausedUntil).toISOString());
      expect(String(status.detail.upstreamBreakers)).toContain("rain_24h L4");
    });
  });

  it("บันไดจริงผ่าน DO: 3 รอบล้ม → พัก 5 นาที (alarm = pausedUntil), ระหว่างพักไม่ยิง, probe ล้ม → 10 นาที, ถอด DO แล้วยังพัก, ฟื้นแล้วกลับปกติ (ระดับน้ำได้ probe ก่อนฝน)", async () => {
    let stub = appEnv.OBSERVATION_CACHE.getByName("obs-ladder");
    await runInDurableObject(stub, (_i, ctx) => put(ctx, "lastRoutePullMs", String(T0)));
    const state = { mode: "ok" as Mode, calls: [] as string[] };
    const fetchSpy = mockThaiwater(state);
    const bothFeeds = 2;

    // a) รอบดีรอบแรก
    await runInDurableObject(stub, async (i) => drive(() => (i as unknown as Internals).alarm()));
    expect(state.calls.length).toBe(bothFeeds);
    const fetchedAt = await runInDurableObject(stub, (_i, ctx) => get(ctx, "fetchedAt"));
    expect(fetchedAt).toBe(new Date(T0).toISOString());

    // b) เกิน TTL 10 นาที (9 นาทีถือว่ายังสด — ไม่ยิง) แล้วต้นทางเริ่ม 429
    at(9 * MIN);
    await runInDurableObject(stub, async (i) => drive(() => (i as unknown as Internals).ensureFresh()));
    expect(state.calls.length, "9 นาที < TTL 10 นาที ต้องยังสด").toBe(bothFeeds);
    state.mode = "429";
    const roundAt = [11 * MIN, 11 * MIN + 30_000, 12 * MIN + 5_000, 14 * MIN + 10_000];
    // รอบที่ 1 (11:00) ล้ม; 11:30 ถูกด่าน backoff 1 นาทีกั้น; 12:05 รอบที่ 2; 14:10 รอบที่ 3 → breaker เปิด
    at(roundAt[0]);
    await runInDurableObject(stub, async (i) => drive(() => (i as unknown as Internals).ensureFresh()));
    expect(state.calls.length).toBe(bothFeeds * 2);
    at(roundAt[1]);
    await runInDurableObject(stub, async (i) => drive(() => (i as unknown as Internals).ensureFresh()));
    expect(state.calls.length, "ด่าน backoff 1 นาทีต้องกั้นรอบที่ 2").toBe(bothFeeds * 2);
    at(roundAt[2]);
    await runInDurableObject(stub, async (i) => drive(() => (i as unknown as Internals).ensureFresh()));
    expect(state.calls.length).toBe(bothFeeds * 3);
    at(roundAt[3]);
    await runInDurableObject(stub, async (i) => drive(() => (i as unknown as Internals).ensureFresh()));
    expect(state.calls.length).toBe(bothFeeds * 4);

    const trip = await runInDurableObject(stub, async (_i, ctx) => ({
      rain: get(ctx, "breaker:rain_24h"),
      water: get(ctx, "breaker:waterlevel_load"),
      alarm: await ctx.storage.getAlarm(),
      failures: get(ctx, "consecutiveFailures"),
      lastAttemptAt: get(ctx, "lastAttemptAt"),
      lastError: get(ctx, "lastError"),
    }));
    expect(trip.rain).toContain('"level":1');
    expect(trip.water).toContain('"level":1');
    const persisted = JSON.parse(trip.rain!) as { pausedUntil: number };
    // refresh() ส่งงานระดับน้ำเข้าคิวก่อน (ให้ระดับน้ำได้ probe ก่อน) — ฝนจึงเริ่มหลังนั้น minGapMs 250 ms
    const water = JSON.parse(trip.water!) as { pausedUntil: number };
    expect(water.pausedUntil).toBe(T0 + roundAt[3] + 5 * MIN); // ระดับน้ำล้มครั้งที่ 3 ที่ roundAt[3] พอดี
    expect(persisted.pausedUntil).toBe(T0 + roundAt[3] + 250 + 5 * MIN);
    // max(backoff 4 นาที, pausedUntil − now) = pausedUntil: ไม่พึ่ง alarm เก่าของรอบก่อน
    // alarm = เวลาแรกสุดที่ฟีดใดฟีดหนึ่งลองใหม่ได้ = ระดับน้ำ (ซึ่งได้ probe ก่อนฝน)
    expect(trip.alarm).toBe(water.pausedUntil);
    expect(trip.failures).toBe("3");
    expect(trip.lastError).toContain("rain_24h failed: 429 retry-after=none");

    // c) ระหว่างพัก: ไม่ยิง ไม่เขียน — ทั้ง cron, ผู้อ่าน และ alarm ที่มาก่อนเวลาพักหมด
    const callsBefore = state.calls.length;
    await runInDurableObject(stub, async (instance, ctx) => {
      const internals = instance as unknown as Internals;
      const refreshSpy = vi.spyOn(internals, "refresh");
      const publishSpy = vi.spyOn(internals, "publishExposure");
      const before = metaDump(ctx);
      for (let i = 0; i < 15; i++) {
        at(14 * MIN + 10_000 + (i + 1) * 10_000);
        await internals.getObservations(null);
        await internals.ensureFresh();
      }
      await internals.alarm(); // alarm ที่ยิงก่อนเวลาพักหมด
      await vi.advanceTimersByTimeAsync(0);
      expect(state.calls.length).toBe(callsBefore);
      expect(refreshSpy).not.toHaveBeenCalled();
      expect(publishSpy).not.toHaveBeenCalled();
      expect(metaDump(ctx)).toBe(before);
      // alarm = เวลาแรกสุดที่ฟีดใดฟีดหนึ่งลองใหม่ได้ = pausedUntil ของระดับน้ำ (ไม่ใช่ของฝนที่ช้ากว่า 250 ms)
      expect(await ctx.storage.getAlarm()).toBe(water.pausedUntil);
    });

    // d) พ้นเวลาพักของระดับน้ำ (ฝนพ้นตามไป 250 ms — ทั้งสองฟีดเป็น half-open): probe ตัวเดียวทั้งคิวคือ **ระดับน้ำ**
    //    (ส่งเข้าคิวก่อนฝน) ล้ม → ขั้น 2 = 10 นาที; ฝนถูกปฏิเสธเพราะ probe ค้าง (ไม่ยิง) จึงยังอยู่ขั้น 1
    const probeAt = water.pausedUntil + 1000;
    vi.setSystemTime(probeAt);
    await runInDurableObject(stub, async (i) => drive(() => (i as unknown as Internals).alarm()));
    expect(state.calls.length - callsBefore, "half-open ปล่อย probe ตัวเดียว").toBe(1);
    expect(state.calls.at(-1)).toContain("waterlevel_load");
    const afterProbe = await runInDurableObject(stub, async (_i, ctx) => ({
      rain: JSON.parse(get(ctx, "breaker:rain_24h")!) as { level: number; pausedUntil: number },
      water: JSON.parse(get(ctx, "breaker:waterlevel_load")!) as { level: number; pausedUntil: number },
      lastError: get(ctx, "lastError"),
      failures: get(ctx, "consecutiveFailures"),
      lastAttemptAt: get(ctx, "lastAttemptAt"),
    }));
    expect(afterProbe.water.level).toBe(2);
    expect(afterProbe.water.pausedUntil).toBe(probeAt + 10 * MIN); // probe ที่ pausedUntil+1s → พักอีก 10 นาที
    expect(afterProbe.rain.level).toBe(1); // ยังไม่เคยได้ probe ของตัวเอง
    expect(afterProbe.rain.pausedUntil).toBe(persisted.pausedUntil); // ไม่ถูกแตะ (ปฏิเสธก่อนยิง ไม่เลื่อนขั้น)
    expect(afterProbe.lastError).toContain("rain_24h probe in flight");
    expect(afterProbe.lastError).toContain("waterlevel_load failed: 429");
    expect(afterProbe.failures).toBe("4");
    expect(afterProbe.lastAttemptAt).toBe(new Date(probeAt).toISOString());

    // e) DO ถูกถอดกลางการพัก: instance ใหม่โหลดขั้นเดิมของทั้งสองฟีดจาก meta และไม่ยิง
    //    (ฝนพ้นเวลาพักแล้วแต่ยังรอ probe; ที่กั้นรอบใหม่คือ backoff ของรอบที่ล้ม 8 นาที นับจาก lastAttemptAt)
    await abortAllDurableObjects();
    stub = appEnv.OBSERVATION_CACHE.getByName("obs-ladder");
    const callsAfterAbort = state.calls.length;
    vi.setSystemTime(probeAt + 5 * MIN); // กลางช่วงพัก 10 นาทีของระดับน้ำ และก่อน backoff 8 นาที
    await runInDurableObject(stub, async (instance) => {
      const internals = instance as unknown as Internals;
      const status = await internals.status();
      // upstreamPausedUntil นับเฉพาะ breaker ที่ยังพักอยู่ = ระดับน้ำ
      expect(status.detail.upstreamPausedUntil).toBe(new Date(afterProbe.water.pausedUntil).toISOString());
      expect(String(status.detail.upstreamBreakers)).toContain("waterlevel_load L2");
      expect(String(status.detail.upstreamBreakers)).toContain("rain_24h L1 awaiting probe");
      await internals.ensureFresh();
    });
    expect(state.calls.length, "instance ใหม่ต้องไม่ยิงระหว่างพัก").toBe(callsAfterAbort);

    // f) ต้นทางฟื้น: หลังพ้นการพัก probe ตัวเดียวคือระดับน้ำ → สำเร็จ → ปิด breaker ของมัน; ฝนถูกปฏิเสธ (probe ค้าง) จึงยังขั้น 1
    state.mode = "ok";
    const recoverAt = afterProbe.water.pausedUntil + 1000;
    vi.setSystemTime(recoverAt);
    const callsBeforeRecover = state.calls.length;
    await runInDurableObject(stub, async (i) => drive(() => (i as unknown as Internals).alarm()));
    expect(state.calls.length - callsBeforeRecover, "probe ตัวเดียว").toBe(1);
    expect(state.calls.at(-1)).toContain("waterlevel_load");
    const halfRecovered = await runInDurableObject(stub, (_i, ctx) => ({
      rain: get(ctx, "breaker:rain_24h"),
      water: get(ctx, "breaker:waterlevel_load"),
      failures: get(ctx, "consecutiveFailures"),
    }));
    expect(halfRecovered.water).toBeNull();
    expect(halfRecovered.rain).toContain('"level":1');
    expect(halfRecovered.failures, "ฟีดฝนยังไม่ฟื้น = ยังเป็นรอบล้มบางส่วน").toBe("5");
    // ฝนได้ probe ของตัวเองในรอบ retry ถัดไป (เว้นให้พ้น backoff 10 นาทีของรอบที่ล้ม) → กลับ level 0 ทั้งคู่
    vi.setSystemTime(recoverAt + 11 * MIN);
    await runInDurableObject(stub, async (i) => drive(() => (i as unknown as Internals).alarm()));
    const recovered = await runInDurableObject(stub, (_i, ctx) => ({
      rain: get(ctx, "breaker:rain_24h"),
      water: get(ctx, "breaker:waterlevel_load"),
      failures: get(ctx, "consecutiveFailures"),
      lastError: get(ctx, "lastError"),
    }));
    expect(recovered.rain).toBeNull();
    expect(recovered.water).toBeNull();
    expect(recovered.failures).toBe("0");
    expect(recovered.lastError).toBeNull();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("backoff ของรอบที่ล้มกั้น ensureFresh/getObservations/alarm — ข้ามแล้วไม่แตะ lastAttemptAt / consecutiveFailures / fetchedAt", async () => {
    const stub = appEnv.OBSERVATION_CACHE.getByName("obs-retry-gate");
    await runInDurableObject(stub, (_i, ctx) => {
      put(ctx, "lastRoutePullMs", String(T0));
      put(ctx, "fetchedAt", new Date(T0 - 30 * MIN).toISOString());
      put(ctx, "lastAttemptAt", new Date(T0 - 10_000).toISOString());
      put(ctx, "consecutiveFailures", "3"); // backoff = 4 นาที
      put(ctx, "lastError", "ThaiWater rain_24h failed: 503 retry-after=none");
    });
    const state = { mode: "429" as Mode, calls: [] as string[] };
    const fetchSpy = mockThaiwater(state);
    await runInDurableObject(stub, async (instance, ctx) => {
      const internals = instance as unknown as Internals;
      const before = {
        lastAttemptAt: get(ctx, "lastAttemptAt"),
        failures: get(ctx, "consecutiveFailures"),
        fetchedAt: get(ctx, "fetchedAt"),
      };
      at(1000);
      await internals.getObservations(null);
      await internals.ensureFresh();
      await internals.alarm();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect({
        lastAttemptAt: get(ctx, "lastAttemptAt"),
        failures: get(ctx, "consecutiveFailures"),
        fetchedAt: get(ctx, "fetchedAt"),
      }).toEqual(before);
    });
    // พ้น backoff (4 นาทีนับจากความพยายามล่าสุด) แล้วจึงยิงได้
    at(4 * MIN);
    await runInDurableObject(stub, async (i) => drive(() => (i as unknown as Internals).ensureFresh()));
    expect(state.calls.length).toBe(2);
  });
});

describe("ข้อความ error และงบเวลา", () => {
  it("สองฟีด 429 พร้อม body 220 ตัวอักษร: lastError ยังเห็น status ของทั้งสอง (≤ 200) ส่วนช่องรายฟีดเก็บรายละเอียด ≤ 300", async () => {
    const stub = appEnv.OBSERVATION_CACHE.getByName("obs-error-shape");
    await runInDurableObject(stub, (_i, ctx) => put(ctx, "lastRoutePullMs", String(T0)));
    const state = { mode: "429" as Mode, calls: [] as string[], retryAfter: "120" };
    mockThaiwater(state);
    await runInDurableObject(stub, async (i) => drive(() => (i as unknown as Internals).alarm()));
    const row = await runInDurableObject(stub, async (i, ctx) => ({
      lastError: get(ctx, "lastError")!,
      rainfallError: get(ctx, "rainfallError")!,
      waterlevelError: get(ctx, "waterlevelError")!,
      status: await (i as unknown as Internals).status(),
    }));
    expect(row.lastError.length).toBeLessThanOrEqual(200);
    expect(row.lastError).toContain("rain_24h failed: 429 retry-after=120");
    expect(row.lastError).toContain("waterlevel_load failed: 429 retry-after=120");
    expect(row.rainfallError.length).toBeLessThanOrEqual(300);
    expect(row.rainfallError).toContain("ssss");
    expect(row.waterlevelError.length).toBeLessThanOrEqual(300);
    // ยังไม่เคยดึงสำเร็จ + มี error = down (ไม่ใช่ unknown) และมีเหตุผลอ่านได้
    expect(row.status.lastError).toContain("429");
  });

  it("TTL 10 นาที: อายุ 9 นาทียังสด (ไม่ยิง) — 11 นาทีต้องยิง; staleAfterSeconds ของ /health = descriptor ของ observations = basins = 1800", async () => {
    const stub = appEnv.OBSERVATION_CACHE.getByName("obs-ttl");
    await runInDurableObject(stub, (_i, ctx) => put(ctx, "lastRoutePullMs", String(T0)));
    const state = { mode: "ok" as Mode, calls: [] as string[] };
    mockThaiwater(state);
    await runInDurableObject(stub, async (i) => drive(() => (i as unknown as Internals).alarm()));
    expect(state.calls.length).toBe(2);

    const firstAlarm = await runInDurableObject(stub, (_i, ctx) => ctx.storage.getAlarm());
    expect(firstAlarm).toBeGreaterThanOrEqual(T0 + 10 * MIN);
    expect(firstAlarm).toBeLessThanOrEqual(T0 + 10 * MIN + 2000);

    at(9 * MIN);
    await runInDurableObject(stub, async (i) => drive(() => (i as unknown as Internals).ensureFresh()));
    expect(state.calls.length).toBe(2);
    // cron ที่แค่ตรวจว่ามีนัดอยู่ ต้องไม่ตั้งนัดใหม่ (ไม่เลื่อนออกทุกนาที และไม่เขียนทุกนาที)
    expect(await runInDurableObject(stub, (_i, ctx) => ctx.storage.getAlarm())).toBe(firstAlarm);
    at(11 * MIN);
    await runInDurableObject(stub, async (i) => drive(() => (i as unknown as Internals).ensureFresh()));
    expect(state.calls.length).toBe(4);
    // รอบที่ cron เป็นคนเริ่มเลื่อนนัดไปเป็น now + TTL — alarm เก่า (T0 + 10 นาที) จะไม่ยิงดึงซ้ำห่างกันไม่กี่วินาที
    const movedAlarm = await runInDurableObject(stub, (_i, ctx) => ctx.storage.getAlarm());
    expect(movedAlarm).toBeGreaterThanOrEqual(T0 + 21 * MIN);
    expect(movedAlarm).toBeLessThanOrEqual(T0 + 21 * MIN + 2000);

    const seen = await runInDurableObject(stub, async (i) => {
      const internals = i as unknown as Internals;
      const obs = (await internals.getObservations(null)) as { layer: { staleAfterSeconds: number } };
      return { status: (await internals.status()).staleAfterSeconds, layer: obs.layer.staleAfterSeconds };
    });
    expect(seen.status).toBe(30 * 60);
    expect(seen.layer).toBe(30 * 60);
    expect(BASINS_STALE_AFTER_SECONDS).toBe(30 * 60);
  });
});
