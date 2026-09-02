import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FLOOD_FIELD_NO_DEPTH, FloodFieldClass, type AoiManifest } from "@siahra/shared-types";
import { createFloodSurface } from "./FloodSurface";
import { buildFloodFieldTexture, floodFieldDepthBounds, type FloodField } from "./floodField";
import type { TerrainField } from "./TerrainMesh";

/**
 * ไม่มี GPU ในเทส — สิ่งที่ตรวจได้คือ (1) geometry ยังเป็น bbox ของเซลล์ที่มี
 * ความลึก **ทั้งหมด** (รวมนอกจังหวัด — การตัดเกิดต่อ fragment ไม่ใช่ตอนสร้าง) และ
 * (2) shader ที่ `onBeforeCompile` ประกอบออกมา sample มาสก์จังหวัด (ช่อง B ของ
 * overlay ภูมิประเทศ) แล้ว discard ก่อนถึงสีของน้ำ
 */
const W = 4;
const H = 3;

function field(cells: { cls: number; depthCm: number }[]): FloodField {
  return {
    width: W,
    height: H,
    cls: Uint8Array.from(cells.map((c) => c.cls)),
    depthCm: Uint16Array.from(cells.map((c) => c.depthCm)),
    likelihood: new Uint8Array(cells.length),
  };
}

const dry = { cls: FloodFieldClass.DRY, depthCm: FLOOD_FIELD_NO_DEPTH };
const wet = { cls: FloodFieldClass.FLOODED, depthCm: 120 };

/** ภูมิประเทศจำลอง: มาสก์จังหวัด = คอลัมน์ 0–1 เท่านั้น (ช่อง B ของ overlay) */
function terrainStub(): TerrainField {
  const overlayData = new Uint8Array(W * H * 4);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) overlayData[(r * W + c) * 4 + 2] = c < 2 ? 255 : 0;
  const overlayTexture = new THREE.DataTexture(overlayData, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  return {
    heights: new Float32Array(W * H).fill(10),
    minZ: 0,
    maxZ: 20,
    projection: { gridWidthM: W * 200, gridHeightM: H * 200 },
    overlay: { texture: overlayTexture },
  } as unknown as TerrainField;
}

const manifest = {
  aoiId: "test",
  terrain: { width: W, height: H, cellSizeM: 200 },
} as unknown as AoiManifest;

interface CompiledShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

/** จำลองสิ่งที่ renderer ทำ: ป้อน chunk ของ MeshStandardMaterial ให้ `onBeforeCompile` แทน */
function compile(material: THREE.Material): CompiledShader {
  const shader: CompiledShader = {
    uniforms: {},
    vertexShader: ["#include <common>", "#include <begin_vertex>", "#include <worldpos_vertex>"].join("\n"),
    fragmentShader: [
      "#include <common>",
      "#include <map_fragment>",
      "#include <normal_fragment_maps>",
      "#include <emissivemap_fragment>",
    ].join("\n"),
  };
  (material.onBeforeCompile as unknown as (s: CompiledShader, r: unknown) => void)(shader, null);
  return shader;
}

describe("createFloodSurface", () => {
  // เซลล์ท่วมที่คอลัมน์ 1 (ในจังหวัด) และคอลัมน์ 3 (นอกจังหวัดแต่ใน bbox) แถวกลาง
  const f = field([dry, dry, dry, dry, dry, wet, dry, wet, dry, dry, dry, dry]);

  it("geometry ยังครอบ bbox ของเซลล์ที่มีความลึกทั้งหมด — รวมที่อยู่นอกมาสก์จังหวัด", () => {
    const bounds = floodFieldDepthBounds(f)!;
    expect(bounds).toEqual({ c0: 0, c1: 3, r0: 0, r1: 2 });
    const terrain = terrainStub();
    const tex = buildFloodFieldTexture(f);
    const surface = createFloodSurface(terrain, manifest, f, tex.texture, { value: 0 });
    expect(surface).not.toBeNull();
    expect(surface!.vertexCount).toBe((bounds.c1 - bounds.c0 + 1) * (bounds.r1 - bounds.r0 + 1));
    surface!.dispose();
    tex.dispose();
  });

  it("fragment shader sample มาสก์จังหวัด (uMaskOverlay.b) แล้ว discard ก่อนสีของน้ำ", () => {
    const terrain = terrainStub();
    const tex = buildFloodFieldTexture(f);
    const surface = createFloodSurface(terrain, manifest, f, tex.texture, { value: 0 })!;
    const { fragmentShader, uniforms } = compile(surface.mesh.material as THREE.Material);
    expect(fragmentShader).toContain("uniform sampler2D uMaskOverlay;");
    const maskDiscard = fragmentShader.indexOf("texture2D(uMaskOverlay, vFloodUv).b < 0.500) discard;");
    const waterColour = fragmentShader.indexOf("siahraDepthMix(sfDepth)");
    expect(maskDiscard).toBeGreaterThan(-1);
    expect(waterColour).toBeGreaterThan(maskDiscard);
    // uniform ชี้ไปที่ texture ของ overlay ภูมิประเทศตัวเดียวกัน ไม่ใช่สำเนา
    expect(uniforms.uMaskOverlay.value).toBe(terrain.overlay.texture);
    surface.dispose();
    tex.dispose();
  });

  it("ฉากที่ไม่มีเซลล์ใดมีความลึก → null (ไม่มีแผ่น)", () => {
    const tex = buildFloodFieldTexture(field(Array(W * H).fill(dry)));
    expect(createFloodSurface(terrainStub(), manifest, field(Array(W * H).fill(dry)), tex.texture, { value: 0 })).toBeNull();
    tex.dispose();
  });
});
