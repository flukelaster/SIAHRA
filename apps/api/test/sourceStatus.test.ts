import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceHealth, SourceStatus } from "@siahra/shared-types";
import { healthOk } from "../src/routes/health";

/**
 * E3.3 — `status()` ของทุก Durable Object ต้องแยกสองความล้มเหลวออกจากกัน:
 * "ดึงไม่สำเร็จ" (`down`/`degraded`/`stale`) กับ "ดึงสำเร็จแต่ต้นทางยังไม่ปล่อย
 * ค่าตรวจวัดรอบใหม่" (`delayed`)
 *
 * นาฬิกาปลอม: ตรึงเวลาด้วย `vi.setSystemTime` (วัดแล้วว่าทะลุถึง `Date.now()`
 * ข้างใน DO เพราะรันใน isolate เดียวกัน) แล้วเขียนเวลาลง storage เป็นค่าสัมบูรณ์
 * เทียบกับ T0 — ไม่มีการ sleep ที่ไหนเลย และผลลัพธ์ไม่ขึ้นกับความเร็วเครื่อง
 *
 * storage ของ DO อยู่ยาวข้าม test block ภายในไฟล์เดียวกัน (ดู vitest.config.ts)
 * จึงตั้งชื่อ instance แยกต่อหนึ่งเคสเสมอ
 */
const T0 = Date.parse("2026-08-19T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function freeze(): void {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
}

afterEach(() => {
  vi.useRealTimers();
});

/** meta ของ RadarDO/FloodExtentDO/ObservationCacheDO เป็นตาราง key/value เดียวกัน */
function writeMeta(ctx: DurableObjectState, key: string, value: string): void {
  ctx.storage.sql.exec(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}

describe("RadarDO.status()", () => {
  async function radarStatus(
    name: string,
    setup: (ctx: DurableObjectState) => void,
  ): Promise<SourceStatus> {
    freeze();
    const stub = env.RADAR.getByName(name);
    return runInDurableObject(stub, async (instance, ctx) => {
      setup(ctx);
      return instance.status();
    });
  }
  const frame = (ctx: DurableObjectState, offsetMs: number) =>
    ctx.storage.sql.exec("INSERT OR REPLACE INTO frames (ts_ms, key) VALUES (?, ?)", T0 + offsetMs, `k${offsetMs}`);

  it("ยังไม่เคยดึงและไม่มี error → unknown พร้อม fetchedAt เป็น null", async () => {
    const s = await radarStatus("radar-unknown", () => {});
    expect(s.health).toBe<SourceHealth>("unknown");
    expect(s.fetchedAt).toBeNull();
    expect(s.nextAttemptAt).toBeNull();
  });

  it("ไม่เคยดึงสำเร็จแต่มี error → down (ยังคง fetchedAt = null ไม่ใช่เวลาปัจจุบัน)", async () => {
    const s = await radarStatus("radar-down", (ctx) => writeMeta(ctx, "lastError", "TMD 503"));
    expect(s.health).toBe<SourceHealth>("down");
    expect(s.fetchedAt).toBeNull();
  });

  it("รอบดึงสำเร็จล่าสุดเก่าเกิน staleAfterSeconds → stale", async () => {
    const s = await radarStatus("radar-stale", (ctx) => {
      writeMeta(ctx, "fetchedAt", iso(-20 * MIN));
      frame(ctx, -25 * MIN);
    });
    expect(s.health).toBe<SourceHealth>("stale");
  });

  it("ค้างเกินงบ *และ* มี error ค้าง → down ไม่ใช่ stale (แหล่งที่ตายห้ามถูกเรียกว่าแค่ข้อมูลเก่า)", async () => {
    const s = await radarStatus("radar-stale-error", (ctx) => {
      writeMeta(ctx, "fetchedAt", iso(-3 * HOUR));
      writeMeta(ctx, "lastError", "TMD index timeout");
      frame(ctx, -3 * HOUR);
    });
    expect(s.health).toBe<SourceHealth>("down");
  });

  it("ดึงล่าสุดสำเร็จบางส่วน (มี lastError) → degraded", async () => {
    const s = await radarStatus("radar-degraded", (ctx) => {
      writeMeta(ctx, "fetchedAt", iso(-2 * MIN));
      writeMeta(ctx, "lastError", "frame 404");
      frame(ctx, -20 * MIN);
    });
    expect(s.health).toBe<SourceHealth>("degraded");
  });

  it("ดึงสำเร็จ แต่เฟรมใหม่สุดเก่ากว่าคาบที่ต้นทางควรส่ง → delayed (ไม่ใช่ stale)", async () => {
    const s = await radarStatus("radar-delayed", (ctx) => {
      writeMeta(ctx, "fetchedAt", iso(-2 * MIN));
      frame(ctx, -100 * MIN);
    });
    expect(s.health).toBe<SourceHealth>("delayed");
    // การดึงยังปกติ: fetchedAt สดกว่า observedLagSeconds มาก
    expect(s.fetchedAt).toBe(iso(-2 * MIN));
    expect(s.latestObservedAt).toBe(iso(-100 * MIN));
  });

  it("ดึงสำเร็จและเฟรมใหม่สุดอยู่ในคาบ → ok", async () => {
    const s = await radarStatus("radar-ok", (ctx) => {
      writeMeta(ctx, "fetchedAt", iso(-2 * MIN));
      frame(ctx, -20 * MIN);
    });
    expect(s.health).toBe<SourceHealth>("ok");
    expect(s.observedLagSeconds).toBe(90 * 60);
  });

  it("ดึงดัชนีสำเร็จแต่โหลดเฟรมไม่ได้สักเฟรม → degraded ไม่ใช่ delayed (ยังไม่มีหลักฐานว่าต้นทางช้า)", async () => {
    const s = await radarStatus("radar-noframes", (ctx) => writeMeta(ctx, "fetchedAt", iso(-2 * MIN)));
    expect(s.health).toBe<SourceHealth>("degraded");
    expect(s.latestObservedAt).toBeNull();
  });

  it("frames24h นับเฉพาะเฟรมใน 24 ชม. ไม่ใช่ทั้งตารางที่เก็บย้อนหลัง 30 วัน", async () => {
    const s = await radarStatus("radar-frames", (ctx) => {
      writeMeta(ctx, "fetchedAt", iso(-2 * MIN));
      frame(ctx, -15 * MIN);
      frame(ctx, -23 * HOUR);
      frame(ctx, -25 * HOUR);
      frame(ctx, -10 * 24 * HOUR);
    });
    expect(s.detail.frames24h).toBe(2);
  });

  it("nextAttemptAt มาจาก alarm จริง — ไม่มี alarm = null ไม่ใช่เวลาที่เดาขึ้นมา", async () => {
    freeze();
    const stub = env.RADAR.getByName("radar-alarm");
    const before = await runInDurableObject(stub, (instance) => instance.status());
    expect(before.nextAttemptAt).toBeNull();
    const after = await runInDurableObject(stub, async (instance, ctx) => {
      await ctx.storage.setAlarm(T0 + 5 * MIN);
      return instance.status();
    });
    expect(after.nextAttemptAt).toBe(iso(5 * MIN));
    await runInDurableObject(stub, (_i, ctx) => ctx.storage.deleteAlarm());
  });
});

describe("FloodExtentDO.status()", () => {
  async function floodStatus(name: string, setup: (ctx: DurableObjectState) => void): Promise<SourceStatus> {
    freeze();
    const stub = env.FLOOD_EXTENT.getByName(name);
    return runInDurableObject(stub, async (instance, ctx) => {
      setup(ctx);
      return instance.status();
    });
  }

  it("ยังไม่เคยดึง → unknown", async () => {
    const s = await floodStatus("flood-unknown", () => {});
    expect(s.health).toBe<SourceHealth>("unknown");
    expect(s.fetchedAt).toBeNull();
  });

  it("ไม่เคยสำเร็จ + มี error → down", async () => {
    const s = await floodStatus("flood-down", (ctx) => writeMeta(ctx, "lastError", "GISTDA WFS 500"));
    expect(s.health).toBe<SourceHealth>("down");
  });

  it("ดึงสำเร็จครั้งสุดท้ายเกิน 3 ชม. → stale", async () => {
    const s = await floodStatus("flood-stale", (ctx) => writeMeta(ctx, "retrievedAt", iso(-4 * HOUR)));
    expect(s.health).toBe<SourceHealth>("stale");
  });

  it("เพิ่งดึงแต่รอบล่าสุดมี error → degraded", async () => {
    const s = await floodStatus("flood-degraded", (ctx) => {
      writeMeta(ctx, "retrievedAt", iso(-10 * MIN));
      writeMeta(ctx, "lastError", "timeout");
    });
    expect(s.health).toBe<SourceHealth>("degraded");
  });

  it("ดึงสำเร็จ → ok และไม่มีวันเป็น delayed เพราะต้นทางไม่ส่งเวลาตรวจวัดมาเลย", async () => {
    const s = await floodStatus("flood-ok", (ctx) => writeMeta(ctx, "retrievedAt", iso(-10 * MIN)));
    expect(s.health).toBe<SourceHealth>("ok");
    expect(s.latestObservedAt).toBeNull();
    expect(s.observedLagSeconds).toBeNull();
  });
});

describe("ObservationCacheDO.status()", () => {
  async function thaiwaterStatus(name: string, setup: (ctx: DurableObjectState) => void): Promise<SourceStatus> {
    freeze();
    const stub = env.OBSERVATION_CACHE.getByName(name);
    return runInDurableObject(stub, async (instance, ctx) => {
      setup(ctx);
      return instance.status();
    });
  }
  const station = (ctx: DurableObjectState, offsetMs: number) =>
    ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO waterlevel (station_id, province_code, situation_level, observed_at, payload) VALUES (1, '50', NULL, ?, '{}')",
      iso(offsetMs),
    );

  it("ยังไม่เคยดึง → unknown และ fetchedAt เป็น null", async () => {
    const s = await thaiwaterStatus("tw-unknown", () => {});
    expect(s.health).toBe<SourceHealth>("unknown");
    expect(s.fetchedAt).toBeNull();
  });

  it("ไม่เคยสำเร็จ + มี error → down", async () => {
    const s = await thaiwaterStatus("tw-down", (ctx) => writeMeta(ctx, "lastError", "ThaiWater 502"));
    expect(s.health).toBe<SourceHealth>("down");
  });

  it("ดึงสำเร็จครั้งสุดท้ายเกิน 15 นาที → stale", async () => {
    const s = await thaiwaterStatus("tw-stale", (ctx) => {
      writeMeta(ctx, "fetchedAt", iso(-30 * MIN));
      station(ctx, -20 * MIN);
    });
    expect(s.health).toBe<SourceHealth>("stale");
  });

  it("ไม่ได้ดึงสำเร็จมา 3 ชม. และมี error ค้าง → down (เดิมถูกกลบเป็น stale แล้วนับว่า ok)", async () => {
    const s = await thaiwaterStatus("tw-stale-error", (ctx) => {
      writeMeta(ctx, "fetchedAt", iso(-3 * HOUR));
      writeMeta(ctx, "lastError", "ThaiWater 502");
      station(ctx, -3 * HOUR);
    });
    expect(s.health).toBe<SourceHealth>("down");
    expect(healthOk([s])).toBe(false);
  });

  it("เพิ่งดึงแต่มี error ค้าง → degraded", async () => {
    const s = await thaiwaterStatus("tw-degraded", (ctx) => {
      writeMeta(ctx, "fetchedAt", iso(-3 * MIN));
      writeMeta(ctx, "lastError", "waterlevel 429");
      station(ctx, -20 * MIN);
    });
    expect(s.health).toBe<SourceHealth>("degraded");
  });

  it("ดึงสำเร็จ แต่ค่าตรวจวัดใหม่สุดเก่ากว่า 2 ชม. → delayed", async () => {
    const s = await thaiwaterStatus("tw-delayed", (ctx) => {
      writeMeta(ctx, "fetchedAt", iso(-3 * MIN));
      station(ctx, -3 * HOUR);
    });
    expect(s.health).toBe<SourceHealth>("delayed");
    expect(s.latestObservedAt).toBe(iso(-3 * HOUR));
    expect(s.observedLagSeconds).toBe(2 * 3600);
  });

  it("ดึงสำเร็จและมีค่าตรวจวัดในคาบ → ok", async () => {
    const s = await thaiwaterStatus("tw-ok", (ctx) => {
      writeMeta(ctx, "fetchedAt", iso(-3 * MIN));
      station(ctx, -40 * MIN);
    });
    expect(s.health).toBe<SourceHealth>("ok");
  });
});

describe("EarthquakeFeedDO.status()", () => {
  interface PollFixture {
    at: string;
    created: number;
    updated: number;
    polled: number;
    feeds?: number;
    errors: string[];
  }
  async function eqStatus(
    name: string,
    setup: (ctx: DurableObjectState) => Promise<void> | void,
  ): Promise<SourceStatus> {
    freeze();
    const stub = env.EARTHQUAKE_FEED.getByName(name);
    return runInDurableObject(stub, async (instance, ctx) => {
      await setup(ctx);
      return (await instance.status())[0];
    });
  }
  const poll = (ctx: DurableObjectState, p: PollFixture) => ctx.storage.put("lastPoll", p);
  const event = (ctx: DurableObjectState, offsetMs: number) =>
    ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO events (id, cluster_id, source, source_id, mag, mag_type, place, lat, lon, depth_km, time_ms, updated_ms, status, tsunami, url, raw_json, ingested_at_ms)
       VALUES ('e1','e1','usgs','1',4.2,'mb','somewhere',18,98,10,?,?,'reviewed',0,NULL,'{}',?)`,
      T0 + offsetMs,
      T0 + offsetMs,
      T0 + offsetMs,
    );

  it("ยังไม่เคย poll → unknown", async () => {
    const s = await eqStatus("eq-unknown", () => {});
    expect(s.health).toBe<SourceHealth>("unknown");
    expect(s.fetchedAt).toBeNull();
  });

  it("poll ล่าสุดเก่าเกิน 5 นาที → stale", async () => {
    const s = await eqStatus("eq-stale", (ctx) =>
      poll(ctx, { at: iso(-10 * MIN), created: 0, updated: 0, polled: 0, feeds: 3, errors: [] }),
    );
    expect(s.health).toBe<SourceHealth>("stale");
  });

  it("poll ค้างเกินงบพร้อม error → down (ไม่ใช่ stale ที่ทำให้ /health ตอบว่า ok)", async () => {
    const s = await eqStatus("eq-stale-error", (ctx) =>
      poll(ctx, { at: iso(-30 * MIN), created: 0, updated: 0, polled: 0, feeds: 3, errors: ["usgs: 500"] }),
    );
    expect(s.health).toBe<SourceHealth>("down");
  });

  it("ฟีดพังครบทุกตัวในรายการ → down (นับจากจำนวนฟีด ไม่ใช่เลข 3 ตายตัว)", async () => {
    const s = await eqStatus("eq-down", (ctx) =>
      poll(ctx, {
        at: iso(-1 * MIN),
        created: 0,
        updated: 0,
        polled: 0,
        feeds: 3,
        errors: ["usgs: 500", "emsc: timeout", "tmd: no credentials"],
      }),
    );
    expect(s.health).toBe<SourceHealth>("down");
  });

  it("ฟีดพังบางตัว → degraded (เส้นทางที่ TMD ไม่มี credentials ใช้จริงอยู่ตอนนี้)", async () => {
    const s = await eqStatus("eq-degraded", (ctx) =>
      poll(ctx, {
        at: iso(-1 * MIN),
        created: 0,
        updated: 0,
        polled: 0,
        feeds: 3,
        errors: ["TMD credentials not configured"],
      }),
    );
    expect(s.health).toBe<SourceHealth>("degraded");
    expect(s.lastError).toContain("TMD credentials");
  });

  it("ถ้ารายการฟีดโตขึ้น พังสามตัวไม่ใช่ down อีกต่อไป → degraded", async () => {
    const s = await eqStatus("eq-fourfeeds", (ctx) =>
      poll(ctx, {
        at: iso(-1 * MIN),
        created: 0,
        updated: 0,
        polled: 0,
        feeds: 4,
        errors: ["a", "b", "c"],
      }),
    );
    expect(s.health).toBe<SourceHealth>("degraded");
  });

  it("poll สำเร็จ + วันนี้ไม่มีแผ่นดินไหวใหม่ → ok ไม่ใช่ delayed (เหตุการณ์ไม่มีคาบ)", async () => {
    const s = await eqStatus("eq-quiet", async (ctx) => {
      event(ctx, -20 * 24 * HOUR);
      await poll(ctx, { at: iso(-1 * MIN), created: 0, updated: 0, polled: 3, feeds: 3, errors: [] });
    });
    expect(s.health).toBe<SourceHealth>("ok");
    expect(s.observedLagSeconds).toBeNull();
    expect(s.latestObservedAt).toBe(iso(-20 * 24 * HOUR));
  });

  it("เรกคอร์ดเก่าที่ยังไม่มีฟิลด์ feeds ตัดสิน down ได้ตามชุดฟีดปัจจุบัน", async () => {
    const s = await eqStatus("eq-legacy", (ctx) =>
      poll(ctx, { at: iso(-1 * MIN), created: 0, updated: 0, polled: 0, errors: ["a", "b", "c"] }),
    );
    expect(s.health).toBe<SourceHealth>("down");
  });
});

/**
 * เงื่อนไข `ok` ของ /api/v1/health ยิงตรง — สถานะ "ค้างพร้อม error" เกิดไม่ได้ใน
 * เทสที่ตัดเน็ต (ทุก DO เย็นสนิทเป็น unknown) จึงต้องทดสอบด้วย fixture
 */
describe("healthOk()", () => {
  const src = (over: Partial<SourceStatus>): SourceStatus => ({
    id: "thaiwater",
    labelTh: "x",
    labelEn: "x",
    health: "ok",
    fetchedAt: iso(-1 * MIN),
    latestObservedAt: iso(-10 * MIN),
    lastAttemptAt: iso(-1 * MIN),
    lastError: null,
    detail: {},
    staleAfterSeconds: 900,
    observedLagSeconds: 7200,
    nextAttemptAt: null,
    ...over,
  });

  it("ทุกแหล่งปกติ → true", () => {
    expect(healthOk([src({}), src({ id: "tmd-radar" })])).toBe(true);
  });

  it("delayed ยังนับว่า ok เพราะยังมีข้อมูลจริงพร้อมอายุให้แสดง", () => {
    expect(healthOk([src({ health: "delayed", latestObservedAt: iso(-3 * HOUR) })])).toBe(true);
  });

  it("stale ไม่นับว่า ok — ไม่มีรอบดึงสำเร็จเกินงบเวลาของแหล่งนั้น", () => {
    expect(healthOk([src({ health: "stale", fetchedAt: iso(-3 * HOUR) })])).toBe(false);
  });

  it("มี lastError ค้าง → false เสมอ ไม่ว่าสถานะจะถูกจัดเป็นอะไร", () => {
    expect(healthOk([src({ health: "stale", lastError: "ThaiWater 502" })])).toBe(false);
    expect(healthOk([src({ health: "ok", lastError: "ThaiWater 502" })])).toBe(false);
  });

  it("down หรือ unknown → false (ความเงียบไม่ใช่ความแข็งแรง)", () => {
    expect(healthOk([src({}), src({ id: "earthquakes", health: "down" })])).toBe(false);
    expect(healthOk([src({ id: "gistda-flood", health: "unknown", fetchedAt: null })])).toBe(false);
  });
});
