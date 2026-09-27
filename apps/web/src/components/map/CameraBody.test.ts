import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SOURCES, type Camera, type ProbeResult } from "@siahra/shared-types";
import { LANGS, translator } from "../../i18n";
import { SnapshotCache } from "../../lib/cctv";
import { CameraBody, probeNoteKey } from "./CameraBody";

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

/**
 * external-link (E15.3 PR D): ไม่มี element สื่อใดเลย, ลิงก์ออกผ่าน allowlist `hosts.link` เท่านั้น
 * (แท็บใหม่ + noopener noreferrer), มีประโยค "ตรวจไม่ได้จากเครือข่ายของเรา" และไม่มีป้าย probe
 */
describe("CameraBody — external-link", () => {
  const LINK = "https://cpudapp.bangkok.go.th/bmatraffic/";
  const bma = (url = LINK): Camera => ({
    id: "1",
    sourceId: "bma-cctv",
    nameTh: "แยกทดสอบ",
    nameEn: null,
    lat: 13.75,
    lon: 100.5,
    coordSource: "upstream",
    provinceCode: "10",
    owner: null,
    code: "TF-XX-01",
    placeTh: "เขตทดสอบ",
    streams: [{ kind: "external-link", url, label: null, captureTime: "none", probe: { result: "not-probed", cors: null } }],
  });
  const render = (camera: Camera, lang: (typeof LANGS)[number]) =>
    renderToStaticMarkup(
      createElement(CameraBody, {
        camera,
        ctx: { cameras: [camera], cache: new SnapshotCache(), probes: {} },
        lang,
        t: translator(lang),
      }),
    );

  it.each(LANGS)("%s: statement + a new-tab link to the owner's site, no media element and no probe note", (lang) => {
    const t = translator(lang);
    const html = render(bma(), lang);
    expect(html).not.toMatch(/<(img|video|iframe)\b/);
    expect(html).toContain(`href="${LINK}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(t("stream.externalLink.open", { host: "cpudapp.bangkok.go.th" }));
    expect(html).toContain(t("stream.externalLink.statement"));
    // ชื่อแหล่งอยู่ในเครดิตด้านล่างของแผง (ประโยคอ้างถึงมัน)
    expect(html).toContain(lang === "th" ? SOURCES["bma-cctv"].nameTh : SOURCES["bma-cctv"].nameEn);
    expect(html).toContain(t("stream.externalLink.unchecked"));
    expect(html).not.toContain("data-probe");
    expect(html).not.toContain(t("popup.camera.notProbed"));
  });

  it("a link outside hosts.link is not rendered as a link", () => {
    const html = render(bma("https://example.org/bmatraffic/"), "th");
    expect(html).not.toContain("example.org");
    expect(html).toContain(translator("th")("stream.externalLink.rejected"));
  });
});
