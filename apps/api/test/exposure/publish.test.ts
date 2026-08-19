import { env, exports as workerExports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FloodExposureRun,
  HealthResponse,
  RainfallObservation,
  SourceStatus,
  WaterLevelObservation,
} from "@siahra/shared-types";
import { getJsonGz, putJsonGz } from "../../src/archive";
import { isContentAddressed } from "../../src/cachePolicy";
import { EXPOSURE_POINTER_NAME, RUN_ID_RE, exposureRunKey, runContentHash } from "../../src/exposure/publish";
import type { AppEnv } from "../../src/types";

/**
 * E10.3 — การเผยแพร่ run ลง R2 (ฝั่ง Durable Object)
 *
 * สามข้อที่ไฟล์นี้ต้องพิสูจน์ และเป็นสามข้อที่พังเงียบที่สุดถ้าไม่มีเทส:
 * 1. `exposure/runs/{runId}.json.gz` **ไม่ถูกเขียนทับ** — มันถูกเสิร์ฟ immutable หนึ่งปี
 * 2. เนื้อหาเท่าเดิม = **ไม่เผยแพร่ซ้ำ** (runId คิดจากเนื้อหา) และเปลี่ยนแม้แต่
 *    ค่าตรวจวัดเดียวโดยระดับไม่ขยับ = **ต้องได้ run ใหม่**
 * 3. การเผยแพร่ที่ล้มเหลว **ห้ามพานัด alarm ตายไปด้วย** — ไม่งั้นการเขียน R2
 *    พลาดครั้งเดียวจะหยุดการดึงค่าตรวจวัดทั้งระบบ (production มี cron กลบไว้
 *    `wrangler dev` ไม่มี) และต้องโผล่ที่ /health เป็น `lastError` ไม่ใช่ความเงียบ
 *
 * เวลาไม่ถูกแช่ด้วย fake timer แต่ **ส่งเข้าไปตรง ๆ** ผ่าน `publishExposure(nowMs)`
 * — `computeExposure` ไม่อ่านนาฬิกาเอง อินพุตเดิม + เวลาเดิม จึงได้ `runId` เดิมเป๊ะ
 */

const appEnv = env as unknown as AppEnv;
const stub = () => appEnv.OBSERVATION_CACHE.getByName("thaiwater");
const bucket = () => appEnv.HAZARD_BUCKET;

/** เมธอดภายในที่เทสเรียกตรง เพื่อคุมเวลาและตัดเรื่องเครือข่ายออกจากสมการ */
interface Internals {
  publishExposure(nowMs: number): Promise<void>;
  refresh(nowMs: number): Promise<void>;
  alarm(): Promise<void>;
  ensureFresh(): Promise<void>;
  getObservations(province?: string | null, atIso?: string | null): Promise<unknown>;
  env: { HAZARD_BUCKET: R2Bucket };
}

const T0 = Date.UTC(2026, 7, 19, 9, 0, 0);

function station(id: number, provinceCode: string | null) {
  return {
    id,
    nameTh: `สถานี ${id}`,
    nameEn: `Station ${id}`,
    lat: 13 + id / 100,
    lon: 100 + id / 100,
    provinceCode,
    provinceNameTh: null,
    amphoeNameTh: null,
    basinNameTh: null,
    agencyShortTh: null,
  };
}

function rain(id: number, provinceCode: string | null, rain1h: number, observedAt: string): RainfallObservation {
  return { station: station(id, provinceCode), rain1h, rain24h: 2, observedAt };
}

function water(id: number, provinceCode: string | null, freeboardM: number, observedAt: string): WaterLevelObservation {
  return {
    station: station(id, provinceCode),
    waterlevelMsl: 5,
    waterlevelLocalM: null,
    minBankMsl: 5 + freeboardM,
    groundLevelMsl: null,
    freeboardM,
    situationLevel: 2,
    storagePercent: null,
    observedAt,
  };
}

/** เขียนแถวสถานีและ meta ลง SQLite ของ DO ตรง ๆ — ตัดต้นทางจริงออกจากเทสนี้ */
async function seed(rows: { rain: RainfallObservation[]; water: WaterLevelObservation[]; fetchedAt: string }) {
  await runInDurableObject(stub(), (_instance, state) => {
    const sql = state.storage.sql;
    sql.exec("DELETE FROM rainfall");
    sql.exec("DELETE FROM waterlevel");
    for (const r of rows.rain) {
      sql.exec(
        "INSERT OR REPLACE INTO rainfall (station_id, province_code, rain_24h, observed_at, payload) VALUES (?, ?, ?, ?, ?)",
        r.station.id,
        r.station.provinceCode,
        r.rain24h,
        r.observedAt,
        JSON.stringify(r),
      );
    }
    for (const w of rows.water) {
      sql.exec(
        "INSERT OR REPLACE INTO waterlevel (station_id, province_code, situation_level, observed_at, payload) VALUES (?, ?, ?, ?, ?)",
        w.station.id,
        w.station.provinceCode,
        w.situationLevel,
        w.observedAt,
        JSON.stringify(w),
      );
    }
    sql.exec(
      "INSERT INTO meta (key, value) VALUES ('fetchedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      rows.fetchedAt,
    );
  });
}

async function publishAt(nowMs: number): Promise<void> {
  await runInDurableObject(stub(), async (instance) => {
    await (instance as unknown as Internals).publishExposure(nowMs);
  });
}

async function meta(key: string): Promise<string | null> {
  return runInDurableObject(stub(), (_instance, state) =>
    state.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)
      .toArray()[0]?.value ?? null,
  );
}

async function pointer() {
  return appEnv.FORECAST_POINTER.getByName(EXPOSURE_POINTER_NAME).getLatest();
}

/** นับเฉพาะการเขียนคีย์ของ exposure — งานคลังถาวรเขียน R2 ของมันเองคนละคีย์ */
function countExposurePuts(instance: unknown): { keys: string[]; restore: () => void } {
  const target = (instance as Internals).env.HAZARD_BUCKET;
  const keys: string[] = [];
  const original = target.put.bind(target) as (...args: unknown[]) => unknown;
  const spy = vi.spyOn(target, "put").mockImplementation(((...args: unknown[]) => {
    const key = args[0];
    if (typeof key === "string" && key.startsWith("exposure/runs/")) keys.push(key);
    return original(...args);
  }) as never);
  return { keys, restore: () => spy.mockRestore() };
}

beforeEach(() => {
  // ไม่มีเทสในไฟล์นี้ต้องการเครือข่าย: ถ้ามีเส้นทางไหนแอบยิงต้นทาง จะพังทันที
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("network disabled in this test");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("การเผยแพร่ exposure run", () => {
  it("เผยแพร่ run แรกลง R2 ด้วยคีย์ที่ frozenArtifact ยอมรับ แล้วชี้ตัวชี้ไปที่มัน", async () => {
    await seed({
      rain: [rain(1, "10", 1, "2026-08-19T08:00:00.000Z")],
      water: [water(2, "50", 4, "2026-08-19T08:30:00.000Z")],
      fetchedAt: "2026-08-19T08:55:00.000Z",
    });
    await publishAt(T0);

    const runId = await meta("exposureRunId");
    expect(runId).toMatch(RUN_ID_RE);
    const key = exposureRunKey(runId as string);
    // AC: รูป runId ที่เลือกต้องผ่าน isContentAddressed ไม่ใช่ไปผ่อนนโยบายให้มัน
    expect(isContentAddressed(key)).toBe(true);
    // เก็บเป็น gzip: อ่านด้วย getJsonGz — ถ้าคีย์ถูกเขียนเป็น JSON ดิบ บรรทัดนี้พัง
    expect(await bucket().head(key)).not.toBeNull();
    const run = (await getJsonGz<FloodExposureRun>(bucket(), key))!;
    expect(run.runId).toBe(runId);
    expect(run.layer.epistemicClass).toBe("illustrative");
    expect(run.stations.map((s) => s.stationId)).toEqual([1, 2]);
    expect(await pointer()).toMatchObject({ runId, manifestKey: key });
  });

  it("รอบที่เนื้อหาไม่เปลี่ยนไม่เขียน R2 ซ้ำ (runId คิดจากเนื้อหา)", async () => {
    const before = await meta("exposureRunId");
    let keys: string[] = [];
    await runInDurableObject(stub(), async (instance) => {
      const spy = countExposurePuts(instance);
      keys = spy.keys;
      await (instance as unknown as Internals).publishExposure(T0);
      spy.restore();
    });
    expect(keys).toEqual([]);
    expect(await meta("exposureRunId")).toBe(before);
  });

  it("คีย์เดิมไม่ถูกเขียนทับ แม้ถูกสั่งให้เผยแพร่ซ้ำด้วย runId เดิม", async () => {
    const runId = (await meta("exposureRunId")) as string;
    const key = exposureRunKey(runId);
    // ปลอมเนื้อหาที่ R2 แล้วล้าง "ลายนิ้วมือเนื้อหา" ทิ้ง เพื่อให้รอบถัดไปตัดสินใจ
    // ว่าต้องเผยแพร่ (ถ้าโค้ดเขียนทับ ค่านี้จะหาย = เทสจับได้)
    await putJsonGz(bucket(), key, { sentinel: true });
    await runInDurableObject(stub(), (_i, state) => {
      state.storage.sql.exec("DELETE FROM meta WHERE key = 'exposureContentHash'");
    });

    await publishAt(T0);

    const stored = (await getJsonGz<{ sentinel?: boolean }>(bucket(), key))!;
    expect(stored.sentinel, "artefact ที่เผยแพร่แล้วถูกเขียนทับ").toBe(true);
    // ตัวชี้ยังชี้ไปที่ run เดิมตามปกติ
    expect(await pointer()).toMatchObject({ runId });
  });

  it("ค่าตรวจวัดเปลี่ยนโดยระดับไม่เปลี่ยน = run ใหม่ และเขียน R2 ครั้งเดียว", async () => {
    const previous = (await meta("exposureRunId")) as string;
    // ฝน 1 → 3 มม. (ยังอยู่แถบ low เหมือนเดิม) และเวลาตรวจวัดขยับ
    await seed({
      rain: [rain(1, "10", 3, "2026-08-19T09:00:00.000Z")],
      water: [water(2, "50", 4, "2026-08-19T08:30:00.000Z")],
      fetchedAt: "2026-08-19T08:55:00.000Z",
    });

    let keys: string[] = [];
    await runInDurableObject(stub(), async (instance) => {
      const spy = countExposurePuts(instance);
      keys = spy.keys;
      await (instance as unknown as Internals).publishExposure(T0 + 60_000);
      spy.restore();
    });

    const runId = (await meta("exposureRunId")) as string;
    expect(runId).not.toBe(previous);
    expect(runContentHash(runId)).not.toBe(runContentHash(previous));
    expect(keys).toEqual([exposureRunKey(runId)]);
    const run = (await getJsonGz<FloodExposureRun>(bucket(), exposureRunKey(runId)))!;
    const s1 = run.stations.find((s) => s.stationId === 1)!;
    expect(s1.factors.rain1hMm).toBe(3);
    expect(s1.level).toBe("low");
    expect(s1.observedAt).toBe("2026-08-19T09:00:00.000Z");
    // run เดิมยังอยู่ครบ ไม่ถูกลบหรือทับ
    expect(await bucket().head(exposureRunKey(previous))).not.toBeNull();
  });
});

describe("การเผยแพร่ที่ล้มเหลว", () => {
  it("alarm ที่เผยแพร่ไม่สำเร็จ ยังตั้งนัดครั้งถัดไป และความล้มเหลวโผล่ที่ /health", async () => {
    await seed({
      rain: [rain(9, "10", 55, "2026-08-19T09:10:00.000Z")],
      water: [],
      fetchedAt: new Date().toISOString(),
    });
    // ล้างลายนิ้วมือ เพื่อให้รอบนี้ต้องเผยแพร่จริง แล้วบังคับให้ R2 put พัง
    await runInDurableObject(stub(), (_i, state) => {
      state.storage.sql.exec("DELETE FROM meta WHERE key = 'exposureContentHash'");
      void state.storage.deleteAlarm();
    });

    await runInDurableObject(stub(), async (instance, state) => {
      const target = (instance as unknown as Internals).env.HAZARD_BUCKET;
      vi.spyOn(target, "put").mockRejectedValue(new Error("R2 put refused (test)"));
      await (instance as unknown as { alarm(): Promise<void> }).alarm();
      // นัดครั้งถัดไปต้องยังอยู่ — นี่คือหัวใจของข้อนี้
      expect(await state.storage.getAlarm()).not.toBeNull();
    });

    expect(await meta("exposureError")).toContain("R2 put refused");

    const res = await workerExports.default.fetch(new Request("https://siahra-radar.co/api/v1/health"));
    const body = (await res.json()) as HealthResponse;
    const source = body.sources.find((s) => s.id === "exposure-illustrative") as SourceStatus;
    expect(source, "/health ไม่มีแหล่ง exposure-illustrative").toBeTruthy();
    expect(source.lastError).toContain("R2 put refused");
    expect(["degraded", "down"]).toContain(source.health);
    expect(body.ok).toBe(false);
  });
});

describe("สถานะบน /health", () => {
  it("ไม่มี run ใหม่เกิน 30 นาที → delayed (ไม่ใช่ stale) แม้เวลาดึงต้นทางจะเก่าเท่ากัน", async () => {
    const nowMs = Date.now();
    await runInDurableObject(stub(), (_i, state) => {
      const sql = state.storage.sql;
      const put = (key: string, value: string) =>
        sql.exec(
          "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          key,
          value,
        );
      // สถานการณ์ตามตัวอักษรของ AC: เผยแพร่ run แล้วเงียบไป 31 นาที — ทั้งเวลาดึง
      // ต้นทางและเวลาของ run เก่าพอกัน ถ้าบันไดสุขภาพถูกป้อนผิด ค่าที่ได้จะเป็น
      // `stale` (ฝั่งเราหยุดดึง) แทนที่จะเป็น `delayed` (ไม่มีอะไรใหม่ให้จัดอันดับ)
      put("fetchedAt", new Date(nowMs - 31 * 60_000).toISOString());
      put("exposureRunAt", new Date(nowMs - 31 * 60_000).toISOString());
      put("exposureObservedAt", new Date(nowMs - 45 * 60_000).toISOString());
      sql.exec("DELETE FROM meta WHERE key = 'exposureError'");
    });
    const status = await stub().exposureStatus();
    expect(status.id).toBe("exposure-illustrative");
    expect(status.health).toBe("delayed");
    expect(status.lastError).toBeNull();
    expect(status.staleAfterSeconds).toBe(3600);
    expect(status.observedLagSeconds).toBe(1800);
  });

  it("มี run ใหม่เมื่อกี้ → ok แม้ค่าตรวจวัดของ ThaiWater จะเก่ากว่านั้นตามปกติของมัน", async () => {
    const nowMs = Date.now();
    await runInDurableObject(stub(), (_i, state) => {
      const put = (key: string, value: string) =>
        state.storage.sql.exec(
          "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          key,
          value,
        );
      put("fetchedAt", new Date(nowMs - 60_000).toISOString());
      put("exposureRunAt", new Date(nowMs - 60_000).toISOString());
      // เวลาตรวจวัดแกว่ง 17–77 นาทีเป็นเรื่องปกติของต้นทาง ห้ามทำให้แหล่งนี้ delayed
      put("exposureObservedAt", new Date(nowMs - 50 * 60_000).toISOString());
    });
    expect((await stub().exposureStatus()).health).toBe("ok");
  });
});

/**
 * นัด alarm ต้องถูกตั้งใหม่เสมอ แม้รอบนั้นจะพัง — ทั้งสามจุดที่เรียก `refreshOnce()`
 *
 * บล็อกนี้บังคับให้ **`refresh()` reject** ไม่ใช่ให้ `fetch` พัง เพราะ `refresh()`
 * ห่อการยิงต้นทางทั้งสองด้วย `.catch()` ของตัวเองอยู่แล้ว (ความล้มเหลวไปโผล่ที่
 * `errors[]`) และ `publishExposure()` ก็มี try/catch ครอบทั้งเมธอด — ทางที่ "ดู
 * เหมือนพัง" สองทางนั้นจึงไม่มีทางทำให้ `refreshOnce()` reject เลย และเทสที่ใช้มัน
 * จะผ่านทั้งที่ `finally` ถูกถอดออก (เทสกลวง) การ assert `rejects.toThrow` จึงเป็น
 * ส่วนที่รับน้ำหนัก: มันพิสูจน์ว่าความล้มเหลวเดินทางถึงผู้เรียกจริง
 *
 * และ **ห้าม** ทำให้ `state.storage.sql.exec` โยนแทน — `armAlarm()` เองก็อ่าน
 * `consecutiveFailures` ผ่าน sql เทสจะแดงกับโค้ดที่ถูกต้อง
 *
 * สองจุดหลัง (`ensureFresh` / `getObservations`) จะเข้า `refreshOnce()` ก็ต่อเมื่อ
 * `isFresh()` เป็นเท็จ ซึ่งอ่านจาก meta `fetchedAt` — บล็อกก่อนหน้าในไฟล์นี้ใส่
 * `fetchedAt` เป็นเวลาปัจจุบันไว้ ถ้าไม่ลบทิ้งก่อน ทั้งสองจะข้าม refresh ไปเฉย ๆ
 * แล้วกลายเป็นเทสกลวงอีกแบบหนึ่ง
 */
describe("นัด alarm ไม่ตายไปกับรอบที่พัง", () => {
  /** ล้างนัดเดิมและ `fetchedAt` ให้ทุกเคสเริ่มจากศูนย์ แล้วบังคับ refresh ให้ reject */
  async function armWithFailingRefresh(
    trigger: (instance: Internals) => Promise<unknown>,
    { clearFetchedAt }: { clearFetchedAt: boolean },
  ) {
    await runInDurableObject(stub(), async (instance, state) => {
      await state.storage.deleteAlarm();
      if (clearFetchedAt) state.storage.sql.exec("DELETE FROM meta WHERE key = 'fetchedAt'");
      // ไม่มีนัดค้างอยู่แล้วจริง ๆ — ไม่งั้นนัดเก่าจะทำให้ assert ผ่านได้เอง
      expect(await state.storage.getAlarm(), "ยังมีนัดค้างจากบล็อกก่อนหน้า").toBeNull();

      const internals = instance as unknown as Internals;
      vi.spyOn(internals, "refresh").mockRejectedValue(new Error("refresh boom"));
      await expect(trigger(internals)).rejects.toThrow("refresh boom");

      expect(await state.storage.getAlarm(), "รอบพังแล้วไม่มีนัดครั้งถัดไปเหลืออยู่").not.toBeNull();
    });
  }

  it("alarm(): refresh พัง → ยังตั้งนัดครั้งถัดไป", async () => {
    await armWithFailingRefresh((i) => i.alarm(), { clearFetchedAt: true });
  });

  it("ensureFresh(): refresh พัง → ยังตั้งนัดครั้งถัดไป", async () => {
    await armWithFailingRefresh((i) => i.ensureFresh(), { clearFetchedAt: true });
  });

  it("getObservations() (เส้นทาง lazy ตอน cold start): refresh พัง → ยังตั้งนัดครั้งถัดไป", async () => {
    await armWithFailingRefresh((i) => i.getObservations(null), { clearFetchedAt: true });
  });
});
