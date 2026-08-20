import { env, exports as workerExports } from "cloudflare:workers";
import { evictDurableObject, listDurableObjectIds, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RadarFramesResponse, SourceStatus } from "@siahra/shared-types";
import { radarListAt, validPngFrame } from "./fixtures/text";

/**
 * E5.5 — Durable Object หนึ่งตัว "ครบวง" ผ่านคำขอ HTTP จริง
 *
 * RadarDO เป็นตัวเดียวที่แตะครบทั้งสี่ชั้นในรอบเดียว: router → DO → R2 →
 * response ที่ผู้ใช้ได้รับจริง เทสนี้จึงเดินทางเดียวกับผู้ใช้ ไม่ใช่เรียกเมทอด
 * ตรง ๆ แล้วเชื่อว่าเส้นทางที่เหลือเชื่อมกันอยู่
 *
 * สิ่งที่พิสูจน์:
 * 1. `GET /api/v1/radar/frames` เย็น ๆ ทำให้ DO ดึงต้นทาง เขียนเฟรมลง R2 แล้ว
 *    ตอบ descriptor ที่ประกาศชนิดข้อมูลถูกต้อง (`observed` + `sourceIds`)
 * 2. `GET /api/v1/radar/frame/{ts}.png` อ่านไบต์เดิมกลับมาจาก R2 (put/get smoke)
 * 3. เส้นทาง alarm ผ่าน `runDurableObjectAlarm` — ทั้งรอบที่สำเร็จและรอบที่พัง
 *    ต้อง **ตั้งนัดครั้งถัดไปเสมอ** (alarm ที่ไม่ถูกตั้งใหม่ = ฟีดตายเงียบ)
 * 4. ข้อมูลอยู่รอดการถูก evict ออกจากหน่วยความจำ
 *
 * **การแยก storage**: pool 0.22 แยก storage ต่อ "ไฟล์" เทส แต่ไม่แยกต่อ block
 * (ดู vitest.config.ts) ไฟล์นี้จึงจงใจ *ไม่* พึ่งการแยกอัตโนมัติ: ทุก block ที่
 * ต้องเริ่มจากศูนย์ใช้ชื่อ instance ของตัวเอง และเทสที่ยิงผ่าน Worker จริงใช้ชื่อ
 * `tmd` (ชื่อเดียวกับที่ route ใช้) เรียงกันแบบตั้งใจให้สถานะไหลต่อกันเป็นเรื่อง
 * เดียว ไม่ใช่บังเอิญรั่ว
 */
const NOW_MS = Date.now();

const workerFetch = (url: string, init: RequestInit = {}) =>
  workerExports.default.fetch(new Request(url, init));

/** ต้นทางปลอมที่มีแค่สองปลายทางของเรดาร์ — ปลายทางอื่นถือว่าเป็นบั๊กของเทสเอง */
function serveRadar(options: { list?: string | Error; frame?: () => Response } = {}): void {
  const list = options.list ?? radarListAt(NOW_MS);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("images_composite.list")) {
      if (list instanceof Error) throw list;
      return new Response(list);
    }
    if (/zr\d{4}\.png/.test(url)) return (options.frame ?? (() => new Response(validPngFrame())))();
    throw new Error(`unexpected fetch in test: ${url}`);
  });
}

const alarmAt = (name: string) =>
  runInDurableObject(env.RADAR.getByName(name), (_instance, ctx) => ctx.storage.getAlarm());

beforeEach(() => {
  serveRadar();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  // ไม่ทิ้ง alarm ค้างไว้ให้ไฟล์อื่น/รอบถัดไปของ runner ต้องเจอ
  await runInDurableObject(env.RADAR.getByName("tmd"), (_instance, ctx) => ctx.storage.deleteAlarm());
});

describe("เรดาร์ครบวง: HTTP → Durable Object → R2", () => {
  it("คำขอแรกดึงต้นทาง เขียน R2 และตอบ descriptor ที่ประกาศชนิดข้อมูลถูกต้อง", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/radar/frames?hours=24");
    expect(res.status).toBe(200);
    const body = (await res.json()) as RadarFramesResponse;

    expect(body.frames).toHaveLength(2);
    expect(body.layer.epistemicClass).toBe("observed");
    expect(body.layer.liveOrStatic).toBe("live");
    expect(body.layer.sourceIds).toContain("tmd-radar");
    // ดึงสำเร็จแล้วต้องมีเวลาจริง ไม่ใช่ null — และ observedAt ต้องเป็นเวลาเฟรม
    expect(body.fetchedAt).not.toBeNull();
    expect(Date.parse(body.layer.observedAt!)).toBeLessThanOrEqual(Date.now());

    const stored = await env.HAZARD_BUCKET.list({ prefix: "radar/tmd-composite/" });
    expect(stored.objects.length).toBeGreaterThanOrEqual(2);
  });

  it("เฟรมที่ระบุใน response อ่านกลับมาจาก R2 ได้ไบต์ตรงกัน", async () => {
    const listRes = await workerFetch("https://siahra-radar.co/api/v1/radar/frames?hours=24");
    const body = (await listRes.json()) as RadarFramesResponse;
    const frameUrl = body.frames[0].url;
    expect(frameUrl).toMatch(/^\/api\/v1\/radar\/frame\/\d+\.png$/);

    const frameRes = await workerFetch(`https://siahra-radar.co${frameUrl}`);
    expect(frameRes.status).toBe(200);
    expect(frameRes.headers.get("Content-Type")).toBe("image/png");
    expect(frameRes.headers.get("ETag")).toBeTruthy();
    const bytes = new Uint8Array(await frameRes.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(new Uint8Array(validPngFrame())));
  });

  it("เฟรมที่ไม่มีในดัชนีตอบ 404 ไม่ใช่ 500 หรือรูปเปล่า", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/radar/frame/1.png");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) });
  });
});

describe("เส้นทาง alarm", () => {
  it("คำขอแรกตั้งนัดไว้ และ runDurableObjectAlarm เดินรอบดึงจริง", async () => {
    await workerFetch("https://siahra-radar.co/api/v1/radar/frames?hours=24");
    // ensureFresh() ต้องติดนัดไว้เสมอ ไม่งั้นเรดาร์จะหยุดอัปเดตทันทีที่ไม่มีคำขอ
    expect(await alarmAt("tmd")).not.toBeNull();

    // ต้นทางปล่อยเฟรมใหม่เพิ่มอีกช่องหนึ่ง — รอบ alarm ต้องเก็บมันเข้ามา
    serveRadar({
      list: radarListAt(NOW_MS, [
        { offsetMin: 30, file: "zr0022.png" },
        { offsetMin: 15, file: "zr0023.png" },
        { offsetMin: 0, file: "zr0000.png" },
      ]),
    });
    const ran = await runDurableObjectAlarm(env.RADAR.getByName("tmd"));
    expect(ran).toBe(true);

    const status: SourceStatus = await runInDurableObject(env.RADAR.getByName("tmd"), (instance) =>
      instance.status(),
    );
    expect(status.detail.frames24h).toBe(3);
    expect(status.lastError).toBeNull();
    expect(status.health).toBe("ok");

    // นัดครั้งถัดไปต้องถูกตั้งใหม่ในรอบเดียวกัน ไม่ใช่รอคำขอถัดไปมาปลุก
    const next = await alarmAt("tmd");
    expect(next).not.toBeNull();
    expect(next!).toBeGreaterThan(Date.now());
    expect(status.nextAttemptAt).not.toBeNull();
  });

  it("รอบที่ดึงดัชนีไม่สำเร็จยังตั้งนัดลองใหม่ และรายงานความล้มเหลวออกมา", async () => {
    const name = "radar-alarm-retry";
    const stub = env.RADAR.getByName(name);
    await runInDurableObject(stub, (instance) => instance.alarm());
    expect(await alarmAt(name)).not.toBeNull();

    serveRadar({ list: new Error("TMD radar list failed: 503") });
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const status: SourceStatus = await runInDurableObject(stub, (instance) => instance.status());
    // ความล้มเหลวต้องมองเห็นได้ ไม่ใช่แค่ค้างอยู่ใน log
    expect(status.lastError).toContain("503");
    expect(status.health).toBe("degraded");
    // และต้องมีนัดลองใหม่ที่เร็วกว่าคาบปกติ (RETRY 1 นาที ไม่ใช่ REFRESH 5 นาที)
    const next = await alarmAt(name);
    expect(next).not.toBeNull();
    expect(next! - Date.now()).toBeLessThanOrEqual(2 * 60 * 1000);
  });

  it("โหลดเฟรมไม่สำเร็จต้องเขียน lastError ไม่ใช่ degraded แบบไม่มีข้อความ", async () => {
    // เคสนี้เคยหลุด: เฟรมที่โหลดไม่ได้ถูก log อย่างเดียว แถบสถานะจึงขึ้น degraded
    // โดยไม่มีเหตุผลให้ผู้ใช้อ่านเลย — ยึดไว้ที่นี่ผ่านเส้นทาง alarm โดยเฉพาะ
    const name = "radar-frame-download";
    const stub = env.RADAR.getByName(name);
    serveRadar({
      frame: () => {
        throw new Error("frame 502");
      },
    });
    await runInDurableObject(stub, (instance) => instance.alarm());

    const status: SourceStatus = await runInDurableObject(stub, (instance) => instance.status());
    expect(status.lastError).not.toBeNull();
    expect(status.lastError).toContain("zr0023.png");
    expect(status.detail.skippedFrames).toBe(2);
    expect(status.health).toBe("degraded");
  });
});

describe("อยู่รอดการถูก evict", () => {
  it("เฟรมที่เก็บไว้ยังอยู่ครบหลัง instance ถูกทิ้งจากหน่วยความจำ", async () => {
    await workerFetch("https://siahra-radar.co/api/v1/radar/frames?hours=24");
    const before: SourceStatus = await runInDurableObject(env.RADAR.getByName("tmd"), (instance) =>
      instance.status(),
    );

    await evictDurableObject(env.RADAR.getByName("tmd"));

    const after: SourceStatus = await runInDurableObject(env.RADAR.getByName("tmd"), (instance) =>
      instance.status(),
    );
    expect(after.detail.frames24h).toBe(before.detail.frames24h);
    expect(after.fetchedAt).toBe(before.fetchedAt);

    // instance ที่ไฟล์นี้สร้างต้องยังอยู่ในสมุดของ namespace หลัง evict
    // (id ที่ pool คืนมาไม่พก `name` กลับมาด้วย จึงเทียบด้วย id ที่ชื่อนั้นแปลงได้)
    const ids = (await listDurableObjectIds(env.RADAR)).map((id) => id.toString());
    expect(ids).toContain(env.RADAR.idFromName("tmd").toString());
  });
});
