import { env, exports as workerExports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { PROVINCE_CODES, type FloodExtentResponse, type FloodExtentSummaryResponse } from "@siahra/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../src/types";
import { TEST_GISTDA_KEY, gistdaCalls, gistdaCell, serveGistda, setGistdaKey } from "./helpers/gistdaApi";

/**
 * E16.PR0 — FloodExtentDO บน GISTDA API gateway ครบวง
 *
 * สิ่งที่ไฟล์นี้ยึด (devops constraints):
 *   1. ต้นทางถูกยิง **เฉพาะใน alarm()** — ensureFresh()/คำขอ ไม่ยิงเลย
 *   3/4. คำตอบ live มาจากหน่วยความจำ/R2 ที่ serialise ไว้ สรุปมาจาก meta แถวเดียว
 *   5/6. archive + แถว PK เฉพาะจังหวัดที่ hash เปลี่ยน, ?at= หาด้วย PK
 *   10. ไม่มีกุญแจ = ไม่ยิงเลย + สถานะบอกชื่อ secret; กุญแจไม่หลุดไปที่ไหน
 * และความซื่อตรง: จังหวัดที่ต้นทางตอบ 0 เซลล์ ≠ "ยังไม่เคยถาม"
 *
 * storage ของ DO อยู่ยาวข้าม block ในไฟล์เดียวกัน — แต่ละ describe ใช้ชื่อ instance ของตัวเอง
 */
const appEnv = env as unknown as AppEnv;

afterEach(() => {
  vi.restoreAllMocks();
  setGistdaKey(undefined);
});

async function gunzipText(gz: ArrayBuffer): Promise<string> {
  return new Response(new Response(gz).body!.pipeThrough(new DecompressionStream("gzip"))).text();
}

/** อ็อบเจกต์ R2 ของรอบหนึ่ง — R2 ใช้ร่วมกันทุก instance ในไฟล์ จึงนับตามโฟลเดอร์เวลาของรอบ */
async function objectsAt(ms: number): Promise<string[]> {
  const folder = new Date(ms).toISOString().replace(/[:.]/g, "-");
  return (await env.HAZARD_BUCKET.list({ prefix: `archive/flood-v2/${folder}/` })).objects.map((o) => o.key);
}

const bodyOf = async (gz: ArrayBuffer) => JSON.parse(await gunzipText(gz)) as FloodExtentResponse;

function rows(ctx: DurableObjectState): { province_code: string; retrieved_ms: number; r2_key: string; content_hash: string }[] {
  return ctx.storage.sql
    .exec<{ province_code: string; retrieved_ms: number; r2_key: string; content_hash: string }>(
      "SELECT province_code, retrieved_ms, r2_key, content_hash FROM flood_province_scenes ORDER BY retrieved_ms, province_code",
    )
    .toArray();
}

function metaOf(ctx: DurableObjectState, key: string): string | null {
  return ctx.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value ?? null;
}

const CELLS_14 = [
  gistdaCell({ h3: "8964a400203ffff", province: "14", tambon: 141104, area: 11315.9, lon: 100.62 }),
  gistdaCell({ h3: "8964a400207ffff", province: "14", tambon: 141104, area: 9000, lon: 100.63 }),
  gistdaCell({ h3: "8964a40020bffff", province: "14", tambon: 141105, area: 5000, lon: 100.64 }),
];

describe("ไม่มี GISTDA_API_KEY", () => {
  it("alarm ไม่ยิงต้นทางเลย และ status บอกชื่อ secret (down ไม่ใช่ 'ไม่มีน้ำท่วม')", async () => {
    setGistdaKey(undefined);
    serveGistda({ "14": CELLS_14 });
    const stub = appEnv.FLOOD_EXTENT.getByName("no-key");
    await runInDurableObject(stub, (i) => i.alarm());
    expect(gistdaCalls()).toHaveLength(0);
    const status = await runInDurableObject(stub, (i) => i.status());
    expect(status.health).toBe("down");
    expect(status.fetchedAt).toBeNull();
    expect(status.lastError).toContain("GISTDA_API_KEY");
    const body = await runInDurableObject(stub, async (i) => bodyOf((await i.getProvinceBody("14")).gz));
    expect(body.retrievedAt).toBeNull();
    expect(body.layer.fetchedAt).toBeNull();
  });

  it("ค่าว่าง/ช่องว่างถือว่าไม่มีกุญแจ", async () => {
    setGistdaKey("   ");
    serveGistda({});
    const stub = appEnv.FLOOD_EXTENT.getByName("blank-key");
    await runInDurableObject(stub, (i) => i.alarm());
    expect(gistdaCalls()).toHaveLength(0);
    expect((await runInDurableObject(stub, (i) => i.status())).lastError).toContain("GISTDA_API_KEY");
  });
});

describe("alarm-only pull", () => {
  it("ensureFresh() ไม่ยิงต้นทาง — แค่ตั้ง alarm (DO ใหม่: เร็ว ๆ, ยังไม่เคยสำเร็จ: คำขอได้ null + no-store)", async () => {
    setGistdaKey(TEST_GISTDA_KEY);
    serveGistda({ "14": CELLS_14 });
    const stub = appEnv.FLOOD_EXTENT.getByName("alarm-only");
    const before = Date.now();
    await runInDurableObject(stub, (i) => i.ensureFresh());
    await runInDurableObject(stub, (i) => i.ensureFresh());
    await runInDurableObject(stub, (i) => i.getProvinceBody("14"));
    await runInDurableObject(stub, (i) => i.getSummaryBody());
    expect(gistdaCalls()).toHaveLength(0);
    const alarm = await runInDurableObject(stub, (_i, ctx) => ctx.storage.getAlarm());
    expect(alarm).not.toBeNull();
    expect(alarm!).toBeGreaterThanOrEqual(before);
  });

  it("หลังรอบที่สำเร็จ ensureFresh ตั้ง alarm ห่างรอบก่อน ≥ 30 นาที", async () => {
    setGistdaKey(TEST_GISTDA_KEY);
    serveGistda({ "14": CELLS_14 });
    const stub = appEnv.FLOOD_EXTENT.getByName("cadence");
    await runInDurableObject(stub, (i) => i.alarm());
    const lastAttempt = await runInDurableObject(stub, (_i, ctx) => Date.parse(metaOf(ctx, "lastAttemptAt")!));
    await runInDurableObject(stub, async (i, ctx) => {
      await ctx.storage.deleteAlarm();
      await i.ensureFresh();
    });
    const alarm = await runInDurableObject(stub, (_i, ctx) => ctx.storage.getAlarm());
    expect(alarm! - lastAttempt).toBeGreaterThanOrEqual(30 * 60 * 1000);
  });
});

describe("หนึ่งรอบเต็ม 77 จังหวัด", () => {
  const stub = () => appEnv.FLOOD_EXTENT.getByName("full-round");

  beforeEach(() => setGistdaKey(TEST_GISTDA_KEY));

  it("ยิงทีละจังหวัด ครบ 77 ทุกคำขอมีกุญแจใน header เท่านั้น", async () => {
    serveGistda({ "14": CELLS_14 });
    await runInDurableObject(stub(), (i) => i.alarm());
    const calls = gistdaCalls();
    expect(new Set(calls.map((c) => new URL(c.url).searchParams.get("pv_idn")))).toEqual(
      new Set(PROVINCE_CODES.map((c) => String(Number(c)))),
    );
    for (const c of calls) {
      expect(c.headers.get("API-Key")).toBe(TEST_GISTDA_KEY);
      expect(c.url).not.toContain(TEST_GISTDA_KEY);
    }
  });

  it("คำตอบ live: เซลล์พร้อมเวลาภาพจริง, firstSeenAt, layer observed + observedAt/publishedAt จากต้นทาง", async () => {
    const body = await runInDurableObject(stub(), async (i) => bodyOf((await i.getProvinceBody("14")).gz));
    expect(body.retrievedAt).not.toBeNull();
    expect(body.granularity).toBe("h3-cell");
    expect(body.matched).toBe(3);
    expect(body.features.map((f) => f.id)).toEqual(["8964a400203ffff", "8964a400207ffff", "8964a40020bffff"]);
    expect(body.acquisitions).toEqual([
      { sensor: "rd2", acquiredAt: "2026-09-25T23:13:00.000Z" },
      { sensor: "S1D", acquiredAt: "2026-09-22T11:19:00.000Z" },
    ]);
    expect(body.observedAt).toBe("2026-09-25T23:13:00.000Z");
    expect(body.layer).toMatchObject({
      epistemicClass: "observed",
      fetchedAt: body.retrievedAt,
      observedAt: "2026-09-25T23:13:00.000Z",
      // `_createdAt` ใหม่สุด = เวลาที่ GISTDA สร้างระเบียนจริง ไม่ใช่เวลาที่เราดึง
      publishedAt: "2026-09-26T06:51:21.687Z",
      sourceIds: ["gistda-flood"],
    });
    expect(body.features[0]!.properties.firstSeenAt).toBe(body.retrievedAt);
    expect(body.features[0]!.properties.observedAt).toBe("2026-09-25T23:13:00.000Z");
  });

  it("จังหวัดที่ต้นทางตอบ 0 เซลล์: retrievedAt จริง + matched 0 (ถูกถามแล้ว ไม่ใช่ 'ยังไม่เคยถาม')", async () => {
    const body = await runInDurableObject(stub(), async (i) => bodyOf((await i.getProvinceBody("10")).gz));
    expect(body.retrievedAt).not.toBeNull();
    expect(body.matched).toBe(0);
    expect(body.features).toEqual([]);
    expect(body.reason).toBeUndefined();
    expect(body.layer.observedAt).toBeUndefined();
  });

  it("รอบแรก archive ครบ 77 จังหวัด (หนึ่งแถว PK + หนึ่งไฟล์ต่อจังหวัด) ใต้ prefix รุ่นใหม่", async () => {
    const r = await runInDurableObject(stub(), (_i, ctx) => rows(ctx));
    expect(r).toHaveLength(77);
    expect(new Set(r.map((x) => x.retrieved_ms)).size).toBe(1);
    expect((await objectsAt(r[0]!.retrieved_ms)).sort()).toEqual(r.map((x) => x.r2_key).sort());
    expect((await env.HAZARD_BUCKET.list({ prefix: "archive/flood/" })).objects).toHaveLength(0);
  });

  it("รอบที่สองเนื้อหาเดิม → ไม่มีแถว/ไฟล์ใหม่ และ firstSeenAt ถูกยกต่อ ไม่ใช่เวลาใหม่", async () => {
    const first = await runInDurableObject(stub(), async (i) => bodyOf((await i.getProvinceBody("14")).gz));
    serveGistda({ "14": CELLS_14 });
    await runInDurableObject(stub(), (i) => i.alarm());
    const r = await runInDurableObject(stub(), (_i, ctx) => rows(ctx));
    expect(r).toHaveLength(77);
    const second = await runInDurableObject(stub(), async (i) => bodyOf((await i.getProvinceBody("14")).gz));
    expect(await objectsAt(Date.parse(second.retrievedAt!))).toEqual([]);
    expect(Date.parse(second.retrievedAt!)).toBeGreaterThan(Date.parse(first.retrievedAt!));
    expect(second.features[0]!.properties.firstSeenAt).toBe(first.features[0]!.properties.firstSeenAt);
  });

  it("เปลี่ยนเฉพาะจังหวัด 14 (เซลล์ใหม่) → แถวใหม่หนึ่งแถว ไฟล์ใหม่หนึ่งไฟล์; เซลล์ใหม่ได้ firstSeenAt ใหม่", async () => {
    const extra = gistdaCell({ h3: "8964a40020fffff", province: "14", tambon: 141106, area: 700, lon: 100.65 });
    serveGistda({ "14": [...CELLS_14, extra] });
    await runInDurableObject(stub(), (i) => i.alarm());
    const r = await runInDurableObject(stub(), (_i, ctx) => rows(ctx));
    expect(r).toHaveLength(78);
    expect(r[77]!.province_code).toBe("14");
    expect(await objectsAt(r[77]!.retrieved_ms)).toEqual([r[77]!.r2_key]);
    const body = await runInDurableObject(stub(), async (i) => bodyOf((await i.getProvinceBody("14")).gz));
    const old = body.features.find((f) => f.id === "8964a400203ffff")!;
    const added = body.features.find((f) => f.id === "8964a40020fffff")!;
    expect(added.properties.firstSeenAt).toBe(body.retrievedAt);
    expect(Date.parse(old.properties.firstSeenAt!)).toBeLessThan(Date.parse(body.retrievedAt!));
  });

  it("กุญแจและ links ไม่อยู่ใน R2, SQLite หรือคำตอบใด ๆ", async () => {
    const listed = await env.HAZARD_BUCKET.list({ prefix: "archive/flood-v2/" });
    expect(listed.objects.length).toBeGreaterThan(0);
    for (const o of listed.objects) {
      const obj = await env.HAZARD_BUCKET.get(o.key);
      const text = await gunzipText(await obj!.arrayBuffer());
      expect(text).not.toContain(TEST_GISTDA_KEY);
      expect(text).not.toContain("api_key");
      expect(text).not.toContain('"links"');
      expect(text).not.toContain("population");
    }
    const dump = await runInDurableObject(stub(), (_i, ctx) => {
      const out: unknown[] = [];
      for (const t of ["meta", "flood_province_scenes", "flood_scenes"]) out.push(ctx.storage.sql.exec(`SELECT * FROM ${t}`).toArray());
      return JSON.stringify(out);
    });
    expect(dump).not.toContain(TEST_GISTDA_KEY);
    expect(dump).not.toContain("api_key");
    const status = await runInDurableObject(stub(), (i) => i.status());
    expect(JSON.stringify(status)).not.toContain(TEST_GISTDA_KEY);
  });

  it("สรุปมาจาก meta แถวเดียว: numberMatched + พื้นที่รวมต่อจังหวัด, จังหวัด 0 เซลล์อยู่ในรายการ", async () => {
    const { body } = await runInDurableObject(stub(), (i) => i.getSummaryBody());
    const summary = JSON.parse(body) as FloodExtentSummaryResponse;
    expect(summary.retrievedAt).not.toBeNull();
    expect(summary.window).toBe("3days");
    expect(summary.totalFeatures).toBe(4);
    expect(summary.provinces).toHaveLength(77);
    expect(summary.provinces[0]).toMatchObject({ provinceCode: "14", cellCount: 4, tambonCount: 3, floodAreaM2: 26016 });
    expect(summary.provinces.find((p) => p.provinceCode === "10")).toMatchObject({ cellCount: 0, floodAreaM2: 0, observedAt: null });
    expect(summary.failedProvinces).toEqual([]);
    // ชื่อจากทะเบียน 77 จังหวัด — จังหวัด 0 เซลล์ก็มีชื่อ และไม่มีคำนำหน้า "จ." ของ pv_tn ปน
    expect(summary.provinces.find((p) => p.provinceCode === "10")!.provinceTh).toBe("กรุงเทพมหานคร");
    expect(summary.provinces[0]!.provinceTh).toBe("พระนครศรีอยุธยา");
    expect(summary.provinces.every((p) => typeof p.provinceTh === "string" && p.provinceTh.length > 0)).toBe(true);
    const stored = await runInDurableObject(stub(), (_i, ctx) => metaOf(ctx, "summaryBody"));
    expect(stored).toBe(body);
  });

  it("DO ถูก evict: คำตอบ live มาจากไฟล์ R2 ล่าสุด พร้อม retrievedAt ของรอบล่าสุด (hash ตรง)", async () => {
    // อีกหนึ่งรอบเนื้อหาเดิม: ไฟล์ R2 ล่าสุดจึงมี retrievedAt ของรอบก่อน — ต้องถูกต่อท้ายใหม่
    const extra = gistdaCell({ h3: "8964a40020fffff", province: "14", tambon: 141106, area: 700, lon: 100.65 });
    serveGistda({ "14": [...CELLS_14, extra] });
    await runInDurableObject(stub(), (i) => i.alarm());
    const before = await runInDurableObject(stub(), async (i) => bodyOf((await i.getProvinceBody("14")).gz));
    await runInDurableObject(stub(), (i) => {
      (i as unknown as { live: Map<string, unknown> }).live.clear();
    });
    const after = await runInDurableObject(stub(), async (i) => bodyOf((await i.getProvinceBody("14")).gz));
    expect(after).toEqual(before);
    const r = await runInDurableObject(stub(), (_i, ctx) => rows(ctx));
    expect(Date.parse(after.retrievedAt!)).toBeGreaterThan(r[r.length - 1]!.retrieved_ms);
  });

  it("?at= (รุ่นใหม่) → ไฟล์ของรอบที่ครอบเวลานั้น ด้วย PK ต่อจังหวัด", async () => {
    const r = await runInDurableObject(stub(), (_i, ctx) => rows(ctx).filter((x) => x.province_code === "14"));
    expect(r).toHaveLength(2);
    const [older, newer] = r;
    const atOlder = await runInDurableObject(stub(), async (i) => i.getProvinceBody("14", newer!.retrieved_ms - 1));
    expect(atOlder.retrievedAt).toBe(new Date(older!.retrieved_ms).toISOString());
    expect((await bodyOf(atOlder.gz)).features).toHaveLength(3);
    const atNewer = await runInDurableObject(stub(), async (i) => i.getProvinceBody("14", newer!.retrieved_ms + 1));
    expect((await bodyOf(atNewer.gz)).features).toHaveLength(4);
  });
});

describe("จังหวัดล้มบางส่วน / กุญแจถูกปฏิเสธ", () => {
  beforeEach(() => setGistdaKey(TEST_GISTDA_KEY));

  it("จังหวัดที่ล้มคงคำตอบเดิม, status degraded พร้อมชื่อจังหวัด, ไม่มี body ต้นทางใน lastError", async () => {
    const stub = appEnv.FLOOD_EXTENT.getByName("partial");
    serveGistda({ "14": CELLS_14 });
    await runInDurableObject(stub, (i) => i.alarm());
    const before = await runInDurableObject(stub, async (i) => (await i.getProvinceBody("14")).retrievedAt);
    serveGistda({ "14": CELLS_14 }, { status: (p) => (p === "14" ? 503 : undefined) });
    await runInDurableObject(stub, async (i) => {
      await i.alarm();
    });
    const after = await runInDurableObject(stub, async (i) => bodyOf((await i.getProvinceBody("14")).gz));
    expect(after.retrievedAt).toBe(before);
    expect(after.features).toHaveLength(3);
    const status = await runInDurableObject(stub, (i) => i.status());
    expect(status.health).toBe("degraded");
    expect(status.lastError).toContain("14: GISTDA API HTTP 503");
    expect(status.lastError).not.toContain("upstream said no");
    expect(status.lastError).not.toContain(TEST_GISTDA_KEY);
    const summary = JSON.parse((await runInDurableObject(stub, (i) => i.getSummaryBody())).body) as FloodExtentSummaryResponse;
    expect(summary.failedProvinces).toEqual(["14"]);
    expect(summary.provinces.find((p) => p.provinceCode === "14")!.retrievedAt).toBe(before);
  }, 30_000);

  it("401 ที่จังหวัดแรก → หยุดทั้งรอบทันที (ยิงครั้งเดียว) และ backoff", async () => {
    const stub = appEnv.FLOOD_EXTENT.getByName("rejected");
    serveGistda({}, { status: () => 401 });
    await runInDurableObject(stub, (i) => i.alarm());
    expect(gistdaCalls()).toHaveLength(1);
    const status = await runInDurableObject(stub, (i) => i.status());
    expect(status.health).toBe("down");
    expect(status.lastError).toContain("key rejected (HTTP 401)");
    expect(status.lastError).not.toContain(TEST_GISTDA_KEY);
    const next = await runInDurableObject(stub, (_i, ctx) => metaOf(ctx, "nextAttemptAt"));
    expect(Date.parse(next!)).toBeGreaterThan(Date.now());
  });
});

describe("งบเวลาของรอบ (REFRESH_BUDGET_MS)", () => {
  beforeEach(() => setGistdaKey(TEST_GISTDA_KEY));

  it("หมดงบกลางจังหวัด (ระหว่าง retry) → จังหวัดนั้นและที่เหลือ 'ข้าม' คงคำตอบเดิม, รอบจบปกติ, alarm ถูกตั้ง, degraded", async () => {
    const stub = appEnv.FLOOD_EXTENT.getByName("budget");
    serveGistda({ "14": CELLS_14, "20": CELLS_14 });
    await runInDurableObject(stub, (i) => i.alarm());
    const before20 = await runInDurableObject(stub, async (i) => bodyOf((await i.getProvinceBody("20")).gz));
    const before14 = await runInDurableObject(stub, async (i) => bodyOf((await i.getProvinceBody("14")).gz));
    vi.restoreAllMocks();

    // นาฬิกาปลอม: คำขอแรกของจังหวัด 20 กิน 11 นาทีแล้วตอบ 503 — retry ต้องไม่เกิด
    const real = Date.now.bind(Date);
    let skew = 0;
    vi.spyOn(Date, "now").mockImplementation(() => real() + skew);
    const extra = gistdaCell({ h3: "8964a40020fffff", province: "14", tambon: 141106, area: 700, lon: 100.65 });
    serveGistda(
      { "14": [...CELLS_14, extra], "20": [] },
      {
        status: (p) => {
          if (p !== "20") return undefined;
          skew += 11 * 60 * 1000;
          return 503;
        },
      },
    );
    await runInDurableObject(stub, (i) => i.alarm());

    const skipped = PROVINCE_CODES.slice(PROVINCE_CODES.indexOf("20"));
    const calls = gistdaCalls().map((c) => String(Number(new URL(c.url).searchParams.get("pv_idn"))).padStart(2, "0"));
    expect(calls.filter((c) => c === "20")).toHaveLength(1);
    expect(calls.some((c) => skipped.slice(1).includes(c))).toBe(false);

    // จังหวัดก่อนหน้า (14) ได้ของใหม่ — จังหวัดที่ข้ามคงไบต์ของรอบก่อน ไม่ใช่แผนที่ว่าง
    const after14 = await runInDurableObject(stub, async (i) => bodyOf((await i.getProvinceBody("14")).gz));
    expect(after14.features).toHaveLength(4);
    expect(Date.parse(after14.retrievedAt!)).toBeGreaterThan(Date.parse(before14.retrievedAt!));
    const after20 = await runInDurableObject(stub, async (i) => bodyOf((await i.getProvinceBody("20")).gz));
    expect(after20).toEqual(before20);
    expect(after20.features).toHaveLength(3);

    const summary = JSON.parse((await runInDurableObject(stub, (i) => i.getSummaryBody())).body) as FloodExtentSummaryResponse;
    expect(summary.failedProvinces).toEqual(skipped);
    expect(summary.provinces.find((p) => p.provinceCode === "20")!.retrievedAt).toBe(before20.retrievedAt);

    const status = await runInDurableObject(stub, (i) => i.status());
    expect(status.health).toBe("degraded");
    expect(status.lastError).toContain(`${skipped.join(",")}: skipped (time budget)`);
    expect(status.lastError).not.toContain(TEST_GISTDA_KEY);
    // รอบจบแบบสำเร็จบางส่วน: ไม่มีคิว backoff และ alarm ถัดไปถูกตั้งตามรอบปกติ
    const next = await runInDurableObject(stub, (_i, ctx) => metaOf(ctx, "nextAttemptAt"));
    expect(next).toBeNull();
    const alarm = await runInDurableObject(stub, (_i, ctx) => ctx.storage.getAlarm());
    expect(alarm).not.toBeNull();
    expect(alarm! - Date.now()).toBeGreaterThan(20 * 60 * 1000);
  });
});

describe("เส้นทาง HTTP", () => {
  it("live ผ่าน caches.default ≤ 300 วิ; ยังไม่เคยดึง = no-store", async () => {
    setGistdaKey(TEST_GISTDA_KEY);
    const cold = await workerExports.default.fetch(new Request("https://siahra-radar.co/api/v1/provinces/57/flood-extent"));
    expect(cold.headers.get("cache-control")).toBe("no-store");
    expect(((await cold.json()) as FloodExtentResponse).retrievedAt).toBeNull();
    // สรุปที่ยังไม่เคยดึง: no-store และห้ามค้างใน caches.default (คำขอหลัง alarm ต้องเห็นของจริง)
    const coldSummary = await workerExports.default.fetch(new Request("https://siahra-radar.co/api/v1/flood-extent/summary"));
    expect(coldSummary.headers.get("cache-control")).toBe("no-store");
    expect(((await coldSummary.json()) as FloodExtentSummaryResponse).retrievedAt).toBeNull();
    serveGistda({ "14": CELLS_14 });
    await runInDurableObject(appEnv.FLOOD_EXTENT.getByName("gistda"), (i) => i.alarm());
    const res = await workerExports.default.fetch(new Request("https://siahra-radar.co/api/v1/provinces/14/flood-extent"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const body = (await res.json()) as FloodExtentResponse;
    expect(body.features).toHaveLength(3);
    const summary = await workerExports.default.fetch(new Request("https://siahra-radar.co/api/v1/flood-extent/summary"));
    expect(summary.headers.get("cache-control")).toBe("public, max-age=300");
    expect(((await summary.json()) as FloodExtentSummaryResponse).provinces).toHaveLength(77);
  });
});
