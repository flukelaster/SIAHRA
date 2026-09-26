import { describe, expect, it, vi } from "vitest";
import { chunkErrorActions, isChunkLoadError, lazyModule } from "./lazyModule";

describe("lazyModule — ตัวโหลด chunk ที่ลองใหม่ได้", () => {
  it("import ครั้งเดียว แม้เรียก load() ซ้ำ (StrictMode เรนเดอร์สองรอบ)", async () => {
    const importer = vi.fn(async () => "mod");
    const m = lazyModule(importer);
    expect(m.peek()).toBeUndefined();
    const [a, b] = await Promise.all([m.load(), m.load()]);
    expect([a, b]).toEqual(["mod", "mod"]);
    await m.load();
    expect(importer).toHaveBeenCalledTimes(1);
    expect(m.peek()).toBe("mod");
    // promise ตัวเดิมหลัง resolve — use() ของ React ติดตามสถานะตาม identity
    expect(m.load()).toBe(m.load());
  });

  it("ไม่จำความล้มเหลว — load() หลัง reject เรียก import ใหม่จริง (ต่างจาก React.lazy)", async () => {
    const importer = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"))
      .mockResolvedValueOnce("mod");
    const m = lazyModule(importer);
    await expect(m.load()).rejects.toThrow("Failed to fetch");
    expect(m.peek()).toBeUndefined();
    await expect(m.load()).resolves.toBe("mod");
    expect(importer).toHaveBeenCalledTimes(2);
    expect(m.peek()).toBe("mod");
  });
});

describe("chunkErrorActions", () => {
  it("ครั้งแรกเสนอแค่ลองใหม่ พลาดซ้ำจึงเสนอโหลดหน้าใหม่ด้วย (chunk หายหลัง deploy)", () => {
    expect(chunkErrorActions(1)).toEqual({ retry: true, reload: false });
    expect(chunkErrorActions(2)).toEqual({ retry: true, reload: true });
    expect(chunkErrorActions(5)).toEqual({ retry: true, reload: true });
  });
});

describe("isChunkLoadError — แยก 'โหลดโค้ดไม่สำเร็จ' ออกจาก 'เรนเดอร์พัง'", () => {
  it("ข้อความ import() ที่ล้มของแต่ละเบราว์เซอร์ = chunk", () => {
    for (const msg of [
      "Failed to fetch dynamically imported module: https://siahra-radar.co/assets/InfoPopup-abc.js",
      "error loading dynamically imported module: https://siahra-radar.co/assets/InfoPopup-abc.js",
      "Importing a module script failed.",
      "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\".",
      "Unable to preload CSS for /assets/x.css",
    ]) {
      expect(isChunkLoadError(new TypeError(msg)), msg).toBe(true);
    }
  });

  it("error อื่นตอนเรนเดอร์ / ค่าที่ไม่ใช่ Error = ไม่ใช่ chunk", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
    expect(isChunkLoadError(new Error("boom"))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});
