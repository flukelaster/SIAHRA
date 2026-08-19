import { env, exports as workerExports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { EarthquakeRecentResponse } from "@siahra/shared-types";
import emscFixture from "./fixtures/emsc-query.json";
import usgsFixture from "./fixtures/usgs-all-hour.json";
import { TMD_SEISMIC_XML } from "./fixtures/text";

/**
 * E5.5 AC 3–4 — EarthquakeFeedDO ครบสามฟีดผ่าน fixture ชุดเดียวกับที่ adapter
 * เทสใช้ (apps/api/test/fixtures) แล้วดูสองสภาพที่ต่างกันคนละขั้ว:
 *   - ทุกฟีดตอบ → เหตุการณ์เข้าคลัง, `/api/v1/earthquakes/recent` เสิร์ฟได้, `ok`
 *   - ทุกฟีดล้ม → `down` แต่ **ของเดิมยังเสิร์ฟอยู่** (ล่มไม่เท่ากับข้อมูลหาย)
 *
 * **ทำไมต้องเลื่อนเวลาใน fixture**: ทั้ง DO และ adapter ตัดข้อมูลตามอายุจริง
 * (retention 30 วันของ DO และ MAX_AGE_MS 30 วันของ TMD) fixture ที่ตรึงวันที่ไว้
 * จะค่อย ๆ หลุดกรอบเวลาไปเองเมื่อเวลาผ่านไป แล้วเทสจะเริ่มพังโดยไม่มีอะไรเสียจริง
 * ที่นี่จึงยืม *รูปร่าง* ของ fixture มาแล้วประทับเวลาใหม่สัมพัทธ์กับตอนนี้ —
 * ไม่ใช่สร้าง fixture ชุดคู่ขนาน (payload ทุกฟิลด์ที่เหลือมาจากไฟล์เดิมทั้งหมด)
 *
 * TMD ต้องมีคีย์จึงจะยิงได้ ไฟล์นี้จึงตั้ง TMD_UID/TMD_UKEY ปลอมไว้เฉพาะไฟล์นี้
 * (env ของ pool ใช้ร่วมกับ DO ในไอโซเลตเดียวกัน) แล้วคืนค่าเดิมเมื่อจบ —
 * สภาพ "ไม่มีคีย์" ซึ่งเป็น honest-degradation ของ production วันนี้ ถูกยึดไว้
 * ที่ earthquakeFeedCredentials.test.ts ต่างหาก
 */
const NOW_MS = Date.now();
const MIN = 60_000;

const mutableEnv = env as unknown as Record<string, string | undefined>;
const savedCreds = { uid: mutableEnv.TMD_UID, ukey: mutableEnv.TMD_UKEY };

/** USGS: `time`/`updated` เป็น epoch ms — เลื่อนทั้งชุดมาที่หน้าต่างล่าสุด */
function usgsAt(nowMs: number): unknown {
  const clone = structuredClone(usgsFixture) as {
    features: { properties: { time: number; updated: number } }[];
  };
  clone.features.forEach((f, i) => {
    f.properties.time = nowMs - (10 + i) * MIN;
    f.properties.updated = nowMs - (9 + i) * MIN;
  });
  return clone;
}

/** EMSC: `time`/`lastupdate` เป็น ISO string */
function emscAt(nowMs: number): unknown {
  const clone = structuredClone(emscFixture) as {
    features: { properties: { time: string; lastupdate: string } }[];
  };
  clone.features.forEach((f, i) => {
    f.properties.time = new Date(nowMs - (20 + i) * MIN).toISOString();
    f.properties.lastupdate = new Date(nowMs - (19 + i) * MIN).toISOString();
  });
  return clone;
}

/** TMD: `<DateTimeUTC>` เป็น "YYYY-MM-DD hh:mm:ss.mmm" ตามรูปแบบของต้นทางเป๊ะ ๆ */
function tmdXmlAt(nowMs: number): string {
  let i = 0;
  return TMD_SEISMIC_XML.replace(/<DateTimeUTC>[^<]*<\/DateTimeUTC>/g, () => {
    const stamp = new Date(nowMs - (30 + 10 * i++) * MIN).toISOString().replace("T", " ").replace("Z", "");
    return `<DateTimeUTC>${stamp}</DateTimeUTC>`;
  });
}

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

/** ทุกฟีดตอบตามปกติ (backfill ของ USGS ตอบชุดว่าง เพื่อให้จำนวนที่นับได้แน่นอน) */
function serveAllFeeds(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host === "earthquake.usgs.gov") {
      return url.pathname.startsWith("/fdsnws")
        ? jsonResponse({ type: "FeatureCollection", features: [] })
        : jsonResponse(usgsAt(NOW_MS));
    }
    if (url.host === "www.seismicportal.eu") return jsonResponse(emscAt(NOW_MS));
    if (url.host === "data.tmd.go.th") return new Response(tmdXmlAt(NOW_MS));
    throw new Error(`unexpected upstream call to ${url.host}`);
  });
}

/** ทุกฟีดตอบ 500 — ไม่มีสักฟีดที่สำเร็จในรอบนั้น */
function serveAllFailing(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response("upstream on fire", { status: 500, statusText: "Internal Server Error" }),
  );
}

const statusOf = (name: string) =>
  runInDurableObject(env.EARTHQUAKE_FEED.getByName(name), async (instance) => (await instance.status())[0]);

beforeAll(() => {
  mutableEnv.TMD_UID = "test-uid";
  mutableEnv.TMD_UKEY = "test-ukey";
});

afterAll(async () => {
  mutableEnv.TMD_UID = savedCreds.uid;
  mutableEnv.TMD_UKEY = savedCreds.ukey;
  await runInDurableObject(env.EARTHQUAKE_FEED.getByName("global"), (_instance, ctx) =>
    ctx.storage.deleteAlarm(),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EarthquakeFeedDO: สามฟีดตอบครบ", () => {
  it("เก็บเหตุการณ์จากทุกฟีด รายงาน ok และเสิร์ฟผ่านเส้นทางจริง", async () => {
    serveAllFeeds();
    const stub = env.EARTHQUAKE_FEED.getByName("global");
    await runInDurableObject(stub, (instance) => instance.pollAndBroadcast());

    const res = await workerExports.default.fetch(
      new Request("https://siahra-radar.co/api/v1/earthquakes/recent"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as EarthquakeRecentResponse;

    // usgs 1 (quarry blast ถูกกรองทิ้งเพราะ type ไม่ใช่ earthquake) + emsc 1 + tmd 2
    expect(body.events).toHaveLength(4);
    const sources = body.events.flatMap((e) => e.sources);
    expect(sources).toContain("usgs");
    expect(sources).toContain("emsc");
    expect(sources).toContain("tmd");
    expect(body.events.some((e) => e.id === "usgs:us7000abce")).toBe(false);

    // descriptor ต้องประกาศชนิดข้อมูลและเวลาที่ดึงจริง
    expect(body.layer.epistemicClass).toBe("observed");
    expect(body.layer.sourceIds).toContain("earthquakes");
    expect(body.layer.fetchedAt).not.toBeNull();

    const status = await statusOf("global");
    expect(status.id).toBe("earthquakes");
    expect(status.health).toBe("ok");
    expect(status.lastError).toBeNull();
    expect(status.fetchedAt).not.toBeNull();
  });

  it("poll ซ้ำด้วยข้อมูลเดิมไม่สร้างแถวซ้ำ", async () => {
    serveAllFeeds();
    const stub = env.EARTHQUAKE_FEED.getByName("global");
    const again = await runInDurableObject(stub, (instance) => instance.pollAndBroadcast());
    expect(again.created).toBe(0);

    const res = await workerExports.default.fetch(
      new Request("https://siahra-radar.co/api/v1/earthquakes/recent"),
    );
    const body = (await res.json()) as EarthquakeRecentResponse;
    expect(body.events).toHaveLength(4);
  });
});

describe("EarthquakeFeedDO: ทุกฟีดล้มพร้อมกัน", () => {
  it("รายงาน down แต่ยังเสิร์ฟเหตุการณ์ที่เก็บไว้แล้ว", async () => {
    const stub = env.EARTHQUAKE_FEED.getByName("global");
    serveAllFailing();
    await runInDurableObject(stub, (instance) => instance.pollAndBroadcast());

    const status = await statusOf("global");
    // ทุกฟีดล้มในรอบเดียว = ต้นทางตาย ไม่ใช่แค่ "เสื่อม"
    expect(status.health).toBe("down");
    expect(status.lastError).toContain("usgs");
    expect(status.lastError).toContain("emsc");
    expect(status.lastError).toContain("tmd");
    expect(status.detail.events30d).toBe(4);

    // ...แต่ข้อมูลที่มีอยู่ต้องไม่หายไปจากหน้าจอ
    const res = await workerExports.default.fetch(
      new Request("https://siahra-radar.co/api/v1/earthquakes/recent"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as EarthquakeRecentResponse;
    expect(body.events).toHaveLength(4);
    // fetchedAt ของรอบที่ล้มยังเป็นเวลาจริงของรอบล่าสุด — อายุของมันคือสิ่งที่
    // ทำให้ผู้ใช้รู้ว่าข้อมูลเก่าลงเรื่อย ๆ ห้ามซ่อนหรือรีเซ็ตเป็น null
    expect(body.layer.fetchedAt).not.toBeNull();
  });

  it("รอบ alarm หลังจากนั้นตั้งนัดครั้งถัดไปต่อได้ ไม่หยุดถาวรเพราะรอบที่ล้ม", async () => {
    const stub = env.EARTHQUAKE_FEED.getByName("global");
    serveAllFailing();
    // getRecent() ที่ผ่านมาแล้วจะติดนัดไว้ให้ — รอบ alarm นี้จึงมีของให้รัน
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const next = await runInDurableObject(stub, (_instance, ctx) => ctx.storage.getAlarm());
    expect(next).not.toBeNull();
    expect(next!).toBeGreaterThan(Date.now());

    const status = await statusOf("global");
    expect(status.health).toBe("down");
    expect(status.nextAttemptAt).not.toBeNull();
  });
});
