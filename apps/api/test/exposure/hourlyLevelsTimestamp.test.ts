import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WaterLevelObservation } from "@siahra/shared-types";
import type { AppEnv } from "../../src/types";

/**
 * P1 (Codex review PR #31) — `writeHourlySnapshot` ต้องไม่ประทับ `nowMs` ลง
 * `hourly_levels.ts_ms` แทนเวลาตรวจวัดจริงเมื่อ ThaiWater ไม่ส่ง `observedAt` มา
 * (หรือส่งค่าที่ parse ไม่ออก) — `exposureHistory()` อ่านตารางนี้ตรง ๆ แล้วป้อนเข้า
 * `freeboardTrend()` ซึ่งตีความ `ts_ms` เป็นเวลาจริงระหว่างจุดสองจุด ถ้าประทับเวลา
 * ปลอมไว้ ค่าที่เปลี่ยนโดยไม่มีเวลาตรวจวัดกำกับจะกลายเป็น "อัตราการเปลี่ยน" ที่ไม่มี
 * ต้นทางรับรอง — ตรงข้ามกับกฎความซื่อสัตย์ของข้อมูลใน AGENTS.md
 */

const appEnv = env as unknown as AppEnv;
const stub = () => appEnv.OBSERVATION_CACHE.getByName("hourly-ts-test");

interface Internals {
  writeHourlySnapshot(nowMs: number, day: string, hour: string): Promise<void>;
}

const T0 = Date.UTC(2026, 7, 19, 9, 0, 0);

function station(id: number) {
  return {
    id,
    nameTh: `สถานี ${id}`,
    nameEn: `Station ${id}`,
    lat: 13 + id / 100,
    lon: 100 + id / 100,
    provinceCode: "10",
    provinceNameTh: null,
    amphoeNameTh: null,
    basinNameTh: null,
    agencyShortTh: null,
  };
}

function water(id: number, observedAt: string | null, waterlevelMsl = 5): WaterLevelObservation {
  return {
    station: station(id),
    waterlevelMsl,
    waterlevelLocalM: null,
    minBankMsl: 8,
    groundLevelMsl: null,
    freeboardM: 3,
    situationLevel: 2,
    storagePercent: null,
    observedAt,
  };
}

/** เขียนแถวลง SQLite ตรง ๆ — `fetchedAt` ตั้งเป็นเวลาจริง ณ ตอนรัน เพื่อให้
 * `getObservations()` ที่ `writeHourlySnapshot` เรียกภายในถือว่าแคช "สด" อยู่แล้ว
 * และไม่ยิงเครือข่ายจริง (ซึ่งถูก mock ให้ throw ไว้ด้านล่าง) */
async function seed(rows: WaterLevelObservation[]) {
  await runInDurableObject(stub(), (_instance, state) => {
    const sql = state.storage.sql;
    sql.exec("DELETE FROM rainfall");
    sql.exec("DELETE FROM waterlevel");
    sql.exec("DELETE FROM hourly_levels");
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
      new Date().toISOString(),
    );
  });
}

async function hourlyRows(): Promise<{ station_id: number; ts_ms: number; value_msl: number | null }[]> {
  return runInDurableObject(stub(), (_instance, state) =>
    state.storage.sql
      .exec<{ station_id: number; ts_ms: number; value_msl: number | null }>(
        "SELECT station_id, ts_ms, value_msl FROM hourly_levels ORDER BY station_id",
      )
      .toArray(),
  );
}

beforeEach(() => {
  // ไม่มีเทสในไฟล์นี้ต้องการเครือข่าย — ถ้ามีเส้นทางไหนแอบยิงต้นทาง จะพังทันที
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("network disabled in this test");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("writeHourlySnapshot — เวลาตรวจวัดสังเคราะห์ต้องไม่เข้า hourly_levels", () => {
  it("สถานีที่มี observedAt จริง → ts_ms = เวลาตรวจวัดนั้น ไม่ใช่ nowMs", async () => {
    await seed([water(1, "2026-08-19T08:30:00.000Z")]);
    await runInDurableObject(stub(), async (instance) => {
      await (instance as unknown as Internals).writeHourlySnapshot(T0, "2026-08-19", "09");
    });
    const rows = await hourlyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ station_id: 1, ts_ms: Date.parse("2026-08-19T08:30:00.000Z") });
    expect(rows[0].ts_ms).not.toBe(T0);
  });

  it("สถานีที่ observedAt เป็น null → ไม่มีแถวถูกเขียนเลย (ไม่ประทับ nowMs แทน)", async () => {
    await seed([water(2, null)]);
    await runInDurableObject(stub(), async (instance) => {
      await (instance as unknown as Internals).writeHourlySnapshot(T0, "2026-08-19", "09");
    });
    expect(await hourlyRows()).toEqual([]);
  });

  it("สถานีที่ observedAt parse ไม่ออก → ไม่มีแถวถูกเขียนเช่นกัน", async () => {
    await seed([water(3, "ไม่ใช่วันที่")]);
    await runInDurableObject(stub(), async (instance) => {
      await (instance as unknown as Internals).writeHourlySnapshot(T0, "2026-08-19", "09");
    });
    expect(await hourlyRows()).toEqual([]);
  });

  it("ผสมกันในรอบเดียว — ตัวที่มีเวลาจริงถูกเก็บ ตัวที่ไม่มีถูกข้าม ไม่ใช่ทั้งชุดพัง", async () => {
    await seed([water(4, "2026-08-19T08:00:00.000Z"), water(5, null), water(6, "garbage")]);
    await runInDurableObject(stub(), async (instance) => {
      await (instance as unknown as Internals).writeHourlySnapshot(T0, "2026-08-19", "09");
    });
    const rows = await hourlyRows();
    expect(rows.map((r) => r.station_id)).toEqual([4]);
  });
});
