import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CAMERA_SOURCE_IDS,
  CAMERA_SOURCES,
  SOURCES,
  streamDirective,
  type Camera,
  type CameraStream,
  type CspDirective,
} from "@siahra/shared-types";
import { DWR_ORIGIN, hasEnabledKind, isAllowedStreamUrl, isAllowedUrl } from "./cameraSources";
import { ENABLED_CAMERA_SOURCES } from "./featureFlags";

const HEADERS_PATH = fileURLToPath(new URL("../../public/_headers", import.meta.url));
const CSP_DIRECTIVE: Record<CspDirective, string> = { connect: "connect-src", img: "img-src", media: "media-src" };

/** อ่าน CSP จาก `public/_headers` → `{ "img-src": ["'self'", "https://…"], … }` */
function parseCsp(): Record<string, string[]> {
  const line = readFileSync(HEADERS_PATH, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("Content-Security-Policy:"));
  if (!line) throw new Error("no Content-Security-Policy line in public/_headers");
  const out: Record<string, string[]> = {};
  for (const part of line.slice("Content-Security-Policy:".length).split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name] = values;
  }
  return out;
}

describe("ทะเบียนแหล่งกล้อง (CAMERA_SOURCES) สอดคล้องกับ SOURCES และ CSP", () => {
  it.each(CAMERA_SOURCE_IDS)("%s เป็น SourceDescriptor ชนิด browser (api ไม่เคยถาม ไม่มีใน /health)", (id) => {
    expect(SOURCES[id].kind).toBe("browser");
    expect(CAMERA_SOURCES[id].id).toBe(id);
  });

  it("ทุกโฮสต์ในทะเบียนอยู่ใน directive ของ CSP ที่ streamDirective กำหนด (public/_headers)", () => {
    const csp = parseCsp();
    for (const id of CAMERA_SOURCE_IDS) {
      for (const [d, hosts] of Object.entries(CAMERA_SOURCES[id].hosts) as [CspDirective, readonly string[]][]) {
        for (const host of hosts) {
          expect(csp[CSP_DIRECTIVE[d]], `${id} ${host} in ${CSP_DIRECTIVE[d]}`).toContain(host);
        }
      }
    }
  });

  it("แหล่งที่เปิดเป็นค่าเริ่มต้นต้องมี licenceNote ที่ระบุวันที่ตรวจ (ไม่ใช่ชื่อสัญญาอนุญาตที่ตั้งเอง)", () => {
    for (const id of CAMERA_SOURCE_IDS) {
      const meta = CAMERA_SOURCES[id];
      if (!meta.defaultEnabled) continue;
      expect(meta.licenceNote).toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it("ชนิดสตรีมทุกชนิดมี directive อย่างน้อยหนึ่ง", () => {
    for (const kind of ["hls", "jpeg", "jpeg-fetch", "mjpeg", "dwr-snapshot", "dwr-mjpeg"] as const) {
      expect(streamDirective(kind).length).toBeGreaterThan(0);
    }
  });

  it("build ทดสอบเปิดทุกแหล่งที่ defaultEnabled (ไม่มี VITE_FEATURE_CCTV_DISABLE)", () => {
    expect(ENABLED_CAMERA_SOURCES).toEqual(CAMERA_SOURCE_IDS.filter((id) => CAMERA_SOURCES[id].defaultEnabled));
  });
});

describe("isAllowedUrl", () => {
  const HLS = "https://camerai1.iticfoundation.org/pass/180.180.242.207:1935/Phase8/PER_8_012.stream/playlist.m3u8";
  const JPEG = "https://camera1.iticfoundation.org/jpeg2.php?camid=10.8.0.19:8802";

  it("รับ HLS บน camerai1 และภาพนิ่ง jpeg2.php กลุ่ม 10.8.0.x ของ iTIC", () => {
    expect(isAllowedUrl("itic-cctv", "hls", HLS)).toBe(true);
    expect(isAllowedUrl("itic-cctv", "hls", "https://camerai1.iticfoundation.org/hls/kk08.m3u8")).toBe(true);
    expect(isAllowedUrl("itic-cctv", "jpeg", JPEG)).toBe(true);
  });

  it("ปฏิเสธ http:, userinfo, origin แปลก และ origin ที่อยู่ผิด directive", () => {
    expect(isAllowedUrl("itic-cctv", "hls", "http://camerai1.iticfoundation.org/hls/kk08.m3u8")).toBe(false);
    expect(isAllowedUrl("itic-cctv", "hls", "https://user:pw@camerai1.iticfoundation.org/hls/kk08.m3u8")).toBe(false);
    expect(isAllowedUrl("itic-cctv", "hls", "https://camerai1.iticfoundation.org.evil.test/x.m3u8")).toBe(false);
    // camera1 อยู่ใน img เท่านั้น — ใช้เป็น HLS (connect+media) ไม่ได้
    expect(isAllowedUrl("itic-cctv", "hls", "https://camera1.iticfoundation.org/hls/kk08.m3u8")).toBe(false);
    // camerai1 ไม่อยู่ใน img — ใช้เป็นภาพนิ่งไม่ได้
    expect(isAllowedUrl("itic-cctv", "jpeg", "https://camerai1.iticfoundation.org/jpeg2.php?camid=10.8.0.1:80")).toBe(false);
    expect(isAllowedUrl("itic-cctv", "hls", "not a url")).toBe(false);
  });

  it("urlPattern ของแหล่งบังคับทั้งเส้น (ภาพนิ่ง iTIC นอกกลุ่ม 10.8.0.x ถูกปฏิเสธ)", () => {
    expect(isAllowedUrl("itic-cctv", "jpeg", "https://camera1.iticfoundation.org/jpeg2.php?camid=CAMPK0001")).toBe(false);
    expect(isAllowedUrl("itic-cctv", "jpeg", `${JPEG}&x=1`)).toBe(false);
  });

  it("แหล่งของกล้องเป็นตัวตัดสิน — HLS ของ iTIC บนกล้องของ DWR ถูกปฏิเสธ", () => {
    expect(isAllowedUrl("dwr-cctv", "hls", HLS)).toBe(false);
  });
});

describe("isAllowedStreamUrl", () => {
  const cam = (sourceId: Camera["sourceId"]): Pick<Camera, "sourceId"> => ({ sourceId });
  const probe = { result: "ok" as const, cors: null };

  it("ปฏิเสธ playlist ป้าย tempsus (ระงับชั่วคราว) ของ iTIC — ไม่ใช่วิดีโอสด", () => {
    const s: CameraStream = { kind: "hls", url: "https://camerai1.iticfoundation.org/hls/tempsus.m3u8", label: null, captureTime: "none", probe };
    expect(isAllowedStreamUrl(cam("itic-cctv"), s)).toBe(false);
    expect(isAllowedStreamUrl(cam("itic-cctv"), { ...s, url: "https://camerai1.iticfoundation.org/hls/kk08.m3u8" })).toBe(true);
  });

  it("ชนิด dwr-* ไม่มี url: ผ่านเมื่อกล้องเป็นของ DWR (origin ที่ derive อยู่ใน hosts) ไม่งั้นปฏิเสธ", () => {
    const snap: CameraStream = { kind: "dwr-snapshot", label: null, captureTime: "path", probe };
    const live: CameraStream = { kind: "dwr-mjpeg", stationCode: "TC020106", label: null, captureTime: "none", probe };
    expect(isAllowedStreamUrl(cam("dwr-cctv"), snap)).toBe(true);
    expect(isAllowedStreamUrl(cam("dwr-cctv"), live)).toBe(true);
    expect(isAllowedStreamUrl(cam("itic-cctv"), snap)).toBe(false);
    expect(isAllowedStreamUrl(cam("itic-cctv"), live)).toBe(false);
    // origin ที่ derive ต้องอยู่ในทะเบียนของ DWR ทั้ง connect (snapshot) และ img (MJPEG)
    expect(CAMERA_SOURCES["dwr-cctv"].hosts.connect).toContain(DWR_ORIGIN);
    expect(CAMERA_SOURCES["dwr-cctv"].hosts.img).toContain(DWR_ORIGIN);
  });

  it("probe ไม่มีผลต่อ allowlist — สตรีมที่ไม่ตอบตอน build ยังเปิดได้ (แค่หรี่ + ป้าย)", () => {
    const s: CameraStream = {
      kind: "hls",
      url: "https://camerai1.iticfoundation.org/hls/kk08.m3u8",
      label: null,
      captureTime: "none",
      probe: { result: "unreachable", cors: null },
    };
    expect(isAllowedStreamUrl(cam("itic-cctv"), s)).toBe(true);
  });
});

describe("hasEnabledKind", () => {
  it("hls ต้องมีแหล่งที่เปิดอยู่ซึ่งประกาศทั้ง connect และ media", () => {
    expect(hasEnabledKind("hls", ["itic-cctv"])).toBe(true);
    expect(hasEnabledKind("hls", ["dwr-cctv"])).toBe(false);
    expect(hasEnabledKind("hls", [])).toBe(false);
    expect(hasEnabledKind("dwr-snapshot", ["dwr-cctv"])).toBe(true);
  });
});
