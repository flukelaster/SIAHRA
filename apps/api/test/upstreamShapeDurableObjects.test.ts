import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceStatus } from "@siahra/shared-types";
import { healthOk } from "../src/routes/health";
import gistdaFixture from "./fixtures/gistda-wfs.json";
import damFixture from "./fixtures/thaiwater-analyst-dam.json";
import rainFixture from "./fixtures/thaiwater-rain24h.json";
import waterFixture from "./fixtures/thaiwater-waterlevel-load.json";
import { radarListAt, truncatedPngFrame, validPngFrame } from "./fixtures/text";

/**
 * E4.3 AC 3 / E4.4 AC 2–4 — สิ่งที่ต้องพิสูจน์ไม่ใช่ "schema ปฏิเสธของเสีย" แต่คือ
 * **รอบที่ payload ผิดรูปต้องไม่แตะข้อมูลที่เราถืออยู่ และต้องโผล่ออกมาให้เห็น**
 * ผ่านบันได `deriveSourceHealth` เดิม (E3.3) ไม่ใช่กลไกสุขภาพชุดใหม่
 *
 * storage ของ DO แยกกันต่อ "ไฟล์" เทส แต่อยู่ยาวข้าม block ในไฟล์เดียวกัน
 * (ดู vitest.config.ts) — เทสที่ต้องเริ่มจากศูนย์จึงตั้งชื่อ instance แยกของตัวเอง
 */

afterEach(() => {
  vi.restoreAllMocks();
});

type FetchRoute = (url: string) => Response | null;

/** mock fetch แบบดูจาก URL — DO หนึ่งตัวยิงหลายปลายทางในรอบเดียว */
function routeFetch(...routes: FetchRoute[]): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    for (const route of routes) {
      const res = route(url);
      if (res) return res;
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
}

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

/** Keep the fixture's intended dam rows inside the production 48 h cutoff. */
function damsAt(nowMs: number): typeof damFixture {
  const bangkokStamp = (offsetMs: number) => {
    const d = new Date(nowMs + offsetMs + 7 * 60 * 60 * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  };
  return {
    ...damFixture,
    data: {
      ...damFixture.data,
      dam_daily: damFixture.data.dam_daily.map((dam) => ({ ...dam, dam_date: bangkokStamp(-60 * 60 * 1000) })),
      dam_medium: damFixture.data.dam_medium.map((dam) => ({ ...dam, dam_date: bangkokStamp(-2 * 60 * 60 * 1000) })),
    },
  };
}

const thaiwaterRoutes = (rain: unknown, water: unknown, dam: unknown): FetchRoute => (url) => {
  if (url.includes("rain_24h")) return jsonResponse(rain);
  if (url.includes("waterlevel_load")) return jsonResponse(water);
  if (url.includes("analyst/dam")) return jsonResponse(dam);
  return null;
};

function countRows(ctx: DurableObjectState, table: string): number {
  return ctx.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).toArray()[0]?.n ?? 0;
}

function meta(ctx: DurableObjectState, key: string): string | null {
  return (
    ctx.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value ?? null
  );
}

describe("ObservationCacheDO: payload ผิดรูปไม่แตะแถวเดิม", () => {
  const stub = env.OBSERVATION_CACHE.getByName("obs-shape");

  it("รอบที่ดีเก็บแถวได้ แล้วรอบที่ payload เป็น {} ทิ้งแถวเดิมไว้ครบและรายงาน degraded", async () => {
    routeFetch(thaiwaterRoutes(rainFixture, waterFixture, damFixture));
    await runInDurableObject(stub, (instance) => instance.alarm());

    const before = await runInDurableObject(stub, (_instance, ctx) => ({
      rainfall: countRows(ctx, "rainfall"),
      waterlevel: countRows(ctx, "waterlevel"),
      fetchedAt: meta(ctx, "fetchedAt"),
    }));
    expect(before.rainfall).toBe(1);
    expect(before.waterlevel).toBe(2);

    // รอบถัดมาต้นทางส่ง {} — เดิมทีจะถูกอ่านเป็น "ศูนย์สถานี ดึงสำเร็จ"
    routeFetch(thaiwaterRoutes({}, {}, {}));
    await runInDurableObject(stub, (instance) => instance.alarm());

    const after = await runInDurableObject(stub, (_instance, ctx) => ({
      rainfall: countRows(ctx, "rainfall"),
      waterlevel: countRows(ctx, "waterlevel"),
      fetchedAt: meta(ctx, "fetchedAt"),
      lastError: meta(ctx, "lastError"),
    }));
    // แถวเดิมอยู่ครบ และ fetchedAt ไม่ถูกประทับใหม่ (ไม่มีอะไรใหม่ให้ประทับ)
    expect(after.rainfall).toBe(before.rainfall);
    expect(after.waterlevel).toBe(before.waterlevel);
    expect(after.fetchedAt).toBe(before.fetchedAt);
    expect(after.lastError).toContain("shape");
    expect(after.lastError).toContain("rain_24h");
    expect(after.lastError).toContain("waterlevel_load");

    const status: SourceStatus = await runInDurableObject(stub, (instance) => instance.status());
    expect(status.health).toBe("degraded");
    expect(status.lastError).toBeTruthy();
    expect(status.detail.rainfallStations).toBe(1);
    expect(status.detail.rainfallFetchedAt).toBe(before.fetchedAt);
    expect(status.detail.waterlevelFetchedAt).toBe(before.fetchedAt);
    expect(status.detail.rainfallError).toContain("rain_24h");
    expect(status.detail.waterlevelError).toContain("waterlevel_load");
    expect(status.detail.rainfallHealth).toBe("degraded");
    expect(status.detail.waterlevelHealth).toBe("degraded");
    // ต้องไหลผ่านบันไดเดิม: มี lastError ค้างอยู่ = /health ไม่มีทางเป็น ok
    expect(healthOk([status])).toBe(false);
  });

  it("validate เสร็จก่อนเขียน จึงไม่มีรอบไหน 'เขียนไปได้ครึ่งทาง'", async () => {
    const stubHalf = env.OBSERVATION_CACHE.getByName("obs-half");
    routeFetch(thaiwaterRoutes(rainFixture, waterFixture, damFixture));
    await runInDurableObject(stubHalf, (instance) => instance.alarm());

    // ฝนดี แต่ระดับน้ำพังตรงระเบียนที่ 1 (ระเบียนที่ 0 ดี) — ถ้าตรวจระหว่างเขียน
    // แถว waterlevel จะถูกแก้ไปแล้วครึ่งหนึ่งก่อนเจอของเสีย
    const halfBroken = {
      waterlevel_data: {
        data: [
          { ...waterFixture.waterlevel_data.data[0], id: 900, station: { ...waterFixture.waterlevel_data.data[0].station, id: 900 }, waterlevel_datetime: "2026-08-19 10:00" },
          { id: 901, station: 42 },
        ],
      },
    };
    routeFetch(thaiwaterRoutes(rainFixture, halfBroken, damFixture));
    await runInDurableObject(stubHalf, (instance) => instance.alarm());

    const ids = await runInDurableObject(stubHalf, (_instance, ctx) =>
      ctx.storage.sql.exec<{ station_id: number }>("SELECT station_id FROM waterlevel ORDER BY station_id").toArray().map((r) => r.station_id),
    );
    // สถานี 900 ต้องไม่ถูกเขียนลงไปเลย ทั้งที่มันอยู่ "ก่อน" ระเบียนที่พัง
    expect(ids).toEqual([201, 202]);
  });

  it("เขื่อน: payload ที่เหลือศูนย์แถวต้องไม่ล้างตารางเขื่อนทิ้ง", async () => {
    // Capture one clock for this test so both fixture rows remain valid under
    // the production age cutoff without coupling the assertion to wall time.
    const dams = damsAt(Date.now());
    const stubDam = env.OBSERVATION_CACHE.getByName("obs-dams");
    routeFetch(thaiwaterRoutes(rainFixture, waterFixture, dams));
    await runInDurableObject(stubDam, (instance) => instance.getDams(null));
    const before = await runInDurableObject(stubDam, (_instance, ctx) => countRows(ctx, "dams"));
    expect(before).toBe(2);

    routeFetch(thaiwaterRoutes(rainFixture, waterFixture, { data: { dam_hourly: [], dam_daily: [], dam_medium: [] } }));
    await runInDurableObject(stubDam, (_instance, ctx) => {
      ctx.storage.sql.exec("DELETE FROM meta WHERE key = 'damsFetchedAt'");
    });
    await runInDurableObject(stubDam, (instance) => instance.getDams(null));

    const after = await runInDurableObject(stubDam, (_instance, ctx) => ({
      dams: countRows(ctx, "dams"),
      damsError: meta(ctx, "damsError"),
    }));
    expect(after.dams).toBe(before);
    expect(after.damsError).toContain("shape");

    // และความล้มเหลวของฟีดเขื่อนต้องมองเห็นได้ ไม่ใช่ซ่อนอยู่ใน detail อย่างเดียว
    const status: SourceStatus = await runInDurableObject(stubDam, (instance) => instance.status());
    expect(status.lastError).toContain("dams:");
    expect(healthOk([status])).toBe(false);

    // ...และต้องหายไปเมื่อต้นทางกลับมาปกติ ไม่ใช่ค้างจน /health ไม่มีวันเป็น ok อีก
    // (เลื่อนเวลาที่ลองล่าสุดให้พ้นระยะเว้น 5 นาที เหมือนรอบถัดไปในชีวิตจริง)
    routeFetch(thaiwaterRoutes(rainFixture, waterFixture, dams));
    await runInDurableObject(stubDam, (_instance, ctx) => {
      ctx.storage.sql.exec("DELETE FROM meta WHERE key = 'damsFetchedAt'");
      ctx.storage.sql.exec(
        "INSERT INTO meta (key, value) VALUES ('damsAttemptAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        String(Date.now() - 10 * 60 * 1000),
      );
    });
    await runInDurableObject(stubDam, (instance) => instance.getDams(null));
    const recovered: SourceStatus = await runInDurableObject(stubDam, (instance) => instance.status());
    expect(recovered.lastError).toBeNull();
    expect(recovered.detail.damsError).toBeNull();
  });

  it("ฟีดเขื่อนที่พังต้องไม่ถูกยิงซ้ำทุกคำขอ", async () => {
    const stubBurst = env.OBSERVATION_CACHE.getByName("obs-dams-burst");
    let damCalls = 0;
    routeFetch((url) => {
      if (url.includes("rain_24h")) return jsonResponse(rainFixture);
      if (url.includes("waterlevel_load")) return jsonResponse(waterFixture);
      if (url.includes("analyst/dam")) {
        damCalls++;
        return jsonResponse({});
      }
      return null;
    });
    for (let i = 0; i < 5; i++) await runInDurableObject(stubBurst, (instance) => instance.getDams(null));
    expect(damCalls).toBe(1);
  });
});

describe("FloodExtentDO: ฉากที่ผิดรูปไม่ทับฉากล่าสุด และไม่แตะ R2 ครึ่งทาง", () => {
  const floodRoute: FetchRoute = (url) => (url.includes("flooding_vis") ? jsonResponse(gistdaFixture) : null);
  const brokenRoute: FetchRoute = (url) => (url.includes("flooding_vis") ? jsonResponse({ type: "FeatureCollection" }) : null);

  it("รอบที่พังคงแถวเดิม คง archive เดิมใน R2 และรายงาน degraded", async () => {
    const stub = env.FLOOD_EXTENT.getByName("flood-shape");
    routeFetch(floodRoute);
    await runInDurableObject(stub, (instance) => instance.alarm());

    const before = await runInDurableObject(stub, (_instance, ctx) => ({
      features: countRows(ctx, "flood_features"),
      retrievedAt: meta(ctx, "retrievedAt"),
      sceneHash: meta(ctx, "sceneHash"),
    }));
    expect(before.features).toBe(2);
    const archiveBefore = (await env.HAZARD_BUCKET.list({ prefix: "archive/flood/" })).objects.map((o) => ({
      key: o.key,
      size: o.size,
    }));
    expect(archiveBefore.length).toBeGreaterThan(0);

    routeFetch(brokenRoute);
    await runInDurableObject(stub, (instance) => instance.alarm());

    const after = await runInDurableObject(stub, (_instance, ctx) => ({
      features: countRows(ctx, "flood_features"),
      retrievedAt: meta(ctx, "retrievedAt"),
      sceneHash: meta(ctx, "sceneHash"),
      lastError: meta(ctx, "lastError"),
    }));
    expect(after.features).toBe(before.features);
    expect(after.retrievedAt).toBe(before.retrievedAt);
    expect(after.sceneHash).toBe(before.sceneHash);
    expect(after.lastError).toContain("shape");

    const archiveAfter = (await env.HAZARD_BUCKET.list({ prefix: "archive/flood/" })).objects.map((o) => ({
      key: o.key,
      size: o.size,
    }));
    // ไม่มีอ็อบเจกต์ใหม่ และของเดิมไม่ถูกเขียนทับด้วยฉากว่าง
    expect(archiveAfter).toEqual(archiveBefore);

    const status: SourceStatus = await runInDurableObject(stub, (instance) => instance.status());
    expect(status.health).toBe("degraded");
    expect(status.lastError).toContain("gistda");
    expect(healthOk([status])).toBe(false);
  });
});

describe("RadarDO: เฟรมเสียถูกข้าม นับไว้ และ 'มองเห็นได้'", () => {
  /**
   * ตรึงเวลาอ้างอิงไว้ครั้งเดียวทั้ง describe — ถ้าปล่อยให้แต่ละ block เรียก
   * Date.now() เอง แล้วชุดเทสบังเอิญคร่อมขอบช่อง 15 นาที ดัชนีที่สร้างขึ้นจะเลื่อน
   * ไปอีกช่อง ทำให้จำนวนเฟรมที่คาดไว้ไม่ตรง
   */
  const NOW_MS = Date.now();
  /** ดัชนีที่มีเวลาใกล้ปัจจุบัน เพื่อไม่ให้ health ไปตกที่ delayed ด้วยเรื่องอายุเฟรม */
  const radarList = (nowMs: number) => radarListAt(nowMs);

  const listRoute = (nowMs: number): FetchRoute => (url) =>
    url.includes("images_composite.list") ? new Response(radarList(nowMs)) : null;
  const frameRoute = (broken: string[]): FetchRoute => (url) => {
    const match = /zr\d{4}\.png/.exec(url);
    if (!match) return null;
    return new Response(broken.includes(match[0]) ? truncatedPngFrame() : validPngFrame());
  };

  it("เฟรมที่ถูกตัดกลาง: ข้าม + นับใน detail + degraded พร้อม lastError ที่ระบุชื่อเฟรม", async () => {
    const stub = env.RADAR.getByName("radar-shape");
    routeFetch(listRoute(NOW_MS), frameRoute(["zr0023.png"]));
    await runInDurableObject(stub, (instance) => instance.alarm());

    const status: SourceStatus = await runInDurableObject(stub, (instance) => instance.status());
    expect(status.detail.skippedFrames).toBe(1);
    // ตัวนับอย่างเดียวไม่พอ: SourceStatusBar แสดงแค่ health กับ lastError
    expect(status.health).toBe("degraded");
    expect(status.lastError).toContain("zr0023.png");
    expect(healthOk([status])).toBe(false);
    // เฟรมที่ดีของรอบเดียวกันต้องถูกเก็บไว้ ไม่ใช่ทิ้งทั้งรอบ
    expect(status.detail.frames24h).toBe(1);
  });

  it("ล้าง lastError เฉพาะรอบที่ทุกเฟรมผ่าน", async () => {
    const stub = env.RADAR.getByName("radar-shape");

    // รอบที่ 2 เฟรมเดิมยังเสียอยู่ — สถานะต้องยัง degraded ไม่ใช่หายไปเอง
    routeFetch(listRoute(NOW_MS), frameRoute(["zr0023.png"]));
    await runInDurableObject(stub, (instance) => instance.alarm());
    const stillBad: SourceStatus = await runInDurableObject(stub, (instance) => instance.status());
    expect(stillBad.health).toBe("degraded");
    expect(stillBad.detail.skippedFrames).toBe(1);

    // รอบที่ 3 ต้นทางกลับมาปกติ
    routeFetch(listRoute(NOW_MS), frameRoute([]));
    await runInDurableObject(stub, (instance) => instance.alarm());
    const healthy: SourceStatus = await runInDurableObject(stub, (instance) => instance.status());
    expect(healthy.detail.skippedFrames).toBe(0);
    expect(healthy.lastError).toBeNull();
    expect(healthy.health).toBe("ok");
    expect(healthy.detail.frames24h).toBe(2);
  });

  it("ดัชนีที่ parse ไม่ได้: ไม่มีเฟรมไหนถูกลบ และรายงาน degraded", async () => {
    const stub = env.RADAR.getByName("radar-index");
    routeFetch(listRoute(NOW_MS), frameRoute([]));
    await runInDurableObject(stub, (instance) => instance.alarm());
    const before: SourceStatus = await runInDurableObject(stub, (instance) => instance.status());
    expect(before.detail.frames24h).toBe(2);

    routeFetch((url) => (url.includes("images_composite.list") ? new Response("upstream redesigned this page\n") : null));
    await runInDurableObject(stub, (instance) => instance.alarm());
    const after: SourceStatus = await runInDurableObject(stub, (instance) => instance.status());
    expect(after.detail.frames24h).toBe(2);
    expect(after.health).toBe("degraded");
    expect(after.lastError).toContain("slots");
  });
});
