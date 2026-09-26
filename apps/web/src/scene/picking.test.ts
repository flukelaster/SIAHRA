import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { Camera } from "@siahra/shared-types";
import { markerPickFromUserData } from "./picking";

const dwr: Camera = {
  id: "cam-1",
  sourceId: "dwr-cctv",
  nameTh: "ทดสอบ",
  nameEn: null,
  lat: 13.7,
  lon: 100.5,
  coordSource: "upstream",
  provinceCode: "10",
  owner: null,
  code: "TC020106",
  placeTh: null,
  streams: [
    { kind: "dwr-snapshot", label: null, captureTime: "path", probe: { result: "ok", cors: true } },
    { kind: "dwr-mjpeg", stationCode: "TC020106", label: null, captureTime: "none", probe: { result: "ok", cors: true } },
  ],
};

const road: Camera = {
  id: "DOH-PER-3-008",
  sourceId: "itic-cctv",
  nameTh: "ทดสอบ",
  nameEn: null,
  lat: 13.9,
  lon: 100.6,
  coordSource: "upstream",
  provinceCode: "10",
  owner: "กรมทางหลวง",
  code: null,
  placeTh: null,
  streams: [
    { kind: "hls", url: "https://camerai1.iticfoundation.org/hls/x.m3u8", label: null, captureTime: "none", probe: { result: "ok", cors: true } },
  ],
};

describe("markerPickFromUserData", () => {
  const anchor = new THREE.Vector3(1, 2, 3);

  it("turns a camera sprite into one `camera` pick carrying its camera — sources differ by sourceId, not by kind", () => {
    const a = markerPickFromUserData({ kind: "camera", camera: dwr }, anchor);
    const b = markerPickFromUserData({ kind: "camera", camera: road }, anchor);
    expect(a?.kind).toBe("camera");
    expect(b?.kind).toBe("camera");
    expect(a && a.kind === "camera" ? a.camera : null).toBe(dwr);
    expect(b && b.kind === "camera" ? b.camera.sourceId : null).toBe("itic-cctv");
    expect(a?.anchor).toBe(anchor);
  });

  it("the legacy per-source kinds are no longer markers", () => {
    expect(markerPickFromUserData({ kind: "cctv", camera: dwr }, anchor)).toBeNull();
    expect(markerPickFromUserData({ kind: "itic", camera: road }, anchor)).toBeNull();
  });

  it("keeps the existing marker kinds", () => {
    expect(markerPickFromUserData({ kind: "dam", dam: {} }, anchor)?.kind).toBe("dam");
    expect(markerPickFromUserData({ kind: "waterlevel", obs: {} }, anchor)?.kind).toBe("waterlevel");
  });

  it("ignores sprites that are not clickable markers", () => {
    expect(markerPickFromUserData({}, anchor)).toBeNull();
    expect(markerPickFromUserData({ kind: "halo" }, anchor)).toBeNull();
    expect(markerPickFromUserData(null, anchor)).toBeNull();
  });
});
