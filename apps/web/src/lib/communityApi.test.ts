import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildReportForm,
  castVote,
  deleteOwnReport,
  failureFor,
  reportFailureFor,
  submitReport,
  type ReportDraft,
  type VoteDeps,
} from "./communityApi";

const ID = "20260927-AAAAAAAAAAAAAAAAAAAAAA";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function deps(initial: string | null = null) {
  let token = initial;
  const turnstile = vi.fn(async () => "ts-token");
  const d: VoteDeps & { token: () => string | null; turnstile: typeof turnstile } = {
    getVoterToken: () => token,
    setVoterToken: (t) => {
      token = t;
    },
    turnstileToken: turnstile,
    token: () => token,
    turnstile,
  };
  return d;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("failureFor — ทุกความล้มเหลวมีชื่อของมัน (ไม่มีกรณีที่กลืนเป็น 'สำเร็จ')", () => {
  it("503: ปิดรับ ≠ ถามบริการยืนยันไม่ได้ ≠ อย่างอื่น", () => {
    expect(failureFor(503, "reporting-disabled")).toBe("disabled");
    expect(failureFor(503, "turnstile-unreachable")).toBe("turnstile-unreachable");
    expect(failureFor(503, undefined)).toBe("server");
  });
  it("429: เพดานรายวันทั้งประเทศ (vote-cap) ≠ ตัวจำกัดอัตราต่อ IP (ไม่มี reason)", () => {
    expect(failureFor(429, "vote-cap")).toBe("vote-cap");
    expect(failureFor(429, undefined)).toBe("rate-limit");
  });
  it("404 / 403 / 401 / 500", () => {
    expect(failureFor(404, "not-found")).toBe("not-found");
    expect(failureFor(403, "turnstile-failed")).toBe("turnstile");
    expect(failureFor(401, "unauthorized")).toBe("unauthorized");
    expect(failureFor(500, undefined)).toBe("server");
  });
});

describe("castVote", () => {
  it("ไม่มี voterToken → Turnstile → /session → โหวตด้วย X-Voter-Token และเก็บ token", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/session")) return json(200, { voterToken: "voter-1" });
        return json(200, { up: 3, down: 1, hidden: false });
      }),
    );
    const d = deps();
    const res = await castVote(ID, 1, d);
    expect(res).toEqual({ ok: true, value: { up: 3, down: 1, hidden: false } });
    expect(d.token()).toBe("voter-1");
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/community/session", `/api/v1/community/reports/${ID}/vote`]);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ turnstileToken: "ts-token" });
    const headers = calls[1].init?.headers as Record<string, string> | undefined;
    expect(headers?.["X-Voter-Token"]).toBe("voter-1");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ value: 1 });
  });

  it("มี token แล้ว = ไม่แตะ Turnstile; 401 → ล้าง token ขอ session ใหม่ครั้งเดียวแล้วลองซ้ำ", async () => {
    let votes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/session")) return json(200, { voterToken: "voter-2" });
        votes += 1;
        return votes === 1 ? json(401, { error: "x", reason: "unauthorized" }) : json(200, { up: 0, down: 0, hidden: false });
      }),
    );
    const d = deps("old");
    const res = await castVote(ID, 0, d);
    expect(res.ok).toBe(true);
    expect(d.turnstile).toHaveBeenCalledTimes(1);
    expect(d.token()).toBe("voter-2");
  });

  it("401 ซ้ำหลัง session ใหม่ = unauthorized (ไม่วนไม่รู้จบ)", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/session") ? json(200, { voterToken: "v" }) : json(401, { reason: "unauthorized" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await castVote(ID, 1, deps("old"));
    expect(res).toEqual({ ok: false, failure: "unauthorized", status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("server ปิดระบบ (503 reporting-disabled ที่ /session) = disabled และไม่มีการโหวต", async () => {
    const fetchMock = vi.fn(async () => json(503, { reason: "reporting-disabled" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await castVote(ID, 1, deps())).toEqual({ ok: false, failure: "disabled", status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Turnstile ล้ม = turnstile และไม่ส่งคำขอใด", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const d = deps();
    d.turnstileToken = async () => {
      throw new Error("challenge");
    };
    expect(await castVote(ID, 1, d)).toEqual({ ok: false, failure: "turnstile", status: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("เพดานโหวต / จำกัดอัตรา / เครือข่าย แยกกัน", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(429, { reason: "vote-cap" })));
    expect((await castVote(ID, 1, deps("t"))).ok ? null : "vote-cap").toBe("vote-cap");
    vi.stubGlobal("fetch", vi.fn(async () => json(429, { error: "Too many requests", retryAfterSeconds: 3 })));
    const rl = await castVote(ID, 1, deps("t"));
    expect(rl.ok ? null : rl.failure).toBe("rate-limit");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const net = await castVote(ID, 1, deps("t"));
    expect(net).toEqual({ ok: false, failure: "network", status: null });
  });

  it("คำตอบรูปร่างผิด = server (ไม่เดาตัวนับ)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { up: "3" })));
    const res = await castVote(ID, 1, deps("t"));
    expect(res.ok ? null : res.failure).toBe("server");
  });
});

describe("deleteOwnReport", () => {
  it("ส่ง ownerToken ใน body; 401 = unauthorized", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      JSON.parse(String(init?.body)).ownerToken === "own" ? json(200, { deleted: true }) : json(401, { reason: "unauthorized" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await deleteOwnReport(ID, "own")).toEqual({ ok: true, value: true });
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/community/reports/${ID}/delete`);
    const bad = await deleteOwnReport(ID, "nope");
    expect(bad.ok ? null : bad.failure).toBe("unauthorized");
  });
});

describe("reportFailureFor — ทุกคำตอบของ POST /community/reports มีชื่อของมัน", () => {
  it("503: ปิดรับ ≠ ถามบริการยืนยันไม่ได้ ≠ เก็บไม่สำเร็จ ≠ อย่างอื่น", () => {
    expect(reportFailureFor(503, "reporting-disabled")).toBe("disabled");
    expect(reportFailureFor(503, "turnstile-unreachable")).toBe("turnstile-unreachable");
    expect(reportFailureFor(503, "storage-failed")).toBe("storage");
    expect(reportFailureFor(503, undefined)).toBe("server");
  });
  it("429: เพดานรายวันทั้งประเทศ ≠ ตัวจำกัดอัตราต่อ IP (router ไม่ส่ง reason)", () => {
    expect(reportFailureFor(429, "report-cap")).toBe("report-cap");
    expect(reportFailureFor(429, undefined)).toBe("rate-limit");
  });
  it("403: Turnstile ไม่ผ่าน ≠ ด่าน same-origin (ไม่มี reason)", () => {
    expect(reportFailureFor(403, "turnstile-failed")).toBe("turnstile");
    expect(reportFailureFor(403, undefined)).toBe("server");
  });
  it("422 / 413 / 415 / 400", () => {
    expect(reportFailureFor(422, "outside-thailand")).toBe("outside-thailand");
    expect(reportFailureFor(422, "image-metadata")).toBe("image-metadata");
    expect(reportFailureFor(422, "image-invalid")).toBe("image-invalid");
    expect(reportFailureFor(422, "invalid-categories")).toBe("invalid");
    expect(reportFailureFor(422, "description-too-long")).toBe("invalid");
    expect(reportFailureFor(422, "invalid-location")).toBe("invalid");
    expect(reportFailureFor(413, "body-too-large")).toBe("too-large");
    expect(reportFailureFor(413, "image-too-large")).toBe("too-large");
    expect(reportFailureFor(415, "image-type")).toBe("image-type");
    expect(reportFailureFor(400, "bad-request")).toBe("invalid");
    expect(reportFailureFor(500, undefined)).toBe("server");
  });
});

const REPORT = {
  id: ID,
  lat: 13.75,
  lon: 100.5,
  provinceCode: "10",
  categories: ["flood"],
  description: "น้ำท่วมถนน",
  imageUrl: `/api/v1/community/image/${ID}`,
  createdAt: "2026-09-27T10:00:00.000Z",
  up: 0,
  down: 0,
};

const draft = (image: Blob | null = null): ReportDraft => ({
  lat: 13.7512345678,
  lon: 100.4987654321,
  categories: ["flood", "road-blocked"],
  description: "น้ำท่วมถนน",
  image,
});

describe("buildReportForm — ฟิลด์ตามที่ parseReportFields ของ API อ่าน", () => {
  it("lat/lon ทศนิยม 6 ตำแหน่ง, หมวดเป็นฟิลด์ซ้ำ, token, ไม่แนบรูป = ไม่มีฟิลด์ image", () => {
    const f = buildReportForm(draft(), "ts");
    expect(f.get("lat")).toBe("13.751235");
    expect(f.get("lon")).toBe("100.498765");
    expect(f.getAll("categories")).toEqual(["flood", "road-blocked"]);
    expect(f.get("description")).toBe("น้ำท่วมถนน");
    expect(f.get("turnstileToken")).toBe("ts");
    expect(f.has("image")).toBe(false);
  });
  it("แนบรูป = ไฟล์ชื่อตามชนิด", () => {
    const webp = buildReportForm(draft(new Blob([new Uint8Array(4)], { type: "image/webp" })), "ts").get("image");
    const jpg = buildReportForm(draft(new Blob([new Uint8Array(4)], { type: "image/jpeg" })), "ts").get("image");
    expect(webp instanceof File && webp.name).toBe("photo.webp");
    expect(jpg instanceof File && jpg.name).toBe("photo.jpg");
  });
});

describe("submitReport — POST เดียวต่อการกดส่ง ไม่ลองซ้ำ", () => {
  it("201 = รายงาน + ownerToken", async () => {
    const fetchMock = vi.fn(async () => json(201, { report: REPORT, ownerToken: "own" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await submitReport(draft(), "ts");
    expect(res).toEqual({ ok: true, value: { report: REPORT, ownerToken: "own" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/community/reports");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("4xx/5xx ถูกแปลตาม reason และถามครั้งเดียวเท่านั้น", async () => {
    const fetchMock = vi.fn(async () => json(503, { error: "x", reason: "reporting-disabled" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await submitReport(draft(), "ts")).toEqual({ ok: false, failure: "disabled", status: 503 });
    vi.stubGlobal("fetch", vi.fn(async () => json(429, { error: "Too many requests", retryAfterSeconds: 12 })));
    expect(await submitReport(draft(), "ts")).toEqual({ ok: false, failure: "rate-limit", status: 429 });
    vi.stubGlobal("fetch", vi.fn(async () => json(422, { error: "x", reason: "outside-thailand" })));
    expect(await submitReport(draft(), "ts")).toEqual({ ok: false, failure: "outside-thailand", status: 422 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("เครือข่ายล้ม = network; 201 รูปร่างผิด (id ผิดรูป / ไม่มี ownerToken) = server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await submitReport(draft(), "ts")).toEqual({ ok: false, failure: "network", status: null });
    vi.stubGlobal("fetch", vi.fn(async () => json(201, { report: { ...REPORT, id: "abc" }, ownerToken: "own" })));
    expect((await submitReport(draft(), "ts")).ok).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => json(201, { report: REPORT })));
    const res = await submitReport(draft(), "ts");
    expect(res.ok ? null : res.failure).toBe("server");
  });
});

