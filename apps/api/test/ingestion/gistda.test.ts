import { afterEach, describe, expect, it, vi } from "vitest";
import { digest, fetchGistdaFloodExtent } from "../../src/ingestion/gistda";
import gistdaFixture from "../fixtures/gistda-wfs.json";
import { respondJson } from "./mockFetch";

/**
 * E5.6 — GISTDA WFS (ฉากพื้นที่น้ำท่วมจากดาวเทียม)
 *
 * กับดักของต้นทางนี้:
 *   - ข้อความไทยมาเป็น **mojibake TIS-620 ที่ถูกอ่านเป็น Latin-1** ("Å¾ºØÃÕ")
 *     ต้องถอดกลับเป็น "ลพบุรี" ไม่ใช่แสดงตามที่ได้มา
 *   - `PV_IDN` เป็นตัวเลข → รหัสจังหวัดต้องเป็นสตริงสองหลักให้ตรงกับที่ UI ใช้
 *   - id ของ feature ("FloodArea_Poly.1") **เปลี่ยนตำแหน่งทุกฉาก** ใช้ไม่ได้ →
 *     คีย์ของเราสังเคราะห์จาก (รหัสตำบล, แฮชของรูปทรง) และต้องคงที่เมื่อรูปทรงเดิม
 *   - พิกัดเป็น EPSG:4326 (องศา) ไม่ใช่ 3857 — ตัวเลขต้องผ่านมาเป็นองศาเป๊ะ ๆ
 *   - **ไม่มีเวลาถ่ายภาพหรือเวลาเผยแพร่ในทั้ง payload** → `publishedAt` เป็น null
 *     เสมอ ห้ามหยิบ `timeStamp` ของ GeoServer มาสวม (มันคือเวลาที่เราถาม)
 */
afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchGistdaFloodExtent", () => {
  it("แปลง feature ทั้งสองชนิดรูปทรง พร้อมภาษาไทยที่ถอด mojibake แล้ว", async () => {
    respondJson(gistdaFixture);
    const scene = await fetchGistdaFloodExtent({ attempts: 1 });

    expect(scene.features).toHaveLength(2);
    const [poly] = scene.features;
    expect(poly.provinceCode).toBe("16");
    expect(poly.props).toEqual({
      tambonTh: "ตำบลตัวอย่าง",
      amphoeTh: "อำเภอตัวอย่าง",
      provinceTh: "ลพบุรี",
      provinceCode: "16",
      // flood_area มาเป็นสตริง "1234.5" → ไร่ (ตัวเลข)
      floodAreaRai: 1234.5,
      houses: 12,
      lat: 15.15,
      lon: 100.15,
    });
    expect(poly.geometry.type).toBe("MultiPolygon");
    // องศาลอนจิจูด/ละติจูด (EPSG:4326) ไม่ใช่เมตรของ Web Mercator
    expect(JSON.stringify(poly.geometry.coordinates)).toContain("100.1");
  });

  it("รองรับทั้ง Polygon และ MultiPolygon และเก็บค่าที่ขาดเป็น null", async () => {
    respondJson(gistdaFixture);
    const scene = await fetchGistdaFloodExtent({ attempts: 1 });
    const [, simple] = scene.features;
    expect(simple.geometry.type).toBe("Polygon");
    expect(simple.props.houses).toBeNull();
    expect(simple.props.tambonTh).toBeNull();
    expect(simple.props.floodAreaRai).toBe(8);
  });

  it("id สังเคราะห์จากรหัสตำบล + แฮชของรูปทรง และคงที่เมื่อรูปทรงไม่เปลี่ยน", async () => {
    respondJson(gistdaFixture);
    const first = await fetchGistdaFloodExtent({ attempts: 1 });
    const hash = await digest(JSON.stringify(gistdaFixture.features[0].geometry.coordinates));
    expect(first.features[0].id).toBe(`160101:${hash.slice(0, 12)}`);

    // ต้นทางสลับ id ประจำฉากใหม่ทุกครั้ง — คีย์ของเราต้องไม่ขยับตาม
    respondJson({
      ...gistdaFixture,
      features: gistdaFixture.features.map((f, i) => ({ ...f, id: `FloodArea_Poly.${99 + i}` })),
    });
    const second = await fetchGistdaFloodExtent({ attempts: 1 });
    expect(second.features.map((f) => f.id)).toEqual(first.features.map((f) => f.id));
  });

  it("รูปทรงที่เปลี่ยนไปได้ id ใหม่ (พื้นที่ท่วมที่ถูกวาดใหม่ = ของใหม่)", async () => {
    respondJson(gistdaFixture);
    const before = await fetchGistdaFloodExtent({ attempts: 1 });

    const moved = structuredClone(gistdaFixture) as typeof gistdaFixture;
    (moved.features[0].geometry.coordinates as unknown as number[][][][])[0][0][0][0] = 100.9;
    respondJson(moved);
    const after = await fetchGistdaFloodExtent({ attempts: 1 });
    expect(after.features[0].id).not.toBe(before.features[0].id);
  });

  it("publishedAt เป็น null เสมอ — timeStamp ของ GeoServer ห้ามถูกใช้แทน", async () => {
    respondJson(gistdaFixture);
    const scene = await fetchGistdaFloodExtent({ attempts: 1 });
    expect(scene.publishedAt).toBeNull();
    expect(gistdaFixture.timeStamp).toBeTruthy();
  });

  it("รูปทรงที่ไม่ใช่พื้นที่ (จุด/เส้น) ถูกข้าม ไม่ใช่ทำให้ทั้งฉากพัง", async () => {
    respondJson({
      ...gistdaFixture,
      features: [
        { ...gistdaFixture.features[0], geometry: { type: "Point", coordinates: [100.1, 15.1] } },
        gistdaFixture.features[1],
      ],
    });
    const scene = await fetchGistdaFloodExtent({ attempts: 1 });
    expect(scene.features).toHaveLength(1);
    expect(scene.features[0].props.floodAreaRai).toBe(8);
  });
});
