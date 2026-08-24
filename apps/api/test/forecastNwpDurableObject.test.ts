import { runInDurableObject } from "cloudflare:test";
import { env, exports as workerExports } from "cloudflare:workers";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvinceForecastResponse, SourceStatus } from "@siahra/shared-types";
import type { AppEnv } from "../src/types";
import dailyFixture from "./fixtures/tmdNwp/daily-region-S.json";
import hourlyFixture from "./fixtures/tmdNwp/hourly-region-S.json";

/**
 * E12.2 — ForecastNwpDO ครบวง: cron → DO → เส้นทาง HTTP
 *
 * สองอย่างที่ไฟล์นี้มีไว้ยึดเป็นพิเศษ:
 *
 * 1. **ปริมาณการเขียน** หนึ่งรอบต้องเขียน "หนึ่งแถวต่อจังหวัด" ไม่ใช่หนึ่งแถวต่อ
 *    ขั้นพยากรณ์ ถ้าวันหนึ่งมีคน refactor เป็นตารางขั้น ๆ (77×55 = 4,235 แถว/รอบ
 *    ≈ 3M/รอบบิล) เทสข้อนั้นต้องแดง ไม่ใช่เงียบแล้วไปโผล่ที่บิล
 * 2. **ยังไม่เคยดึงสำเร็จ** ต้องได้ `batch: null` คู่กับ `layers.*.fetchedAt: null`
 *    ไม่ใช่ตารางว่างที่อ่านได้ว่า "แบบจำลองบอกว่าไม่มีอะไร"
 *
 * เรื่อง secret: token ถูก **ใส่/ถอดอย่างชัดเจนในทุกเทส** ไม่พึ่งว่าเครื่องที่รัน
 * มี `.dev.vars` หรือไม่ — ถ้าปล่อยให้ขึ้นกับสภาพเครื่อง เทสจะเขียวบนเครื่อง dev
 * แล้วแดงบน CI (หรือแย่กว่านั้นคือกลับกัน)
 */
const appEnv = env as unknown as AppEnv;
const TEST_TOKEN = "test-nwp-token";
/** คีย์แบบนี้ห้ามโผล่ในคำตอบพยากรณ์ — ค่าที่นี่เป็นค่าเชิงกำหนด ไม่ใช่ความน่าจะเป็น */
const FORBIDDEN_KEY_RE = /probab|chance|likelihood|risk/i;

const call = (path: string) => workerExports.default.fetch(new Request(`https://siahra-radar.co${path}`));

/** หนึ่ง tick ของ cron ผ่าน entrypoint จริง (env/ctx ถูกผูกให้โดย pool) */
const runCron = () =>
  (
    workerExports.default as unknown as { scheduled(): Promise<void> }
  ).scheduled();

function setToken(value: string | undefined): void {
  const mutable = env as unknown as Record<string, string | undefined>;
  if (value === undefined) delete mutable.TMD_NWP_TOKEN;
  else mutable.TMD_NWP_TOKEN = value;
}

/**
 * นับเฉพาะคำขอที่ไปที่ nwpapi — `runCron()` เดินงานทุกตัวในตาราง cron
 * (thaiwater, gistda, radar, …) คำขอของแหล่งอื่นจึงปนอยู่ใน mock ตัวเดียวกัน
 */
function nwpCallCount(): number {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([input]) => String(input).includes("/nwpapi/v1/forecast/location/")).length;
}

/** ต้นทาง TMD ปลอม — ทุกภาคได้ fixture ภาคใต้ชุดเดียวกัน (5 จังหวัด) */
function serveNwp(options: { status?: number; failRegions?: string[] } = {}): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host !== "data.tmd.go.th") throw new Error(`unexpected upstream call to ${url.host}`);
    if (options.status && options.status !== 200) {
      return new Response(JSON.stringify({ message: "no" }), { status: options.status });
    }
    const region = url.searchParams.get("region");
    if (region && options.failRegions?.includes(region)) return new Response("upstream boom", { status: 502 });
    if (url.pathname.endsWith("/hourly/region")) return json(hourlyFixture);
    if (url.pathname.endsWith("/daily/region")) return json(dailyFixture);
    if (url.pathname.endsWith("/location/daily")) return json({ daily_data: { min: "2026-08-23", max: "2026-09-02" } });
    throw new Error(`unexpected TMD NWP path ${url.pathname}`);
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

const statusOf = (name: string): Promise<SourceStatus> =>
  runInDurableObject(appEnv.FORECAST_NWP.getByName(name), (instance) => instance.status());

const rowCount = (name: string): Promise<number> =>
  runInDurableObject(
    appEnv.FORECAST_NWP.getByName(name),
    (_instance, state) =>
      state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM latest").toArray()[0]?.n ?? 0,
  );

beforeEach(() => {
  setToken(TEST_TOKEN);
  serveNwp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  setToken(undefined);
  await runInDurableObject(appEnv.FORECAST_NWP.getByName("primary"), (_i, ctx) => ctx.storage.deleteAlarm());
});

/** บล็อกนี้ต้องมาก่อนทุกบล็อกที่ทำให้ instance "primary" อุ่น — state อยู่ยาวข้าม block ในไฟล์เดียวกัน
 *  ("primary" ไม่ใช่ "tmd" ตามชื่อ instance จริงที่ production ใช้ตั้งแต่ 2026-08-24 — ดู index.ts) */
describe("ยังไม่เคยดึงสำเร็จ", () => {
  it("ตอบ 200 พร้อม batch: null และ fetchedAt เป็น null ทั้งสอง descriptor", async () => {
    const res = await call("/api/v1/provinces/10/forecast");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProvinceForecastResponse;
    expect(body.batch).toBeNull();
    // ยังไม่มีคำตอบของต้นทางให้นับ — ระยะที่ประกาศคือระยะที่ layer นี้จะ "ขอ"
    expect(body.layers.hourly.forecast!.horizonHours).toBe(48);
    expect(body.layers.hourly.fetchedAt).toBeNull();
    expect(body.layers.daily.fetchedAt).toBeNull();
    // เส้นทางคำขอต้องไม่ปลุกการดึงต้นทาง — cron เป็นคนขับรอบดึงเท่านั้น
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("รหัสจังหวัดที่ไม่มีจริงตอบ 404 ไม่ใช่ batch ว่าง", async () => {
    const res = await call("/api/v1/provinces/28/forecast");
    expect(res.status).toBe(404);
  });

  it("availability ที่ยังไม่เคยอ่านสำเร็จเป็น null คู่กับ fetchedAt: null", async () => {
    const res = await call("/api/v1/forecast/availability");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ daily: null, fetchedAt: null });
  });
});

describe("cron ขับรอบดึง แล้วเส้นทางอ่านผลออกมา", () => {
  it("รอบ cron ทำให้ DO ดึงต้นทางและตอบ descriptor ของชนิด forecast", async () => {
    // ยิงผ่าน `scheduled()` ของ entrypoint จริง ไม่ใช่เรียก DO ตรง ๆ — สิ่งที่ต้อง
    // พิสูจน์คือ "งานนี้อยู่ในตาราง cron จริง" ไม่ใช่แค่ตัว DO ทำงานได้
    // (pool 0.22 ไม่มี `SELF.scheduled` ให้เรียก)
    await runCron();

    // ตรึง "รูปการยิงต้นทาง" ไว้เหมือนที่ตรึงจำนวนแถวไว้ข้างล่าง: 6 ภาค × 2 ชุด
    // + availability = 13 คำขอ ถ้าวันหน้ามีคนเปลี่ยนไปยิงรายจังหวัด (77 หรือ 154)
    // เทสนี้จะแดงทันที แทนที่จะไปโผล่ที่โควตา datapoint ของ TMD เงียบ ๆ
    expect(nwpCallCount()).toBe(13);

    const res = await call("/api/v1/provinces/90/forecast");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProvinceForecastResponse;

    expect(body.batch).not.toBeNull();
    expect(body.batch!.provinceCode).toBe("90");
    expect(body.batch!.hourly).toHaveLength(48);
    expect(body.batch!.daily).toHaveLength(7);
    expect(body.batch!.queryPoint).toEqual({ lat: 7.207486, lon: 100.596251 });
    // rain: 0 คือค่าจริงที่ต้องอยู่รอดการเดินทางผ่าน JSON ใน DO จนถึงคำตอบ
    expect(body.batch!.hourly[0].rainMm).toBe(0);
    expect(body.batch!.daily.every((s) => s.tempC === null)).toBe(true);

    for (const kind of ["hourly", "daily"] as const) {
      const layer = body.layers[kind];
      expect(layer.epistemicClass).toBe("forecast");
      expect(layer.liveOrStatic).toBe("live");
      expect(layer.sourceIds).toEqual(["tmd-nwp"]);
      expect(layer.fetchedAt).toBe(body.batch!.fetchedAt);
      // ต้นทางไม่เผยแพร่เวลารอบรันของแบบจำลอง — ห้ามเติมจาก fetchedAt
      expect(layer.forecast!.issuedAt).toBeNull();
      // ตัวเลขความละเอียดกริดยังตรวจสอบไม่ได้ → null ไม่ใช่เลขที่เดาเอา
      expect(layer.forecast!.resolutionKm).toBeNull();
    }
    // สองชุดมีระยะพยากรณ์ต่างกันจริง นี่คือเหตุผลที่ต้องมีสอง descriptor
    // และตัวเลขนับจากขั้นที่ต้นทางส่งมาจริง (48 ขั้น × 1 ชม. / 7 ขั้น × 24 ชม.)
    expect(body.layers.hourly.forecast!.horizonHours).toBe(body.batch!.hourly.length);
    expect(body.layers.hourly.forecast!.horizonHours).toBe(48);
    expect(body.layers.daily.forecast!.horizonHours).toBe(body.batch!.daily.length * 24);
    expect(body.layers.daily.forecast!.horizonHours).toBe(168);
  });

  it("เขียนหนึ่งแถวต่อหนึ่งจังหวัด ไม่ใช่หนึ่งแถวต่อขั้นพยากรณ์", async () => {
    const status = await statusOf("primary");
    const rows = await rowCount("primary");
    // fixture มี 5 จังหวัด × (48 + 7) ขั้น = 275 ขั้น ถ้าเก็บเป็นแถวละขั้นจะได้ 275
    expect(rows).toBe(5);
    expect(rows).toBe(status.detail.provinces);
    expect(rows).toBeLessThanOrEqual(77);
  });

  it("/health รายงาน tmd-nwp เป็น ok พร้อมช่วงข้อมูลที่ต้นทางประกาศ", async () => {
    const status = await statusOf("primary");
    expect(status.id).toBe("tmd-nwp");
    expect(status.health).toBe("ok");
    expect(status.lastError).toBeNull();
    expect(status.fetchedAt).not.toBeNull();
    // พยากรณ์ไม่มีเวลาตรวจวัด — ยัด valid time ในอนาคตลงช่องนี้ไม่ได้
    expect(status.latestObservedAt).toBeNull();
    expect(status.observedLagSeconds).toBeNull();
    expect(status.detail.dailyAvailability).toBe("2026-08-23..2026-09-02");
    expect(status.nextAttemptAt).not.toBeNull();
  });

  it("คำตอบพยากรณ์ไม่มีคีย์ที่อ่านได้ว่าเป็นความน่าจะเป็น", async () => {
    const res = await call("/api/v1/provinces/90/forecast");
    const offenders: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) return value.slice(0, 5).forEach((v, i) => walk(v, `${path}[${i}]`));
      if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (FORBIDDEN_KEY_RE.test(k)) offenders.push(`${path}.${k}`);
          walk(v, `${path}.${k}`);
        }
      }
    };
    walk(await res.json(), "forecast");
    expect(offenders).toEqual([]);
  });
});

describe("ความล้มเหลวต้องมองเห็น", () => {
  it("บางภาคพัง: เก็บของที่สำเร็จไว้ และบอกชื่อภาคที่ถามไม่สำเร็จ", async () => {
    const name = "nwp-partial";
    serveNwp({ failRegions: ["N", "NE"] });
    await runInDurableObject(appEnv.FORECAST_NWP.getByName(name), (instance) => instance.alarm());

    const status = await statusOf(name);
    expect(status.health).toBe("degraded");
    expect(status.detail.regionsOk).toBe(4);
    // ต้องบอกว่าภาคไหน — "แหล่งเงียบ" กับ "เราถามไม่สำเร็จ" คนละเรื่อง
    expect(String(status.lastError)).toContain("N:");
    expect(await rowCount(name)).toBe(5);
    expect(status.fetchedAt).not.toBeNull();
  });

  it("พังทุกภาค: ไม่เขียนทับของเดิม และไม่ขยับ fetchedAt", async () => {
    const name = "nwp-all-failed";
    const stub = appEnv.FORECAST_NWP.getByName(name);
    await runInDurableObject(stub, (instance) => instance.alarm());
    const good = await statusOf(name);
    expect(good.fetchedAt).not.toBeNull();

    serveNwp({ failRegions: ["C", "N", "NE", "E", "S", "W"] });
    await runInDurableObject(stub, (instance) => instance.alarm());
    const after = await statusOf(name);
    expect(after.fetchedAt).toBe(good.fetchedAt);
    expect(after.lastAttemptAt).not.toBe(good.lastAttemptAt);
    expect(after.detail.regionsOk).toBe(0);
    // รอบที่พังทั้งหมดไม่ได้เขียนแถวไหนเลย ตัวเลขของรอบก่อนต้องไม่ค้าง
    expect(after.detail.writtenLastRound).toBe(0);
    expect(await rowCount(name)).toBe(5);
    // ของเดิมยังอ่านออกและยังพก fetchedAt ของรอบที่มันมาจริง ๆ
    const held = await runInDurableObject(stub, (instance) => instance.getProvince("90"));
    expect(held.batch!.fetchedAt).toBe(good.fetchedAt);
    expect(held.layers.hourly.fetchedAt).toBe(good.fetchedAt);
  });

  /**
   * cron เดินทุกนาที แต่รอบที่พังทั้งรอบไม่เขียน `fetchedAt` เงื่อนไข "ครบชั่วโมง
   * หรือยัง" จึงเป็นจริงตลอดเวลาที่ต้นทางล่ม ถ้า `ensureFresh()` ไม่มีตัวกั้น มันจะ
   * ยิงต้นทางใหม่ทั้ง 12 คำขอทุกนาที = ลบ backoff 5 นาทีของ `alarm()` ทิ้ง และ
   * กลายเป็นการถล่มต้นทางที่กำลังมีปัญหา เทสนี้ตรึงตัวกั้นนั้นไว้
   */
  /**
   * โควตา datapoint ของ TMD เป็น **รายชั่วโมง** และเคสที่กัดคือต้นทางเปลี่ยนรูป
   * ข้อมูล: ตอบ 200 (จ่าย datapoint ไปแล้ว) แต่ schema ไม่ผ่าน ทุกภาคจึงพังพร้อมกัน
   * ถ้าถอยแค่ RETRY_MS จะกลายเป็น 12 รอบ/ชม. ≈ 146k datapoint ทะลุเพดาน 100k
   * รอบที่พังเพราะโควตาจึงต้องถอยเท่ารอบปกติ ไม่ใช่ถอยสั้น
   */
  it("โควตาต้นทางใกล้หมด: ถอยยาวเท่ารอบปกติ ไม่ใช่ลองใหม่ใน RETRY_MS", async () => {
    const name = "nwp-quota";
    const stub = appEnv.FORECAST_NWP.getByName(name);
    // ต้นทางตอบ 200 แต่บอกว่าโควตาเหลือน้อยกว่าราคาหนึ่งรอบ
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ WeatherForecasts: [] }), {
        headers: { "content-type": "application/json", "x-datapoint-remaining": "10" },
      }),
    );
    const before = Date.now();
    await runInDurableObject(stub, (instance) => instance.alarm());

    const st = await statusOf(name);
    expect(st.fetchedAt).toBeNull();
    expect(st.lastError).toMatch(/quota/i);
    // นัดครั้งถัดไปต้องห่างกว่า RETRY_MS (5 นาที) มาก — คือระยะรอบปกติ 1 ชม.
    const nextMs = Date.parse(st.nextAttemptAt!);
    expect(nextMs - before).toBeGreaterThan(30 * 60 * 1000);
  });

  it("ต้นทางล่ม: cron รอบถัดมาที่ยังไม่พ้น RETRY_MS ต้องไม่ยิงต้นทางซ้ำ", async () => {
    const name = "nwp-cron-backoff";
    const stub = appEnv.FORECAST_NWP.getByName(name);
    serveNwp({ failRegions: ["C", "N", "NE", "E", "S", "W"] });
    await runInDurableObject(stub, (instance) => instance.alarm());
    const failed = await statusOf(name);
    expect(failed.fetchedAt).toBeNull();

    const before = nwpCallCount();
    await runInDurableObject(stub, (instance) => instance.ensureFresh());
    expect(nwpCallCount() - before).toBe(0);
    // lastAttemptAt ของรอบที่พังต้องไม่ถูกเขียนทับ — เป็นตัวที่กั้นรอบถัดไปอยู่
    expect((await statusOf(name)).lastAttemptAt).toBe(failed.lastAttemptAt);
  });

  it("token ถูกปฏิเสธ (401) รายงานว่ากุญแจถูกปฏิเสธ ไม่ใช่ 'ไม่มีข้อมูล'", async () => {
    const name = "nwp-401";
    serveNwp({ status: 401 });
    await runInDurableObject(appEnv.FORECAST_NWP.getByName(name), (instance) => instance.alarm());
    const status = await statusOf(name);
    expect(status.lastError).toContain("TMD NWP token rejected (401)");
    // ไม่เคยดึงสำเร็จเลย + มี error = down (ไม่ใช่ ok เพราะ "ไม่มีใครบ่น")
    expect(status.health).toBe("down");
  });

  it("ไม่มี secret เลย: บอกว่าไม่ได้ตั้ง token และไม่ยิงไปหาต้นทางเลย", async () => {
    const name = "nwp-no-token";
    setToken(undefined);
    await runInDurableObject(appEnv.FORECAST_NWP.getByName(name), (instance) => instance.alarm());
    const status = await statusOf(name);
    expect(status.lastError).toBe("TMD NWP token not configured");
    expect(status.fetchedAt).toBeNull();
    // "เราไม่มีกุญแจจะถาม" ต้องไม่ถูกรายงานเป็น "ถามแล้วต้นทางเงียบ"
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
