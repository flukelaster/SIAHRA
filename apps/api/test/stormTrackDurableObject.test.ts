import { runInDurableObject } from "cloudflare:test";
import { env, exports as workerExports } from "cloudflare:workers";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVINCE_CODES, type SourceStatus, type StormsResponse } from "@siahra/shared-types";
import type { AppEnv } from "../src/types";
import gdacsListEmpty from "./fixtures/storm/gdacs-eventlist-empty.json";
import gdacsList from "./fixtures/storm/gdacs-eventlist.json";
import gdacsGeometry from "./fixtures/storm/gdacs-geometry-1001326.json";
import jmaForecast from "./fixtures/storm/jma-TC2632-forecast.json";
import jmaSpecs from "./fixtures/storm/jma-TC2632-specifications.json";
import jmaTargetsEmpty from "./fixtures/storm/jma-targetTc-empty.json";
import jmaTargets from "./fixtures/storm/jma-targetTc.json";

/**
 * StormTrackDO ครบวง: cron → DO → เส้นทาง HTTP / status() — ใช้ fixture จริงของ
 * 2026-09-26 (ดู fixtures/storm/README.md)
 *
 * สิ่งที่ไฟล์นี้ตรึงไว้:
 * 1. **ต้นทางหนึ่งล่ม อีกต้นทางไม่ล่มตาม** และพายุของต้นทางที่ล่มยังอยู่พร้อม fetchedAt เก่า
 * 2. **schema เปลี่ยน** = error ที่มีชื่อ + คงสำเนาเดิม ไม่ใช่ "ไม่มีพายุ"
 * 3. **ไม่มีพายุ (ต้นทางตอบว่าง) ≠ ยังไม่เคยดึง** — ตัวแรกมี lastSuccessAt ตัวหลังเป็น null
 * 4. ต้นทุน: แถว `latest` แถวเดียว, GET ไม่ยิงต้นทาง, ensureFresh ไม่ยิงซ้ำภายใน RETRY_MS,
 *    GDACS ยิง getgeometry เฉพาะเหตุการณ์ NIO (SURIGAE-26 ของ GDACS ต้องไม่ถูกถาม)
 */
const appEnv = env as unknown as AppEnv;
const RETRY_MS = 5 * 60 * 1000;
const REFRESH_MS = 30 * 60 * 1000;

const call = (path: string) => workerExports.default.fetch(new Request(`https://siahra-radar.co${path}`));
const runCron = () => (workerExports.default as unknown as { scheduled(): Promise<void> }).scheduled();

type Mode = "ok" | "fail" | "drift" | "empty" | "hang";

interface Serve {
  jma?: Mode;
  gdacs?: Mode;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** ต้นทางปลอมตาม host — host อื่น (thaiwater, TMD, …) throw เพื่อให้เห็นว่าไม่มีใครแอบยิง */
function serve({ jma = "ok", gdacs = "ok" }: Serve = {}): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host === "www.jma.go.jp") {
      if (jma === "fail") return new Response("boom", { status: 502 });
      if (url.pathname.endsWith("/targetTc.json")) {
        if (jma === "drift") return json([{ tropicalCyclone: 2632, issue: "x" }]);
        return json(jma === "empty" ? jmaTargetsEmpty : jmaTargets);
      }
      if (url.pathname.endsWith("/TC2632/specifications.json")) return json(jmaSpecs);
      if (url.pathname.endsWith("/TC2632/forecast.json")) return json(jmaForecast);
      throw new Error(`unexpected JMA path ${url.pathname}`);
    }
    if (url.host === "www.gdacs.org") {
      if (gdacs === "fail") return new Response("boom", { status: 503 });
      if (url.pathname.includes("/events/geteventlist/")) return json(gdacs === "empty" ? gdacsListEmpty : gdacsList);
      if (url.pathname.endsWith("/polygons/getgeometry")) {
        if (url.searchParams.get("eventid") === "1001326") return json(gdacsGeometry);
        throw new Error(`getgeometry asked for non-NIO event ${url.searchParams.get("eventid")}`);
      }
      throw new Error(`unexpected GDACS path ${url.pathname}`);
    }
    throw new Error(`unexpected upstream call to ${url.host}`);
  });
}

function stormCalls(host?: string): string[] {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.map(([input]) => String(input instanceof Request ? input.url : input))
    .filter((u) => (host ? new URL(u).host === host : /www\.(jma\.go\.jp|gdacs\.org)/.test(u)));
}

const stub = (name: string) => appEnv.STORM_TRACK.getByName(name);
const storms = (name: string): Promise<StormsResponse> => runInDurableObject(stub(name), (i) => i.getStorms());
const statuses = (name: string): Promise<SourceStatus[]> => runInDurableObject(stub(name), (i) => i.status());
const statusOf = async (name: string, id: string) => (await statuses(name)).find((s) => s.id === id)!;
const alarm = (name: string) => runInDurableObject(stub(name), (i) => i.alarm());
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => serve());

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const name of ["primary", "split", "drift", "empty", "all-fail", "gate", "tc-drift"]) {
    await runInDurableObject(stub(name), (_i, ctx) => ctx.storage.deleteAlarm());
  }
});

/** ต้องมาก่อนบล็อกที่อุ่น "primary" — state อยู่ยาวข้าม block ในไฟล์เดียวกัน */
describe("ยังไม่เคยดึงสำเร็จ", () => {
  it("GET /storms ตอบ 200, storms ว่าง, ทุกเวลาเป็น null, no-store และไม่ยิงต้นทาง", async () => {
    const res = await call("/api/v1/storms");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as StormsResponse;
    expect(body.storms).toEqual([]);
    for (const layer of Object.values(body.layers)) expect(layer.fetchedAt).toBeNull();
    expect(body.layers.track.forecast!.issuedAt).toBeNull();
    for (const s of body.sources) {
      expect(s.lastSuccessAt).toBeNull();
      expect(s.lastAttemptAt).toBeNull();
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("status() ของ DO เย็นให้สองแถว unknown พร้อม fetchedAt null และไม่ยิงต้นทาง", async () => {
    const rows = await statuses("primary");
    expect(rows.map((r) => r.id)).toEqual(["jma-typhoon", "gdacs-tc"]);
    for (const r of rows) {
      expect(r.health).toBe("unknown");
      expect(r.fetchedAt).toBeNull();
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("cron ขับรอบดึง แล้วเส้นทางอ่านผลออกมา", () => {
  it("scheduled() ถึง StormTrackDO: JMA 1+2 คำขอ, GDACS รายการ + getgeometry เฉพาะ NIO", async () => {
    await runCron();
    const jma = stormCalls("www.jma.go.jp");
    const gdacs = stormCalls("www.gdacs.org");
    expect(jma).toHaveLength(3);
    expect(gdacs).toHaveLength(2);
    expect(gdacs.some((u) => u.includes("alertlevel=green;orange;red"))).toBe(true);
    // SURIGAE-26 ของ GDACS (126.8°E) คือพายุลูกเดียวกับ JMA TC2632 — ห้ามถาม ห้ามแทน
    expect(gdacs.some((u) => u.includes("eventid=1001327"))).toBe(false);
    expect(jma.length + gdacs.length).toBeLessThanOrEqual(20);
  });

  it("GET /storms: พายุ JMA หนึ่งลูก + GDACS NIO หนึ่งลูก พร้อม descriptor สามชั้น", async () => {
    const res = await call("/api/v1/storms?t=warm");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
    const body = (await res.json()) as StormsResponse;
    expect(body.storms.map((s) => s.id).sort()).toEqual(["gdacs:1001326", "jma:TC2632"]);

    const jma = body.storms.find((s) => s.id === "jma:TC2632")!;
    expect(jma.source).toBe("jma-typhoon");
    expect(jma.basin).toBe("WNP");
    expect(jma.name).toBe("Surigae");
    expect(jma.category).toBe("STS");
    // เวลาออกประกาศของ JMA (`issue`) — ไม่ใช่ fetchedAt
    expect(jma.advisoryIssuedAt).toBe("2026-09-26T09:45:00.000Z");
    expect(jma.advisoryIssuedAt).not.toBe(jma.fetchedAt);
    expect(jma.windAveraging).toBe("10-min");
    const latest = jma.past[jma.past.length - 1]!;
    expect(latest).toEqual({ observedAt: "2026-09-26T09:00:00.000Z", lat: 23.2, lon: 126.9, windKt: 55, pressureHpa: 990 });
    // เส้นทางเดิมของ JMA ไม่มีเวลา — ห้ามประมาณเวลาย้อนหลังให้
    expect(jma.past[0]!.observedAt).toBeNull();
    expect(jma.forecast.map((f) => f.circleRadiusKm)).toEqual([65, 95, 155, 220, 320, 460]);
    expect(jma.forecast[0]).toMatchObject({ validAt: "2026-09-26T21:00:00.000Z", windKt: 60, pressureHpa: 985 });
    expect(Object.keys(jma.nearestKmByProvince)).toHaveLength(77);
    for (const code of PROVINCE_CODES) expect(typeof jma.nearestKmByProvince[code]).toBe("number");

    const nio = body.storms.find((s) => s.id === "gdacs:1001326")!;
    expect(nio.basin).toBe("NIO");
    expect(nio.name).toBe("ONE-26");
    // GDACS ไม่มีเวลาออกประกาศ — ห้ามเอา datemodified/polygondate มาสวม
    expect(nio.advisoryIssuedAt).toBeNull();
    expect(nio.forecast.every((f) => f.circleRadiusKm === null && f.windKt === null)).toBe(true);
    expect(nio.gdacsCone?.type).toBe("Polygon");
    expect(nio.gdacs?.alertLevel).toBe("Orange");

    expect(body.layers.track.epistemicClass).toBe("forecast");
    expect(body.layers.circle.epistemicClass).toBe("probabilistic");
    expect(body.layers.circle.sourceIds).toEqual(["jma-typhoon"]);
    expect(body.layers.past.epistemicClass).toBe("observed");
    // พายุสองลูกมีเวลาออกประกาศไม่เท่ากัน (ลูกหนึ่งไม่มีเลย) → ไม่มีเวลาร่วมให้ประกาศ
    expect(body.layers.track.forecast!.issuedAt).toBeNull();
    expect(body.layers.track.forecast!.horizonHours).toBe(117);
    for (const s of body.sources) {
      expect(s.lastSuccessAt).not.toBeNull();
      expect(s.lastError).toBeNull();
    }
    // ไม่มีการยิงต้นทางระหว่างตอบคำขอ
    expect(stormCalls()).toHaveLength(0);
  });

  it("เก็บแถว latest แถวเดียว (ไม่ใช่ต่อพายุ/ต่อต้นทาง)", async () => {
    const rows = await runInDurableObject(stub("primary"), (_i, state) =>
      state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM latest").toArray()[0]?.n ?? 0,
    );
    expect(rows).toBe(1);
  });

  it("/api/v1/health รายงานทั้งสองต้นทางเป็น ok พร้อมจำนวนพายุ", async () => {
    const res = await call("/api/v1/health?t=storm-warm");
    const body = (await res.json()) as { sources: SourceStatus[] };
    const jma = body.sources.find((s) => s.id === "jma-typhoon")!;
    const gdacs = body.sources.find((s) => s.id === "gdacs-tc")!;
    expect(jma.health).toBe("ok");
    expect(gdacs.health).toBe("ok");
    expect(jma.detail.storms).toBe(1);
    expect(gdacs.detail.storms).toBe(1);
    expect(jma.latestObservedAt).toBe("2026-09-26T09:00:00.000Z");
    expect(jma.nextAttemptAt).not.toBeNull();
  });
});

describe("ความล้มเหลวต้องมองเห็น และไม่ลามข้ามต้นทาง", () => {
  it("GDACS ล่ม JMA ปกติ: พายุ GDACS เดิมอยู่ต่อพร้อม fetchedAt เก่า, JMA อัปเดต", async () => {
    const name = "split";
    await alarm(name);
    const first = await storms(name);
    const firstGdacs = first.storms.find((s) => s.source === "gdacs-tc")!;
    await tick();

    vi.restoreAllMocks();
    serve({ gdacs: "fail" });
    await alarm(name);
    const second = await storms(name);
    const gdacs = second.storms.find((s) => s.source === "gdacs-tc")!;
    const jma = second.storms.find((s) => s.source === "jma-typhoon")!;
    expect(gdacs.fetchedAt).toBe(firstGdacs.fetchedAt);
    expect(Date.parse(jma.fetchedAt)).toBeGreaterThan(Date.parse(firstGdacs.fetchedAt));

    const gState = second.sources.find((s) => s.id === "gdacs-tc")!;
    expect(gState.lastSuccessAt).toBe(firstGdacs.fetchedAt);
    expect(gState.lastError).toContain("gdacs-tc HTTP 503");
    expect(second.sources.find((s) => s.id === "jma-typhoon")!.lastError).toBeNull();
    // ชั้นสองต้นทางประกาศเวลาที่เก่ากว่า — ไม่อ้างความสดเกินจริง
    expect(second.layers.track.fetchedAt).toBe(firstGdacs.fetchedAt);
    expect(second.layers.circle.fetchedAt).toBe(jma.fetchedAt);

    expect((await statusOf(name, "jma-typhoon")).health).toBe("ok");
    expect((await statusOf(name, "gdacs-tc")).health).toBe("degraded");
  });

  it("JMA เปลี่ยน schema: error มีชื่อ + path, พายุ JMA เดิมอยู่ต่อ, /health ไม่ ok", async () => {
    const name = "drift";
    await alarm(name);
    const before = (await storms(name)).storms.find((s) => s.source === "jma-typhoon")!;
    await tick();

    vi.restoreAllMocks();
    serve({ jma: "drift" });
    await alarm(name);
    const after = await storms(name);
    const kept = after.storms.find((s) => s.source === "jma-typhoon")!;
    expect(kept.fetchedAt).toBe(before.fetchedAt);
    const st = await statusOf(name, "jma-typhoon");
    expect(st.lastError).toContain("jma-typhoon targetTc shape: 0.tropicalCyclone");
    expect(st.health).toBe("degraded");
    expect(st.fetchedAt).toBe(before.fetchedAt);
    expect((await statusOf(name, "gdacs-tc")).health).toBe("ok");
  });

  it("JMA ส่ง specifications ผิดรูปของพายุหนึ่งลูก: รายการสำเร็จ แต่ลูกนั้นรายงานใน lastError", async () => {
    const name = "tc-drift";
    vi.restoreAllMocks();
    serve();
    const base = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) =>
      String(input).endsWith("/TC2632/specifications.json") ? json([{ part: "title" }]) : base(input, init),
    );
    await alarm(name);
    const st = await statusOf(name, "jma-typhoon");
    expect(st.lastError).toContain("TC2632: jma-typhoon specifications shape");
    // รายการถามสำเร็จ แต่ไม่มีสำเนาเดิมของลูกนั้น → ไม่มีพายุ JMA ให้แสดง (และบอกเหตุผลไว้)
    expect(st.fetchedAt).not.toBeNull();
    expect(st.health).toBe("degraded");
    expect((await storms(name)).storms.some((s) => s.source === "jma-typhoon")).toBe(false);
  });

  it("ไม่มีพายุทั้งสองแอ่ง: storms ว่าง แต่ lastSuccessAt มีค่า (≠ ยังไม่เคยดึง)", async () => {
    const name = "empty";
    vi.restoreAllMocks();
    serve({ jma: "empty", gdacs: "empty" });
    await alarm(name);
    const body = await storms(name);
    expect(body.storms).toEqual([]);
    for (const s of body.sources) {
      expect(s.lastSuccessAt).not.toBeNull();
      expect(s.lastError).toBeNull();
    }
    expect(body.layers.track.fetchedAt).not.toBeNull();
    expect(body.layers.track.forecast!.horizonHours).toBe(0);
    for (const st of await statuses(name)) {
      expect(st.health).toBe("ok");
      expect(st.detail.storms).toBe(0);
    }
    // ต้นทาง JMA ตอบว่าง = ไม่มีพายุ → ไม่ยิง specifications/forecast
    expect(stormCalls("www.jma.go.jp")).toHaveLength(1);
  });

  it("ทั้งสองต้นทางล่ม: re-arm ใน RETRY_MS และ /health เป็น down (ไม่ใช่ 'ไม่มีพายุ')", async () => {
    const name = "all-fail";
    vi.restoreAllMocks();
    serve({ jma: "fail", gdacs: "fail" });
    const before = Date.now();
    await alarm(name);
    const next = await runInDurableObject(stub(name), (_i, ctx) => ctx.storage.getAlarm());
    expect(next! - before).toBeGreaterThanOrEqual(RETRY_MS - 1000);
    expect(next! - before).toBeLessThan(REFRESH_MS);
    for (const st of await statuses(name)) {
      expect(st.health).toBe("down");
      expect(st.fetchedAt).toBeNull();
      expect(st.lastAttemptAt).not.toBeNull();
    }
    const body = await storms(name);
    expect(body.storms).toEqual([]);
    for (const s of body.sources) expect(s.lastSuccessAt).toBeNull();
  });

  it("รอบสำเร็จ re-arm ที่ REFRESH_MS (30 นาที)", async () => {
    const before = Date.now();
    await runInDurableObject(stub("split"), (_i, ctx) => ctx.storage.deleteAlarm());
    await alarm("split");
    const next = await runInDurableObject(stub("split"), (_i, ctx) => ctx.storage.getAlarm());
    expect(next! - before).toBeGreaterThanOrEqual(REFRESH_MS - 1000);
  });

  it("ensureFresh() หลังรอบที่พังภายใน RETRY_MS ไม่ยิงต้นทางซ้ำ (cron ทุกนาทีไม่ถล่มต้นทาง)", async () => {
    const name = "gate";
    vi.restoreAllMocks();
    serve({ jma: "fail", gdacs: "fail" });
    await runInDurableObject(stub(name), (i) => i.ensureFresh());
    const first = stormCalls().length;
    expect(first).toBeGreaterThan(0);
    await runInDurableObject(stub(name), (i) => i.ensureFresh());
    await runInDurableObject(stub(name), (i) => i.ensureFresh());
    expect(stormCalls().length).toBe(first);
  });
});
