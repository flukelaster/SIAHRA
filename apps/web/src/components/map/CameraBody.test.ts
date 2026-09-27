import { describe, expect, it } from "vitest";
import type { ProbeResult } from "@siahra/shared-types";
import { LANGS, translator } from "../../i18n";
import { probeNoteKey } from "./CameraBody";

/**
 * ป้ายผล probe ใน popup กล้อง (E15.3 PR C): `tls-chain` เป็นข้อจำกัดของเครื่องมือ build — ต้องไม่ถูกเล่า
 * เป็น "ถามไม่ได้" (`unreachable`) หรือ "ต้นทางตอบว่าไม่มีของ" (`answered`) และข้อความทั้งสองภาษาต้องบอก
 * ว่าเบราว์เซอร์มักเปิดได้ และไม่ใช่คำตัดสินเกี่ยวกับกล้อง
 */
describe("probeNoteKey", () => {
  it("keeps unreachable, tls-chain and answered-with-nothing apart", () => {
    expect(probeNoteKey("unreachable")).toBe("popup.camera.unverified.unreachable");
    expect(probeNoteKey("tls-chain")).toBe("popup.camera.unverified.tlsChain");
    for (const r of ["empty", "not-image", "http-4xx", "http-5xx"] as const satisfies readonly ProbeResult[]) {
      expect(probeNoteKey(r)).toBe("popup.camera.unverified.answered");
    }
  });

  it("the tls-chain note in both languages says the browser usually can and that it is not about the camera", () => {
    for (const lang of LANGS) {
      const t = translator(lang);
      const text = t("popup.camera.unverified.tlsChain", { at: "2026-09-27", vantage: "fortinet-lan" });
      expect(text).toContain("2026-09-27");
      expect(text).toContain("fortinet-lan");
      expect(text).toMatch(lang === "th" ? /เบราว์เซอร์มักเปิดได้/ : /browsers usually can/i);
      expect(text).toMatch(lang === "th" ? /ไม่ใช่คำตัดสินเกี่ยวกับกล้อง/ : /not a statement about the camera/i);
      // ต้องไม่ใช้คำของกรณีอื่น
      expect(text).not.toMatch(lang === "th" ? /ถามไม่ได้|ต้นทางล่ม/ : /could not be reached|source is down/i);
    }
  });
});
