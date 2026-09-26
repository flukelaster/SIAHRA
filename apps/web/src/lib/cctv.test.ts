import { describe, expect, it, vi } from "vitest";
import type { CctvCamera } from "@siahra/shared-types";
import {
  coLocatedCameras,
  distinctLabels,
  DWR_API,
  DWR_LIVE_OBSERVED_LIFETIME_MS,
  DWR_LIVE_STALE_MS,
  dwrLiveUrl,
  isDwrFrameFresh,
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

describe("dwrLiveUrl", () => {
  it("points at DWR's MJPEG stream with a cache-busting counter", () => {
    expect(dwrLiveUrl("TC020106", 3)).toBe(`${DWR_API}/public/cctv/mjpegStream?stnCode=TC020106&_=3`);
    expect(dwrLiveUrl("A B", 1)).toContain("stnCode=A%20B");
  });
});

describe("nearestCamera across sources", () => {
  it("works on any catalogue with lat/lon (iTIC road cameras too)", () => {
    const road = [
      { id: "far", lat: 13.9, lon: 100.9 },
      { id: "near", lat: 13.701, lon: 100.501 },
    ];
    expect(nearestCamera(13.7, 100.5, road)?.camera.id).toBe("near");
    expect(nearestCamera(15, 102, road)).toBeNull();
  });
});

describe("isDwrFrameFresh (DWR live badge)", () => {
  it("is live only while a new frame was seen within the stale window", () => {
    expect(isDwrFrameFresh(10_000, null, true)).toBe(false);
    expect(isDwrFrameFresh(10_000, 10_000 - DWR_LIVE_STALE_MS, true)).toBe(true);
    expect(isDwrFrameFresh(10_001, 10_000 - DWR_LIVE_STALE_MS, true)).toBe(false);
  });

  it("falls back to the observed stream lifetime when only the first frame is observable", () => {
    const first = 1_000;
    expect(isDwrFrameFresh(first + DWR_LIVE_STALE_MS + 1, first, false)).toBe(true);
    expect(isDwrFrameFresh(first + DWR_LIVE_OBSERVED_LIFETIME_MS, first, false)).toBe(true);
    expect(isDwrFrameFresh(first + DWR_LIVE_OBSERVED_LIFETIME_MS + 1, first, false)).toBe(false);
  });
});

describe("coLocatedCameras", () => {
  // คู่จริงจากบัญชี iTIC: DOH-PER-3-006 ขาเข้า/ขาออก (~22 ม.) และ ITICM_BMAMI0164–0166 (≤ ~140 ม.)
  const cams = [
    { id: "DOH-PER-3-006-out", lat: 13.8302, lon: 100.4132 },
    { id: "far", lat: 13.84, lon: 100.4132 },
    { id: "DOH-PER-3-006", lat: 13.83, lon: 100.4132 },
    { id: "ITICM_BMAMI0164", lat: 13.828648681903177, lon: 100.52881854153176 },
    { id: "ITICM_BMAMI0165", lat: 13.827772016676931, lon: 100.52787985034071 },
    { id: "ITICM_BMAMI0166", lat: 13.828683279709187, lon: 100.52784892246397 },
    { id: "b-twin", lat: 13.9, lon: 100.6 },
    { id: "a-twin", lat: 13.9, lon: 100.6 },
    { id: "c-twin", lat: 13.9, lon: 100.6 },
  ];

  it("puts the picked camera first and includes a same-spot twin, excluding one ~1 km away", () => {
    expect(coLocatedCameras(cams[2], cams).map((c) => c.id)).toEqual(["DOH-PER-3-006", "DOH-PER-3-006-out"]);
    expect(coLocatedCameras(cams[0], cams).map((c) => c.id)).toEqual(["DOH-PER-3-006-out", "DOH-PER-3-006"]);
  });

  it("groups the three Wong Sawang cameras from any one of them, nearest first", () => {
    expect(coLocatedCameras(cams[3], cams).map((c) => c.id)).toEqual([
      "ITICM_BMAMI0164",
      "ITICM_BMAMI0166",
      "ITICM_BMAMI0165",
    ]);
  });

  it("orders equal distances by id and returns only itself when alone", () => {
    expect(coLocatedCameras(cams[6], cams).map((c) => c.id)).toEqual(["b-twin", "a-twin", "c-twin"]);
    expect(coLocatedCameras(cams[1], cams).map((c) => c.id)).toEqual(["far"]);
  });

  it("excludes a camera just past the radius", () => {
    // 0.002° ละติจูด ≈ 222 ม. > 150 ม.
    const pair = [
      { id: "x", lat: 13, lon: 100 },
      { id: "y", lat: 13.002, lon: 100 },
    ];
    expect(coLocatedCameras(pair[0], pair)).toHaveLength(1);
  });
});

describe("distinctLabels", () => {
  it("drops the shared prefix at a word boundary", () => {
    expect(
      distinctLabels([
        "(จ.นนทบุรี) ถ.กาญจนาภิเษก บางใหญ่ ทิศทางมุ่งหน้าบางแค",
        "(จ.นนทบุรี) ถ.กาญจนาภิเษก บางใหญ่ ทิศทางมุ่งหน้าบางบัวทอง",
      ]),
    ).toEqual(["…ทิศทางมุ่งหน้าบางแค", "…ทิศทางมุ่งหน้าบางบัวทอง"]);
    expect(
      distinctLabels(["(กรุงเทพมหานคร) รัชดาภิเษก-วงศ์สว่าง", "(กรุงเทพมหานคร) Big C วงศ์สว่าง"]),
    ).toEqual(["…รัชดาภิเษก-วงศ์สว่าง", "…Big C วงศ์สว่าง"]);
  });

  it("keeps full names when no whole word is shared, or when alone", () => {
    expect(distinctLabels(["A cam", "B cam"])).toEqual(["A cam", "B cam"]);
    expect(distinctLabels(["Road", "Road out"])).toEqual(["Road", "Road out"]);
    // ชื่อหนึ่งเป็นคำนำหน้าของอีกชื่อ — ยังเหลือคำสุดท้ายที่ต่างกันให้อ่าน
    expect(distinctLabels(["Road 1", "Road 1 out"])).toEqual(["…1", "…1 out"]);
    expect(distinctLabels(["Solo"])).toEqual(["Solo"]);
  });
});
