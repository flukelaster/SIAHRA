import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { CctvCamera, ItiCCamera } from "@siahra/shared-types";
import { markerPickFromUserData } from "./picking";

const camera: CctvCamera = {
  id: "cam-1",
  stationCode: "TC020106",
  nameTh: "ทดสอบ",
  nameEn: null,
  lat: 13.7,
  lon: 100.5,
  provinceCode: "10",
  amphoeTh: null,
};

describe("markerPickFromUserData", () => {
  const anchor = new THREE.Vector3(1, 2, 3);

  it("turns a CCTV sprite into a `cctv` pick carrying its camera", () => {
    const pick = markerPickFromUserData({ kind: "cctv", camera }, anchor);
    expect(pick?.kind).toBe("cctv");
    expect(pick && pick.kind === "cctv" ? pick.camera : null).toBe(camera);
    expect(pick?.anchor).toBe(anchor);
  });

  it("turns an iTIC sprite into an `itic` pick, distinct from DWR", () => {
    const road: ItiCCamera = {
      id: "DOH-PER-3-008",
      name: "ทดสอบ",
      lat: 13.9,
      lon: 100.6,
      organization: "กรมทางหลวง",
      stream: { kind: "hls", url: "https://camerai1.iticfoundation.org/hls/x.m3u8" },
      provinceCode: "10",
    };
    const pick = markerPickFromUserData({ kind: "itic", camera: road }, anchor);
    expect(pick?.kind).toBe("itic");
    expect(pick && pick.kind === "itic" ? pick.camera : null).toBe(road);
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
