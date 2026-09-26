import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { CctvCamera } from "@siahra/shared-types";
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
