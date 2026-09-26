import { describe, expect, it } from "vitest";
import { CAMERA_SOURCE_IDS } from "@siahra/shared-types";
import { cameraLayerDescriptor } from "./useLayerDescriptors";

describe("cameraLayerDescriptor (E15/E15.3)", () => {
  const dwrAt = "2026-09-26T13:30:24.656Z";
  const iticAt = "2026-09-26T13:25:19.805Z";

  it("ไม่มีบัญชีใดโหลดได้ = ไม่มี descriptor (ไม่ใช่ fetchedAt null ที่อ่านเป็น 'ตอนนี้')", () => {
    expect(cameraLayerDescriptor({})).toBeUndefined();
  });

  it("แหล่งเดียว: static-reference, fetchedAt = builtAt ของไฟล์, publishedAt null, sourceIds = แหล่งนั้น", () => {
    expect(cameraLayerDescriptor({ "itic-cctv": iticAt })).toEqual({
      id: "itic-cctv-catalogue",
      epistemicClass: "static-reference",
      liveOrStatic: "static",
      publishedAt: null,
      fetchedAt: iticAt,
      sourceIds: ["itic-cctv"],
    });
  });

  it("หลายแหล่ง: fetchedAt = builtAt ที่เก่าที่สุด, sourceIds เฉพาะที่โหลดได้ ตามลำดับ CAMERA_SOURCE_IDS", () => {
    const d = cameraLayerDescriptor({ "itic-cctv": iticAt, "dwr-cctv": dwrAt });
    expect(d?.fetchedAt).toBe(iticAt);
    expect(d?.sourceIds).toEqual([...CAMERA_SOURCE_IDS]);
    expect(d?.id).toBe("cctv-catalogues");
    expect(d?.publishedAt).toBeNull();
    // สลับว่าใครเก่ากว่า — ยังเป็นตัวเก่าสุด ไม่ใช่ตัวแรกในลำดับ
    expect(cameraLayerDescriptor({ "dwr-cctv": iticAt, "itic-cctv": dwrAt })?.fetchedAt).toBe(iticAt);
  });
});
