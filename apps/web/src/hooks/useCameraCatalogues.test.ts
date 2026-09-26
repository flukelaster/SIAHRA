import { describe, expect, it } from "vitest";
import type { Camera, CameraCatalogue } from "@siahra/shared-types";
import { loadCatalogue, mergeCatalogues } from "./useCameraCatalogues";

function cam(sourceId: Camera["sourceId"], id: string): Camera {
  return {
    id,
    sourceId,
    nameTh: null,
    nameEn: null,
    lat: 13.7,
    lon: 100.5,
    coordSource: "upstream",
    provinceCode: null,
    owner: null,
    code: null,
    placeTh: null,
    streams: [],
  };
}

function catalogue(sourceId: Camera["sourceId"], ids: string[]): CameraCatalogue {
  return {
    sourceId,
    builtAt: "2026-09-26T13:30:24.656Z",
    sourceUrl: "https://example.test/",
    probedAt: null,
    probeVantage: null,
    cameras: ids.map((id) => cam(sourceId, id)),
  };
}

describe("mergeCatalogues", () => {
  it("รวมตามลำดับ CAMERA_SOURCE_IDS (dwr ก่อน itic) ไม่ใช่ลำดับที่โหลดเสร็จ และข้ามแหล่งที่ยังไม่มี", () => {
    const merged = mergeCatalogues({ "itic-cctv": catalogue("itic-cctv", ["b"]), "dwr-cctv": catalogue("dwr-cctv", ["a"]) });
    expect(merged.map((c) => `${c.sourceId}:${c.id}`)).toEqual(["dwr-cctv:a", "itic-cctv:b"]);
    expect(mergeCatalogues({ "itic-cctv": catalogue("itic-cctv", ["b"]), "dwr-cctv": null }).map((c) => c.id)).toEqual(["b"]);
    expect(mergeCatalogues({})).toEqual([]);
  });
});

describe("loadCatalogue", () => {
  const json = (body: unknown, status = 200, type = "application/json") =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": type } });
  const fetchOf = (res: Response) => (async () => res) as unknown as typeof fetch;
  const signal = () => new AbortController().signal;

  it("คืนบัญชีเมื่อ sourceId ในไฟล์ตรงกับที่ขอ", async () => {
    const cat = catalogue("dwr-cctv", ["a"]);
    expect(await loadCatalogue("dwr-cctv", signal(), fetchOf(json(cat)))).toEqual(cat);
  });

  it("sourceId ไม่ตรง = พังเฉพาะแหล่งนั้น (ไฟล์ของ itic ที่ถูกวางไว้ใต้ชื่อ dwr ถูกปฏิเสธ)", async () => {
    await expect(loadCatalogue("dwr-cctv", signal(), fetchOf(json(catalogue("itic-cctv", ["b"]))))).rejects.toThrow(/sourceId mismatch/);
    // แหล่งอื่นยังโหลดได้ตามปกติ — การพังไม่ลามข้ามแหล่ง
    expect((await loadCatalogue("itic-cctv", signal(), fetchOf(json(catalogue("itic-cctv", ["b"]))))).cameras).toHaveLength(1);
  });

  it("SPA fallback (200 text/html), HTTP error และรูปผิดถูกปฏิเสธ", async () => {
    await expect(loadCatalogue("dwr-cctv", signal(), fetchOf(json({}, 200, "text/html")))).rejects.toThrow(/not JSON/);
    await expect(loadCatalogue("dwr-cctv", signal(), fetchOf(json({}, 404)))).rejects.toThrow(/HTTP 404/);
    await expect(loadCatalogue("dwr-cctv", signal(), fetchOf(json({ sourceId: "dwr-cctv" })))).rejects.toThrow(/malformed/);
  });
});
