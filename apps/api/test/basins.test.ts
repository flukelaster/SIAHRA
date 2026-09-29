import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BasinsResponse, DamObservation, WaterLevelObservation } from "@siahra/shared-types";
import { BASINS_STALE_AFTER_SECONDS, basinKey, buildBasins, coldBasinsResponse } from "../src/basins/build";
import { handleBasins } from "../src/routes/basins";
import type { AppEnv } from "../src/types";
import observationSrc from "../src/durable-objects/observation-cache.ts?raw";
import damFixture from "./fixtures/thaiwater-analyst-dam.json";
import rainFixture from "./fixtures/thaiwater-rain24h.json";
import waterFixture from "./fixtures/thaiwater-waterlevel-load.json";

/**
 * มุมมองตามลุ่มน้ำ — ข้อบังคับต้นทุนจาก devops ถูกตรึงไว้ที่นี่
 *   C3/C4 เขียนแถวเดียวต่อรอบ refresh (`rowsWritten <= 2`) ไม่ว่ากี่สถานี และเขียนทุกรอบที่ดึงระดับน้ำสำเร็จ
 *   C5   `fetchedAt` เป็นของรอบนั้นจริง / `damsFetchedAt` แยก / ไม่มีนาฬิกาปัจจุบัน
 *   C6   `getBasins()` อ่าน PK แถวเดียว ไม่สแกน ไม่ปลุกต้นทาง
 *   C8   เกินเพดาน = เก็บแถวเดิม + `basinsError`
 *   C9   route: query → 400 ก่อนแคช, ยังไม่มีแถว = no-store ไม่ถูก put, DO ล้ม = 503 no-store
 */

const appEnv = env as unknown as AppEnv;

// ─────────────────────────────────────────────────────────────────────────────
// ตัวสร้าง (ฟังก์ชันล้วน)
// ─────────────────────────────────────────────────────────────────────────────

function wl(id: number, basin: string | null, over: Partial<WaterLevelObservation> = {}): WaterLevelObservation {
  return {
    station: {
      id,
      nameTh: `สถานี ${id}`,
      nameEn: null,
      lat: 15 + id / 1000,
      lon: 100,
      provinceCode: "50",
      provinceNameTh: null,
      amphoeNameTh: null,
      basinNameTh: basin,
      agencyShortTh: null,
      ridCode: null,
      subBasinId: null,
      isKeyStation: false,
    },
    waterlevelMsl: 10,
    waterlevelLocalM: null,
    minBankMsl: 12,
    groundLevelMsl: null,
    freeboardM: 2,
    situationLevel: 2,
    storagePercent: null,
    dischargeM3s: null,
    qmaxM3s: null,
    criticalLevelMsl: null,
    observedAt: "2026-09-29T03:00:00.000Z",
    ...over,
  };
}

function dam(id: number, basin: string | null): DamObservation {
  return {
    id,
    nameTh: `เขื่อน ${id}`,
    nameEn: null,
    lat: 16,
    lon: 100,
    provinceCode: "50",
    provinceNameTh: null,
    basinNameTh: basin,
    agencyShortTh: null,
    kind: "large",
    storageMcm: 100,
    storagePercent: 50,
    maxStorageMcm: 200,
    normalStorageMcm: 150,
    inflowMcm: null,
    releasedMcm: null,
    observedAt: "2026-09-29T02:00:00.000Z",
  };
}

const build = (waterlevel: WaterLevelObservation[], dams: DamObservation[] = [], fetchedAt: string | null = "2026-09-29T03:05:00.000Z") =>
  buildBasins({ waterlevel, dams, fetchedAt, damsFetchedAt: null, staleAfterSeconds: BASINS_STALE_AFTER_SECONDS });

describe("basinKey", () => {
  it("trim แล้วตัดคำนำหน้า 'ลุ่มน้ำ' หนึ่งครั้ง — 'ลุ่มน้ำปิง' และ 'ปิง' เป็นคีย์เดียวกัน", () => {
    expect(basinKey("ลุ่มน้ำปิง")).toBe("ปิง");
    expect(basinKey("  ปิง ")).toBe("ปิง");
    expect(basinKey("ลุ่มน้ำ ปิง")).toBe("ปิง");
  });
  it("ตัดหนึ่งครั้งเท่านั้น และไม่รวมชื่อที่ต่างกัน", () => {
    expect(basinKey("ลุ่มน้ำลุ่มน้ำปิง")).toBe("ลุ่มน้ำปิง");
    expect(basinKey("โขงเหนือ")).not.toBe(basinKey("โขงตะวันออกเฉียงเหนือ"));
    expect(basinKey("ภาคใต้ฝั่งตะวันออกตอนบน")).not.toBe(basinKey("ภาคใต้ฝั่งตะวันออกตอนล่าง"));
  });
  it("null / ว่าง / เหลือแต่คำนำหน้า = ไม่มีคีย์", () => {
    expect(basinKey(null)).toBeNull();
    expect(basinKey(undefined)).toBeNull();
    expect(basinKey("")).toBeNull();
    expect(basinKey("   ")).toBeNull();
    expect(basinKey("ลุ่มน้ำ")).toBeNull();
  });
});

describe("buildBasins", () => {
  it("สองการสะกดของลุ่มเดียวกันรวมเป็นกลุ่มเดียว; ชื่อที่แสดงคือที่ต้นทางเขียน (ตัวที่พบมากสุด)", () => {
    const r = build([wl(1, "ลุ่มน้ำปิง"), wl(2, "ปิง"), wl(3, "ลุ่มน้ำปิง")]);
    expect(r.basins).toHaveLength(1);
    expect(r.basins[0]).toMatchObject({ key: "ปิง", nameTh: "ลุ่มน้ำปิง" });
    expect(r.basins[0]!.stations.map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it("ชื่อที่ต่างกันไม่ถูกรวม", () => {
    const r = build([wl(1, "ลุ่มน้ำโขงเหนือ"), wl(2, "ลุ่มน้ำโขงตะวันออกเฉียงเหนือ")]);
    expect(r.basins.map((b) => b.key).sort()).toEqual(["โขงตะวันออกเฉียงเหนือ", "โขงเหนือ"]);
  });

  it("null / ว่าง → unassigned (ทั้งสถานีและเขื่อน) ไม่ถูกทิ้ง", () => {
    const r = build([wl(1, null), wl(2, ""), wl(3, "ลุ่มน้ำปิง")], [dam(9, null)]);
    expect(r.unassigned.stations.map((s) => s.id)).toEqual([1, 2]);
    expect(r.unassigned.dams.map((d) => d.id)).toEqual([9]);
    expect(r.basins).toHaveLength(1);
  });

  it("'นอกประเทศไทย' ไม่ใช่ลุ่มน้ำ — อยู่ใน outsideThailand แยก ไม่อยู่ใน basins[]", () => {
    const r = build([wl(1, "นอกประเทศไทย"), wl(2, "ลุ่มน้ำปิง")], [dam(5, "นอกประเทศไทย")]);
    expect(r.outsideThailand.stations.map((s) => s.id)).toEqual([1]);
    expect(r.outsideThailand.dams.map((d) => d.id)).toEqual([5]);
    expect(r.basins.map((b) => b.key)).toEqual(["ปิง"]);
    expect(r.unassigned.stations).toEqual([]);
  });

  it("ทุกสถานีและเขื่อนไปอยู่ที่ใดที่หนึ่งพอดี (ไม่หาย ไม่ซ้ำ)", () => {
    const stations = [wl(1, "ลุ่มน้ำปิง"), wl(2, null), wl(3, "นอกประเทศไทย"), wl(4, "ยม"), wl(5, "ลุ่มน้ำยม")];
    const dams = [dam(1, "ปิง"), dam(2, null), dam(3, "นอกประเทศไทย"), dam(4, "ลุ่มน้ำมูล")];
    const r = build(stations, dams);
    const placedStations = [...r.basins.flatMap((b) => b.stations), ...r.outsideThailand.stations, ...r.unassigned.stations];
    const placedDams = [...r.basins.flatMap((b) => b.dams), ...r.outsideThailand.dams, ...r.unassigned.dams];
    expect(placedStations.map((s) => s.id).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(placedDams.map((d) => d.id).sort()).toEqual([1, 2, 3, 4]);
    // ลุ่มที่มีแต่เขื่อนยังปรากฏ (มูล)
    expect(r.basins.find((b) => b.key === "มูล")).toMatchObject({ stations: [], dams: [{ id: 4 }] });
  });

  it("ลำดับแน่นอน: จำนวนสถานีมากไปน้อย เสมอกันตามรหัสอักขระ และไม่ขึ้นกับลำดับอินพุต", () => {
    const stations = [wl(5, "ยม"), wl(1, "ปิง"), wl(4, "ปิง"), wl(3, "น่าน"), wl(2, "ปิง"), wl(6, "ชี")];
    const a = build(stations);
    const b = build([...stations].reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.basins.map((x) => x.key)).toEqual(["ปิง", "ชี", "น่าน", "ยม"]);
    expect(a.basins[0]!.stations.map((s) => s.id)).toEqual([1, 2, 4]);
  });

  it("ฟิลด์ที่แถวก่อน E16 ไม่มีถูกเติมเป็น null ไม่ใช่ undefined (JSON ต้องมีคีย์ครบ)", () => {
    const legacy = wl(1, "ปิง") as Partial<WaterLevelObservation> as WaterLevelObservation;
    delete (legacy as Partial<WaterLevelObservation>).dischargeM3s;
    delete (legacy as Partial<WaterLevelObservation>).qmaxM3s;
    const s = build([legacy]).basins[0]!.stations[0]!;
    expect(s.dischargeM3s).toBeNull();
    expect(s.qmaxM3s).toBeNull();
    expect(Object.keys(JSON.parse(JSON.stringify(s)))).toContain("dischargeM3s");
  });

  it("descriptor: observed, thaiwater; fetchedAt ตามที่ส่งเข้ามา (null คงเป็น null), observedAt = เวลาตรวจวัดใหม่สุดของสถานี", () => {
    const r = build([wl(1, "ปิง", { observedAt: "2026-09-29T01:00:00.000Z" }), wl(2, "ปิง", { observedAt: "2026-09-29T03:10:00.000Z" }), wl(3, "ปิง", { observedAt: null })]);
    expect(r.layer).toMatchObject({
      id: "thaiwater-basins",
      epistemicClass: "observed",
      publishedAt: null,
      fetchedAt: "2026-09-29T03:05:00.000Z",
      observedAt: "2026-09-29T03:10:00.000Z",
      sourceIds: ["thaiwater"],
    });
    expect(r.fetchedAt).toBe("2026-09-29T03:05:00.000Z");
    expect(r.damsFetchedAt).toBeNull();
    expect(build([wl(1, "ปิง")], [], null).layer.fetchedAt).toBeNull();
  });

  it("คำตอบ 'ยังไม่มีแถว': fetchedAt/damsFetchedAt เป็น null ทุกที่ และไม่มี observedAt", () => {
    const cold = coldBasinsResponse(BASINS_STALE_AFTER_SECONDS, "boom");
    expect(cold.fetchedAt).toBeNull();
    expect(cold.damsFetchedAt).toBeNull();
    expect(cold.layer.fetchedAt).toBeNull();
    expect(cold.layer.observedAt).toBeUndefined();
    expect(cold.basins).toEqual([]);
    expect(cold.buildError).toBe("boom");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Route handler (C9)
// ─────────────────────────────────────────────────────────────────────────────

const STORED = JSON.stringify(build([wl(1, "ลุ่มน้ำปิง")]));

function fakeEnv(result: { body: string | null; lastError: string | null }) {
  const calls = { getByName: [] as string[], getBasins: 0 };
  const stub = {
    getBasins: async () => {
      calls.getBasins++;
      return result;
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

describe("GET /api/v1/basins — handler", () => {
  it("แถวมีอยู่: DO ครั้งเดียว, ส่งบอดี้ตามที่เก็บ (ไบต์ต่อไบต์), แคช 5 นาที, ครั้งถัดไปตอบจากแคช", async () => {
    const url = "https://basins-cache.test/api/v1/basins";
    const { env: fake, calls } = fakeEnv({ body: STORED, lastError: null });
    const a = fakeCtx();
    const first = await handleBasins(new Request(url), fake, a.ctx);
    await a.settle();
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=300");
    expect(first.headers.get("Content-Type")).toContain("application/json");
    expect(await first.text()).toBe(STORED);
    expect(calls.getBasins).toBe(1);
    expect(calls.getByName).toEqual(["thaiwater"]);

    const b = fakeCtx();
    const second = await handleBasins(new Request(url), fake, b.ctx);
    await b.settle();
    expect(second.status).toBe(200);
    expect(calls.getBasins).toBe(1);
    expect(((await second.json()) as BasinsResponse).fetchedAt).toBe("2026-09-29T03:05:00.000Z");
  });

  it("query string ใด ๆ = 400 ก่อนถึงแคชและ DO", async () => {
    const { env: fake, calls } = fakeEnv({ body: STORED, lastError: null });
    const { ctx } = fakeCtx();
    const res = await handleBasins(new Request("https://basins-q.test/api/v1/basins?t=1"), fake, ctx);
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(calls.getBasins).toBe(0);
    expect(calls.getByName).toEqual([]);
  });

  it("ยังไม่มีแถว = 200 fetchedAt null แบบ no-store และไม่ถูก put ลงแคช (พก basinsError ถ้ามี)", async () => {
    const url = "https://basins-cold.test/api/v1/basins";
    const { env: fake } = fakeEnv({ body: null, lastError: "basins row 1000001 bytes exceeds 1000000 — previous row kept" });
    const { ctx, settle } = fakeCtx();
    const res = await handleBasins(new Request(url), fake, ctx);
    await settle();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as BasinsResponse;
    expect(body.fetchedAt).toBeNull();
    expect(body.damsFetchedAt).toBeNull();
    expect(body.layer.fetchedAt).toBeNull();
    expect(body.basins).toEqual([]);
    expect(body.buildError).toContain("exceeds");
    expect(await caches.default.match(new Request(url))).toBeUndefined();
  });

  it("DO ล้มเหลว = 503 no-store (ไม่ถูกแคช)", async () => {
    const url = "https://basins-fail.test/api/v1/basins";
    const fake = {
      OBSERVATION_CACHE: {
        getByName: () => ({
          getBasins: async () => {
            throw new Error("boom");
          },
        }),
      },
    } as unknown as AppEnv;
    const { ctx, settle } = fakeCtx();
    const res = await handleBasins(new Request(url), fake, ctx);
    await settle();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await caches.default.match(new Request(url))).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ObservationCacheDO: แถวเดียวต่อรอบ (C1–C8)
// ─────────────────────────────────────────────────────────────────────────────

type RebuildResult = { status: "ok"; basins: number; bytes: number; rowsWritten: number } | "failed";
interface Internals {
  rebuildBasins(): RebuildResult;
  /** ตัวจับเวลา lazy ในหน่วยความจำของ `getBasins()` — เทสตั้งเองแทนการหมุนนาฬิกา */
  basinsLazyAttemptMs: number | null;
  getBasins(): Promise<{ body: string | null; lastError: string | null }>;
  alarm(): Promise<void>;
}

const stub = () => appEnv.OBSERVATION_CACHE.getByName("basins-test");

afterEach(() => {
  vi.restoreAllMocks();
});

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

function routeThaiwater(rain: unknown, water: unknown, dam: unknown): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("rain_24h")) return jsonResponse(rain);
    if (url.includes("waterlevel_load")) return jsonResponse(water);
    if (url.includes("analyst/dam")) return jsonResponse(dam);
    throw new Error(`unexpected fetch in test: ${url}`);
  });
}

async function resetTables(): Promise<void> {
  await runInDurableObject(stub(), (_i, state) => {
    for (const t of ["waterlevel", "rainfall", "dams", "basins_latest", "meta"]) state.storage.sql.exec(`DELETE FROM ${t}`);
  });
  await runInDurableObject(stub(), (i) => {
    (i as unknown as Internals).basinsLazyAttemptMs = null;
  });
}

/** `rebuildBasins()` ต้องการ `waterlevelFetchedAt` (รอบ refresh จริงเขียนให้ก่อนเรียกเสมอ) — เทสที่เรียกมันตรง ๆ ต้องใส่เอง */
async function seedFetchedAt(at = "2026-09-29T03:05:00.000Z"): Promise<void> {
  await runInDurableObject(stub(), (_i, state) => {
    state.storage.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", "waterlevelFetchedAt", at);
  });
}

const insertWaterlevel = (state: DurableObjectState, w: WaterLevelObservation): void => {
  state.storage.sql.exec(
    "INSERT OR REPLACE INTO waterlevel (station_id, province_code, situation_level, observed_at, payload) VALUES (?, ?, ?, ?, ?)",
    w.station.id,
    w.station.provinceCode,
    w.situationLevel,
    w.observedAt,
    JSON.stringify(w),
  );
};

describe("ObservationCacheDO — แถว basins_latest", () => {
  it("ก่อนมีรอบ refresh: getBasins() = ไม่มีแถว (body null)", async () => {
    await resetTables();
    const r = await runInDurableObject(stub(), (i) => (i as unknown as Internals).getBasins());
    expect(r).toEqual({ body: null, lastError: null });
  });

  it("refresh ที่ดึงระดับน้ำสำเร็จ: เขียนหนึ่งแถว, fetchedAt = waterlevelFetchedAt ของรอบนั้น, เขื่อนที่ไม่เคยดึง = damsFetchedAt null", async () => {
    await resetTables();
    routeThaiwater(rainFixture, waterFixture, damFixture);
    await runInDurableObject(stub(), (i) => (i as unknown as Internals).alarm());

    const { stored, waterlevelFetchedAt, rows } = await runInDurableObject(stub(), async (instance, state) => ({
      stored: await (instance as unknown as Internals).getBasins(),
      waterlevelFetchedAt:
        state.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", "waterlevelFetchedAt").toArray()[0]?.value ?? null,
      rows: state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM basins_latest").toArray()[0]!.n,
    }));
    expect(rows).toBe(1);
    expect(stored.body).not.toBeNull();
    const body = JSON.parse(stored.body!) as BasinsResponse;
    expect(waterlevelFetchedAt).not.toBeNull();
    expect(body.fetchedAt).toBe(waterlevelFetchedAt);
    expect(body.layer.fetchedAt).toBe(waterlevelFetchedAt);
    // ไม่มีการดึงเขื่อนบนรอบ refresh — ต้องบอกตามจริงว่าไม่เคยดึง ไม่ใช่เขื่อนว่างที่ดูเหมือนของจริง
    expect(body.damsFetchedAt).toBeNull();
    expect(body.layer.staleAfterSeconds).toBe(BASINS_STALE_AFTER_SECONDS);
    expect(body.basins.find((b) => b.key === "เจ้าพระยา")?.stations.map((s) => s.id)).toContain(201);
    // ทุกสถานีในตารางไปอยู่ที่ใดที่หนึ่ง
    const placed =
      body.basins.reduce((n, b) => n + b.stations.length, 0) + body.outsideThailand.stations.length + body.unassigned.stations.length;
    expect(placed).toBe(2);
  });

  it("แถวที่สร้างจากตาราง (ไม่ใช่อาเรย์ฟีดของรอบ): สถานีที่หายไปจากฟีดยังอยู่, เขื่อนที่ดึงไว้แล้วมาพร้อม damsFetchedAt ของมัน", async () => {
    await resetTables();
    const damsFetchedAt = "2026-09-29T01:00:00.000Z";
    await runInDurableObject(stub(), (_i, state) => {
      insertWaterlevel(state, wl(900, "ลุ่มน้ำมูล"));
      state.storage.sql.exec(
        "INSERT INTO dams (dam_id, province_code, observed_at, payload) VALUES (?, ?, ?, ?)",
        77,
        "30",
        "2026-09-29T00:00:00.000Z",
        JSON.stringify(dam(77, "ลุ่มน้ำมูล")),
      );
      state.storage.sql.exec("INSERT INTO meta (key, value) VALUES (?, ?)", "damsFetchedAt", damsFetchedAt);
      state.storage.sql.exec("INSERT INTO meta (key, value) VALUES (?, ?)", "waterlevelFetchedAt", "2026-09-29T03:05:00.000Z");
    });
    // รอบที่ฟีดระดับน้ำมีสถานีอื่น (201/202) แต่ไม่มี 900
    routeThaiwater(rainFixture, waterFixture, damFixture);
    await runInDurableObject(stub(), (i) => (i as unknown as Internals).alarm());
    const stored = await runInDurableObject(stub(), (i) => (i as unknown as Internals).getBasins());
    const body = JSON.parse(stored.body!) as BasinsResponse;
    const mun = body.basins.find((b) => b.key === "มูล");
    expect(mun?.stations.map((s) => s.id)).toEqual([900]);
    expect(mun?.dams.map((d) => d.id)).toEqual([77]);
    expect(body.damsFetchedAt).toBe(damsFetchedAt);
  });

  it("C3: หนึ่งแถวต่อรอบไม่ว่ากี่สถานี — rowsWritten ≤ 2, rebuildBasins() ถูกเรียกครั้งเดียวต่อ refresh, ไม่มีแถวต่อสถานี/ลุ่มน้ำ", async () => {
    await resetTables();
    await runInDurableObject(stub(), (_i, state) => {
      for (let id = 1000; id < 1600; id++) insertWaterlevel(state, wl(id, `ลุ่มน้ำ${id % 22}`));
    });
    routeThaiwater(rainFixture, waterFixture, damFixture);
    const { results, calls, rows } = await runInDurableObject(stub(), async (instance, state) => {
      const spy = vi.spyOn(instance as unknown as Internals, "rebuildBasins");
      await instance.alarm();
      return {
        results: spy.mock.results.map((r) => r.value as RebuildResult),
        calls: spy.mock.calls.length,
        rows: state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM basins_latest").toArray()[0]!.n,
      };
    });
    expect(calls).toBe(1);
    expect(rows).toBe(1);
    const r = results[0]!;
    expect(r).not.toBe("failed");
    if (r !== "failed") {
      expect(r.rowsWritten).toBeLessThanOrEqual(2);
      // 22 ลุ่มที่ใส่เอง + ลุ่มของสถานีในฟีดจำลอง
      expect(r.basins).toBeGreaterThanOrEqual(22);
    }
  });

  it("C4: เขียนใหม่ทุกรอบที่ดึงสำเร็จ แม้เนื้อหาเท่าเดิม (ไม่มี hash-skip) และแถวยังเป็นแถวเดียว", async () => {
    await resetTables();
    await seedFetchedAt();
    await runInDurableObject(stub(), (_i, state) => insertWaterlevel(state, wl(1, "ปิง")));
    const [a, b] = await runInDurableObject(stub(), (instance) => {
      const i = instance as unknown as Internals;
      return [i.rebuildBasins(), i.rebuildBasins()] as const;
    });
    expect(a).not.toBe("failed");
    expect(b).not.toBe("failed");
    if (b !== "failed") expect(b.rowsWritten).toBeGreaterThan(0);
    const rows = await runInDurableObject(stub(), (_i, state) => state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM basins_latest").toArray()[0]!.n);
    expect(rows).toBe(1);
  });

  it("C2: ระดับน้ำดึงพลาด = ไม่เรียกตัวสร้าง แถวเดิมอยู่ครบพร้อม fetchedAt เก่า และ refresh ไม่ reject", async () => {
    await resetTables();
    routeThaiwater(rainFixture, waterFixture, damFixture);
    await runInDurableObject(stub(), (i) => (i as unknown as Internals).alarm());
    const before = await runInDurableObject(stub(), (i) => (i as unknown as Internals).getBasins());
    expect(before.body).not.toBeNull();

    routeThaiwater({}, {}, {});
    const calls = await runInDurableObject(stub(), async (instance) => {
      const spy = vi.spyOn(instance as unknown as Internals, "rebuildBasins");
      await expect(instance.alarm()).resolves.toBeUndefined();
      return spy.mock.calls.length;
    });
    expect(calls).toBe(0);
    const after = await runInDurableObject(stub(), (i) => (i as unknown as Internals).getBasins());
    expect(after.body).toBe(before.body);
  });

  it("C2: ตัวสร้างล้มเหลว (payload เสีย) = basinsError, แถวเดิมอยู่, ไม่ throw; รอบที่ดีลบ error", async () => {
    await resetTables();
    await seedFetchedAt();
    await runInDurableObject(stub(), (_i, state) => insertWaterlevel(state, wl(1, "ปิง")));
    const good = await runInDurableObject(stub(), (i) => (i as unknown as Internals).rebuildBasins());
    expect(good).not.toBe("failed");
    const before = await runInDurableObject(stub(), (i) => (i as unknown as Internals).getBasins());

    const outcome = await runInDurableObject(stub(), (instance, state) => {
      state.storage.sql.exec(
        "INSERT OR REPLACE INTO waterlevel (station_id, province_code, situation_level, observed_at, payload) VALUES (?, ?, ?, ?, ?)",
        2,
        "50",
        1,
        null,
        "{not json",
      );
      const r = (instance as unknown as Internals).rebuildBasins();
      return {
        r,
        error: state.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", "basinsError").toArray()[0]?.value ?? null,
      };
    });
    expect(outcome.r).toBe("failed");
    expect(outcome.error).toBeTruthy();
    const kept = await runInDurableObject(stub(), (i) => (i as unknown as Internals).getBasins());
    expect(kept.body).toBe(before.body);

    const recovered = await runInDurableObject(stub(), (instance, state) => {
      state.storage.sql.exec("DELETE FROM waterlevel WHERE station_id = 2");
      const r = (instance as unknown as Internals).rebuildBasins();
      return { r, error: state.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", "basinsError").toArray()[0]?.value ?? null };
    });
    expect(recovered.r).not.toBe("failed");
    expect(recovered.error).toBeNull();
  });

  it("C8: บอดี้เกินเพดาน ~1 MB (นับไบต์ UTF-8 ไม่ใช่ตัวอักษร) = ไม่เขียน เก็บแถวเดิม และบอกใน basinsError", async () => {
    await resetTables();
    await seedFetchedAt();
    await runInDurableObject(stub(), (_i, state) => insertWaterlevel(state, wl(1, "ปิง")));
    const small = await runInDurableObject(stub(), (i) => (i as unknown as Internals).rebuildBasins());
    expect(small).not.toBe("failed");
    const before = await runInDurableObject(stub(), (i) => (i as unknown as Internals).getBasins());

    // ไทย 3 ไบต์/ตัว: 12 แถว × 30,000 ตัว ≈ 1.08 MB (แต่ต่ำกว่า 400k ตัวอักษร — วัดด้วย length จะไม่ติดเพดาน)
    const huge = "ก".repeat(30_000);
    const outcome = await runInDurableObject(stub(), (instance, state) => {
      for (let id = 100; id < 112; id++) insertWaterlevel(state, wl(id, "ปิง", { station: { ...wl(id, "ปิง").station, nameTh: huge } }));
      const r = (instance as unknown as Internals).rebuildBasins();
      return { r, error: state.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", "basinsError").toArray()[0]?.value ?? null };
    });
    expect(outcome.r).toBe("failed");
    expect(outcome.error).toContain("exceeds");
    const after = await runInDurableObject(stub(), (i) => (i as unknown as Internals).getBasins());
    expect(after.body).toBe(before.body);
  });

  it("ไม่มี waterlevelFetchedAt = ไม่เขียนแถว (แถวที่มีต้องหมายถึงเคยดึงระดับน้ำสำเร็จ) และบอกใน basinsError", async () => {
    await resetTables();
    await runInDurableObject(stub(), (_i, state) => insertWaterlevel(state, wl(1, "ปิง")));
    const r = await runInDurableObject(stub(), (i) => (i as unknown as Internals).rebuildBasins());
    expect(r).toBe("failed");
    const stored = await runInDurableObject(stub(), (i) => (i as unknown as Internals).getBasins());
    expect(stored.body).toBeNull();
    // ยังไม่มีแถว: route ได้เหตุผลไปบอกใน buildError
    expect(stored.lastError).toContain("waterlevelFetchedAt");
  });

  it("C6: getBasins() อ่านแถวเดียวด้วย PK — ซอร์สของเมธอดไม่มีการสแกนตารางสถานี/เขื่อน และไม่ปลุกต้นทาง", () => {
    const start = observationSrc.indexOf("async getBasins(");
    expect(start).toBeGreaterThan(0);
    const end = observationSrc.indexOf("\n  }\n", start);
    const method = observationSrc.slice(start, end);
    expect(method).toContain("FROM basins_latest WHERE id = ?");
    // ทางสร้าง lazy ที่อนุญาตทางเดียว: เรียกผ่าน `rebuildBasins()` เดิม (ไม่มี SQL สแกนของตัวเอง) หลังเช็ค meta + ตัวจับเวลา
    expect(method.split("this.rebuildBasins()").length - 1).toBe(1);
    for (const guard of ['readMeta("waterlevelFetchedAt")', "this.inflight === null", "BASINS_LAZY_INTERVAL_MS", "this.basinsLazyAttemptMs = nowMs"]) {
      expect(method, `getBasins() ต้องมีตัวกั้น ${guard}`).toContain(guard);
    }
    // และมีตัวเรียก `rebuildBasins()` ทั้งไฟล์แค่สองที่: รอบ refresh กับตัวกั้นนี้
    expect(observationSrc.split("this.rebuildBasins()").length - 1).toBe(2);
    for (const banned of ["FROM waterlevel", "FROM dams", "FROM rainfall", "getObservations", "ensureFresh", "refreshOnce", "refreshDams", "getDams", "fetch("]) {
      expect(method, `getBasins() ต้องไม่มี ${banned}`).not.toContain(banned);
    }
  });

  it("C10/C11: ตัวสร้างไม่มี console.* และไม่แตะ R2/D1/alarm/stub.fetch", () => {
    const start = observationSrc.indexOf("private rebuildBasins(");
    expect(start).toBeGreaterThan(0);
    const end = observationSrc.indexOf("\n  }\n", start);
    const method = observationSrc.slice(start, end);
    for (const banned of ["console.", "logInfo", "logWarn", "logError", "HAZARD_BUCKET", "setAlarm", "stub.fetch", "DELETE"]) {
      expect(method, `rebuildBasins() ต้องไม่มี ${banned}`).not.toContain(banned);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ทางสร้างแถวครั้งแรกแบบ lazy ใน getBasins() (ดีพลอยตอนต้นทางล่ม → ไม่เคยมีรอบ refresh ที่สำเร็จ)
// ─────────────────────────────────────────────────────────────────────────────

const LAZY_MS = 10 * 60 * 1000;
type Stored = { body: string | null; lastError: string | null };

/** ตารางถือสถานีที่ดึงสำเร็จแล้ว (waterlevelFetchedAt = เวลาจริงของครั้งนั้น) แต่ไม่มีแถว basins_latest */
async function seedHeldNoRow(at = "2026-09-29T10:05:16.000Z"): Promise<void> {
  await resetTables();
  await seedFetchedAt(at);
  await runInDurableObject(stub(), (_i, state) => {
    insertWaterlevel(state, wl(1, "ลุ่มน้ำปิง"));
    insertWaterlevel(state, wl(2, "ยม"));
  });
}

/** เรียก getBasins() `n` ครั้งในคำสั่งเดียวของ DO ที่จะรัน rebuildBasins จริง — นับจำนวนครั้งที่ตัวสร้างถูกเรียก */
async function getBasinsCounting(n: number, concurrent = false): Promise<{ results: Stored[]; builds: number }> {
  return runInDurableObject(stub(), async (instance) => {
    const i = instance as unknown as Internals;
    const spy = vi.spyOn(i, "rebuildBasins");
    const results = concurrent
      ? await Promise.all(Array.from({ length: n }, () => i.getBasins()))
      : await (async () => {
          const out: Stored[] = [];
          for (let k = 0; k < n; k++) out.push(await i.getBasins());
          return out;
        })();
    const builds = spy.mock.calls.length;
    spy.mockRestore(); // ไม่งั้นการเรียกครั้งถัดไปได้สปายเดิมที่นับสะสม
    return { results, builds };
  });
}

describe("ObservationCacheDO.getBasins — สร้างแถวครั้งแรกแบบ lazy", () => {
  it("ไม่มีแถว + waterlevelFetchedAt มีค่า: สร้างหนึ่งครั้งแล้วตอบแถวจริง — fetchedAt เป็นเวลาที่ดึงจริง ไม่ใช่ตอนนี้", async () => {
    await seedHeldNoRow();
    const { results, builds } = await getBasinsCounting(1);
    expect(builds).toBe(1);
    expect(results[0]!.lastError).toBeNull();
    const body = JSON.parse(results[0]!.body!) as BasinsResponse;
    expect(body.fetchedAt).toBe("2026-09-29T10:05:16.000Z");
    expect(body.layer.fetchedAt).toBe("2026-09-29T10:05:16.000Z");
    expect(body.buildError).toBeUndefined();
    expect(body.basins.map((b) => b.key).sort()).toEqual(["ปิง", "ยม"]);
    const rows = await runInDurableObject(stub(), (_i, state) => state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM basins_latest").toArray()[0]!.n);
    expect(rows).toBe(1);
  });

  it("คำขอที่สองและสามหลังสร้างสำเร็จ อ่านแถวด้วย PK — ไม่เรียกตัวสร้างอีก", async () => {
    await seedHeldNoRow();
    const { results, builds } = await getBasinsCounting(3);
    expect(builds).toBe(1);
    expect(results[1]!.body).toBe(results[0]!.body);
    expect(results[2]!.body).toBe(results[0]!.body);
  });

  it("คำขอที่มาพร้อมกันใช้การสร้างครั้งเดียวร่วมกัน", async () => {
    await seedHeldNoRow();
    const { results, builds } = await getBasinsCounting(6, true);
    expect(builds).toBe(1);
    expect(new Set(results.map((r) => r.body)).size).toBe(1);
    expect(results[0]!.body).not.toBeNull();
  });

  it("meta waterlevelFetchedAt เป็น null: ไม่สแกนเลย, body null และ lastError null (ยังไม่เคยดึงจริง)", async () => {
    await resetTables();
    await runInDurableObject(stub(), (_i, state) => insertWaterlevel(state, wl(1, "ปิง")));
    const { results, builds } = await getBasinsCounting(3);
    expect(builds).toBe(0);
    for (const r of results) expect(r).toEqual({ body: null, lastError: null });
  });

  it("สร้างพลาด (เกินเพดาน): lastError บอกเหตุ ไม่ใช่ null, คำขอถัดไปใน 10 นาทีไม่สแกนซ้ำ (แม้แก้ข้อมูลแล้ว), ครบ 10 นาทีลองอีกครั้งเดียว", async () => {
    await seedHeldNoRow();
    const huge = "ก".repeat(30_000);
    await runInDurableObject(stub(), (_i, state) => {
      for (let id = 100; id < 112; id++) insertWaterlevel(state, wl(id, "ปิง", { station: { ...wl(id, "ปิง").station, nameTh: huge } }));
    });
    const first = await getBasinsCounting(4);
    expect(first.builds).toBe(1);
    for (const r of first.results) {
      expect(r.body).toBeNull();
      expect(r.lastError).toContain("exceeds");
    }

    // ตารางถูกแก้จนสร้างได้ — แต่ยังไม่ถึง 10 นาที: ต้องไม่สแกน จึงยังไม่มีแถว และ lastError ยังบอกเหตุเดิม
    await runInDurableObject(stub(), (_i, state) => state.storage.sql.exec("DELETE FROM waterlevel WHERE station_id >= 100"));
    const within = await getBasinsCounting(3);
    expect(within.builds).toBe(0);
    for (const r of within.results) {
      expect(r.body).toBeNull();
      expect(r.lastError).toContain("exceeds");
    }

    // ผ่าน 10 นาที (ตั้งตัวจับเวลาย้อนหลัง): ลองอีกครั้งเดียว แล้วสำเร็จ
    await runInDurableObject(stub(), (i) => {
      (i as unknown as Internals).basinsLazyAttemptMs = Date.now() - LAZY_MS - 1;
    });
    const after = await getBasinsCounting(3);
    expect(after.builds).toBe(1);
    expect(after.results[0]!.body).not.toBeNull();
    expect(after.results[0]!.lastError).toBeNull();
  });

  it("ก่อนครบ 10 นาที (9:59) ไม่ลองซ้ำ, ครบพอดี 10:00 ลองได้ — ทั้งกรณีที่ทำสำเร็จและพลาดนับเป็นหนึ่งความพยายาม", async () => {
    await seedHeldNoRow();
    // พลาดด้วยแถวเสีย
    await runInDurableObject(stub(), (_i, state) =>
      state.storage.sql.exec("INSERT INTO waterlevel (station_id, province_code, situation_level, observed_at, payload) VALUES (?, ?, ?, ?, ?)", 5, "50", 1, null, "{not json"),
    );
    expect((await getBasinsCounting(1)).builds).toBe(1);
    await runInDurableObject(stub(), (i) => {
      (i as unknown as Internals).basinsLazyAttemptMs = Date.now() - (LAZY_MS - 5_000);
    });
    expect((await getBasinsCounting(1)).builds).toBe(0);
    await runInDurableObject(stub(), (i) => {
      (i as unknown as Internals).basinsLazyAttemptMs = Date.now() - LAZY_MS;
    });
    expect((await getBasinsCounting(1)).builds).toBe(1);
  });

  it("ตารางถือข้อมูลแต่สร้างพลาดโดยไม่มี basinsError: ยังได้ lastError (ห้ามอ่านเป็น 'ยังไม่เคยดึง')", async () => {
    await seedHeldNoRow();
    // ตัวจับเวลาเพิ่งใช้ไป → ไม่สร้าง, meta basinsError ไม่มี
    await runInDurableObject(stub(), (i) => {
      (i as unknown as Internals).basinsLazyAttemptMs = Date.now();
    });
    const { results, builds } = await getBasinsCounting(1);
    expect(builds).toBe(0);
    expect(results[0]!.body).toBeNull();
    expect(results[0]!.lastError).toBeTruthy();
  });

  it("มีแถวเดิมอยู่แล้ว: ไม่เรียกตัวสร้างเลย แม้ตัวจับเวลาว่าง และแถวเดิมไม่ถูกแตะ", async () => {
    await seedHeldNoRow();
    await runInDurableObject(stub(), (i) => (i as unknown as Internals).rebuildBasins());
    const before = await runInDurableObject(stub(), (i) => (i as unknown as Internals).getBasins());
    await runInDurableObject(stub(), (_i, state) => insertWaterlevel(state, wl(3, "น่าน")));
    const { results, builds } = await getBasinsCounting(2);
    expect(builds).toBe(0);
    expect(results[0]!.body).toBe(before.body);
  });

  it("route + DO จริง: ต้นทางล่มตลอด (ตารางถือของเก่า) → ตอบแถวที่สร้างจากตาราง พร้อม fetchedAt เก่า ไม่ใช่ cold", async () => {
    await seedHeldNoRow("2026-09-29T10:05:16.000Z");
    const url = "https://siahra-radar.co/api/v1/basins";
    await caches.default.delete(new Request(url));
    const { ctx, settle } = fakeCtx();
    const res = await handleBasins(new Request(url), { ...appEnv, OBSERVATION_CACHE: { getByName: () => stub() } } as unknown as AppEnv, ctx);
    await settle();
    const body = (await res.json()) as BasinsResponse;
    expect(body.fetchedAt).toBe("2026-09-29T10:05:16.000Z");
    expect(body.basins.length).toBeGreaterThan(0);
    await caches.default.delete(new Request(url));
  });
});
