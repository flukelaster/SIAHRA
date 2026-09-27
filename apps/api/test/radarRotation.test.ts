import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RadarFramesResponse, SourceStatus } from "@siahra/shared-types";
import { legacyPngFrame, pngFrameFor, radarListZrAt, radarSlotMs, unknownSizePngFrame } from "./fixtures/text";

/**
 * ดัชนีเรดาร์รูปแบบใหม่ของ TMD (2026-09): ชื่อไฟล์ `zr/<n>.png` เป็นหน้าต่างเลื่อน
 * ที่ถูกใช้ซ้ำกับเวลาใหม่ทุก 15 นาที และบางไฟล์ที่ลงไว้ในดัชนีตอบ 404
 *
 * สิ่งที่พิสูจน์ผ่าน RadarDO จริง (fetch + R2 จริงของ pool):
 * 1. 404 = "ต้นทางไม่ให้บริการภาพนั้น" → นับใน `detail.notServed` ไม่ลง lastError
 *    และ health ยัง ok เมื่อมีเฟรมสด; warn รวมบรรทัดเดียวต่อรอบ
 * 2. ดัชนีที่หมุนระหว่างสองรอบอ่าน → เฟรมที่หมุนไม่ถูก put (`detail.rotated`)
 * 3. อ่านดัชนีซ้ำไม่ได้ → ไม่ put อะไรเลย แต่รอบนั้นไม่ใช่ `false` (ไม่สลับไป RETRY)
 * 4. 5xx ยังลง lastError ตามเดิม
 * 5. คีย์ R2 มาจากเวลาของช่อง ไม่ใช่ชื่อไฟล์
 * 6. อ่านดัชนีซ้ำไม่เกินหนึ่งครั้งต่อรอบ และไม่อ่านเลยถ้าไม่มีเฟรมถูกโหลด
 *
 * storage แยกต่อ "ไฟล์" แต่อยู่ยาวข้าม block — ทุกเทสใช้ชื่อ instance ของตัวเอง
 */
const NOW_MS = Date.now();
const r2Key = (tsMs: number) => `radar/tmd-composite/${new Date(tsMs).toISOString().replace(/[:.]/g, "-")}.png`;

/** "ok" = PNG ที่ไบต์ต่างกันตามชื่อไฟล์; `{ tag }` = PNG ของ tag นั้น (ใช้จำลองภาพที่ยังไม่ถูกสลับ) */
type FrameReply = "ok" | 404 | 503 | { tag: string } | { bytes: () => ArrayBuffer };

/**
 * ต้นทางปลอม: `lists` คือคำตอบของดัชนีตามลำดับการเรียก (ครั้งเกินจากนั้นใช้ตัวสุดท้าย)
 * `frames` กำหนดคำตอบรายไฟล์ ไฟล์ที่ไม่ได้ระบุ = PNG ที่ถูกต้อง
 */
function serveZr(lists: (string | Error)[], frames: Record<string, FrameReply> = {}) {
  let n = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("images_composite.list")) {
      const list = lists[Math.min(n++, lists.length - 1)];
      if (list instanceof Error) throw list;
      return new Response(list);
    }
    const m = /\/composite\/images\/(zr\/\d+\.png)\?t=\d+$/.exec(url);
    if (m) {
      const reply = frames[m[1]] ?? "ok";
      if (reply === "ok") return new Response(pngFrameFor(m[1]));
      if (typeof reply === "object") return new Response("tag" in reply ? pngFrameFor(reply.tag) : reply.bytes());
      return new Response("upstream says no", { status: reply });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
}

type FetchSpy = { mock: { calls: [input: RequestInfo | URL, ...rest: unknown[]][] } };
function listCalls(spy: FetchSpy): number {
  return spy.mock.calls.filter(([input]) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.includes("images_composite.list");
  }).length;
}
function frameCalls(spy: FetchSpy): string[] {
  return spy.mock.calls
    .map(([input]) => (input instanceof Request ? input.url : String(input)))
    .filter((url) => url.includes("/composite/images/"));
}

const status = (name: string): Promise<SourceStatus> =>
  runInDurableObject(env.RADAR.getByName(name), (instance) => instance.status());
const runAlarm = (name: string) => runInDurableObject(env.RADAR.getByName(name), (instance) => instance.alarm());
const alarmAt = (name: string) =>
  runInDurableObject(env.RADAR.getByName(name), (_instance, ctx) => ctx.storage.getAlarm());

/** บรรทัด log JSON ที่ออกทาง console.error (warn/error) ในระหว่างเทส */
function warnMessages(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.flatMap(([line]) => {
    try {
      return [String((JSON.parse(String(line)) as { message: unknown }).message)];
    } catch {
      return [];
    }
  });
}

/**
 * R2 ของ pool แยกต่อไฟล์ แต่ **ใช้ร่วมกันทุก instance ของ DO** และคีย์ขึ้นกับเวลาของ
 * ช่องเท่านั้น — เทสที่ตรวจว่า "ไม่มีอะไรถูก put" จึงต้องเริ่มจาก prefix ที่ว่าง
 * (list/delete ในโค้ดเทสเท่านั้น ไม่ใช่บนเส้นทาง refresh)
 */
beforeEach(async () => {
  const { objects } = await env.HAZARD_BUCKET.list({ prefix: "radar/tmd-composite/" });
  if (objects.length) await env.HAZARD_BUCKET.delete(objects.map((o) => o.key));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const INSTANCES = [
  "zr-not-served",
  "zr-rotated",
  "zr-reread-fails",
  "zr-5xx",
  "zr-no-reread",
  "zr-same-bytes",
  "zr-stale-newest",
  "zr-legacy-size-now",
  "zr-unknown-size",
  "zr-mercator-before-cutoff",
  "zr-frames-response",
];
afterAll(async () => {
  // ไม่ทิ้ง alarm ค้างไว้ให้ไฟล์อื่น/รอบถัดไปของ runner ต้องเจอ
  for (const name of INSTANCES) {
    await runInDurableObject(env.RADAR.getByName(name), (_instance, ctx) => ctx.storage.deleteAlarm());
  }
});

describe("RadarDO กับดัชนีรูปแบบ zr/<n>.png", () => {
  it("404 ของไฟล์ที่ลงไว้ในดัชนี: นับเป็น notServed ไม่ลง lastError, health ok, warn บรรทัดเดียว", async () => {
    const name = "zr-not-served";
    const list = radarListZrAt(NOW_MS, [
      { offsetMin: 75, file: "zr/0.png" },
      { offsetMin: 60, file: "zr/1.png" },
      { offsetMin: 45, file: "zr/2.png" },
      { offsetMin: 30, file: "zr/3.png" },
      { offsetMin: 15, file: "zr/4.png" },
    ]);
    const spy = serveZr([list], { "zr/0.png": 404, "zr/1.png": 404, "zr/2.png": 404 });
    const errSpy = vi.spyOn(console, "error");
    await runAlarm(name);

    const s = await status(name);
    expect(s.detail.notServed).toBe(3);
    expect(s.detail.rotated).toBe(0);
    expect(s.detail.skippedFrames).toBe(0);
    expect(s.detail.frames24h).toBe(2);
    expect(s.lastError).toBeNull();
    expect(s.health).toBe("ok");
    // ยิงภาพครั้งเดียวต่อช่องที่ยังไม่มี และอ่านดัชนีซ้ำครั้งเดียว
    expect(frameCalls(spy)).toHaveLength(5);
    expect(listCalls(spy)).toBe(2);

    const warns = warnMessages(errSpy);
    expect(warns.filter((m) => m === "radar frames not stored")).toHaveLength(1);
    expect(warns.filter((m) => m === "radar frame skipped")).toHaveLength(0);
    const line = errSpy.mock.calls
      .map(([l]) => String(l))
      .find((l) => l.includes("radar frames not stored"));
    expect(JSON.parse(line!)).toMatchObject({ notServed: 3, notServedFiles: ["zr/0.png", "zr/1.png", "zr/2.png"] });
  });

  it("ดัชนีหมุนระหว่างสองรอบอ่าน: เฟรมที่ชื่อไฟล์ชี้เวลาใหม่แล้วไม่ถูก put", async () => {
    const name = "zr-rotated";
    const first = radarListZrAt(NOW_MS, [
      { offsetMin: 30, file: "zr/23.png" },
      { offsetMin: 15, file: "zr/24.png" },
    ]);
    // ระหว่างที่เราโหลด zr/24 ถูกใช้ซ้ำกับช่องที่ใหม่กว่า — zr/23 ยังชี้เวลาเดิม
    const second = radarListZrAt(NOW_MS, [
      { offsetMin: 30, file: "zr/23.png" },
      { offsetMin: 0, file: "zr/24.png" },
    ]);
    const spy = serveZr([first, second]);
    await runAlarm(name);

    const s = await status(name);
    expect(s.detail.rotated).toBe(1);
    expect(s.detail.frames24h).toBe(1);
    expect(s.lastError).toBeNull();
    expect(listCalls(spy)).toBe(2);
    // คีย์ R2 มาจากเวลาของช่อง — เฟรมที่ยืนยันแล้วอยู่ เฟรมที่หมุนไม่มีทั้งใน R2 และในดัชนี
    expect(await env.HAZARD_BUCKET.head(r2Key(radarSlotMs(NOW_MS, 30)))).not.toBeNull();
    expect(await env.HAZARD_BUCKET.head(r2Key(radarSlotMs(NOW_MS, 15)))).toBeNull();
    const rotatedKey = await runInDurableObject(env.RADAR.getByName(name), (instance) =>
      instance.frameKey(radarSlotMs(NOW_MS, 15)),
    );
    expect(rotatedKey).toBeNull();
  });

  it("อ่านดัชนีซ้ำไม่ได้: ไม่ put อะไรเลย ลง lastError แต่ไม่สลับไปคาบ RETRY", async () => {
    const name = "zr-reread-fails";
    const list = radarListZrAt(NOW_MS, [
      { offsetMin: 30, file: "zr/23.png" },
      { offsetMin: 15, file: "zr/24.png" },
    ]);
    const spy = serveZr([list, new Error("TMD radar list failed: 503")]);
    await runAlarm(name);

    const s = await status(name);
    expect(listCalls(spy)).toBe(2);
    expect(s.detail.frames24h).toBe(0);
    expect(s.detail.skippedFrames).toBe(2);
    expect(s.lastError).toContain("re-read");
    expect(await env.HAZARD_BUCKET.head(r2Key(radarSlotMs(NOW_MS, 30)))).toBeNull();
    expect(await env.HAZARD_BUCKET.head(r2Key(radarSlotMs(NOW_MS, 15)))).toBeNull();
    // refresh() ไม่คืน false → alarm ตั้งคาบปกติ 5 นาที ไม่ใช่ RETRY 1 นาที
    const next = await alarmAt(name);
    expect(next).not.toBeNull();
    expect(next! - Date.now()).toBeGreaterThan(2 * 60 * 1000);
  });

  it("5xx ของเฟรมยังเป็นความล้มเหลวจริง: ลง lastError พร้อมชื่อไฟล์ และ degraded", async () => {
    const name = "zr-5xx";
    const list = radarListZrAt(NOW_MS, [
      { offsetMin: 30, file: "zr/23.png" },
      { offsetMin: 15, file: "zr/24.png" },
    ]);
    serveZr([list], { "zr/24.png": 503 });
    await runAlarm(name);

    const s = await status(name);
    expect(s.lastError).toContain("zr/24.png");
    expect(s.lastError).toContain("503");
    expect(s.detail.skippedFrames).toBe(1);
    expect(s.detail.notServed).toBe(0);
    expect(s.health).toBe("degraded");
    expect(s.detail.frames24h).toBe(1);
    // เฟรมเสียรายเฟรมไม่ทำให้รอบนั้นเป็น false
    const next = await alarmAt(name);
    expect(next! - Date.now()).toBeGreaterThan(2 * 60 * 1000);
  });

  it("ไม่อ่านดัชนีซ้ำเมื่อไม่มีเฟรมถูกโหลด (เก็บครบแล้ว หรือทุกช่องเป็น 404)", async () => {
    const name = "zr-no-reread";
    const list = radarListZrAt(NOW_MS, [
      { offsetMin: 30, file: "zr/23.png" },
      { offsetMin: 15, file: "zr/24.png" },
    ]);
    serveZr([list]);
    await runAlarm(name);
    vi.restoreAllMocks();

    // รอบที่สอง: ทุกช่องเก็บแล้ว → ไม่ยิงภาพเลย และอ่านดัชนีครั้งเดียว
    const stored = serveZr([list]);
    await runAlarm(name);
    expect(frameCalls(stored)).toHaveLength(0);
    expect(listCalls(stored)).toBe(1);
    vi.restoreAllMocks();

    // รอบที่สาม: ช่องใหม่เป็น 404 ทั้งหมด → ไม่มีอะไรให้ยืนยัน ไม่อ่านซ้ำ
    const withNew = radarListZrAt(NOW_MS, [
      { offsetMin: 30, file: "zr/23.png" },
      { offsetMin: 15, file: "zr/24.png" },
      { offsetMin: 0, file: "zr/25.png" },
    ]);
    const allMissing = serveZr([withNew], { "zr/25.png": 404 });
    await runAlarm(name);
    expect(frameCalls(allMissing)).toHaveLength(1);
    expect(listCalls(allMissing)).toBe(1);
    const s = await status(name);
    expect(s.detail.notServed).toBe(1);
    expect(s.lastError).toBeNull();
  });

  it("ภาพสองช่องใหม่ที่เวลาต่างกันแต่ไบต์เหมือนกัน: ทิ้งทั้งคู่ (rotated) และไม่อ่านดัชนีซ้ำ", async () => {
    const name = "zr-same-bytes";
    const list = radarListZrAt(NOW_MS, [
      { offsetMin: 30, file: "zr/23.png" },
      { offsetMin: 15, file: "zr/24.png" },
    ]);
    const spy = serveZr([list], { "zr/23.png": { tag: "same" }, "zr/24.png": { tag: "same" } });
    await runAlarm(name);

    const s = await status(name);
    expect(s.detail.rotated).toBe(2);
    expect(s.detail.frames24h).toBe(0);
    expect(s.lastError).toBeNull();
    // ไม่มีเฟรมเหลือให้ยืนยัน → ไม่ต้องอ่านดัชนีซ้ำ
    expect(listCalls(spy)).toBe(1);
    expect(await env.HAZARD_BUCKET.head(r2Key(radarSlotMs(NOW_MS, 30)))).toBeNull();
    expect(await env.HAZARD_BUCKET.head(r2Key(radarSlotMs(NOW_MS, 15)))).toBeNull();
  });

  it("ช่องใหม่สุดที่ภาพยังเป็นภาพของเฟรมใหม่สุดที่เก็บไว้: ทิ้งรอบนี้ แล้วรับรอบถัดไปเมื่อภาพเปลี่ยน", async () => {
    const name = "zr-stale-newest";
    // รอบ 1: เก็บสองช่อง — zr/24 (ย้อน 15 นาที) เป็นเฟรมใหม่สุดที่เก็บไว้
    serveZr([
      radarListZrAt(NOW_MS, [
        { offsetMin: 30, file: "zr/23.png" },
        { offsetMin: 15, file: "zr/24.png" },
      ]),
    ]);
    await runAlarm(name);
    expect((await status(name)).detail.frames24h).toBe(2);
    vi.restoreAllMocks();

    // รอบ 2: หน้าต่างเลื่อนไปหนึ่งช่อง ดัชนีบอกแล้วว่า zr/24 = ช่องปัจจุบัน
    // แต่ภาพที่ zr/24 ยังเป็นภาพเดิม (ต้นทางยังไม่ได้เขียนภาพใหม่)
    const shifted = radarListZrAt(NOW_MS, [
      { offsetMin: 30, file: "zr/22.png" },
      { offsetMin: 15, file: "zr/23.png" },
      { offsetMin: 0, file: "zr/24.png" },
    ]);
    const stale = serveZr([shifted], { "zr/24.png": { tag: "zr/24.png" } });
    await runAlarm(name);
    const afterStale = await status(name);
    expect(afterStale.detail.rotated).toBe(1);
    expect(afterStale.detail.frames24h).toBe(2);
    expect(afterStale.lastError).toBeNull();
    expect(listCalls(stale)).toBe(1);
    expect(await env.HAZARD_BUCKET.head(r2Key(radarSlotMs(NOW_MS, 0)))).toBeNull();
    vi.restoreAllMocks();

    // รอบ 3: ภาพที่ zr/24 ถูกสลับแล้ว → รับไว้ภายใต้เวลาของช่อง
    serveZr([shifted], { "zr/24.png": { tag: "zr/24.png@next" } });
    await runAlarm(name);
    const accepted = await status(name);
    expect(accepted.detail.rotated).toBe(0);
    expect(accepted.detail.frames24h).toBe(3);
    const stored = await env.HAZARD_BUCKET.get(r2Key(radarSlotMs(NOW_MS, 0)));
    expect(stored).not.toBeNull();
    expect(Array.from(new Uint8Array(await stored!.arrayBuffer()))).toEqual(
      Array.from(new Uint8Array(pngFrameFor("zr/24.png@next"))),
    );
  });
});

describe("RadarDO: ขนาดภาพต้องตรงกับ projection ตามเวลา (ไม่มีเฟรมไหนถูกวาดด้วยกรอบที่เดา)", () => {
  const twoSlots = (nowMs: number) =>
    radarListZrAt(nowMs, [
      { offsetMin: 30, file: "zr/23.png" },
      { offsetMin: 15, file: "zr/24.png" },
    ]);

  it("ภาพขนาดเดิม 1173×1668 ที่เวลาปัจจุบัน: ข้าม + lastError (ไม่ถูกเก็บเป็น equirectangular)", async () => {
    const name = "zr-legacy-size-now";
    serveZr([twoSlots(NOW_MS)], { "zr/24.png": { bytes: legacyPngFrame } });
    await runAlarm(name);
    const s = await status(name);
    expect(s.detail.frames24h).toBe(1);
    expect(s.detail.skippedFrames).toBe(1);
    expect(s.lastError).toContain("zr/24.png");
    expect(s.lastError).toContain("equirectangular size for a web-mercator time");
    expect(s.health).toBe("degraded");
    expect(await env.HAZARD_BUCKET.head(r2Key(radarSlotMs(NOW_MS, 15)))).toBeNull();
  });

  it("ขนาดที่ไม่รู้จัก (1×1): ข้าม + lastError ที่บอกขนาด", async () => {
    const name = "zr-unknown-size";
    serveZr([twoSlots(NOW_MS)], { "zr/24.png": { bytes: unknownSizePngFrame } });
    await runAlarm(name);
    const s = await status(name);
    expect(s.detail.skippedFrames).toBe(1);
    expect(s.lastError).toContain("unexpected size 1x1");
    expect(await env.HAZARD_BUCKET.head(r2Key(radarSlotMs(NOW_MS, 15)))).toBeNull();
  });

  it("ภาพ 1800×2644 ที่อ้างเวลาก่อนจุดแบ่ง: ข้าม + lastError (ป้ายตามเวลาจะผิด)", async () => {
    const name = "zr-mercator-before-cutoff";
    const before = Date.parse("2026-09-01T12:00:00Z");
    serveZr([twoSlots(before)]);
    await runAlarm(name);
    const s = await status(name);
    expect(s.detail.skippedFrames).toBe(2);
    expect(s.lastError).toContain("web-mercator size for a equirectangular time");
    expect(await env.HAZARD_BUCKET.head(r2Key(radarSlotMs(before, 15)))).toBeNull();
  });

  it("frames response: ทุกเฟรมบอก projection และช่องที่เลิกใช้ยังมีค่า (bundle เว็บรุ่นก่อนไม่พัง)", async () => {
    const name = "zr-frames-response";
    serveZr([twoSlots(NOW_MS)]);
    const body: RadarFramesResponse = await runInDurableObject(env.RADAR.getByName(name), (instance) =>
      instance.getFrames(24),
    );
    expect(body.frames).toHaveLength(2);
    expect(body.frames.every((f) => f.projection === "web-mercator")).toBe(true);
    expect(body.georeferences["web-mercator"]).toMatchObject({ widthPx: 1800, heightPx: 2644 });
    expect(body.georeferences.equirectangular).toMatchObject({ widthPx: 1173, heightPx: 1668 });
    // ช่องเก่า = georeference ของเฟรมใหม่สุด
    expect(body.bounds).toEqual({ minLon: 95, minLat: 4, maxLon: 108, maxLat: 22.5 });
    expect([body.widthPx, body.heightPx]).toEqual([1800, 2644]);
  });
});
