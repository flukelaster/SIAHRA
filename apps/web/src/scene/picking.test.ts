import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { Camera } from "@siahra/shared-types";
import { chooseMarkerHit, markerPickFromUserData } from "./picking";

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

  it("returns a community report pin with its report (opened in the right sheet, not the popup)", () => {
    const report = { id: "20260927-AAAAAAAAAAAAAAAAAAAAAA" };
    const p = markerPickFromUserData({ kind: "community", report }, anchor);
    expect(p?.kind).toBe("community");
    expect(p && p.kind === "community" ? p.report : null).toBe(report);
  });

  it("ignores sprites that are not clickable markers", () => {
    expect(markerPickFromUserData({}, anchor)).toBeNull();
    expect(markerPickFromUserData({ kind: "halo" }, anchor)).toBeNull();
    expect(markerPickFromUserData(null, anchor)).toBeNull();
  });
});

describe("chooseMarkerHit — การคลิกได้หมุดที่วาดอยู่บนสุด", () => {
  const sprite = (userData: object, renderOrder: number, z: number) => {
    const s = new THREE.Sprite();
    s.userData = userData;
    s.renderOrder = renderOrder;
    s.position.set(0, 0, z);
    return { object: s };
  };
  const report = { id: "20260927-AAAAAAAAAAAAAAAAAAAAAA" };

  it("หมุดรายงาน (renderOrder สูงกว่า) ชนะหมุดกล้องที่อยู่ใกล้กล้องกว่า", () => {
    // raycaster เรียงใกล้ → ไกล: กล้องมาก่อน แต่รายงานถูกวาดทับ
    const hits = [sprite({ kind: "camera", camera: dwr }, 30, 1), sprite({ kind: "community", report }, 31.5, 5)];
    const p = chooseMarkerHit(hits);
    expect(p?.kind).toBe("community");
    expect(p?.anchor.z).toBe(5);
  });

  it("renderOrder เท่ากัน = ตัวที่ใกล้กว่า (ตัวแรก)", () => {
    const hits = [sprite({ kind: "camera", camera: dwr }, 30, 1), sprite({ kind: "camera", camera: road }, 30, 2)];
    const p = chooseMarkerHit(hits);
    expect(p && p.kind === "camera" ? p.camera : null).toBe(dwr);
  });

  it("สิ่งที่คลิกไม่ได้ไม่ถูกนับ แม้ renderOrder สูงสุด; ไม่มีหมุดเลย = null", () => {
    const hits = [sprite({ kind: "halo" }, 99, 0), sprite({ kind: "dam", dam: {} }, 32, 3)];
    expect(chooseMarkerHit(hits)?.kind).toBe("dam");
    expect(chooseMarkerHit([sprite({}, 50, 0)])).toBeNull();
    expect(chooseMarkerHit([])).toBeNull();
  });
});

