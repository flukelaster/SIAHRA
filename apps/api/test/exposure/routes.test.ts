import { env, exports as workerExports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FloodExposureRun,
  ProvinceExposureResponse,
  StationExposure,
  WaterLevelObservation,
} from "@siahra/shared-types";
import { exposureRunKey, scopeToProvince } from "../../src/exposure/publish";
import type { AppEnv } from "../../src/types";

/**
 * E10.3 — เส้นทาง `/provinces/{NN}/exposure/latest` และ `/exposure/runs/{runId}`
 *
 * สิ่งที่ไฟล์นี้พิสูจน์ นอกจากรูปร่างของคำตอบ คือกฎ "ขอบเขตจังหวัดอยู่ในตัว run":
 * run ที่เผยแพร่ไปแล้วต้องตอบเหมือนเดิมทุกวัน แม้ตารางสถานีที่ยังมีชีวิตอยู่จะ
 * เปลี่ยนไปแล้ว — เทสด้านล่างลบสถานีออกจากตารางจริง เผยแพร่ run ใหม่ แล้วอ่าน
 * run เก่ากลับมาเทียบ ถ้าโค้ดแอบไปตัดขอบด้วยรายชื่อสถานีของวันนี้ ข้อนั้นจะพัง
 */

const appEnv = env as unknown as AppEnv;
const stub = () => appEnv.OBSERVATION_CACHE.getByName("thaiwater");
const call = (path: string) => workerExports.default.fetch(new Request(`https://siahra-radar.co${path}`));

interface Internals {
  publishExposure(nowMs: number): Promise<void>;
}

const T0 = Date.UTC(2026, 7, 19, 10, 0, 0);
/** คำที่ห้ามโผล่เป็นคีย์ในคำตอบ — ไม่มีตัวเลขชนิดนั้นอยู่ใน run เลย จึงต้องไม่มีช่องให้ใส่ */
const FORBIDDEN_KEY_RE = /probability|chance|likelihood|risk/i;

function station(id: number, provinceCode: string | null) {
  return {
    id,
    nameTh: null,
    nameEn: null,
    lat: 13 + id / 100,
    lon: 100 + id / 100,
    provinceCode,
    provinceNameTh: null,
    amphoeNameTh: null,
    basinNameTh: null,
    agencyShortTh: null,
  };
}

function water(id: number, provinceCode: string | null, observedAt: string): WaterLevelObservation {
  return {
    station: station(id, provinceCode),
    waterlevelMsl: 5,
    waterlevelLocalM: null,
    minBankMsl: 9,
    groundLevelMsl: null,
    freeboardM: 4,
    situationLevel: 2,
    storagePercent: null,
    observedAt,
  };
}

async function seedWater(rows: WaterLevelObservation[], fetchedAt: string) {
  await runInDurableObject(stub(), (_i, state) => {
    const sql = state.storage.sql;
    sql.exec("DELETE FROM rainfall");
    sql.exec("DELETE FROM waterlevel");
    for (const w of rows) {
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
      fetchedAt,
    );
  });
}

async function publishAt(nowMs: number): Promise<string> {
  await runInDurableObject(stub(), async (instance) => {
    await (instance as unknown as Internals).publishExposure(nowMs);
  });
  return runInDurableObject(stub(), (_i, state) =>
    state.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'exposureRunId'")
      .toArray()[0]?.value ?? "",
  );
}

/** ไล่คีย์ทุกชั้นของ payload หาคำที่ต้องห้าม */
function collectKeys(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, into);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      into.push(k);
      collectKeys(v, into);
    }
  }
  return into;
}

const ids = (stations: StationExposure[]) => stations.map((s) => s.stationId).sort((a, b) => a - b);

/** run ที่หนึ่ง: สถานี 10 กับ 11 ในจังหวัด 10, สถานี 50 ในจังหวัด 50, สถานี 99 ไม่มีจังหวัด */
let runA = "";
let runB = "";

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("network disabled in this test");
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/v1/provinces/{NN}/exposure/latest", () => {
  it("เผยแพร่ run แรกแล้วเสิร์ฟตามสัญญา: illustrative + methodologyUrl + X-Run-Id + ไม่มีคีย์ต้องห้าม", async () => {
    await seedWater(
      [
        water(10, "10", "2026-08-19T09:40:00.000Z"),
        water(11, "10", "2026-08-19T09:50:00.000Z"),
        water(50, "50", "2026-08-19T09:30:00.000Z"),
        water(99, null, "2026-08-19T09:55:00.000Z"),
      ],
      "2026-08-19T09:59:00.000Z",
    );
    runA = await publishAt(T0);
    expect(runA).not.toBe("");

    const res = await call("/api/v1/provinces/10/exposure/latest");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Run-Id")).toBe(runA);
    const body = (await res.json()) as ProvinceExposureResponse;
    expect(body.layer.epistemicClass).toBe("illustrative");
    expect(body.layer.methodologyUrl ?? "").not.toBe("");
    expect(body.runId).toBe(runA);
    expect(body.scopedToProvinceCode).toBe("10");
    expect(body.nationwideStationCount).toBe(4);
    const bad = collectKeys(body).filter((k) => FORBIDDEN_KEY_RE.test(k));
    expect(bad, `คีย์ต้องห้ามในคำตอบ: ${bad.join(", ")}`).toEqual([]);
    // เวลาตรวจวัดของชั้นข้อมูลถูกคิดใหม่จากสถานีที่เหลือ ไม่ใช่ค่าของทั้งประเทศ
    expect(body.layer.observedAt).toBe("2026-08-19T09:50:00.000Z");
  });

  it("สองจังหวัดได้ชุดสถานีที่ไม่ทับกัน และสถานีที่ไม่มีรหัสจังหวัดไม่อยู่ในทั้งคู่", async () => {
    const p10 = (await (await call("/api/v1/provinces/10/exposure/latest")).json()) as ProvinceExposureResponse;
    const p50 = (await (await call("/api/v1/provinces/50/exposure/latest")).json()) as ProvinceExposureResponse;
    expect(ids(p10.stations)).toEqual([10, 11]);
    expect(ids(p50.stations)).toEqual([50]);
    expect(ids(p10.stations).filter((id) => ids(p50.stations).includes(id))).toEqual([]);
    expect([...ids(p10.stations), ...ids(p50.stations)]).not.toContain(99);
    // สถานีที่ไม่มีรหัสจังหวัดยังอยู่ใน run ทั้งประเทศตามจริง
    const whole = (await (await call(`/api/v1/exposure/runs/${p10.runId}`)).json()) as FloodExposureRun;
    expect(ids(whole.stations)).toEqual([10, 11, 50, 99]);
  });

  it("รหัสจังหวัดที่ไม่มีอยู่จริงตอบ 404", async () => {
    const res = await call("/api/v1/provinces/99/exposure/latest");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("99") });
  });

  it("ค่าตรวจวัดเปลี่ยนโดยระดับไม่เปลี่ยน → /latest เสิร์ฟ run ใหม่พร้อมเวลาตรวจวัดใหม่", async () => {
    const before = (await (await call("/api/v1/provinces/10/exposure/latest")).json()) as ProvinceExposureResponse;
    const changed = water(10, "10", "2026-08-19T10:05:00.000Z");
    changed.freeboardM = 3.9; // ยังอยู่แถบ low เท่าเดิม (ต้องต่ำกว่า 3 ม. ถึงจะขยับแถบ)
    await seedWater(
      [changed, water(11, "10", "2026-08-19T09:50:00.000Z"), water(50, "50", "2026-08-19T09:30:00.000Z"), water(99, null, "2026-08-19T09:55:00.000Z")],
      "2026-08-19T10:09:00.000Z",
    );
    runB = await publishAt(T0 + 10 * 60_000);
    expect(runB).not.toBe(runA);

    const res = await call("/api/v1/provinces/10/exposure/latest");
    const after = (await res.json()) as ProvinceExposureResponse;
    expect(res.headers.get("X-Run-Id")).toBe(runB);
    const s10 = after.stations.find((s) => s.stationId === 10)!;
    const s10before = before.stations.find((s) => s.stationId === 10)!;
    expect(s10.level).toBe(s10before.level);
    expect(s10.factors.freeboardM).toBe(3.9);
    expect(s10.observedAt).toBe("2026-08-19T10:05:00.000Z");
    expect(after.layer.observedAt).toBe("2026-08-19T10:05:00.000Z");
    expect(after.layer.fetchedAt).toBe("2026-08-19T10:09:00.000Z");
  });
});

describe("GET /api/v1/exposure/runs/{runId}", () => {
  it("run เก่ายังตัดขอบจังหวัดได้เหมือนวันที่มันถูกเขียน แม้สถานีจะหายไปจากตารางจริงแล้ว", async () => {
    // สถานี 50 ถูกถอดออกจากตารางที่ยังมีชีวิตอยู่ แล้วเผยแพร่ run ใหม่
    await seedWater([water(10, "10", "2026-08-19T10:05:00.000Z"), water(11, "10", "2026-08-19T09:50:00.000Z")], "2026-08-19T10:14:00.000Z");
    const runC = await publishAt(T0 + 15 * 60_000);
    expect(runC).not.toBe(runB);

    const latest50 = (await (await call("/api/v1/provinces/50/exposure/latest")).json()) as ProvinceExposureResponse;
    expect(latest50.stations, "run ปัจจุบันไม่มีสถานีของจังหวัด 50 แล้ว").toEqual([]);

    // แต่ run เก่าต้องตอบเหมือนเดิมเป๊ะ — ขอบเขตอยู่ในตัวมันเอง ไม่ได้มาจากตารางวันนี้
    const res = await call(`/api/v1/exposure/runs/${runA}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    /**
     * ไบต์ใน R2 เป็น gzip (คีย์จึงลงท้าย `.json.gz` ไม่ใช่ `.json`) แต่สิ่งที่
     * client ได้ต้องเป็น JSON ธรรมดา — ไม่ใช่ไบนารีที่ curl เปล่า ๆ อ่านไม่ออก
     */
    const storedKey = exposureRunKey(runA);
    expect(storedKey.endsWith(".json.gz")).toBe(true);
    const raw = new Uint8Array(await (await appEnv.HAZARD_BUCKET.get(storedKey))!.arrayBuffer());
    expect([raw[0], raw[1]], "ไบต์ที่เก็บไม่ใช่ gzip").toEqual([0x1f, 0x8b]);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Content-Encoding")).toBeNull();
    const old = (await res.json()) as FloodExposureRun;
    expect(old.runId).toBe(runA);
    expect(ids(scopeToProvince(old, "50").stations)).toEqual([50]);
    expect(ids(scopeToProvince(old, "10").stations)).toEqual([10, 11]);
    expect(scopeToProvince(old, "10").nationwideStationCount).toBe(4);
  });

  it("runId ที่ยังไม่มีตอบ 404 และ runId ผิดรูปไม่มีทางกลายเป็นคีย์ R2", async () => {
    const missing = await call("/api/v1/exposure/runs/20260101T000000Z-abcdef0123456789");
    expect(missing.status).toBe(404);
    // ผิดรูป → ไม่ตรง pattern ในตารางเส้นทาง → 404 ของ router
    const malformed = await call("/api/v1/exposure/runs/..%2F..%2Fsecret");
    expect(malformed.status).toBe(404);
    expect(await appEnv.HAZARD_BUCKET.head(exposureRunKey("20260101T000000Z-abcdef0123456789"))).toBeNull();
  });
});
