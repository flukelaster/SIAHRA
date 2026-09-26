import { describe, expect, it, vi } from "vitest";
import type { CctvCamera } from "@siahra/shared-types";
import {
  DWR_API,
  fetchSnapshot,
  freshness,
  nearestCamera,
  parseSnapshotPath,
  SnapshotCache,
  type SnapshotDeps,
} from "./cctv";

describe("parseSnapshotPath", () => {
  it("reads the path as Thai time (+07:00)", () => {
    expect(parseSnapshotPath("/TC020106/2026/9/26/7_17.jpg")).toBe("2026-09-26T07:17:00+07:00");
    expect(Date.parse(parseSnapshotPath("/TC020106/2026/9/26/7_17.jpg")!)).toBe(Date.parse("2026-09-26T00:17:00Z"));
    expect(parseSnapshotPath("/TA020510/2026/12/1/23_5.jpg")).toBe("2026-12-01T23:05:00+07:00");
  });

  it("returns null for anything it cannot read — never a made-up time", () => {
    expect(parseSnapshotPath("")).toBeNull();
    expect(parseSnapshotPath("/TC020106/2026/9/26/latest.jpg")).toBeNull();
    expect(parseSnapshotPath("/TC020106/2026/2/31/7_17.jpg")).toBeNull();
    expect(parseSnapshotPath("/TC020106/2026/9/26/24_00.jpg")).toBeNull();
    expect(parseSnapshotPath("/TC020106/2026/13/1/7_17.jpg")).toBeNull();
  });
});

describe("freshness", () => {
  const obs = "2026-09-26T07:00:00+07:00";
  const t0 = Date.parse(obs);
  it("fresh ≤ 45 min, stale ≤ 24 h, old beyond", () => {
    expect(freshness(obs, t0 + 45 * 60000, "en")?.level).toBe("fresh");
    expect(freshness(obs, t0 + 46 * 60000, "en")?.level).toBe("stale");
    expect(freshness(obs, t0 + 24 * 3600000, "en")?.level).toBe("stale");
    expect(freshness(obs, t0 + 24 * 3600000 + 1, "en")?.level).toBe("old");
  });
  it("labels the age", () => {
    expect(freshness(obs, t0 + 20 * 60000, "en")?.label).toBe("20 min ago");
  });
  it("a capture time slightly ahead of this clock is fresh, age 0 — not 'soon'", () => {
    const f = freshness(obs, t0 - 4 * 60000, "en");
    expect(f?.level).toBe("fresh");
    expect(f?.ageMs).toBe(0);
    expect(f?.label).not.toMatch(/soon/i);
  });
  it("unparsable time → null", () => {
    expect(freshness("nope", t0, "th")).toBeNull();
  });
});

describe("nearestCamera", () => {
  const cam = (id: string, lat: number, lon: number): CctvCamera => ({
    id,
    stationCode: id,
    nameTh: null,
    nameEn: null,
    lat,
    lon,
    provinceCode: null,
    amphoeTh: null,
  });
  const cams = [cam("far", 13.8, 100.5), cam("near", 13.71, 100.5), cam("nearer", 13.705, 100.5)];
  it("picks the closest within maxKm", () => {
    const r = nearestCamera(13.7, 100.5, cams);
    expect(r?.camera.id).toBe("nearer");
    expect(r?.distanceKm).toBeCloseTo(0.556, 2);
  });
  it("null when none is within range", () => {
    expect(nearestCamera(15, 100.5, cams)).toBeNull();
    expect(nearestCamera(13.7, 100.5, cams, 0.1)).toBeNull();
  });
});

function deps(responses: (Response | Error)[]): SnapshotDeps & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      const r = responses[i++];
      if (r instanceof Error) throw r;
      return r;
    }) as typeof fetch,
    createObjectURL: () => "blob:fake-1",
    now: () => Date.parse("2026-09-26T00:30:00Z"),
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const jpeg = () => new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), { status: 200 });

describe("fetchSnapshot", () => {
  const signal = () => new AbortController().signal;

  it("GET path → POST image → object URL, observedAt from the path", async () => {
    const d = deps([json({ value: "/TC020106/2026/9/26/7_17.jpg" }), jpeg()]);
    const r = await fetchSnapshot("abc", signal(), d);
    expect(r).toEqual({
      kind: "ok",
      blobUrl: "blob:fake-1",
      observedAt: "2026-09-26T07:17:00+07:00",
      fetchedAt: "2026-09-26T00:30:00.000Z",
    });
    expect(d.calls).toEqual([
      `GET ${DWR_API}/public/reportCctv/snapshot/abc`,
      `POST ${DWR_API}/file/image/cctv`,
    ]);
  });

  it("DWR answered with no snapshot → no-image (not unreachable)", async () => {
    expect(await fetchSnapshot("abc", signal(), deps([json({ value: null })]))).toEqual({ kind: "no-image" });
    expect(await fetchSnapshot("abc", signal(), deps([json({ value: "/X/2026/9/26/7_17.jpg" }), new Response(null, { status: 404 })]))).toEqual({
      kind: "no-image",
    });
  });

  it("network/CORS failure or 5xx → unreachable (could not ask DWR)", async () => {
    expect((await fetchSnapshot("abc", signal(), deps([new TypeError("Failed to fetch")]))).kind).toBe("unreachable");
    expect((await fetchSnapshot("abc", signal(), deps([json({}, 503)]))).kind).toBe("unreachable");
    expect(
      (await fetchSnapshot("abc", signal(), deps([json({ value: "/X/2026/9/26/7_17.jpg" }), new Response("", { status: 502 })]))).kind,
    ).toBe("unreachable");
  });

  it("an aborted request rethrows instead of reporting DWR as unreachable", async () => {
    const c = new AbortController();
    c.abort();
    await expect(fetchSnapshot("abc", c.signal, deps([new DOMException("Aborted", "AbortError")]))).rejects.toThrow();
  });
});

describe("SnapshotCache", () => {
  const snap = (url: string) => ({ kind: "ok" as const, blobUrl: url, observedAt: null, fetchedAt: "x" });

  it("revokes on TTL expiry, replacement, overflow and clear", () => {
    let now = 0;
    const revoke = vi.fn();
    const cache = new SnapshotCache({ ttlMs: 1000, maxEntries: 2, now: () => now, revoke });
    cache.set("a", snap("blob:a1"));
    expect(cache.get("a")?.blobUrl).toBe("blob:a1");
    cache.set("a", snap("blob:a2"));
    expect(revoke).toHaveBeenLastCalledWith("blob:a1");
    now = 1001;
    expect(cache.get("a")).toBeNull();
    expect(revoke).toHaveBeenLastCalledWith("blob:a2");
    cache.set("b", snap("blob:b"));
    cache.set("c", snap("blob:c"));
    cache.set("d", snap("blob:d"));
    expect(revoke).toHaveBeenLastCalledWith("blob:b");
    cache.clear();
    expect(cache.size).toBe(0);
    expect(revoke.mock.calls.map((c) => c[0]).sort()).toEqual(["blob:a1", "blob:a2", "blob:b", "blob:c", "blob:d"]);
  });
});
