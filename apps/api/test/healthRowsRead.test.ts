import { env, exports as workerExports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../src/types";

/**
 * `/api/v1/health` ถูก poll ทุก 60 วิจากทุกแท็บที่เปิดค้าง และ `status()` ของ
 * ObservationCacheDO เคยสแกนสองตารางสถานี (~6,000 แถว) ห้าคำสั่งต่อครั้ง —
 * วัดจริง 2026-08-23 ≈ 540M rows read/วัน จากข้อมูลที่เปลี่ยนแค่ทุก 5 นาที
 * เทสนี้ตรึงสองอย่าง: (1) `status()` อ่านค่าที่วัดไว้ตอน refresh ไม่ได้นับสด และ
 * (2) คำตอบของ /health ถูกแคชที่ขอบในหน้าต่าง 15 วิ
 */

const appEnv = env as unknown as AppEnv;
const stub = () => appEnv.OBSERVATION_CACHE.getByName("thaiwater");

interface Internals {
  recomputeStationStats(): void;
}

async function seedRainfall(ids: number[], observedAt: string): Promise<void> {
  await runInDurableObject(stub(), (_instance, state) => {
    for (const id of ids) {
      state.storage.sql.exec(
        "INSERT OR REPLACE INTO rainfall (station_id, province_code, rain_24h, observed_at, payload) VALUES (?, ?, ?, ?, ?)",
        id,
        "10",
        1,
        observedAt,
        JSON.stringify({ station: { id, provinceCode: "10" }, rain24h: 1, observedAt }),
      );
    }
  });
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("network disabled in this test");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ObservationCacheDO.status() ไม่สแกนตารางสถานี", () => {
  it("รายงานค่าที่วัดไว้ตอน refresh — แถวที่เข้ามาหลังจากนั้นไม่ถูกนับจนกว่าจะวัดใหม่", async () => {
    await seedRainfall([1, 2], "2026-08-23T12:00:00.000Z");
    await runInDurableObject(stub(), (instance) => {
      (instance as unknown as Internals).recomputeStationStats();
    });
    const before = await stub().status();
    expect(before.detail.rainfallStations).toBe(2);

    // แถวที่สามเขียนตรงเข้าตาราง โดยไม่ผ่านรอบ refresh
    await seedRainfall([3], "2026-08-23T13:00:00.000Z");
    const stale = await stub().status();
    expect(stale.detail.rainfallStations).toBe(2);
    expect(stale.latestObservedAt).toBe("2026-08-23T12:00:00.000Z");

    await runInDurableObject(stub(), (instance) => {
      (instance as unknown as Internals).recomputeStationStats();
    });
    const after = await stub().status();
    expect(after.detail.rainfallStations).toBe(3);
    expect(after.latestObservedAt).toBe("2026-08-23T13:00:00.000Z");
  });

  it("แคชที่สร้างก่อนโค้ดนี้ (ไม่มี meta) ถูกวัดให้หนึ่งครั้ง ไม่รายงาน 0 ทั้งที่ตารางมีของ", async () => {
    await seedRainfall([7], "2026-08-23T12:00:00.000Z");
    await runInDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("DELETE FROM meta WHERE key LIKE 'stat%'");
    });
    const s = await stub().status();
    expect(s.detail.rainfallStations).toBeGreaterThanOrEqual(1);
    expect(s.latestObservedAt).not.toBeNull();
  });
});

describe("GET /api/v1/health ถูกแคชที่ขอบ", () => {
  it("สองคำขอติดกันได้คำตอบเดียวกัน (serverTime เท่ากัน) และไม่ยิง DO ซ้ำ", async () => {
    const url = "https://siahra-radar.co/api/v1/health?t=edge-cache";
    const first = await workerExports.default.fetch(new Request(url));
    expect(first.status).toBe(200);
    const a = (await first.json()) as { serverTime: string };
    const second = await workerExports.default.fetch(new Request(url));
    const b = (await second.json()) as { serverTime: string };
    expect(b.serverTime).toBe(a.serverTime);
    expect(second.headers.get("Cache-Control")).toBe("public, max-age=15");
  });
});
