import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GISTDA_FLOOD_WINDOW,
  GISTDA_PAGE_LIMIT,
  GistdaAuthError,
  GistdaBudgetError,
  fetchGistdaProvince,
  gistdaApiKey,
  gistdaPageUrl,
  parseGistdaFileName,
  projectGistdaFeature,
  redactKey,
} from "../../src/ingestion/gistda";
import { UpstreamShapeError } from "../../src/ingestion/errors";
import gistdaFixture from "../fixtures/gistda-api-page.json";
import { TEST_GISTDA_KEY, gistdaCalls, gistdaCell, serveGistda } from "../helpers/gistdaApi";

/**
 * E16.PR0 — GISTDA API gateway (แทน WFS ที่ตอบ 401 ตั้งแต่ 2026-09-10)
 *
 * กับดักของต้นทางนี้:
 *   - `links[].href` สะท้อนกุญแจกลับมาเป็น `?api_key=` → ห้ามตาม ห้ามเก็บ
 *   - กุญแจต้องไปทาง header `API-Key` เท่านั้น (`X-API-Key` ได้ 407)
 *   - `file_name` = `sensor_YYYYMMDD_HHMM` ไม่มีเขตเวลา → อ่านเป็นเวลาไทย (+07:00)
 *   - property มีมากกว่าที่เราเก็บ (population, building, mongo_id …) → allowlist เท่านั้น
 *   - พิกัดยาว 14–15 หลักทศนิยม → ปัดเหลือ FLOOD_EXTENT_COORD_DECIMALS
 */
afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseGistdaFileName", () => {
  it("อ่านทุกภาพเป็นเวลาไทย เรียงใหม่สุดก่อน ไม่ซ้ำ", () => {
    expect(parseGistdaFileName("rd2_20260926_0613, S1C_20260921_0558, S1D_20260922_1819, rd2_20260926_0613")).toEqual([
      { sensor: "rd2", acquiredAt: "2026-09-25T23:13:00.000Z" },
      { sensor: "S1D", acquiredAt: "2026-09-22T11:19:00.000Z" },
      { sensor: "S1C", acquiredAt: "2026-09-20T22:58:00.000Z" },
    ]);
  });

  it("หลักฐานเขตเวลา: S1D_20260920_0607 = ฉาก GFM 20260919T230750Z (ทศนิยมนาทีตรงกัน)", () => {
    expect(parseGistdaFileName("S1D_20260920_0607")[0]!.acquiredAt).toBe("2026-09-19T23:07:00.000Z");
  });

  it("โทเค็นที่อ่านไม่ออก/วันที่ไม่มีจริงถูกข้าม ไม่ถูกเดาเวลา", () => {
    expect(parseGistdaFileName("garbage, S1C_20260230_0600, S1C_20260921_2561, rd2_2026092_0613")).toEqual([]);
    expect(parseGistdaFileName(null)).toEqual([]);
    expect(parseGistdaFileName("")).toEqual([]);
  });
});

describe("projectGistdaFeature", () => {
  it("เก็บเฉพาะ allowlist + ปัดพิกัด ≤ 4 ตำแหน่ง (ของจริงจาก pv_idn=14)", () => {
    const f = projectGistdaFeature(gistdaFixture.features[0], 0)!;
    expect(f.id).toBe("8964a400203ffff");
    expect(Object.keys(f.properties).sort()).toEqual(
      [
        "acquisitions",
        "amphoeCode",
        "amphoeTh",
        "floodAreaM2",
        "h3",
        "observedAt",
        "provinceCode",
        "provinceTh",
        "publishedAt",
        "tambonCode",
        "tambonTh",
      ].sort(),
    );
    expect(f.properties).toMatchObject({
      h3: "8964a400203ffff",
      provinceCode: "14",
      amphoeCode: "1411",
      tambonCode: "141104",
      tambonTh: "ต.ลำไทร",
      floodAreaM2: 11315.9,
      observedAt: "2026-09-25T23:13:00.000Z",
      publishedAt: "2026-09-26T06:51:21.687Z",
    });
    const text = JSON.stringify(f);
    for (const banned of ["population", "building", "hospital", "mongo_id", "_id", "rice_area", "api_key", "links"]) {
      expect(text).not.toContain(banned);
    }
    const coords = (f.geometry.coordinates as number[][][][]).flat(3);
    expect(coords.length).toBeGreaterThan(0);
    for (const c of coords) expect(Math.abs(c * 1e4 - Math.round(c * 1e4))).toBeLessThan(1e-6);
    // วงปิดเสมอ และไม่มีจุดซ้ำติดกันหลังปัด
    const ring = (f.geometry.coordinates as number[][][][])[0]![0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (let i = 1; i < ring.length; i++) expect(ring[i]).not.toEqual(ring[i - 1]);
  });

  it("เซลล์ที่ยุบหายตอนปัด ได้ coordinates [] ไม่ถูกทิ้ง (จำนวน/พื้นที่ยังตรงกับต้นทาง)", () => {
    const tiny = gistdaCell({ h3: "89tiny", province: "14" });
    (tiny.geometry as { coordinates: unknown }).coordinates = [
      [[[100.00001, 14.00001], [100.00002, 14.00001], [100.00002, 14.00002], [100.00001, 14.00001]]],
    ];
    const f = projectGistdaFeature(tiny, 0)!;
    expect(f.geometry).toEqual({ type: "MultiPolygon", coordinates: [] });
    expect(f.properties.floodAreaM2).toBe(12345.7);
  });

  it("feature ที่ไม่ใช่รูปทรงพื้นที่ หรือไม่มี h3 ถูกข้าม", () => {
    const point = { ...gistdaCell({ h3: "89p", province: "14" }), geometry: { type: "Point", coordinates: [100, 14] } };
    expect(projectGistdaFeature(point, 0)).toBeNull();
    const noH3 = gistdaCell({ h3: "", province: "14" });
    expect(projectGistdaFeature(noH3, 0)).toBeNull();
  });
});

describe("gistdaPageUrl / key handling", () => {
  it("URL มีแค่ pv_idn/limit/offset ของหน้าต่างที่เลือก ไม่มีกุญแจ", () => {
    const url = new URL(gistdaPageUrl("14", 2000));
    expect(url.pathname.endsWith(`/flood/${GISTDA_FLOOD_WINDOW}`)).toBe(true);
    expect(Object.fromEntries(url.searchParams)).toEqual({ pv_idn: "14", limit: String(GISTDA_PAGE_LIMIT), offset: "2000" });
  });

  it("gistdaApiKey: ว่าง/ช่องว่าง = ไม่มีกุญแจ", () => {
    expect(gistdaApiKey({})).toBeNull();
    expect(gistdaApiKey({ GISTDA_API_KEY: "  " })).toBeNull();
    expect(gistdaApiKey({ GISTDA_API_KEY: " k " })).toBe("k");
  });

  it("redactKey ลบกุญแจทุกตำแหน่ง", () => {
    expect(redactKey(`a ${TEST_GISTDA_KEY} b ${TEST_GISTDA_KEY}`, TEST_GISTDA_KEY)).toBe("a [redacted] b [redacted]");
  });
});

describe("fetchGistdaProvince", () => {
  const cells = (n: number) =>
    Array.from({ length: n }, (_, i) => gistdaCell({ h3: `89${String(i).padStart(6, "0")}`, province: "60", lon: 100 + i * 0.01 }));

  it("เลื่อน offset จน numberReturned < limit — 2,500 เซลล์ = 3 หน้า (0/1000/2000)", async () => {
    serveGistda({ "60": cells(2500) });
    const pull = await fetchGistdaProvince("60", TEST_GISTDA_KEY, { attempts: 1 });
    expect(pull.matched).toBe(2500);
    expect(pull.features).toHaveLength(2500);
    const calls = gistdaCalls();
    expect(calls.map((c) => new URL(c.url).searchParams.get("offset"))).toEqual(["0", "1000", "2000"]);
    // กุญแจไปทาง header เท่านั้น และไม่เคยอยู่ใน URL
    for (const c of calls) {
      expect(c.headers.get("API-Key")).toBe(TEST_GISTDA_KEY);
      expect(c.headers.get("X-API-Key")).toBeNull();
      expect(c.url).not.toContain("api_key");
      expect(c.url).not.toContain(TEST_GISTDA_KEY);
    }
    // links[].href (ที่มีกุญแจ) ไม่ถูกตาม — ทุก URL ประกอบจาก offset เอง
    expect(JSON.stringify(pull)).not.toContain(TEST_GISTDA_KEY);
    expect(JSON.stringify(pull)).not.toContain("api_key");
  });

  it("หยุดที่ offset ≥ numberMatched แม้หน้าเต็ม (ไม่ยิงหน้าว่างเกิน)", async () => {
    serveGistda({ "60": cells(1000) });
    await fetchGistdaProvince("60", TEST_GISTDA_KEY, { attempts: 1 });
    expect(gistdaCalls()).toHaveLength(1);
  });

  it("เซลล์ซ้ำข้ามหน้า (ต้นทางสร้างชุดใหม่ระหว่างเลื่อน offset) นับครั้งเดียว เรียงตาม h3", async () => {
    const list = cells(1500);
    list[1200] = list[3]!;
    serveGistda({ "60": list });
    const pull = await fetchGistdaProvince("60", TEST_GISTDA_KEY, { attempts: 1 });
    expect(pull.features).toHaveLength(1499);
    const ids = pull.features.map((f) => f.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("0 เซลล์ = คำตอบจริงที่ว่าง (matched 0) ไม่ใช่ error", async () => {
    serveGistda({});
    const pull = await fetchGistdaProvince("10", TEST_GISTDA_KEY, { attempts: 1 });
    expect(pull).toEqual({ provinceCode: "10", matched: 0, features: [] });
  });

  it.each([401, 403, 407])("HTTP %i → GistdaAuthError ไม่ retry และข้อความไม่มี body ของต้นทาง", async (status) => {
    serveGistda({}, { status: () => status });
    const err = await fetchGistdaProvince("14", TEST_GISTDA_KEY, { attempts: 3 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GistdaAuthError);
    expect(String(err)).not.toContain(TEST_GISTDA_KEY);
    expect(String(err)).not.toContain("upstream said no");
    expect(gistdaCalls()).toHaveLength(1);
  });

  it("HTTP 500 → error ที่มีแค่ status (body ที่มีกุญแจไม่ถูกคัดลอก)", async () => {
    serveGistda({}, { status: () => 500 });
    const err = await fetchGistdaProvince("14", TEST_GISTDA_KEY, { attempts: 1 }).catch((e: unknown) => e);
    expect(String(err)).toContain("HTTP 500");
    expect(String(err)).not.toContain(TEST_GISTDA_KEY);
  });

  /** นาฬิกาปลอม: Date.now() จริง + skew ที่เทสเลื่อนได้กลางรอบ */
  function fakeClock(): { advance: (ms: number) => void } {
    const real = Date.now.bind(Date);
    let skew = 0;
    vi.spyOn(Date, "now").mockImplementation(() => real() + skew);
    return { advance: (ms) => (skew += ms) };
  }

  it("deadline ผ่านไปแล้ว → GistdaBudgetError ก่อนยิงหน้าแรก (ไม่มีคำขอเลย)", async () => {
    serveGistda({ "60": cells(10) });
    const err = await fetchGistdaProvince("60", TEST_GISTDA_KEY, { attempts: 1, deadlineMs: Date.now() - 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GistdaBudgetError);
    expect(gistdaCalls()).toHaveLength(0);
  });

  it("หมดงบระหว่างหน้า → หยุดก่อนหน้าถัดไป ไม่คืนผลครึ่ง ๆ กลาง ๆ", async () => {
    const clock = fakeClock();
    // matched() ถูกเรียกหนึ่งครั้งต่อหน้าที่ตอบ — เลื่อนนาฬิกาเลย deadline หลังหน้าแรก
    serveGistda({ "60": cells(2500) }, { matched: (_p, n) => (clock.advance(120_000), n) });
    const err = await fetchGistdaProvince("60", TEST_GISTDA_KEY, { attempts: 1, deadlineMs: Date.now() + 60_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GistdaBudgetError);
    expect(gistdaCalls().map((c) => new URL(c.url).searchParams.get("offset"))).toEqual(["0"]);
  });

  it("หมดงบระหว่าง retry → ไม่ยิง attempt ถัดไป", async () => {
    const clock = fakeClock();
    serveGistda({}, { status: () => (clock.advance(120_000), 503) });
    const err = await fetchGistdaProvince("14", TEST_GISTDA_KEY, { attempts: 3, deadlineMs: Date.now() + 60_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GistdaBudgetError);
    expect(gistdaCalls()).toHaveLength(1);
  });

  it("{} ไม่กลายเป็นจังหวัดว่าง และ JSON ที่ขาดกลางไม่คัดลอกเศษ body", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}"));
    await expect(fetchGistdaProvince("14", TEST_GISTDA_KEY, { attempts: 3 })).rejects.toBeInstanceOf(UpstreamShapeError);
    vi.restoreAllMocks();
    const truncated = JSON.stringify(gistdaFixture).slice(0, 900);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(truncated));
    const err = await fetchGistdaProvince("14", TEST_GISTDA_KEY, { attempts: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamShapeError);
    expect(String(err)).toContain("<body>");
    expect(String(err)).not.toContain("api_key");
  });
});
