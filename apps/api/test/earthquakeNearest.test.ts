import { env } from "cloudflare:workers";
import { abortAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EarthquakeEvent } from "@siahra/shared-types";

/**
 * E10.6 — การย้ายสคีมาคือความเสี่ยงหลักของงานนี้: เหตุการณ์ที่เก็บไว้ 30 วัน คือ
 * ข้อมูลที่ต้นทางไม่ย้อนคืนให้ การ "สร้างตารางใหม่" จึงเท่ากับลบข้อมูลจริงทิ้ง
 * เทสนี้จึงยึดสองอย่างไว้:
 *   1. ระเบียนเดิม (สคีมาก่อนมีคอลัมน์ `nearest`) รอดจากการอัปเกรด — จำนวนแถวเท่าเดิม
 *   2. รอบ poll ถัดไปเติม `nearest` ให้ระเบียนเดิมโดยไม่แตะจำนวนแถว
 */

const DO_NAME = "nearest-migration";
const NOW = Date.now();

/** จุดในเขตจังหวัดเชียงราย (บนบก) และจุดนอกเขตทุกจังหวัดกลางอ่าวไทย */
const INLAND = { id: "usgs:inland1", lat: 19.91, lon: 99.83 };
const OFFSHORE = { id: "usgs:offshore1", lat: 11.0, lon: 101.5 };

function insertLegacyRow(
  sql: SqlStorage,
  row: { id: string; lat: number; lon: number },
  withNearestColumn: boolean,
): void {
  const cols = `id, cluster_id, source, source_id, mag, mag_type, place, lat, lon, depth_km, time_ms, updated_ms, status, tsunami, url, raw_json, ingested_at_ms`;
  sql.exec(
    `INSERT INTO events (${cols}${withNearestColumn ? ", nearest" : ""})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${withNearestColumn ? ", NULL" : ""})`,
    row.id,
    row.id,
    "usgs",
    row.id.split(":")[1],
    4.2,
    "mb",
    "fixture",
    row.lat,
    row.lon,
    10,
    NOW - 60_000,
    NOW - 60_000,
    "reviewed",
    0,
    "https://earthquake.usgs.gov/earthquakes/eventpage/inland1",
    JSON.stringify({ id: row.id }),
    NOW - 60_000,
  );
}

/** ทุกฟีดล้ม — รอบ poll จึงไม่เพิ่มเหตุการณ์ใหม่ เหลือแต่เส้นทาง backfill ให้วัด */
function serveAllFailing(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response("upstream on fire", { status: 500 }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** ฟีด USGS หนึ่งเหตุการณ์ที่ "ย้ายจุดศูนย์กลาง" ในรอบแก้ไข (automatic → reviewed) */
function serveUsgsRelocation(lat: number, lon: number, updatedMs: number): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.host !== "earthquake.usgs.gov") return new Response("nope", { status: 500 });
    return Response.json({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "reloc1",
          properties: {
            mag: 4.5,
            place: "relocated fixture",
            time: NOW - 120_000,
            updated: updatedMs,
            url: "https://earthquake.usgs.gov/earthquakes/eventpage/reloc1",
            status: "reviewed",
            tsunami: 0,
            magType: "mb",
            type: "earthquake",
          },
          geometry: { type: "Point", coordinates: [lon, lat, 10] },
        },
      ],
    });
  });
}

describe("EarthquakeFeedDO: การย้ายสคีมา nearest", () => {
  it("ตารางที่ยังไม่มีคอลัมน์ nearest ได้คอลัมน์เพิ่มโดยแถวเดิมอยู่ครบ", async () => {
    const stub = env.EARTHQUAKE_FEED.getByName(DO_NAME);

    // จำลองสคีมา "ก่อน E10.6": ใส่ระเบียนไว้แล้วถอดคอลัมน์ออก
    await runInDurableObject(stub, (_instance, ctx) => {
      insertLegacyRow(ctx.storage.sql, INLAND, true);
      insertLegacyRow(ctx.storage.sql, OFFSHORE, true);
      ctx.storage.sql.exec("ALTER TABLE events DROP COLUMN nearest");
      const cols = ctx.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(events)")
        .toArray()
        .map((c) => c.name);
      expect(cols).not.toContain("nearest");
    });

    // สร้างอินสแตนซ์ใหม่ = คอนสตรักเตอร์รันการย้ายสคีมา (ไม่ได้ลบข้อมูล)
    await abortAllDurableObjects();

    await runInDurableObject(env.EARTHQUAKE_FEED.getByName(DO_NAME), (_instance, ctx) => {
      const cols = ctx.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(events)")
        .toArray()
        .map((c) => c.name);
      expect(cols).toContain("nearest");
      const rows = ctx.storage.sql
        .exec<{ id: string; nearest: string | null }>("SELECT id, nearest FROM events ORDER BY id")
        .toArray();
      // แถวเดิมอยู่ครบ และยังไม่มีค่า nearest จนกว่าจะ poll รอบถัดไป
      expect(rows.map((r) => r.id)).toEqual([INLAND.id, OFFSHORE.id]);
      expect(rows.every((r) => r.nearest === null)).toBe(true);
    });
  });

  it("รอบ poll ถัดไปเติม nearest ให้ระเบียนเดิม โดยจำนวนแถวไม่เปลี่ยน", async () => {
    serveAllFailing();
    const stub = env.EARTHQUAKE_FEED.getByName(DO_NAME);
    const before = await runInDurableObject(
      stub,
      (_instance, ctx) =>
        ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM events").toArray()[0].n,
    );
    expect(before).toBe(2);

    await runInDurableObject(stub, (instance) => instance.pollAndBroadcast());

    const events = await runInDurableObject(stub, async (instance, ctx) => {
      const n = ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM events").toArray()[0].n;
      expect(n).toBe(before);
      return instance.getRecent();
    });

    const inland = events.find((e: EarthquakeEvent) => e.id === INLAND.id)!;
    const offshore = events.find((e: EarthquakeEvent) => e.id === OFFSHORE.id)!;

    expect(inland.nearest).toHaveLength(3);
    // จุดบนบกในเขตเชียงราย: ระยะถึงรูปหลายเหลี่ยม = 0 และเป็นอันดับหนึ่ง
    expect(inland.nearest![0]).toMatchObject({ provinceCode: "57", distanceKm: 0, inside: true });
    expect(inland.nearest![0].nameTh).toBe("เชียงราย");

    // จุดกลางอ่าวไทย: ไม่อยู่ในเขตใดเลย ระยะต้องเป็นค่าจริงที่มากกว่า 0
    expect(offshore.nearest).toHaveLength(3);
    expect(offshore.nearest!.every((n) => !n.inside)).toBe(true);
    expect(offshore.nearest![0].distanceKm).toBeGreaterThan(0);
    // เรียงจากใกล้ไปไกล
    expect(offshore.nearest![1].distanceKm).toBeGreaterThanOrEqual(offshore.nearest![0].distanceKm);
  });
});

/**
 * รอบแก้ไขของต้นทางย้ายจุดศูนย์กลางได้จริง — `nearest` ต้องขยับตามพิกัดใหม่
 * ไม่ใช่ค้างอยู่ที่จังหวัดของตำแหน่งเดิม (และต้องไม่เกิดแถวใหม่)
 */
describe("EarthquakeFeedDO: เหตุการณ์ถูกย้ายจุดศูนย์กลางในรอบแก้ไข", () => {
  const RELOC_DO = "nearest-relocation";

  it("nearest เดินตามพิกัดใหม่ และจำนวนแถวไม่เปลี่ยน", async () => {
    const stub = env.EARTHQUAKE_FEED.getByName(RELOC_DO);

    // รอบแรก: จุดอยู่ในเขตเชียงราย
    serveUsgsRelocation(INLAND.lat, INLAND.lon, NOW - 90_000);
    await runInDurableObject(stub, (instance) => instance.pollAndBroadcast());
    vi.restoreAllMocks();

    const first = await runInDurableObject(stub, (instance) => instance.getRecent());
    expect(first).toHaveLength(1);
    expect(first[0].nearest![0]).toMatchObject({ provinceCode: "57", inside: true });

    // รอบแก้ไข: ต้นทางเลื่อนจุดไปอยู่ในเขตนครราชสีมา (รหัส 30)
    serveUsgsRelocation(14.97, 102.1, NOW - 30_000);
    await runInDurableObject(stub, (instance) => instance.pollAndBroadcast());

    const after = await runInDurableObject(stub, async (instance, ctx) => {
      const n = ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM events").toArray()[0].n;
      expect(n).toBe(1);
      return instance.getRecent();
    });
    expect(after[0].lat).toBeCloseTo(14.97, 5);
    expect(after[0].nearest![0]).toMatchObject({ provinceCode: "30", distanceKm: 0, inside: true });
  });
});
