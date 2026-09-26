import { describe, expect, it } from "vitest";
import type { Camera, CameraStream } from "@siahra/shared-types";
import { markerStyle } from "./CctvMarkers";

const ok = { result: "ok" as const, cors: true };
const cam = (streams: CameraStream[]): Pick<Camera, "streams"> => ({ streams });

describe("markerStyle — ไอคอนตามชนิดของสตรีมแรก × ยืนยันตอน build", () => {
  it("DWR: ภาพนิ่งเป็นสตรีมแรก → still; ตรวจแล้ว", () => {
    expect(
      markerStyle(
        cam([
          { kind: "dwr-snapshot", label: null, captureTime: "path", probe: ok },
          { kind: "dwr-mjpeg", stationCode: "X", label: null, captureTime: "none", probe: { result: "empty", cors: true } },
        ]),
      ),
    ).toEqual({ kind: "still", verified: true });
  });

  it("HLS/MJPEG → video; jpeg/jpeg-fetch → still", () => {
    expect(markerStyle(cam([{ kind: "hls", url: "https://x/y.m3u8", label: null, captureTime: "none", probe: ok }])).kind).toBe("video");
    expect(markerStyle(cam([{ kind: "mjpeg", url: "https://x/y", label: null, captureTime: "none", probe: ok }])).kind).toBe("video");
    expect(markerStyle(cam([{ kind: "jpeg", url: "https://x/y.jpg", label: null, captureTime: "burned-in", probe: ok }])).kind).toBe("still");
    expect(markerStyle(cam([{ kind: "jpeg-fetch", url: "https://x/y.jpg", label: null, captureTime: "last-modified", probe: ok }])).kind).toBe("still");
  });

  it("ไม่มีสตรีมใดตอบตอน build = ยังไม่ยืนยัน (หรี่) — และ not-probed ก็นับว่ายังไม่ยืนยัน ไม่ใช่ล้มเหลว", () => {
    expect(markerStyle(cam([{ kind: "hls", url: "https://x/y.m3u8", label: null, captureTime: "none", probe: { result: "unreachable", cors: null } }])).verified).toBe(false);
    expect(markerStyle(cam([{ kind: "hls", url: "https://x/y.m3u8", label: null, captureTime: "none", probe: { result: "not-probed", cors: null } }])).verified).toBe(false);
    // สตรีมที่สองตอบ = กล้องยืนยันแล้ว
    expect(
      markerStyle(
        cam([
          { kind: "hls", url: "https://x/a.m3u8", label: "IN", captureTime: "none", probe: { result: "unreachable", cors: null } },
          { kind: "hls", url: "https://x/b.m3u8", label: "OUT", captureTime: "none", probe: ok },
        ]),
      ).verified,
    ).toBe(true);
    expect(markerStyle(cam([]))).toEqual({ kind: "still", verified: false });
  });
});
