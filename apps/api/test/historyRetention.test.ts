import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../src/types";

/**
 * ต้นทางของเทสไฟล์นี้: บิล Durable Objects วันที่ 2026-08-18..23 ขึ้นเป็น
 * 72.38B rows read เทียบกับ 4.16M rows written บนสตอเรจรวมทั้งบัญชี 64.57 MB —
 * แปลว่าไม่ได้เกิดจากข้อมูลก้อนใหญ่ แต่เกิดจากการ "กวาดตารางเดิมซ้ำ ๆ"
 *
 * สาเหตุคือ retention DELETE ที่กรองด้วย `ts_ms` ตัวเดียว ในขณะที่ PK ของทั้งสอง
 * ตารางคือ `(station_id, ts_ms)` → ใช้ดัชนีไม่ได้ กลายเป็น full scan และ
 * Cloudflare คิดเงิน rows read ตามแถวที่ถูก "สแกน" ไม่ใช่แถวที่ถูกลบ ที่แพงจริง
 * คือมันถูกวางไว้ท้าย `pullHistory()` ซึ่งถูกเรียก **รายสถานี** (สูงสุด 24 ตัวต่อ
 * การดูหนึ่งจังหวัด ผ่าน `warmProvinceHistory`) การดูจังหวัดเดียวจึงเท่ากับสแกน
 * ตารางประวัติทั้งตาราง 24 รอบ และยิ่งเปิดดูหลายจังหวัด ตารางยิ่งโต ทุกสแกน
 * ถัดไปยิ่งแพง
 *
 * เทสนี้จึงตรึงสองอย่างที่ทำให้มันกลับมาไม่ได้เงียบ ๆ: (1) เส้นทางรายสถานีต้องไม่
 * กวาด และ (2) แผนคิวรีต้องใช้ดัชนี ไม่ใช่ SCAN
 */

const appEnv = env as unknown as AppEnv;
const stub = () => appEnv.OBSERVATION_CACHE.getByName("history-retention-test");

interface Internals {
  pullHistory(stationId: number, nowMs: number, priority?: number): Promise<void>;
  pruneRetention(nowMs: number): void;
}

const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);
const HOUR_MS = 60 * 60 * 1000;
/** เกินหน้าต่างเก็บ 8 วันไปแล้วหนึ่งวัน — แถวที่ "ถึงคิวถูกกวาด" */
const EXPIRED_MS = NOW - 9 * 24 * HOUR_MS;

async function seedExpired(stationId: number, tsMs: number): Promise<void> {
  await runInDurableObject(stub(), (_instance, state) => {
    state.storage.sql.exec(
      "INSERT OR REPLACE INTO waterlevel_history (station_id, ts_ms, value, discharge) VALUES (?, ?, ?, ?)",
      stationId,
      tsMs,
      1.5,
      null,
    );
    state.storage.sql.exec(
      "INSERT OR REPLACE INTO hourly_levels (station_id, ts_ms, value_msl) VALUES (?, ?, ?)",
      stationId,
      tsMs,
      1.5,
    );
  });
}

async function historyCount(): Promise<{ fine: number; hourly: number }> {
  return runInDurableObject(stub(), (_instance, state) => ({
    fine:
      state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM waterlevel_history").toArray()[0]?.n ?? 0,
    hourly: state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM hourly_levels").toArray()[0]?.n ?? 0,
  }));
}

async function reset(): Promise<void> {
  await runInDurableObject(stub(), (_instance, state) => {
    state.storage.sql.exec("DELETE FROM waterlevel_history");
    state.storage.sql.exec("DELETE FROM hourly_levels");
    state.storage.sql.exec("DELETE FROM history_meta");
    state.storage.sql.exec("DELETE FROM meta WHERE key = 'lastPruneMs'");
  });
}

/** แผนของคิวรีจริงที่ DO รัน — `EXPLAIN QUERY PLAN` ตอบเป็นแถวที่มีคอลัมน์ `detail` */
async function queryPlan(sql: string): Promise<string> {
  return runInDurableObject(stub(), (_instance, state) =>
    state.storage.sql
      .exec<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
      .toArray()
      .map((r) => r.detail)
      .join(" | "),
  );
}

beforeEach(async () => {
  await reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("retention ของตารางประวัติ", () => {
  it("pullHistory() ไม่กวาดแถวพ้นอายุ — การดึงประวัติรายสถานีต้องไม่แตะทั้งตาราง", async () => {
    await seedExpired(101, EXPIRED_MS);
    // ต้นทางตอบ "ไม่มีจุดข้อมูล" ก็พอ: สิ่งที่เทสนี้วัดคือ *ผลข้างเคียง* ของ
    // pullHistory() ไม่ใช่จุดที่มันเขียนลงไป
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => Response.json({ data: { graph_data: [] } }),
    );

    await runInDurableObject(stub(), async (instance) => {
      await (instance as unknown as Internals).pullHistory(101, NOW, 1);
    });

    expect(await historyCount()).toEqual({ fine: 1, hourly: 1 });
  });

  it("pruneRetention() กวาดแถวพ้นอายุออกจากทั้งสองตาราง", async () => {
    await seedExpired(102, EXPIRED_MS);
    await runInDurableObject(stub(), (instance) => {
      (instance as unknown as Internals).pruneRetention(NOW);
    });
    expect(await historyCount()).toEqual({ fine: 0, hourly: 0 });
  });

  it("กวาดชั่วโมงละครั้ง — เรียกซ้ำภายในชั่วโมงเดียวกันไม่ทำงานอีก", async () => {
    await runInDurableObject(stub(), (instance) => {
      (instance as unknown as Internals).pruneRetention(NOW);
    });
    await seedExpired(103, EXPIRED_MS);

    await runInDurableObject(stub(), (instance) => {
      (instance as unknown as Internals).pruneRetention(NOW + 30 * 60 * 1000);
    });
    expect(await historyCount()).toEqual({ fine: 1, hourly: 1 });

    await runInDurableObject(stub(), (instance) => {
      (instance as unknown as Internals).pruneRetention(NOW + HOUR_MS + 1);
    });
    expect(await historyCount()).toEqual({ fine: 0, hourly: 0 });
  });

  it("แถวที่ยังไม่พ้นอายุไม่ถูกกวาดไปด้วย", async () => {
    await seedExpired(104, NOW - 2 * 24 * HOUR_MS);
    await runInDurableObject(stub(), (instance) => {
      (instance as unknown as Internals).pruneRetention(NOW);
    });
    expect(await historyCount()).toEqual({ fine: 1, hourly: 1 });
  });
});

describe("แผนคิวรีของเส้นทางที่คิดเงินตามแถวที่สแกน", () => {
  it("retention DELETE ทั้งสองใช้ดัชนี ts_ms ไม่ใช่ SCAN ทั้งตาราง", async () => {
    const fine = await queryPlan("DELETE FROM waterlevel_history WHERE ts_ms < 1");
    expect(fine).toContain("idx_waterlevel_history_ts");
    expect(fine).not.toContain("SCAN waterlevel_history");

    const hourly = await queryPlan("DELETE FROM hourly_levels WHERE ts_ms < 1");
    expect(hourly).toContain("idx_hourly_levels_ts");
    expect(hourly).not.toContain("SCAN hourly_levels");
  });

  it("หน้าต่างของ exposureHistory() อ่านเฉพาะช่วงเวลาที่ขอ", async () => {
    // คิวรีเดียวกับใน `exposureHistory()` — `ORDER BY ts_ms` คือสิ่งที่ทำให้
    // SQLite เลือกดัชนีแทนการไล่ PK ทั้งตารางเพื่อเรียงตาม station_id ก่อน
    const plan = await queryPlan(
      "SELECT station_id, ts_ms, value_msl FROM hourly_levels WHERE ts_ms >= 1 ORDER BY ts_ms",
    );
    expect(plan).toContain("idx_hourly_levels_ts");
    expect(plan).not.toContain("SCAN hourly_levels");
  });
});
