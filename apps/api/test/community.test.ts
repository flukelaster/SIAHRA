import { createExecutionContext, runDurableObjectAlarm, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { env, exports as workerExports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMUNITY_MAX_BODY_BYTES,
  COMMUNITY_MAX_IMAGE_BYTES,
  COMMUNITY_REPORT_CAP_PER_DAY,
  COMMUNITY_VOTE_CAP_PER_DAY,
  LIVE_SOURCE_IDS,
  SOURCES,
  isAutoHidden,
  type CommunityCreateResponse,
  type CommunityReportsResponse,
  type CommunitySessionResponse,
  type CommunityVoteResponse,
} from "@siahra/shared-types";
import healthSrc from "../src/routes/health.ts?raw";
import { routes } from "../src/index";
import { readMeta, writeMeta } from "../src/durable-objects/metaKv";
import { MEMO_TTL_MS, type NewReport } from "../src/durable-objects/community-report";
import { imageKeyFor, newReportId, readCappedBody, sniffImage } from "../src/community/validate";
import {
  TURNSTILE_SITEVERIFY_URL,
  handleCommunityAdmin,
  handleCommunityCreate,
  handleCommunityImage,
  handleCommunityList,
  handleCommunityOwnerDelete,
  handleCommunitySession,
  handleCommunityVote,
} from "../src/routes/community";
import type { AppEnv } from "../src/types";

/**
 * รายงานจากประชาชน (PR A) — ข้อบังคับของ devops ถูกตรึงที่นี่:
 * REPORT-1 (ลำดับ + 0 R2 put บนทุกคำตอบที่ปฏิเสธ + ≤ 2 DO call), VOTE-1..3, SQL-4 (memo), SQL-5/ALARM-1
 * (retention), LIST-1, IMAGE-1, HEALTH-1
 *
 * handler ถูกเรียกตรง ๆ ด้วย env ที่ห่อไว้นับการเรียก DO / R2 และ secret ที่ใส่เองทุกเทส (vitest.config
 * ตั้ง secret ทั้งสามเป็น "" จึงไม่พึ่ง `.dev.vars` ของเครื่อง) — siteverify ของ Turnstile ถูก mock ด้วย
 * `vi.spyOn(globalThis, "fetch")` แบบเดียวกับต้นทางอื่นในเทส; ใช้ test secret ของ Turnstile เป็นค่า
 */
const appEnv = env as unknown as AppEnv;
const SECRETS = {
  // Turnstile test secret "always passes" — แต่ siteverify ถูก mock อยู่ดี ไม่มีคำขอออกเน็ตจริง
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  COMMUNITY_HMAC_KEY: "test-community-hmac-key-0123456789abcdef",
  COMMUNITY_ADMIN_TOKEN: "test-admin-token-9f8e7d",
};
const PASS = "turnstile-pass";
const DAY = 86_400_000;
const BANGKOK = { lat: "13.7563", lon: "100.5018" };

interface Calls {
  getByName: number;
  rpc: string[];
  puts: number;
  gets: number;
  deletes: number;
}

/** env ที่นับทุกการเรียก DO/R2 — `overrides` ทับค่าจริง (secret, หรือ binding ปลอมที่ throw) */
function envWith(overrides: Partial<Record<string, unknown>> = SECRETS): { env: AppEnv; calls: Calls } {
  const calls: Calls = { getByName: 0, rpc: [], puts: 0, gets: 0, deletes: 0 };
  const community = {
    getByName: (name: string) => {
      calls.getByName++;
      const stub = appEnv.COMMUNITY_REPORT.getByName(name) as unknown as Record<string, (...a: unknown[]) => unknown>;
      return new Proxy(
        {},
        {
          get(_t, prop: string) {
            return (...args: unknown[]) => {
              calls.rpc.push(prop);
              return stub[prop]!(...args);
            };
          },
        },
      );
    },
  };
  const bucket = {
    put: (...a: Parameters<R2Bucket["put"]>) => {
      calls.puts++;
      return appEnv.HAZARD_BUCKET.put(...a);
    },
    get: (...a: Parameters<R2Bucket["get"]>) => {
      calls.gets++;
      return appEnv.HAZARD_BUCKET.get(...a);
    },
    delete: (...a: Parameters<R2Bucket["delete"]>) => {
      calls.deletes++;
      return appEnv.HAZARD_BUCKET.delete(...a);
    },
  };
  const wrapped = new Proxy(appEnv as unknown as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in overrides) return overrides[prop];
      if (prop === "COMMUNITY_REPORT") return community;
      if (prop === "HAZARD_BUCKET") return bucket;
      return target[prop];
    },
  });
  return { env: wrapped as unknown as AppEnv, calls };
}

// ─── ไบต์ของรูปทดสอบ ────────────────────────────────────────────────────────
const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const SOS = [0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9];
/** JPEG แบบที่ canvas เขียน: SOI + APP0 (JFIF) + SOS … EOI — ไม่มี APP1 */
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], "JFIF", [0, 1, 1, 0, 0, 1, 0, 1, 0, 0], SOS);
/** JPEG จากกล้อง: APP1 Exif ก่อน SOS */
const JPEG_EXIF = bytes([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0e], "Exif", [0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0], SOS);
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
const WEBP = bytes("RIFF", le32(16), "WEBP", "VP8 ", le32(4), [1, 2, 3, 4]);
const WEBP_EXIF = bytes("RIFF", le32(28), "WEBP", "VP8X", le32(0), "EXIF", le32(4), [0, 0, 0, 0], "VP8 ", le32(0));
const PNG = bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

interface ReportOpts {
  lat?: string;
  lon?: string;
  categories?: string[] | string;
  description?: string;
  image?: Uint8Array;
  token?: string;
  origin?: string;
}

/** multipart จริง (ให้ runtime ประกอบ boundary) + Content-Length ตามไบต์จริง */
async function reportRequest(o: ReportOpts = {}): Promise<Request> {
  const form = new FormData();
  form.set("lat", o.lat ?? BANGKOK.lat);
  form.set("lon", o.lon ?? BANGKOK.lon);
  const cats = o.categories ?? ["flood"];
  if (typeof cats === "string") form.set("categories", cats);
  else for (const c of cats) form.append("categories", c);
  form.set("description", o.description ?? "น้ำท่วมถนนหน้าตลาด");
  if (o.image) form.set("image", new File([o.image], "photo.bin"));
  form.set("turnstileToken", o.token ?? PASS);
  const built = new Request("https://x.test/", { method: "POST", body: form });
  const body = new Uint8Array(await built.arrayBuffer());
  return new Request(`${o.origin ?? "https://community.test"}/api/v1/community/reports`, {
    method: "POST",
    body,
    headers: { "content-type": built.headers.get("content-type")!, "content-length": String(body.byteLength) },
  });
}

const jsonRequest = (path: string, body: unknown, headers: Record<string, string> = {}) => {
  const text = JSON.stringify(body);
  return new Request(`https://community.test${path}`, {
    method: "POST",
    body: text,
    headers: { "content-type": "application/json", "content-length": String(new TextEncoder().encode(text).byteLength), ...headers },
  });
};

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // siteverify ปลอม: token === PASS ผ่าน, อย่างอื่นไม่ผ่าน — host อื่น throw ให้เห็นว่ามีใครแอบยิง
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== TURNSTILE_SITEVERIFY_URL) throw new Error(`unexpected upstream call to ${url}`);
    const form = init?.body as FormData;
    expect(form.get("secret")).toBe(SECRETS.TURNSTILE_SECRET_KEY);
    return Response.json({ success: form.get("response") === PASS });
  });
});
afterEach(() => {
  fetchSpy.mockRestore();
});

const siteverifyCalls = () => fetchSpy.mock.calls.length;
const primary = () => appEnv.COMMUNITY_REPORT.getByName("primary");

/** วันที่ของเพดาน (UTC+7) — ตรงกับ capDate ใน DO */
const capDate = (ms = Date.now()) => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 10);
const setCaps = (uploads: number, votes: number) =>
  runInDurableObject(primary(), (_i, state) => {
    writeMeta(state.storage.sql, "caps", JSON.stringify({ date: capDate(), uploads, votes }));
  });

async function createReport(o: ReportOpts = {}): Promise<CommunityCreateResponse> {
  const { env: e } = envWith();
  const res = await handleCommunityCreate(await reportRequest(o), e);
  expect(res.status).toBe(201);
  return (await res.json()) as CommunityCreateResponse;
}

async function voterToken(): Promise<string> {
  const { env: e } = envWith();
  const res = await handleCommunitySession(jsonRequest("/api/v1/community/session", { turnstileToken: PASS }), e);
  expect(res.status).toBe(200);
  return ((await res.json()) as CommunitySessionResponse).voterToken;
}

/** แถวตรงเข้า DO (สำหรับเทส retention/moderation ที่ต้องกำหนดเวลาเอง) */
const insertDirect = (row: Partial<NewReport> & { createdMs: number }) =>
  runInDurableObject(primary(), async (instance) => {
    const id = row.id ?? newReportId(row.createdMs);
    const r = await instance.insertReport(
      {
        id,
        provinceCode: "57",
        lat: 19.9,
        lon: 99.8,
        categories: ["other"],
        description: "",
        imageKey: null,
        ...row,
      },
      false,
    );
    if (!r.ok) throw new Error("insert refused");
    return r.report;
  });

// ─────────────────────────────────────────────────────────────────────────────

describe("สัญญาข้อมูล — แหล่ง community และชั้น crowdsourced", () => {
  it("community-report เป็น kind community นอก LIVE_SOURCE_IDS และ /health ไม่เรียก DO นี้ (HEALTH-1)", () => {
    expect(SOURCES["community-report"].kind).toBe("community");
    expect(LIVE_SOURCE_IDS).not.toContain("community-report");
    expect(healthSrc).not.toContain("COMMUNITY_REPORT");
  });

  it("isAutoHidden = down ≥ 5 และ down ≥ 2 × up", () => {
    expect(isAutoHidden(0, 4)).toBe(false);
    expect(isAutoHidden(0, 5)).toBe(true);
    expect(isAutoHidden(3, 5)).toBe(false);
    expect(isAutoHidden(3, 6)).toBe(true);
  });

  it("ทุกเส้นทาง community มีงบต่อ IP ตาม devops LIMITS", () => {
    const limitOf = (method: string, path: string) =>
      routes.find((r) => r.method === method && r.pattern.test(path))?.limit?.perMinute;
    const id = "20260927-AAAAAAAAAAAAAAAAAAAAAA";
    expect(limitOf("GET", "/api/v1/community/10/reports")).toBe(60);
    expect(limitOf("POST", `/api/v1/community/reports/${id}/vote`)).toBe(30);
    expect(limitOf("POST", "/api/v1/community/reports")).toBe(5);
    expect(limitOf("POST", "/api/v1/community/session")).toBe(10);
    expect(limitOf("GET", `/api/v1/community/image/${id}`)).toBe(120);
    expect(limitOf("POST", `/api/v1/community/admin/reports/${id}/hide`)).toBe(30);
    expect(limitOf("POST", `/api/v1/community/reports/${id}/delete`)).toBe(10);
  });
});

describe("POST /api/v1/community/reports — ปฏิเสธก่อนแตะ DO/R2", () => {
  it.each([
    ["ไม่มี TURNSTILE_SECRET_KEY", { ...SECRETS, TURNSTILE_SECRET_KEY: "" }],
    ["ไม่มี COMMUNITY_HMAC_KEY", { ...SECRETS, COMMUNITY_HMAC_KEY: "" }],
  ])("%s = 503 reporting-disabled (report และ session)", async (_label, overrides) => {
    const { env: e, calls } = envWith(overrides);
    const res = await handleCommunityCreate(await reportRequest(), e);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: "reporting-disabled" });
    const s = await handleCommunitySession(jsonRequest("/api/v1/community/session", { turnstileToken: PASS }), e);
    expect(s.status).toBe(503);
    expect(calls.getByName + calls.puts).toBe(0);
    expect(siteverifyCalls()).toBe(0);
  });

  it("413 เมื่อไม่มี Content-Length (body แบบสตรีม) — ก่อน formData, 0 siteverify, 0 DO", async () => {
    const { env: e, calls } = envWith();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(10));
        c.close();
      },
    });
    const res = await handleCommunityCreate(
      new Request("https://community.test/api/v1/community/reports", {
        method: "POST",
        body: stream,
        headers: { "content-type": "multipart/form-data; boundary=x" },
      }),
      e,
    );
    expect(res.status).toBe(413);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(siteverifyCalls()).toBe(0);
    expect(calls.getByName + calls.puts).toBe(0);
  });

  it("413 เมื่อ Content-Length เกินเพดาน", async () => {
    const { env: e, calls } = envWith();
    const req = new Request("https://community.test/api/v1/community/reports", {
      method: "POST",
      body: new Uint8Array(COMMUNITY_MAX_BODY_BYTES + 1),
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(COMMUNITY_MAX_BODY_BYTES + 1) },
    });
    expect((await handleCommunityCreate(req, e)).status).toBe(413);
    expect(siteverifyCalls()).toBe(0);
    expect(calls.getByName).toBe(0);
  });

  it("อ่าน body ซ้ำแบบจำกัดไบต์ — ไม่เชื่อ Content-Length ที่อ้างมา", async () => {
    const req = new Request("https://x.test/", { method: "POST", body: new Uint8Array(2000) });
    expect(await readCappedBody(req, 1000)).toBeNull();
    const ok = new Request("https://x.test/", { method: "POST", body: new Uint8Array(1000) });
    expect((await readCappedBody(ok, 1000))?.byteLength).toBe(1000);
  });

  it("Turnstile ไม่ผ่าน = 403 turnstile-failed, 0 DO", async () => {
    const { env: e, calls } = envWith();
    const res = await handleCommunityCreate(await reportRequest({ token: "bot" }), e);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "turnstile-failed" });
    expect(calls.getByName + calls.puts).toBe(0);
  });

  it("siteverify ถามไม่ได้ = 503 turnstile-unreachable (ไม่ใช่ 'token ผิด')", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));
    const { env: e, calls } = envWith();
    const res = await handleCommunityCreate(await reportRequest(), e);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: "turnstile-unreachable" });
    expect(calls.getByName).toBe(0);
  });

  it("นอกประเทศไทย = 422 outside-thailand, 0 DO, 0 put", async () => {
    const { env: e, calls } = envWith();
    const res = await handleCommunityCreate(await reportRequest({ lat: "35.68", lon: "139.69", image: JPEG }), e);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reason: "outside-thailand" });
    expect(calls.getByName + calls.puts).toBe(0);
  });

  it.each([
    ["หมวดนอก enum", { categories: ["flood", "alien-landing"] }, 422, "invalid-categories"],
    ["ไม่มีหมวด", { categories: [] }, 422, "invalid-categories"],
    ["ข้อความเกิน 500", { description: "ก".repeat(501) }, 422, "description-too-long"],
    ["lat ไม่ใช่ตัวเลข", { lat: "north" }, 422, "invalid-location"],
    ["PNG", { image: PNG }, 415, "image-type"],
    ["JPEG ที่มี APP1 Exif", { image: JPEG_EXIF }, 422, "image-metadata"],
    ["WebP ที่มี chunk EXIF", { image: WEBP_EXIF }, 422, "image-metadata"],
    ["รูปเกิน 300 KB", { image: new Uint8Array(COMMUNITY_MAX_IMAGE_BYTES + 1).fill(0xff) }, 413, "image-too-large"],
  ] as const)("%s = %i %s, 0 DO, 0 put", async (_label, opts, status, reason) => {
    const { env: e, calls } = envWith();
    const res = await handleCommunityCreate(await reportRequest(opts as ReportOpts), e);
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ reason });
    expect(calls.getByName + calls.puts).toBe(0);
  });

  it("categories เป็น JSON array ได้ และถูกเรียงตามลำดับที่ประกาศ ตัดซ้ำ", async () => {
    const { report } = await createReport({ categories: '["other","flood","flood"]', origin: "https://json-cats.test" });
    expect(report.categories).toEqual(["flood", "other"]);
  });
});

describe("magic bytes", () => {
  it("JPEG ของ canvas และ WebP ผ่าน; ไม่มี SOS / RIFF ไม่มีภาพ = image-invalid", () => {
    expect(sniffImage(JPEG)).toEqual({ ok: true, contentType: "image/jpeg" });
    expect(sniffImage(WEBP)).toEqual({ ok: true, contentType: "image/webp" });
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xd9]))).toMatchObject({ ok: false, reason: "image-invalid" });
    expect(sniffImage(bytes("RIFF", le32(4), "WEBP"))).toMatchObject({ ok: false, reason: "image-invalid" });
  });
});

describe("POST /api/v1/community/reports — สำเร็จ", () => {
  it("ไม่มีรูป = DO call เดียว, 0 put, 201 {report, ownerToken}; provinceCode/createdAt มาจาก server", async () => {
    const { env: e, calls } = envWith();
    const before = Date.now();
    const res = await handleCommunityCreate(await reportRequest(), e);
    expect(res.status).toBe(201);
    const body = (await res.json()) as CommunityCreateResponse;
    expect(body.report).toMatchObject({ provinceCode: "10", categories: ["flood"], imageUrl: null, up: 0, down: 0 });
    expect(Date.parse(body.report.createdAt)).toBeGreaterThanOrEqual(before);
    expect(body.ownerToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(calls.rpc).toEqual(["insertReport"]);
    expect(calls.puts).toBe(0);
  });

  it("มีรูป = จอง → put → เขียนแถว (2 DO call, 1 put) และเส้นทางรูปเสิร์ฟจาก R2 โดยไม่ถาม DO", async () => {
    const { env: e, calls } = envWith();
    const res = await handleCommunityCreate(await reportRequest({ image: JPEG }), e);
    expect(res.status).toBe(201);
    const { report } = (await res.json()) as CommunityCreateResponse;
    expect(calls.rpc).toEqual(["reserveUpload", "insertReport"]);
    expect(calls.puts).toBe(1);
    expect(report.imageUrl).toBe(`/api/v1/community/image/${report.id}`);

    const img = envWith();
    const ctx = createExecutionContext();
    const first = await handleCommunityImage(new Request(`https://img.test${report.imageUrl}`), img.env, [report.id], ctx);
    await waitOnExecutionContext(ctx);
    expect(first.status).toBe(200);
    expect(first.headers.get("Content-Type")).toBe("image/jpeg");
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(JPEG);
    // ครั้งที่สองจากแคชขอบ (คีย์ไม่มี query) — ไม่แตะ R2 อีก, และไม่แตะ DO เลยทั้งสองครั้ง
    const ctx2 = createExecutionContext();
    const second = await handleCommunityImage(new Request(`https://img.test${report.imageUrl}?bust=1`), img.env, [report.id], ctx2);
    expect(second.status).toBe(200);
    expect(img.calls.gets).toBe(1);
    expect(img.calls.getByName).toBe(0);
  });

  it("put ล้มเหลว = 503 storage-failed และไม่มีแถวชี้หารูปที่ไม่มี (ไม่เรียก insertReport)", async () => {
    const { env: base, calls } = envWith();
    const failing = new Proxy(base as unknown as Record<string, unknown>, {
      get(t, p: string) {
        if (p === "HAZARD_BUCKET") {
          return {
            put: async () => {
              calls.puts++;
              throw new Error("R2 down");
            },
          };
        }
        return t[p];
      },
    }) as unknown as AppEnv;
    const res = await handleCommunityCreate(await reportRequest({ image: WEBP }), failing);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: "storage-failed" });
    expect(calls.rpc).toEqual(["reserveUpload"]);
  });

  it("เพดานรายวันเต็ม = 429 report-cap, 0 put (มีรูปก็ไม่ put)", async () => {
    await setCaps(COMMUNITY_REPORT_CAP_PER_DAY, 0);
    try {
      const withImage = envWith();
      const res = await handleCommunityCreate(await reportRequest({ image: JPEG }), withImage.env);
      expect(res.status).toBe(429);
      expect(await res.json()).toMatchObject({ reason: "report-cap" });
      expect(withImage.calls.puts).toBe(0);
      expect(withImage.calls.rpc).toEqual(["reserveUpload"]);
      const noImage = envWith();
      expect((await handleCommunityCreate(await reportRequest(), noImage.env)).status).toBe(429);
    } finally {
      await setCaps(0, 0);
    }
  });
});

describe("GET /api/v1/community/{code}/reports (LIST-1, SQL-4)", () => {
  it("รหัสจังหวัดที่ไม่รู้จัก = 404, 0 DO", async () => {
    const { env: e, calls } = envWith();
    const res = await handleCommunityList(new Request("https://l.test/api/v1/community/99/reports"), e, ["99"], createExecutionContext());
    expect(res.status).toBe(404);
    expect(calls.getByName).toBe(0);
  });

  it("มี query string = 400, 0 DO", async () => {
    const { env: e, calls } = envWith();
    const res = await handleCommunityList(new Request("https://l.test/api/v1/community/10/reports?t=1"), e, ["10"], createExecutionContext());
    expect(res.status).toBe(400);
    expect(calls.getByName).toBe(0);
  });

  it("รายการว่างก็ถูกแคช 30 วิ — คำขอที่สองไม่ถึง DO; descriptor เป็น crowdsourced", async () => {
    const { env: e, calls } = envWith();
    const url = "https://list-empty.test/api/v1/community/96/reports";
    const ctx = createExecutionContext();
    const first = await handleCommunityList(new Request(url), e, ["96"], ctx);
    await waitOnExecutionContext(ctx);
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=30, s-maxage=30");
    const body = (await first.json()) as CommunityReportsResponse;
    expect(body.reports).toEqual([]);
    expect(body.hiddenCount).toBe(0);
    expect(body.layer).toMatchObject({
      epistemicClass: "crowdsourced",
      sourceIds: ["community-report"],
      publishedAt: null,
      fetchedAt: body.fetchedAt,
    });
    expect(Number.isFinite(Date.parse(body.fetchedAt))).toBe(true);
    const second = await handleCommunityList(new Request(url), e, ["96"], createExecutionContext());
    expect(second.status).toBe(200);
    expect(calls.rpc).toEqual(["list"]);
  });

  it("DO ล้มเหลว = 503 no-store ไม่ถูกแคช", async () => {
    const url = "https://list-fail.test/api/v1/community/10/reports";
    const { env: e } = envWith({
      ...SECRETS,
      COMMUNITY_REPORT: {
        getByName: () => ({
          list: async () => {
            throw new Error("boom");
          },
        }),
      },
    });
    const ctx = createExecutionContext();
    const res = await handleCommunityList(new Request(url), e, ["10"], ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await caches.default.match(new Request(url))).toBeUndefined();
  });

  it("สองครั้งภายใน TTL ของ memo = SELECT ครั้งเดียว; การเขียนล้าง memo ของจังหวัดนั้น", async () => {
    await insertDirect({ provinceCode: "95", lat: 6.5, lon: 101.3, createdMs: Date.now() });
    const selects = await runInDurableObject(primary(), async (instance, state) => {
      const spy = vi.spyOn(state.storage.sql, "exec");
      try {
        const a = await instance.list("95");
        const b = await instance.list("95");
        expect(b).toBe(a);
        const listSelects = () => spy.mock.calls.filter(([q]) => String(q).startsWith("SELECT id, province_code")).length;
        const afterTwo = listSelects();
        await instance.insertReport(
          {
            id: newReportId(Date.now()),
            provinceCode: "95",
            lat: 6.5,
            lon: 101.3,
            categories: ["flood"],
            description: "",
            imageKey: null,
            createdMs: Date.now(),
          },
          false,
        );
        const c = await instance.list("95");
        expect(c.reports).toHaveLength(2);
        return { afterTwo, afterWrite: listSelects() };
      } finally {
        spy.mockRestore();
      }
    });
    expect(selects).toEqual({ afterTwo: 1, afterWrite: 2 });
    expect(MEMO_TTL_MS).toBeLessThanOrEqual(30_000);
  });
});

describe("โหวต (VOTE-1..3)", () => {
  it("/session ไม่เรียก DO เลย และออก token รูป voterId.sig", async () => {
    const { env: e, calls } = envWith();
    const res = await handleCommunitySession(jsonRequest("/api/v1/community/session", { turnstileToken: PASS }), e);
    expect(res.status).toBe(200);
    const { voterToken: token } = (await res.json()) as CommunitySessionResponse;
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(calls.getByName).toBe(0);
    const bot = await handleCommunitySession(jsonRequest("/api/v1/community/session", { turnstileToken: "bot" }), e);
    expect(bot.status).toBe(403);
  });

  it.each([
    ["ไม่มี token", undefined],
    ["ลายเซ็นปลอม", "AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"],
    ["รูปผิด", "garbage"],
  ])("%s = 401 และ 0 DO request", async (_l, token) => {
    const { env: e, calls } = envWith();
    const id = "20260927-AAAAAAAAAAAAAAAAAAAAAA";
    const res = await handleCommunityVote(
      jsonRequest(`/api/v1/community/reports/${id}/vote`, { value: 1 }, token ? { "X-Voter-Token": token } : {}),
      e,
      [id],
    );
    expect(res.status).toBe(401);
    expect(calls.getByName).toBe(0);
  });

  it("upsert → เปลี่ยน → ซ้ำ (no-op) → ถอน ผ่าน Worker ด้วย token จริง", async () => {
    const { report } = await createReport({ origin: "https://vote.test" });
    const token = await voterToken();
    const vote = async (value: unknown) => {
      const { env: e } = envWith();
      const res = await handleCommunityVote(
        jsonRequest(`/api/v1/community/reports/${report.id}/vote`, { value }, { "X-Voter-Token": token }),
        e,
        [report.id],
      );
      return { status: res.status, body: (await res.json()) as CommunityVoteResponse };
    };
    expect(await vote(1)).toEqual({ status: 200, body: { up: 1, down: 0, hidden: false } });
    expect(await vote(1)).toEqual({ status: 200, body: { up: 1, down: 0, hidden: false } });
    expect(await vote(-1)).toEqual({ status: 200, body: { up: 0, down: 1, hidden: false } });
    expect(await vote(0)).toEqual({ status: 200, body: { up: 0, down: 0, hidden: false } });
    expect((await vote(2)).status).toBe(400);
    const { env: e } = envWith();
    const missing = "20260927-ZZZZZZZZZZZZZZZZZZZZZZ";
    const res = await handleCommunityVote(
      jsonRequest(`/api/v1/community/reports/${missing}/vote`, { value: 1 }, { "X-Voter-Token": token }),
      e,
      [missing],
    );
    expect(res.status).toBe(404);
  });

  /** ทุกคำสั่งที่เขียน (INSERT/UPDATE/DELETE) ระหว่าง `fn` — นับจาก sql.exec ของ DO ตัวจริง */
  const writesDuring = <T>(fn: (i: import("../src/durable-objects/community-report").CommunityReportDO) => Promise<T>) =>
    runInDurableObject(primary(), async (instance, state) => {
      const spy = vi.spyOn(state.storage.sql, "exec");
      try {
        const result = await fn(instance);
        const writes = spy.mock.calls.map(([q]) => String(q)).filter((q) => /^\s*(INSERT|UPDATE|DELETE)/.test(q));
        return { result, writes };
      } finally {
        spy.mockRestore();
      }
    });

  it("VOTE-2: ค่าเท่าเดิม / 0 ที่ไม่เคยโหวต = 0 แถวที่เขียน; การเปลี่ยนหนึ่งครั้ง = votes 1 + UPDATE reports 1 + caps 1", async () => {
    const report = await insertDirect({ createdMs: Date.now() });
    const none = await writesDuring((i) => i.vote(report.id, "voter-a", 0));
    expect(none.result).toMatchObject({ ok: true, up: 0, down: 0 });
    expect(none.writes).toEqual([]);
    const first = await writesDuring((i) => i.vote(report.id, "voter-a", 1));
    expect(first.writes).toHaveLength(3);
    expect(first.writes.filter((q) => q.includes("INTO votes"))).toHaveLength(1);
    expect(first.writes.filter((q) => q.startsWith("UPDATE reports"))).toHaveLength(1);
    expect(first.writes.filter((q) => q.includes("INTO meta"))).toHaveLength(1);
    const same = await writesDuring((i) => i.vote(report.id, "voter-a", 1));
    expect(same.result).toMatchObject({ ok: true, up: 1, down: 0 });
    expect(same.writes).toEqual([]);
  });

  it("VOTE-1: เกินเพดานรายวันทั้งประเทศ = vote-cap และ 0 แถวที่เขียน (Worker ตอบ 429)", async () => {
    const report = await insertDirect({ createdMs: Date.now() });
    await setCaps(0, COMMUNITY_VOTE_CAP_PER_DAY);
    try {
      const capped = await writesDuring((i) => i.vote(report.id, "voter-cap", -1));
      expect(capped.result).toEqual({ ok: false, reason: "vote-cap" });
      expect(capped.writes).toEqual([]);
      const token = await voterToken();
      const { env: e } = envWith();
      const res = await handleCommunityVote(
        jsonRequest(`/api/v1/community/reports/${report.id}/vote`, { value: 1 }, { "X-Voter-Token": token }),
        e,
        [report.id],
      );
      expect(res.status).toBe(429);
      expect(await res.json()).toMatchObject({ reason: "vote-cap" });
      const caps = await runInDurableObject(primary(), (_i, state) => readMeta(state.storage.sql, "caps"));
      expect(JSON.parse(caps!)).toMatchObject({ votes: COMMUNITY_VOTE_CAP_PER_DAY });
    } finally {
      await setCaps(0, 0);
    }
  });

  it("ซ่อนอัตโนมัติเมื่อโหวตลงถึงเกณฑ์ — หายจากรายการแต่นับใน hiddenCount (ไม่หายเงียบ)", async () => {
    const report = await insertDirect({ provinceCode: "94", lat: 6.9, lon: 101.2, createdMs: Date.now() });
    const result = await runInDurableObject(primary(), async (instance) => {
      await instance.vote(report.id, "up-1", 1);
      const hidden: (boolean | null)[] = [];
      for (let n = 1; n <= 5; n++) {
        const s = await instance.vote(report.id, `down-${n}`, -1);
        hidden.push(s.ok ? s.hidden : null);
      }
      const hiddenList = await instance.list("94");
      // ถอนโหวตลงหนึ่งเสียง (down 4) = กลับมาแสดง
      await instance.vote(report.id, "down-5", 0);
      return { hidden, hiddenList, shownList: await instance.list("94") };
    });
    // up 1: down 1..4 ยังแสดง, down 5 (≥ 5 และ ≥ 2 × 1) ซ่อน
    expect(result.hidden).toEqual([false, false, false, false, true]);
    expect(result.hiddenList.reports.map((r) => r.id)).not.toContain(report.id);
    expect(result.hiddenList.hiddenCount).toBe(1);
    expect(result.shownList.reports.map((r) => r.id)).toContain(report.id);
    expect(result.shownList.hiddenCount).toBe(0);
  });
});

describe("retention 30 วัน (SQL-5, ALARM-1)", () => {
  it("alarm ลบแถว + votes + รูปใน R2 ที่เก่ากว่า 30 วัน เก็บของใหม่ไว้ และตั้งนัดต่อเฉพาะเมื่อยังมีแถว", async () => {
    const stub = appEnv.COMMUNITY_REPORT.getByName("retention-test");
    const old = Date.now() - 31 * DAY;
    const oldId = newReportId(old);
    const oldKey = imageKeyFor(oldId)!;
    await appEnv.HAZARD_BUCKET.put(oldKey, JPEG, { httpMetadata: { contentType: "image/jpeg" } });
    const freshId = newReportId(Date.now());
    const base = { provinceCode: "57", lat: 19.9, lon: 99.8, categories: ["flood" as const], description: "" };
    await runInDurableObject(stub, async (instance) => {
      await instance.insertReport({ ...base, id: oldId, imageKey: oldKey, createdMs: old }, false);
      await instance.insertReport({ ...base, id: freshId, imageKey: null, createdMs: Date.now() }, false);
      await instance.vote(oldId, "voter-r", 1);
    });
    expect(await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())).not.toBeNull();

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const after = await runInDurableObject(stub, (_i, state) => ({
      ids: state.storage.sql.exec<{ id: string }>("SELECT id FROM reports").toArray().map((r) => r.id),
      votes: state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM votes WHERE report_id = ?", oldId).one().n,
    }));
    expect(after.ids).toEqual([freshId]);
    expect(after.votes).toBe(0);
    expect(await appEnv.HAZARD_BUCKET.head(oldKey)).toBeNull();
    // ยังมีแถว → นัดต่อ +1 ชม.
    const next = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(next).not.toBeNull();
    expect(next! - Date.now()).toBeGreaterThan(50 * 60_000);

    // ลบแถวสุดท้าย → alarm รอบถัดไปไม่ตั้งนัดอีก
    await runInDurableObject(stub, (instance) => instance.deleteReport(freshId));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())).toBeNull();
  });

  it("insertReport ไม่เลื่อนนัดที่มีอยู่ (ALARM-1)", async () => {
    const stub = appEnv.COMMUNITY_REPORT.getByName("alarm-arm-test");
    const base = { provinceCode: "57", lat: 19.9, lon: 99.8, categories: ["flood" as const], description: "", imageKey: null };
    const first = await runInDurableObject(stub, async (instance, state) => {
      await instance.insertReport({ ...base, id: newReportId(Date.now()), createdMs: Date.now() }, false);
      return state.storage.getAlarm();
    });
    const second = await runInDurableObject(stub, async (instance, state) => {
      await instance.insertReport({ ...base, id: newReportId(Date.now()), createdMs: Date.now() }, false);
      return state.storage.getAlarm();
    });
    expect(second).toBe(first);
  });
});

describe("ลบ/ซ่อน — เจ้าของและผู้ดูแล", () => {
  it("เจ้าของลบด้วย ownerToken: token ผิด = 401 0 DO; ถูก = ลบแถวและรูป; ครั้งที่สอง = 404", async () => {
    const { report, ownerToken } = await createReport({ image: WEBP, origin: "https://owner.test" });
    const key = imageKeyFor(report.id)!;
    expect(await appEnv.HAZARD_BUCKET.head(key)).not.toBeNull();
    const del = (token: string) => {
      const w = envWith();
      return {
        w,
        res: handleCommunityOwnerDelete(
          jsonRequest(`/api/v1/community/reports/${report.id}/delete`, { ownerToken: token }),
          w.env,
          [report.id],
        ),
      };
    };
    const forged = del("A".repeat(43));
    expect((await forged.res).status).toBe(401);
    expect(forged.w.calls.getByName).toBe(0);
    const ok = del(ownerToken);
    expect((await ok.res).status).toBe(200);
    expect(await appEnv.HAZARD_BUCKET.head(key)).toBeNull();
    expect((await del(ownerToken).res).status).toBe(404);
  });

  const admin = (id: string, action: string, auth: string | null, overrides = SECRETS) => {
    const w = envWith(overrides);
    const req = new Request(`https://community.test/api/v1/community/admin/reports/${id}/${action}`, {
      method: "POST",
      headers: auth ? { Authorization: auth } : {},
    });
    return { w, res: handleCommunityAdmin(req, w.env, [id, action]) };
  };

  it("ไม่ได้ตั้ง COMMUNITY_ADMIN_TOKEN = 503; bearer ผิด/ไม่มี = 401 — ทั้งหมด 0 DO", async () => {
    const id = "20260927-AAAAAAAAAAAAAAAAAAAAAA";
    const off = admin(id, "hide", `Bearer ${SECRETS.COMMUNITY_ADMIN_TOKEN}`, { ...SECRETS, COMMUNITY_ADMIN_TOKEN: "" });
    expect((await off.res).status).toBe(503);
    for (const auth of [null, "Bearer wrong", SECRETS.COMMUNITY_ADMIN_TOKEN]) {
      const a = admin(id, "hide", auth);
      expect((await a.res).status).toBe(401);
      expect(a.w.calls.getByName).toBe(0);
    }
  });

  it("hide เก็บรูปไว้และนับใน hiddenCount, unhide คืนมา (โหวตลงหลังจากนั้นไม่ซ่อนอีก), delete ลบรูป", async () => {
    const { report } = await createReport({ image: JPEG, lat: "7.0", lon: "100.47", origin: "https://admin.test" });
    const code = report.provinceCode;
    const key = imageKeyFor(report.id)!;
    const bearer = `Bearer ${SECRETS.COMMUNITY_ADMIN_TOKEN}`;
    const list = () => runInDurableObject(primary(), (i) => i.list(code));

    const hide = await admin(report.id, "hide", bearer).res;
    expect(await hide.json()).toMatchObject({ hidden: true });
    expect(await appEnv.HAZARD_BUCKET.head(key)).not.toBeNull();
    const hiddenList = await list();
    expect(hiddenList.reports.map((r) => r.id)).not.toContain(report.id);
    expect(hiddenList.hiddenCount).toBeGreaterThanOrEqual(1);

    const unhide = await admin(report.id, "unhide", bearer).res;
    expect(await unhide.json()).toMatchObject({ hidden: false });
    const afterVotes = await runInDurableObject(primary(), async (instance) => {
      let last;
      for (let n = 1; n <= 6; n++) last = await instance.vote(report.id, `brigade-${n}`, -1);
      return last;
    });
    expect(afterVotes).toMatchObject({ ok: true, down: 6, hidden: false });
    expect((await list()).reports.map((r) => r.id)).toContain(report.id);

    const del = await admin(report.id, "delete", bearer).res;
    expect(del.status).toBe(200);
    expect(await appEnv.HAZARD_BUCKET.head(key)).toBeNull();
    expect((await admin(report.id, "hide", bearer).res).status).toBe(404);
  });
});

describe("GET /api/v1/community/image/{id} (IMAGE-1)", () => {
  it("id ผิดรูป = 404 ก่อนแตะ R2; ไม่มี object = 404 no-store ไม่แคช", async () => {
    const bad = envWith();
    const res = await handleCommunityImage(new Request("https://img2.test/api/v1/community/image/x"), bad.env, ["../etc"], createExecutionContext());
    expect(res.status).toBe(404);
    expect(bad.calls.gets).toBe(0);

    const missingId = "20260927-QQQQQQQQQQQQQQQQQQQQQQ";
    const url = `https://img2.test/api/v1/community/image/${missingId}`;
    const miss = envWith();
    const ctx = createExecutionContext();
    const r = await handleCommunityImage(new Request(url), miss.env, [missingId], ctx);
    await waitOnExecutionContext(ctx);
    expect(r.status).toBe(404);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(miss.calls.getByName).toBe(0);
    expect(await caches.default.match(new Request(url))).toBeUndefined();
  });
});

describe("ตารางเส้นทางจริง (routes[] → handler ส่ง params ถูก)", () => {
  const call = (path: string, init: RequestInit = {}) =>
    workerExports.default.fetch(new Request(`https://route-wiring.test${path}`, init));

  it("GET รายการจังหวัด = 200 crowdsourced; id รูปผิดรูป = 404 ของ router; GET บนเส้นทาง POST = 405", async () => {
    const list = await call("/api/v1/community/10/reports");
    expect(list.status).toBe(200);
    expect(((await list.json()) as CommunityReportsResponse).layer.epistemicClass).toBe("crowdsourced");
    expect((await call("/api/v1/community/99/reports")).status).toBe(404);
    expect((await call("/api/v1/community/image/not-an-id")).status).toBe(404);
    const wrong = await call("/api/v1/community/reports");
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("Allow")).toBe("POST");
  });

  it("POST ผ่าน router ถึง handler: secret ว่างใน vitest.config = 503 reporting-disabled / admin-disabled", async () => {
    const res = await call("/api/v1/community/session", { method: "POST", body: "{}", headers: { "content-length": "2" } });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: "reporting-disabled" });
    const id = "20260927-AAAAAAAAAAAAAAAAAAAAAA";
    const admin = await call(`/api/v1/community/admin/reports/${id}/hide`, { method: "POST" });
    expect(admin.status).toBe(503);
    expect(await admin.json()).toMatchObject({ reason: "admin-disabled" });
  });
});
