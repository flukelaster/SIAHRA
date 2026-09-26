import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NorthRouteResponse, WaterLevelObservation } from "@siahra/shared-types";
import { NORTH_ROUTE_STATIONS } from "../src/data/northRoute";
import { handleNorthRoute } from "../src/routes/rivers";
import type { AppEnv } from "../src/types";

/**
 * E16 — เส้นทางน้ำเหนือ: ข้อบังคับต้นทุนจาก devops ถูกตรึงไว้ที่นี่
 *   C1 cache miss = RPC ไป ObservationCacheDO ครั้งเดียว ไม่แตะ DO อื่น
 *   C2 `northRoute()` อ่านอย่างเดียว ไม่ยิงต้นทาง ไม่เขียน
 *   C5 แคชที่ขอบ 120 วิ คีย์ไม่มี query string (มี query = 400)
 *   C6/C7/C8 `pullRouteHistory()` ชั่วโมงละครั้ง, ความล้มเหลวไม่แตะสถานะฟีดหลัก และหยุดที่
 *   สถานีแรกที่พัง, เขียนเฉพาะจุดที่ใหม่กว่าที่มีอยู่
 */

const appEnv = env as unknown as AppEnv;
const HOUR = 3_600_000;

interface Internals {
  pullRouteHistory(nowMs: number): Promise<void>;
  northRoute(): Promise<NorthRouteResponse>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler (C1, C5)
// ─────────────────────────────────────────────────────────────────────────────

function fakeEnv(body: unknown) {
  const calls = { getByName: [] as string[], northRoute: 0 };
  const stub = {
    northRoute: async () => {
      calls.northRoute++;
      return body;
    },
  };
  const forbidden = new Proxy(
    {},
    {
      get() {
        throw new Error("this route must not touch any other binding");
      },
    },
  );
  const fake = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "OBSERVATION_CACHE") {
          return {
            getByName: (name: string) => {
              calls.getByName.push(name);
              return stub;
            },
          };
        }
        return forbidden;
      },
    },
  ) as unknown as AppEnv;
  return { env: fake, calls };
}

function fakeCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return { ctx, settle: () => Promise.all(pending) };
}

const SAMPLE: NorthRouteResponse = {
  layer: {
    id: "north-route-observations",
    epistemicClass: "observed",
    liveOrStatic: "live",
    publishedAt: null,
    fetchedAt: null,
    sourceIds: ["thaiwater"],
  },
  fetchedAt: null,
  windowHours: 48,
  stations: [],
};

describe("GET /api/v1/rivers/north — handler", () => {
  it("cache miss = RPC northRoute() ครั้งเดียว, ครั้งถัดไปตอบจากแคชที่ขอบ", async () => {
    // origin ของเทสนี้เท่านั้น — กันแคชชนกับเทสอื่นในไฟล์เดียวกัน
    const url = "https://rivers-cache.test/api/v1/rivers/north";
    const { env: fake, calls } = fakeEnv(SAMPLE);
    const a = fakeCtx();
    const first = await handleNorthRoute(new Request(url), fake, a.ctx);
    await a.settle();
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=120");
    expect(calls.northRoute).toBe(1);
    expect(calls.getByName).toEqual(["thaiwater"]);

    const b = fakeCtx();
    const second = await handleNorthRoute(new Request(url), fake, b.ctx);
    await b.settle();
    expect(second.status).toBe(200);
    expect(calls.northRoute).toBe(1);
    expect(((await second.json()) as NorthRouteResponse).windowHours).toBe(48);
  });

  it("query string ใด ๆ = 400 ก่อนถึงแคชและ DO (แตกแคชด้วย ?t= ไม่ได้)", async () => {
    const { env: fake, calls } = fakeEnv(SAMPLE);
    const { ctx } = fakeCtx();
    const res = await handleNorthRoute(new Request("https://rivers-q.test/api/v1/rivers/north?t=1"), fake, ctx);
    expect(res.status).toBe(400);
    expect(calls.northRoute).toBe(0);
    expect(calls.getByName).toEqual([]);
  });

  it("DO ล้มเหลว = 503 no-store (ไม่ถูกแคช)", async () => {
    const url = "https://rivers-fail.test/api/v1/rivers/north";
    const fake = {
      OBSERVATION_CACHE: {
        getByName: () => ({
          northRoute: async () => {
            throw new Error("boom");
          },
        }),
      },
    } as unknown as AppEnv;
    const { ctx, settle } = fakeCtx();
    const res = await handleNorthRoute(new Request(url), fake, ctx);
    await settle();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await caches.default.match(new Request(url))).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ObservationCacheDO.northRoute() (C2, C3) และ pullRouteHistory() (C6–C8)
// ─────────────────────────────────────────────────────────────────────────────

const stub = () => appEnv.OBSERVATION_CACHE.getByName("rivers-north-test");
const FIRST = NORTH_ROUTE_STATIONS[0];

/** แถว waterlevel แบบก่อน E16 — ไม่มีฟิลด์ใหม่เลย (ต้องถูกเติมเป็น null ตอนอ่าน) */
function legacyPayload(id: number): Omit<WaterLevelObservation, "dischargeM3s" | "qmaxM3s" | "criticalLevelMsl"> {
  return {
    station: {
      id,
      nameTh: "ทดสอบ",
      nameEn: null,
      lat: 18.8,
      lon: 99,
      provinceCode: "50",
      provinceNameTh: null,
      amphoeNameTh: null,
      basinNameTh: null,
      agencyShortTh: null,
    } as WaterLevelObservation["station"],
    waterlevelMsl: 301.7,
    waterlevelLocalM: null,
    minBankMsl: 304.2,
    groundLevelMsl: null,
    freeboardM: 2.5,
    situationLevel: 2,
    storagePercent: null,
    observedAt: new Date(Date.now() - HOUR).toISOString(),
  };
}

async function reset(): Promise<void> {
  await runInDurableObject(stub(), (_i, state) => {
    state.storage.sql.exec("DELETE FROM waterlevel");
    state.storage.sql.exec("DELETE FROM waterlevel_history");
    state.storage.sql.exec("DELETE FROM history_meta");
    state.storage.sql.exec("DELETE FROM meta");
  });
}

async function historyRows(stationId: number): Promise<number> {
  return runInDurableObject(stub(), (_i, state) =>
    state.storage.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM waterlevel_history WHERE station_id = ?", stationId)
      .toArray()[0]!.n,
  );
}

async function meta(key: string): Promise<string | null> {
  return runInDurableObject(stub(), (_i, state) =>
    state.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value ?? null,
  );
}

/** "YYYY-MM-DD HH:MM" เวลาไทย ตามที่ waterlevel_graph ส่ง */
function bangkok(ms: number): string {
  return new Date(ms + 7 * HOUR).toISOString().slice(0, 16).replace("T", " ");
}

function graphResponder(pointsMs: () => number[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          data: { graph_data: pointsMs().map((t) => ({ datetime: bangkok(t), value: 10, discharge: "100" })) },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
}

beforeEach(async () => {
  await reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ObservationCacheDO.northRoute()", () => {
  it("อ่านอย่างเดียว: ≤ 48 ชม., ไม่ยิงต้นทาง, แถวก่อน E16 ได้ฟิลด์ใหม่เป็น null", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("northRoute() must not reach any upstream");
    });
    const now = Date.now();
    await runInDurableObject(stub(), (_i, state) => {
      const sql = state.storage.sql;
      sql.exec(
        "INSERT INTO waterlevel (station_id, province_code, situation_level, observed_at, payload) VALUES (?, ?, ?, ?, ?)",
        FIRST.thaiwaterId,
        "50",
        2,
        null,
        JSON.stringify(legacyPayload(FIRST.thaiwaterId)),
      );
      for (const [t, q] of [
        [now - 50 * HOUR, 90],
        [now - 47 * HOUR, 95],
        [now - HOUR, -1],
      ] as const) {
        sql.exec("INSERT INTO waterlevel_history (station_id, ts_ms, value, discharge) VALUES (?, ?, ?, ?)", FIRST.thaiwaterId, t, 10, q);
      }
      sql.exec("INSERT INTO history_meta (station_id, fetched_ms, datum) VALUES (?, ?, ?)", FIRST.thaiwaterId, now - 10 * 60_000, "msl");
    });

    const body = await runInDurableObject(stub(), (instance) => (instance as unknown as Internals).northRoute());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(body.windowHours).toBe(48);
    expect(body.stations).toHaveLength(NORTH_ROUTE_STATIONS.length);
    // ไม่เคยดึงสำเร็จ = null ไม่ใช่เวลาปัจจุบัน
    expect(body.fetchedAt).toBeNull();
    expect(body.layer).toMatchObject({ epistemicClass: "observed", fetchedAt: null, publishedAt: null, sourceIds: ["thaiwater"] });

    const first = body.stations[0];
    expect(first.ridCode).toBe(FIRST.ridCode);
    expect(first.history48h).toHaveLength(2);
    for (const p of first.history48h) expect(Date.parse(p.t)).toBeGreaterThanOrEqual(now - 48 * HOUR);
    // อัตราการไหลติดลบในประวัติ = ไม่มีข้อมูล
    expect(first.history48h.at(-1)!.discharge).toBeNull();
    expect(first.datum).toBe("msl");
    expect(first.historyFetchedAt).not.toBeNull();
    expect(first.latest?.dischargeM3s).toBeNull();
    expect(first.latest?.qmaxM3s).toBeNull();
    expect(first.latest?.criticalLevelMsl).toBeNull();
    expect(first.latest?.station.ridCode).toBeNull();
    expect(first.latest?.station.isKeyStation).toBe(false);

    // สถานีที่ไม่มีอะไรเลย: ไม่ใช่ข้อผิดพลาด แต่บอกตามจริงว่าไม่มี
    const empty = body.stations[1];
    expect(empty.latest).toBeNull();
    expect(empty.history48h).toEqual([]);
    expect(empty.historyFetchedAt).toBeNull();
    expect(empty.datum).toBe("unknown");

    // ไม่มีการเขียน: ไม่มีแถว meta ใดเกิดขึ้นจากการอ่าน
    expect(await meta("lastRoutePullMs")).toBeNull();
  });
});

describe("ObservationCacheDO.pullRouteHistory()", () => {
  it("ชั่วโมงละครั้ง: ครั้งที่สองภายในชั่วโมงไม่ถามต้นทาง, พ้นชั่วโมงแล้วถามใหม่", async () => {
    const t0 = Date.now();
    const fetchSpy = graphResponder(() => [t0 - 2 * HOUR, t0 - HOUR]);
    await runInDurableObject(stub(), (i) => (i as unknown as Internals).pullRouteHistory(t0));
    expect(fetchSpy).toHaveBeenCalledTimes(NORTH_ROUTE_STATIONS.length);
    expect(await historyRows(FIRST.thaiwaterId)).toBe(2);

    await runInDurableObject(stub(), (i) => (i as unknown as Internals).pullRouteHistory(t0 + 30 * 60_000));
    expect(fetchSpy).toHaveBeenCalledTimes(NORTH_ROUTE_STATIONS.length);

    await runInDurableObject(stub(), (i) => (i as unknown as Internals).pullRouteHistory(t0 + 61 * 60_000));
    expect(fetchSpy).toHaveBeenCalledTimes(2 * NORTH_ROUTE_STATIONS.length);
    // คิวต้นทางเว้น ≥ 250 ms ต่อคำขอ: 25 สถานี × 2 รอบ ≈ 13 วิ
  }, 40_000);

  it("เขียนเฉพาะจุดที่ใหม่กว่าจุดล่าสุดที่เก็บไว้", async () => {
    const t0 = Date.now();
    let points = [t0 - 3 * HOUR, t0 - 2 * HOUR];
    graphResponder(() => points);
    await runInDurableObject(stub(), (i) => (i as unknown as Internals).pullRouteHistory(t0));
    expect(await historyRows(FIRST.thaiwaterId)).toBe(2);
    points = [t0 - 3 * HOUR, t0 - 2 * HOUR, t0 - HOUR];
    await runInDurableObject(stub(), (i) => (i as unknown as Internals).pullRouteHistory(t0 + 2 * HOUR));
    expect(await historyRows(FIRST.thaiwaterId)).toBe(3);
  }, 40_000);

  it("ต้นทางพัง: หยุดที่สถานีแรก, ไม่โยน, ไม่แตะ fetchedAt/lastError/consecutiveFailures ของฟีดหลัก", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("down", { status: 503 }));
    const t0 = Date.now();
    await expect(
      runInDurableObject(stub(), (i) => (i as unknown as Internals).pullRouteHistory(t0)),
    ).resolves.toBeUndefined();
    // หนึ่งครั้งเท่านั้น — ไม่มีทางดันคิวต้นทางให้ถึงเกณฑ์ตัดวงจร (3 ครั้งติด)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await meta("routePullError")).toContain(FIRST.ridCode);
    expect(await meta("lastRoutePullMs")).toBe(String(t0));
    expect(await meta("fetchedAt")).toBeNull();
    expect(await meta("lastError")).toBeNull();
    expect(await meta("consecutiveFailures")).toBeNull();
  });
});
