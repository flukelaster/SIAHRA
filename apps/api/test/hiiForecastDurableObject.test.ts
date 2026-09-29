import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { env, exports as workerExports } from "cloudflare:workers";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RiverForecastResponse, SourceStatus } from "@siahra/shared-types";
import type { AppEnv } from "../src/types";
import { handleRiverForecast } from "../src/routes/riverForecast";
import c2 from "./fixtures/hii/forecast-C2.txt?raw";
import c13 from "./fixtures/hii/forecast-C13.txt?raw";
import cpy014 from "./fixtures/hii/forecast-CPY014.txt?raw";
import ridMeta from "./fixtures/hii/rid_discharge.csv?raw";
import wlMeta from "./fixtures/hii/hii_waterlevel.csv?raw";

/**
 * HiiForecastDO ครบวง: cron → DO → เส้นทาง HTTP / status() — ไฟล์จริงของ 2026-09-29
 * (fixtures/hii/README.md; C3 / C7A / C35 ใช้ตัวเลขของ C2 ติดป้ายรหัสของตัวเอง เพราะเทสไม่ได้ตรวจค่า
 * ของสถานีเหล่านั้นแยก)
 *
 * สิ่งที่ไฟล์นี้ตรึงไว้:
 * 1. ต้นทุน: แถว `latest` แถวเดียว, GET/status ไม่ยิงต้นทาง, หนึ่งรอบ = 6 ไฟล์ + metadata 2 ไฟล์ (ครั้งแรก)
 * 2. **304 หรือ body เดิม = ยืนยันสำเร็จ** (fetchedAt / lastSuccessAt ขยับ) ชุดค่าและ publishedAt เดิมอยู่ครบ
 * 3. **ไฟล์พัง/HTML/5xx ไม่ล้างชุดเดิม** — fetchedAt เก่าของสถานีนั้นอยู่ต่อ, lastError บอกเหตุ, /health ไม่ ok
 * 4. metadata ล้มเหลวไม่ทำให้รอบพยากรณ์ล้ม และไม่ถี่กว่ารอบ
 * 5. `ensureFresh()` ของ cron ไม่แย่งรอบกับ alarm (นัดในอนาคต + ลองล่าสุด < 60 นาที = ไม่ยิง)
 */
const appEnv = env as unknown as AppEnv;
const RETRY_MS = 5 * 60 * 1000;
const REFRESH_MS = 60 * 60 * 1000;
const LM = "Tue, 29 Sep 2026 03:05:01 GMT";
const HOST = "fews2.hii.or.th";

const call = (path: string) => workerExports.default.fetch(new Request(`https://siahra-radar.co${path}`));
const runCron = () => (workerExports.default as unknown as { scheduled(): Promise<void> }).scheduled();

type Mode = "ok" | "fail" | "html" | "ignore-conditional" | "changed";

interface Serve {
  /** ต่อรหัส HII (C2, C13, …) */
  forecast?: Partial<Record<string, Mode>>;
  all?: Mode;
  metadata?: Mode;
  lastModified?: string;
}

function forecastBody(code: string): string {
  if (code === "C2") return c2;
  if (code === "C13") return c13;
  if (code === "CPY014") return cpy014;
  return c2.replace(/^C2,/gm, `${code},`);
}

/** ต้นทางปลอมตาม host — host อื่นให้ throw เพื่อให้เห็นว่าไม่มีใครแอบยิง */
function serve({ forecast = {}, all = "ok", metadata = "ok", lastModified = LM }: Serve = {}): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host !== HOST) throw new Error(`unexpected upstream call to ${url.host}`);
    const headers = new Headers(init?.headers);
    const fm = /\/forecast\/(\w+)\.txt$/.exec(url.pathname);
    const mm = /\/metadata\/(\w+)\.csv$/.exec(url.pathname);
    let name: string;
    let text: string;
    let mode: Mode;
    if (fm) {
      name = fm[1]!;
      mode = forecast[name] ?? all;
      text = forecastBody(name);
      if (mode === "changed") {
        // ไฟล์ที่หน้าต่างเลื่อนไปแล้ว: หัว + 40 แถวสุดท้าย
        const lines = text.split(/\r?\n/).filter((l) => l !== "");
        text = [lines[0], ...lines.slice(-40)].join("\r\n");
      }
    } else if (mm) {
      name = mm[1]!;
      mode = metadata;
      text = name === "rid_discharge" ? ridMeta : wlMeta;
    } else {
      throw new Error(`unexpected HII path ${url.pathname}`);
    }
    if (mode === "fail") return new Response("boom", { status: 503 });
    if (mode === "html") return new Response("<html><body>maintenance</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    const etag = `"etag-${name}-${mode === "changed" ? "v2" : "v1"}"`;
    if (mode !== "ignore-conditional" && headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { etag } });
    }
    return new Response(text, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", etag, "last-modified": mode === "changed" ? "Tue, 29 Sep 2026 09:05:01 GMT" : lastModified },
    });
  });
}

interface Call {
  path: string;
  headers: Headers;
}
function hiiCalls(): Call[] {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.map(([input, init]) => ({
      url: new URL(input instanceof Request ? input.url : String(input)),
      headers: new Headers(init?.headers),
    }))
    .filter((c) => c.url.host === HOST)
    .map((c) => ({ path: c.url.pathname.replace("/model-output/data_portal", ""), headers: c.headers }));
}
const forecastCalls = () => hiiCalls().filter((c) => c.path.includes("/forecast/"));
const metadataCalls = () => hiiCalls().filter((c) => c.path.includes("/metadata/"));

const stub = (name: string) => appEnv.HII_FORECAST.getByName(name);
const forecast = (name: string): Promise<RiverForecastResponse> => runInDurableObject(stub(name), (i) => i.getForecast());
const status = (name: string): Promise<SourceStatus> => runInDurableObject(stub(name), (i) => i.status());
const alarm = (name: string) => runInDurableObject(stub(name), (i) => i.alarm());
const ensureFresh = (name: string) => runInDurableObject(stub(name), (i) => i.ensureFresh());
const alarmAt = (name: string) => runInDurableObject(stub(name), (_i, ctx) => ctx.storage.getAlarm());
const tick = () => new Promise((r) => setTimeout(r, 5));
const station = (b: RiverForecastResponse, hiiCode: string) => b.stations.find((s) => s.hiiCode === hiiCode)!;

function setMeta(name: string, key: string, mutate: (raw: string | null) => string | null): Promise<void> {
  return runInDurableObject(stub(name), (_i, ctx) => {
    const sql = ctx.storage.sql;
    const cur = sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value ?? null;
    const next = mutate(cur);
    if (next === null) sql.exec("DELETE FROM meta WHERE key = ?", key);
    else sql.exec("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, next);
  });
}

beforeEach(() => serve());

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const name of ["primary", "cond", "same", "changed", "partial", "html", "outage", "meta", "gate", "lost", "shape"]) {
    await runInDurableObject(stub(name), (_i, ctx) => ctx.storage.deleteAlarm());
  }
});

/** ต้องมาก่อนบล็อกที่อุ่น "primary" — state อยู่ยาวข้าม block ในไฟล์เดียวกัน */
describe("ยังไม่เคยดึงสำเร็จ", () => {
  it("GET /rivers/forecast ตอบ 200 no-store: หกสถานี ชุดค่าว่าง ทุกเวลาเป็น null และไม่ยิงต้นทาง", async () => {
    const res = await call("/api/v1/rivers/forecast");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as RiverForecastResponse;
    expect(body.stations.map((s) => s.code)).toEqual(["C.2", "C.13", "C.3", "C.7A", "C.35", "CPY014"]);
    for (const s of body.stations) {
      expect(s.series).toEqual([]);
      expect(s.publishedAt).toBeNull();
      expect(s.fetchedAt).toBeNull();
      expect(s.thresholds).toBeNull();
    }
    expect(body.layer.epistemicClass).toBe("forecast");
    expect(body.layer.fetchedAt).toBeNull();
    expect(body.layer.publishedAt).toBeNull();
    expect(body.layer.forecast).toMatchObject({ issuedAt: null, horizonHours: null, resolutionKm: null });
    expect(body.source).toEqual({ id: "hii-fews", lastSuccessAt: null, lastAttemptAt: null, lastError: null });
    expect(hiiCalls()).toHaveLength(0);
  });

  it("query string ใด ๆ = 400 (ไม่ถึงแคชหรือ DO)", async () => {
    const res = await call("/api/v1/rivers/forecast?t=1");
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("status() ของ DO เย็น: unknown, fetchedAt null, ไม่ยิงต้นทาง", async () => {
    const st = await status("primary");
    expect(st.id).toBe("hii-fews");
    expect(st.health).toBe("unknown");
    expect(st.fetchedAt).toBeNull();
    expect(st.latestObservedAt).toBeNull();
    expect(st.observedLagSeconds).toBeNull();
    expect(st.staleAfterSeconds).toBe(10_800);
    expect(hiiCalls()).toHaveLength(0);
  });
});

describe("cron ขับรอบดึง แล้วเส้นทางอ่านผลออกมา", () => {
  it("scheduled() ถึง HiiForecastDO: 6 ไฟล์พยากรณ์ + 2 metadata ครั้งแรก, ทุกคำขอไม่มี validator, มี User-Agent", async () => {
    await runCron();
    expect(forecastCalls()).toHaveLength(6);
    expect(metadataCalls()).toHaveLength(2);
    for (const c of hiiCalls()) {
      expect(c.headers.has("if-none-match")).toBe(false);
      expect(c.headers.has("if-modified-since")).toBe(false);
      expect(c.headers.get("user-agent")).toContain("siahra-api");
    }
    expect(forecastCalls().map((c) => c.path).sort()).toEqual([
      "/hii_waterlevel/forecast/CPY014.txt",
      "/rid_discharge/forecast/C13.txt",
      "/rid_discharge/forecast/C2.txt",
      "/rid_discharge/forecast/C3.txt",
      "/rid_discharge/forecast/C35.txt",
      "/rid_discharge/forecast/C7A.txt",
    ]);
  });

  it("GET /rivers/forecast: ชุดที่แปลงแล้ว เวลาไทย→UTC เกณฑ์ตามที่เผยแพร่ descriptor แบบ forecast", async () => {
    const res = await call("/api/v1/rivers/forecast");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
    const body = (await res.json()) as RiverForecastResponse;

    const s2 = station(body, "C2");
    expect(s2).toMatchObject({
      code: "C.2",
      kind: "discharge",
      unit: "m3/s",
      nameTh: "ค่ายจิรประวัติ",
      province: "จ.นครสวรรค์",
      thresholds: { alarm: 2988, warning: 3362, critical: 3735 },
      publishedAt: "2026-09-29T03:05:01.000Z",
      lastError: null,
    });
    expect(s2.series).toHaveLength(337);
    expect(s2.series[0]).toEqual([Date.parse("2026-09-22T06:00:00+07:00"), 1684]);
    expect(s2.series.at(-1)).toEqual([Date.parse("2026-10-06T06:00:00+07:00"), 2228.17]);
    expect(s2.fetchedAt).not.toBeNull();

    const w = station(body, "CPY014");
    expect(w).toMatchObject({ code: "CPY014", kind: "waterlevel", unit: "m", province: "จ.นนทบุรี" });
    expect(w.thresholds).toEqual({ alarm: -0.82, warning: 0.74, critical: 2.3 });
    expect(station(body, "C35").thresholds).toEqual({ alarm: 927.2, warning: 1043.1, critical: 1159 });

    expect(body.layer).toMatchObject({
      id: "river-forecast-hii-fews",
      epistemicClass: "forecast",
      liveOrStatic: "live",
      sourceIds: ["hii-fews"],
      publishedAt: "2026-09-29T03:05:01.000Z",
      staleAfterSeconds: 10_800,
    });
    // ไม่มีรอบรันจากต้นทาง → issuedAt ต้องเป็น null ไม่ใช่ fetchedAt/publishedAt
    expect(body.layer.forecast).toEqual({
      modelName: "HII FEWS model output (model not named by the publisher)",
      resolutionKm: null,
      // จุดสุดท้าย 2026-10-06 06:00 +07 = 10-05 23:00Z ลบ Last-Modified 09-29 03:05:01Z = 163.92 ชม.
      horizonHours: 164,
      issuedAt: null,
    });
    expect(body.layer.fetchedAt).toBe(body.source.lastSuccessAt);
    expect(body.layer.fetchedAt).not.toBeNull();
    expect(body.layer.publishedAt).not.toBe(body.layer.fetchedAt);
    expect(body.source.lastError).toBeNull();
    expect(body.thresholdsFetchedAt).not.toBeNull();
    expect(body.thresholdsLastError).toBeNull();
    // ไม่มี NaN/null หลุดเข้าชุด
    for (const s of body.stations) for (const p of s.series) expect(p.every((n) => typeof n === "number" && Number.isFinite(n))).toBe(true);
    // ไม่มีการยิงต้นทางระหว่างตอบคำขอ
    expect(hiiCalls()).toHaveLength(0);
  });

  it("เก็บแถว latest แถวเดียว (ไม่ใช่ต่อสถานี/ต่อไฟล์)", async () => {
    const rows = await runInDurableObject(stub("primary"), (_i, state) =>
      state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM latest").toArray()[0]?.n ?? 0,
    );
    expect(rows).toBe(1);
  });

  it("/api/v1/health รายงาน hii-fews เป็น ok พร้อมนัดถัดไปจาก alarm จริง", async () => {
    const res = await call("/api/v1/health?t=hii-warm");
    const body = (await res.json()) as { sources: SourceStatus[] };
    const s = body.sources.filter((x) => x.id === "hii-fews");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      health: "ok",
      latestObservedAt: null,
      observedLagSeconds: null,
      staleAfterSeconds: 10_800,
      lastError: null,
      detail: { stations: 6, stationsOk: 6, oldestPublishedAt: "2026-09-29T03:05:01.000Z" },
    });
    expect(s[0]!.fetchedAt).not.toBeNull();
    expect(s[0]!.nextAttemptAt).not.toBeNull();
    expect(s[0]!.labelTh.length).toBeGreaterThan(0);
  });

  it("ตัว alarm ที่ cron ตั้งไว้ห่างราว 1 ชั่วโมง", async () => {
    const at = await alarmAt("primary");
    expect(at! - Date.now()).toBeGreaterThan(REFRESH_MS - 60_000);
    expect(at! - Date.now()).toBeLessThanOrEqual(REFRESH_MS);
  });
});

describe("ถามซ้ำแบบมีเงื่อนไข: 304 / body เดิม = ยืนยันสำเร็จ", () => {
  it("รอบสอง: แนบ ETag + If-Modified-Since ทุกไฟล์, 304 ทั้งหมด → ชุดและ publishedAt เดิม แต่ fetchedAt ขยับ, ไม่ยิง metadata", async () => {
    await alarm("cond");
    const first = await forecast("cond");
    const st1 = await status("cond");
    vi.mocked(globalThis.fetch).mockClear();
    await tick();

    await alarm("cond");
    const calls = forecastCalls();
    expect(calls).toHaveLength(6);
    for (const c of calls) {
      expect(c.headers.get("if-none-match")).toMatch(/^"etag-\w+-v1"$/);
      expect(c.headers.get("if-modified-since")).toBe(LM);
    }
    // metadata ยังไม่ครบ 24 ชม. → ไม่ยิง
    expect(metadataCalls()).toHaveLength(0);

    const second = await forecast("cond");
    for (const code of ["C2", "C13", "C3", "C7A", "C35", "CPY014"]) {
      const a = station(first, code);
      const b = station(second, code);
      expect(b.series).toEqual(a.series);
      expect(b.publishedAt).toBe(a.publishedAt);
      expect(b.publishedAt).toBe("2026-09-29T03:05:01.000Z");
      expect(Date.parse(b.fetchedAt!)).toBeGreaterThan(Date.parse(a.fetchedAt!));
      expect(b.thresholds).toEqual(a.thresholds);
      expect(b.lastError).toBeNull();
    }
    expect(Date.parse(second.source.lastSuccessAt!)).toBeGreaterThan(Date.parse(first.source.lastSuccessAt!));
    expect(second.layer.fetchedAt).toBe(second.source.lastSuccessAt);
    expect(second.layer.publishedAt).toBe(first.layer.publishedAt);
    // เกณฑ์/ชื่อไม่ถูกล้างเมื่อไม่ได้ถาม metadata
    expect(second.thresholdsFetchedAt).toBe(first.thresholdsFetchedAt);
    const st2 = await status("cond");
    expect(st2.health).toBe("ok");
    expect(Date.parse(st2.fetchedAt!)).toBeGreaterThan(Date.parse(st1.fetchedAt!));
  });

  it("ต้นทางไม่รองรับ validator (200 ทุกครั้ง เนื้อเหมือนเดิม): ยังนับว่ายืนยันสำเร็จ และเขียนแถวเดียว", async () => {
    vi.restoreAllMocks();
    serve({ all: "ignore-conditional" });
    await alarm("same");
    const first = await forecast("same");
    await tick();
    await alarm("same");
    const second = await forecast("same");
    expect(station(second, "C2").series).toEqual(station(first, "C2").series);
    expect(Date.parse(station(second, "C2").fetchedAt!)).toBeGreaterThan(Date.parse(station(first, "C2").fetchedAt!));
    expect(Date.parse(second.source.lastSuccessAt!)).toBeGreaterThan(Date.parse(first.source.lastSuccessAt!));
    expect(second.source.lastError).toBeNull();
    const rows = await runInDurableObject(stub("same"), (_i, s) => s.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM latest").toArray()[0]!.n);
    expect(rows).toBe(1);
  });

  it("200 ที่เนื้อเปลี่ยน: ชุดใหม่ + Last-Modified ใหม่ + horizon คิดใหม่จากไฟล์ที่ถืออยู่", async () => {
    await alarm("changed");
    const first = await forecast("changed");
    vi.restoreAllMocks();
    serve({ forecast: { C2: "changed" } });
    await tick();
    await alarm("changed");
    const second = await forecast("changed");
    const s = station(second, "C2");
    expect(s.series).toHaveLength(40);
    expect(s.publishedAt).toBe("2026-09-29T09:05:01.000Z");
    // ไฟล์อื่นไม่เปลี่ยน (304) → publishedAt ที่เก่าที่สุดของทั้งชั้นยังเป็นของเดิม
    expect(second.layer.publishedAt).toBe("2026-09-29T03:05:01.000Z");
    expect(station(second, "C13").publishedAt).toBe(station(first, "C13").publishedAt);
    // C2 ใหม่: 10-05 23:00Z − 09:05:01Z = 157.9 → 158; ไฟล์อื่น 164 → ค่าน้อยสุด
    expect(second.layer.forecast!.horizonHours).toBe(158);
  });
});

describe("ความล้มเหลวต้องมองเห็น และไม่ล้างชุดเดิม", () => {
  it("ไฟล์เดียว 503: ชุดของสถานีนั้นอยู่ครบพร้อม fetchedAt เก่า, สถานีอื่นอัปเดต, lastError บอกเหตุ, health degraded", async () => {
    await alarm("partial");
    const first = await forecast("partial");
    await tick();
    vi.restoreAllMocks();
    serve({ forecast: { C2: "fail" } });
    await alarm("partial");
    const second = await forecast("partial");
    const kept = station(second, "C2");
    expect(kept.series).toEqual(station(first, "C2").series);
    expect(kept.series).toHaveLength(337);
    expect(kept.fetchedAt).toBe(station(first, "C2").fetchedAt);
    expect(kept.publishedAt).toBe(station(first, "C2").publishedAt);
    expect(kept.lastError).toContain("hii-fews HTTP 503 for /rid_discharge/forecast/C2.txt");
    expect(Date.parse(station(second, "C13").fetchedAt!)).toBeGreaterThan(Date.parse(station(first, "C13").fetchedAt!));
    expect(station(second, "C13").lastError).toBeNull();
    // รอบนี้ยังสำเร็จบางไฟล์ → lastSuccessAt ขยับ แต่ source.lastError ไม่ว่าง
    expect(Date.parse(second.source.lastSuccessAt!)).toBeGreaterThan(Date.parse(first.source.lastSuccessAt!));
    expect(second.source.lastError).toContain("C2");
    const st = await status("partial");
    expect(st.health).toBe("degraded");
    expect(st.lastError).toContain("HTTP 503");
    expect(st.detail.stationsOk).toBe(5);
    // ผ่านไปแล้ว: รอบที่ไม่ได้พังทั้งรอบ ไม่ถอยหลัง — กลับสู่คาบชั่วโมง
    const at = await alarmAt("partial");
    expect(at! - Date.now()).toBeGreaterThan(REFRESH_MS - 60_000);
  });

  it("ไฟล์ตอบ 200 เป็น HTML: UpstreamShapeError ชื่อไฟล์, ชุดเดิมอยู่, validator เดิมไม่ถูกทับ (รอบหน้ายังถามด้วยตัวเดิม)", async () => {
    await alarm("html");
    const first = await forecast("html");
    vi.restoreAllMocks();
    serve({ forecast: { C13: "html" } });
    await tick();
    await alarm("html");
    const second = await forecast("html");
    const kept = station(second, "C13");
    expect(kept.series).toEqual(station(first, "C13").series);
    expect(kept.fetchedAt).toBe(station(first, "C13").fetchedAt);
    expect(kept.lastError).toContain("hii-fews shape:");
    vi.restoreAllMocks();
    serve();
    vi.mocked(globalThis.fetch).mockClear();
    await alarm("html");
    const c13Call = forecastCalls().find((c) => c.path.endsWith("/C13.txt"))!;
    expect(c13Call.headers.get("if-none-match")).toBe('"etag-C13-v1"');
    // ต้นทางกลับมา → lastError หาย
    expect(station(await forecast("html"), "C13").lastError).toBeNull();
  });

  it("body ที่ผ่านแต่มีแถวเสีย: ชุดอ่านได้ถูกใช้, lastError บอกจำนวนแถวที่ข้าม", async () => {
    vi.restoreAllMocks();
    const base = vi.spyOn(globalThis, "fetch");
    base.mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.includes("/metadata/")) return new Response(url.pathname.includes("rid") ? ridMeta : wlMeta);
      const code = /\/(\w+)\.txt$/.exec(url.pathname)![1]!;
      const text = forecastBody(code);
      return new Response(code === "C2" ? `${text}C2,2026-10-06,07:00:00,oops\r\n` : text, {
        headers: { "last-modified": LM },
      });
    });
    await alarm("shape");
    const b = await forecast("shape");
    expect(station(b, "C2").series).toHaveLength(337);
    expect(station(b, "C2").lastError).toContain("1 unreadable row(s) skipped");
    expect((await status("shape")).health).toBe("degraded");
  });

  it("ทั้งรอบพัง: ไม่เคยสำเร็จ → down, lastSuccessAt null, re-arm 5 นาทีแล้วถอยหลัง 10 นาที (ไม่เกินรอบปกติ)", async () => {
    vi.restoreAllMocks();
    serve({ all: "fail" });
    let before = Date.now();
    await alarm("outage");
    let next = await alarmAt("outage");
    expect(next! - before).toBeGreaterThanOrEqual(RETRY_MS - 1000);
    expect(next! - before).toBeLessThan(RETRY_MS + 5000);
    const body = await forecast("outage");
    expect(body.source.lastSuccessAt).toBeNull();
    expect(body.layer.fetchedAt).toBeNull();
    expect(body.source.lastError).toContain("HTTP 503");
    for (const s of body.stations) {
      expect(s.series).toEqual([]);
      expect(s.fetchedAt).toBeNull();
    }
    const st = await status("outage");
    expect(st.health).toBe("down");
    expect(st.fetchedAt).toBeNull();
    expect(st.lastAttemptAt).not.toBeNull();
    // ต้นทางล่มทั้งรอบ = ไม่ถาม metadata เพิ่ม
    expect(metadataCalls()).toHaveLength(0);

    before = Date.now();
    await alarm("outage");
    next = await alarmAt("outage");
    expect(next! - before).toBeGreaterThanOrEqual(2 * RETRY_MS - 1000);
    expect(next! - before).toBeLessThan(2 * RETRY_MS + 5000);
  });

  it("ทั้งรอบพังหลังเคยสำเร็จ: ชุดเดิมอยู่ครบ fetchedAt เดิม, สถานะ degraded (ยังไม่เกินงบเวลา) และ lastSuccessAt ไม่ขยับ", async () => {
    await alarm("outage-warm");
    const first = await forecast("outage-warm");
    vi.restoreAllMocks();
    serve({ all: "fail" });
    await tick();
    await alarm("outage-warm");
    const second = await forecast("outage-warm");
    expect(second.source.lastSuccessAt).toBe(first.source.lastSuccessAt);
    expect(second.layer.fetchedAt).toBe(first.layer.fetchedAt);
    for (const s of second.stations) {
      expect(s.series).toEqual(station(first, s.hiiCode).series);
      expect(s.fetchedAt).toBe(station(first, s.hiiCode).fetchedAt);
      expect(s.lastError).toContain("HTTP 503");
    }
    expect((await status("outage-warm")).health).toBe("degraded");
    await runInDurableObject(stub("outage-warm"), (_i, ctx) => ctx.storage.deleteAlarm());
  });
});

describe("metadata (เกณฑ์/ชื่อ/จังหวัด)", () => {
  it("ล้มเหลวไม่ทำให้รอบพยากรณ์ล้ม: ชุดค่าอัปเดต เกณฑ์เป็น null, บอกเหตุแยกที่ thresholdsLastError; รอบถัดไปลองใหม่แล้วได้เกณฑ์", async () => {
    vi.restoreAllMocks();
    serve({ metadata: "fail" });
    await alarm("meta");
    const a = await forecast("meta");
    expect(station(a, "C2").series).toHaveLength(337);
    expect(station(a, "C2").thresholds).toBeNull();
    expect(station(a, "C2").nameTh).toBeNull();
    expect(a.thresholdsFetchedAt).toBeNull();
    expect(a.thresholdsLastError).toContain("HTTP 503");
    expect(a.source.lastError).toBeNull();
    expect((await status("meta")).health).toBe("ok");
    expect(metadataCalls()).toHaveLength(2);

    vi.restoreAllMocks();
    serve();
    await tick();
    await alarm("meta");
    expect(metadataCalls()).toHaveLength(2);
    const b = await forecast("meta");
    expect(station(b, "C2").thresholds).toEqual({ alarm: 2988, warning: 3362, critical: 3735 });
    expect(b.thresholdsLastError).toBeNull();
    expect(b.thresholdsFetchedAt).not.toBeNull();
  });

  it("ยืนยันแล้วไม่ถามอีกจนครบ 24 ชม.; ครบแล้วถามแบบมีเงื่อนไข (304) และเกณฑ์เดิมอยู่", async () => {
    vi.mocked(globalThis.fetch).mockClear();
    await alarm("meta");
    expect(metadataCalls()).toHaveLength(0);

    await setMeta("meta", "state", (raw) => {
      const st = JSON.parse(raw!) as { metadataFetchedAt: string };
      st.metadataFetchedAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
      return JSON.stringify(st);
    });
    await alarm("meta");
    const calls = metadataCalls();
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.headers.get("if-none-match")).toMatch(/^"etag-\w+-v1"$/);
    const b = await forecast("meta");
    expect(station(b, "C2").thresholds).toEqual({ alarm: 2988, warning: 3362, critical: 3735 });
    expect(Date.now() - Date.parse(b.thresholdsFetchedAt!)).toBeLessThan(60_000);
  });
});

describe("บอดี้ที่เก็บไว้หาย/อ่านไม่ออกขณะ validator ยังอยู่", () => {
  it("ไม่แนบ validator ให้ไฟล์ใดเลย (ไม่งั้น 304 แล้วไม่มีอะไรเก็บ) — ชุดค่า ชื่อ และเกณฑ์กลับมาครบ", async () => {
    await alarm("body-lost");
    await runInDurableObject(stub("body-lost"), (_i, ctx) => {
      ctx.storage.sql.exec("DELETE FROM latest WHERE id = ?", "all");
    });
    // ยืนยันว่า state (validator + metadataFetchedAt) ยังอยู่ — นี่คือสถานการณ์ที่ต้องการ
    await setMeta("body-lost", "state", (raw) => {
      const st = JSON.parse(raw!) as { metadataFetchedAt: string };
      st.metadataFetchedAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
      return JSON.stringify(st);
    });
    expect((await forecast("body-lost")).source.lastSuccessAt).toBeNull(); // แถว latest หายไป = เย็น
    vi.mocked(globalThis.fetch).mockClear();
    await alarm("body-lost");
    for (const c of hiiCalls()) {
      expect(c.headers.has("if-none-match"), c.path).toBe(false);
      expect(c.headers.has("if-modified-since"), c.path).toBe(false);
    }
    expect(forecastCalls()).toHaveLength(6);
    expect(metadataCalls()).toHaveLength(2);
    const b = await forecast("body-lost");
    expect(station(b, "C2").series).toHaveLength(337);
    expect(station(b, "C2").thresholds).toEqual({ alarm: 2988, warning: 3362, critical: 3735 });
    expect(station(b, "C2").nameTh).toBe("ค่ายจิรประวัติ");
    expect(station(b, "CPY014").thresholds).toEqual({ alarm: -0.82, warning: 0.74, critical: 2.3 });
    await runInDurableObject(stub("body-lost"), (_i, ctx) => ctx.storage.deleteAlarm());
  });
});

describe("ensureFresh() ของ cron ไม่แย่งรอบกับ alarm", () => {
  it("ไม่เคยลองเลย: เริ่มรอบเอง 1 รอบแล้วนัด alarm ราว 1 ชั่วโมง", async () => {
    const before = Date.now();
    await ensureFresh("gate");
    expect(forecastCalls()).toHaveLength(6);
    const next = await alarmAt("gate");
    expect(next! - before).toBeGreaterThan(REFRESH_MS - 60_000);
    expect(next! - before).toBeLessThanOrEqual(REFRESH_MS + 5_000);
  });

  it("มี alarm นัดในอนาคต + ลองล่าสุด < 60 นาที: ensureFresh() กี่ครั้งก็ไม่ยิงต้นทางและไม่ขยับนัด", async () => {
    vi.mocked(globalThis.fetch).mockClear();
    const armed = await alarmAt("gate");
    await ensureFresh("gate");
    await ensureFresh("gate");
    await ensureFresh("gate");
    expect(hiiCalls()).toHaveLength(0);
    expect(await alarmAt("gate")).toBe(armed);
  });

  it("alarm() เพิ่งรันแล้ว cron มาเรียก: ไม่ยิงซ้ำ (ไม่ทำแบบ StormTrackDO ที่ cron ชนะแล้ว alarm ยิงรอบสอง)", async () => {
    await alarm("gate");
    vi.mocked(globalThis.fetch).mockClear();
    await ensureFresh("gate");
    await ensureFresh("gate");
    expect(hiiCalls()).toHaveLength(0);
  });

  it("ไม่มีนัด แต่ลองล่าสุด 90 นาทีก่อน (< 2 ชั่วโมง): ไม่ยิงจาก cron แค่ตั้งนัดคืนใกล้ ๆ", async () => {
    await runInDurableObject(stub("gate"), (_i, ctx) => ctx.storage.deleteAlarm());
    await setMeta("gate", "lastAttemptAt", () => new Date(Date.now() - 90 * 60_000).toISOString());
    vi.mocked(globalThis.fetch).mockClear();
    await ensureFresh("gate");
    expect(hiiCalls()).toHaveLength(0);
    const next = await alarmAt("gate");
    expect(next).not.toBeNull();
    expect(next! - Date.now()).toBeLessThanOrEqual(6_000);
  });

  it("สายโซ่ alarm หาย (ลองล่าสุด 3 ชั่วโมงก่อน, ไม่มีนัด): ensureFresh() ยิงพอดี 1 รอบ แล้วนัดต่อ", async () => {
    await runInDurableObject(stub("lost"), (_i, ctx) => ctx.storage.deleteAlarm());
    await alarm("lost"); // ให้มีชุดเดิมและ validator
    await runInDurableObject(stub("lost"), (_i, ctx) => ctx.storage.deleteAlarm());
    await setMeta("lost", "lastAttemptAt", () => new Date(Date.now() - 3 * 3_600_000).toISOString());
    vi.mocked(globalThis.fetch).mockClear();
    await ensureFresh("lost");
    expect(forecastCalls()).toHaveLength(6);
    expect(metadataCalls()).toHaveLength(0);
    const next = await alarmAt("lost");
    expect(next! - Date.now()).toBeGreaterThan(REFRESH_MS - 60_000);
    // และรอบต่อไปของ cron ไม่ยิงซ้ำ
    vi.mocked(globalThis.fetch).mockClear();
    await ensureFresh("lost");
    expect(hiiCalls()).toHaveLength(0);
  });

  it("รอบสำเร็จ re-arm ที่ 1 ชั่วโมง (alarm ทับนัดที่ cron ตั้งไว้)", async () => {
    const before = Date.now();
    await alarm("cond");
    const next = await alarmAt("cond");
    expect(next! - before).toBeGreaterThanOrEqual(REFRESH_MS - 1000);
  });
});

describe("handleRiverForecast (ยูนิต): ห้ามแคช 'ยังไม่เคยดึง' และ 503 ตอน DO ล้ม", () => {
  const key = "https://siahra-radar.co/api/v1/rivers/forecast";
  const fakeEnv = (getForecast: () => Promise<RiverForecastResponse>) =>
    ({ HII_FORECAST: { getByName: () => ({ getForecast }) } }) as unknown as AppEnv;
  const run = async (e: AppEnv, url = key) => {
    const ctx = createExecutionContext();
    const res = await handleRiverForecast(new Request(url), e, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  };
  const body = (lastSuccessAt: string | null): RiverForecastResponse => ({
    layer: {
      id: "x",
      epistemicClass: "forecast",
      liveOrStatic: "live",
      fetchedAt: lastSuccessAt,
      sourceIds: ["hii-fews"],
    },
    stations: [],
    source: { id: "hii-fews", lastSuccessAt, lastAttemptAt: lastSuccessAt, lastError: null },
    thresholdsFetchedAt: null,
    thresholdsLastError: null,
  });

  // คำตอบของ "primary" ที่อุ่นแล้วถูก put ไว้ใต้คีย์เดียวกันจากบล็อกด้านบน — ล้างก่อนและหลังทุกเคส
  beforeEach(async () => {
    await caches.default.delete(new Request(key));
  });
  afterEach(async () => {
    await caches.default.delete(new Request(key));
  });

  it("DO ล้ม → 503 no-store", async () => {
    const res = await run(fakeEnv(() => Promise.reject(new Error("do down"))));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("ยังไม่เคยดึงสำเร็จ → no-store และไม่ถูก put ลงแคช (DO ถูกถามทุกครั้ง)", async () => {
    const getForecast = vi.fn(async () => body(null));
    const e = fakeEnv(getForecast);
    const r1 = await run(e);
    expect(r1.headers.get("cache-control")).toBe("no-store");
    await run(e);
    expect(getForecast).toHaveBeenCalledTimes(2);
    expect(await caches.default.match(new Request(key))).toBeUndefined();
  });

  it("เคยดึงสำเร็จ → นโยบาย riverForecast และรอบสองมาจากแคชโดยไม่ถาม DO; query สุ่มแตกแคชไม่ได้ (400)", async () => {
    const getForecast = vi.fn(async () => body("2026-09-29T04:00:00.000Z"));
    const e = fakeEnv(getForecast);
    const r1 = await run(e);
    expect(r1.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
    await run(e);
    expect(getForecast).toHaveBeenCalledTimes(1);
    const q = await run(e, `${key}?bust=${Math.random()}`);
    expect(q.status).toBe(400);
    expect(getForecast).toHaveBeenCalledTimes(1);
  });
});
