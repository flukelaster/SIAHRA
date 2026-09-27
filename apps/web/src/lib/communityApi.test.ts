import { afterEach, describe, expect, it, vi } from "vitest";
import { castVote, deleteOwnReport, failureFor, type VoteDeps } from "./communityApi";

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
