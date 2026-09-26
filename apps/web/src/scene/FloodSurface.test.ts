import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FLOOD_FIELD_NO_DEPTH, FloodFieldClass, type AoiManifest } from "@siahra/shared-types";
import { STATION_SHEET_MAX_ALPHA, STATION_SHEET_RGB } from "../lib/floodStyle";
import {
  ILLUSTRATIVE_HATCH_DUTY,
  ILLUSTRATIVE_HATCH_PERIOD_PX,
  ILLUSTRATIVE_RGB,
  STATION_SHEET_HATCH_MIX,
} from "../lib/illustrativeStyle";
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

  it("variant (แผ่นน้ำจำลองจากสถานี): สีของตัวเอง + ตัวคูณความทึบ + คีย์ cache แยก; ไม่ส่ง = GFM เดิม", () => {
    const terrain = terrainStub();
    const tex = buildFloodFieldTexture(f);
    const gfm = createFloodSurface(terrain, manifest, f, tex.texture, { value: 0 })!;
    const opacity = { value: 0.4 };
    const sheet = createFloodSurface(terrain, manifest, f, tex.texture, { value: 0 }, {
      cacheKey: "siahra-station-sheet",
      name: "station-sheet",
      palette: { shallow: [0.1, 0.2, 0.3], deep: [0.4, 0.5, 0.6] },
      opacity,
    })!;
    const g = compile(gfm.mesh.material as THREE.Material);
    const s = compile(sheet.mesh.material as THREE.Material);
    // GFM ไม่มีอะไรของ variant ติดมา และยังใช้คีย์ cache เดิม
    expect(g.fragmentShader).not.toContain("uSurfaceOpacity");
    expect(g.uniforms.uSurfaceOpacity).toBeUndefined();
    expect((gfm.mesh.material as THREE.Material).customProgramCacheKey()).toBe("siahra-flood-surface");
    // variant: คีย์ต่าง (ไม่งั้น three แจก program ของ GFM ให้) + สี + ความทึบคูณท้ายสุด
    expect((sheet.mesh.material as THREE.Material).customProgramCacheKey()).toBe("siahra-station-sheet");
    expect(s.fragmentShader).toContain("mix(vec3(0.1000, 0.2000, 0.3000), vec3(0.4000, 0.5000, 0.6000), sfMix)");
    expect(s.fragmentShader).toContain("diffuseColor.a *= uSurfaceOpacity;");
    expect(s.uniforms.uSurfaceOpacity).toBe(opacity);
    expect(sheet.mesh.name).toBe("station-sheet:test");
    gfm.dispose();
    sheet.dispose();
    tex.dispose();
  });

  it("variant.sheet: ลายทแยงภาพประกอบ + เพดานความทึบหลัง Fresnel; GFM ไม่มีอะไรของสองอย่างนี้", () => {
    const terrain = terrainStub();
    const tex = buildFloodFieldTexture(f);
    const gfm = createFloodSurface(terrain, manifest, f, tex.texture, { value: 0 })!;
    const sheet = createFloodSurface(terrain, manifest, f, tex.texture, { value: 0 }, {
      cacheKey: "siahra-station-sheet",
      name: "station-sheet",
      palette: STATION_SHEET_RGB,
      opacity: { value: 1 },
      sheet: { hatchPx: { value: ILLUSTRATIVE_HATCH_PERIOD_PX } },
    })!;
    const g = compile(gfm.mesh.material as THREE.Material).fragmentShader;
    const s = compile(sheet.mesh.material as THREE.Material).fragmentShader;
    // สูตรลายเดียวกับชั้นลุ่มต่ำ (terrainMaterial) + สี/น้ำหนักจาก illustrativeStyle
    expect(s).toContain("(gl_FragCoord.x + gl_FragCoord.y) / (hatchPx * 1.4142136)");
    expect(s).toContain(`smoothstep(${ILLUSTRATIVE_HATCH_DUTY.toFixed(4)} - hatchAa`);
    const light = ILLUSTRATIVE_RGB.light.map((v) => v.toFixed(4)).join(", ");
    expect(s).toContain(`vec3(${light}), ${STATION_SHEET_HATCH_MIX.toFixed(4)} * stripe)`);
    // เพดานอยู่หลัง Fresnel (ไม่งั้น +0.3 ของ Fresnel ดันกลับเกินเพดาน)
    const fres = s.indexOf("0.3 * sfFres");
    const cap = s.indexOf(`min(diffuseColor.a, ${STATION_SHEET_MAX_ALPHA.toFixed(4)}) * sfHatchA`);
    expect(fres).toBeGreaterThan(-1);
    expect(cap).toBeGreaterThan(fres);
    expect(STATION_SHEET_MAX_ALPHA).toBeLessThanOrEqual(0.55);
    for (const k of ["sfHatchA", "hatchTri", "min(diffuseColor.a"]) expect(g).not.toContain(k);
    gfm.dispose();
    sheet.dispose();
    tex.dispose();
  });

  it("variant.observedExtent (แผ่น GISTDA): วาดเซลล์ตื้น < 2 ซม. + ความทึบขั้นต่ำ + ไม่มีลาย; GFM ยังทิ้งเซลล์ตื้น", () => {
    const terrain = terrainStub();
    const tex = buildFloodFieldTexture(f);
    const gfm = createFloodSurface(terrain, manifest, f, tex.texture, { value: 0 })!;
    const obs = createFloodSurface(terrain, manifest, f, tex.texture, { value: 0 }, {
      cacheKey: "siahra-gistda-sheet",
      name: "gistda-sheet",
      palette: { shallow: [0.1, 0.2, 0.3], deep: [0.4, 0.5, 0.6] },
      opacity: { value: 1 },
      observedExtent: { minAlpha: 0.55 },
    })!;
    const g = compile(gfm.mesh.material as THREE.Material).fragmentShader;
    const o = compile(obs.mesh.material as THREE.Material).fragmentShader;
    expect(g).toContain("sfDepth < 0.020");
    expect(o).not.toContain("sfDepth < 0.020");
    expect(o).toContain("if (sfCov < 0.5 || sfNotEst > 0.5) discard;");
    expect(o).toContain("diffuseColor.a = mix(0.550, 0.9, sfMix);");
    expect(o).toContain("mix(vec3(0.1000, 0.2000, 0.3000), vec3(0.4000, 0.5000, 0.6000), sfMix)");
    expect(o).toContain("diffuseColor.a *= uSurfaceOpacity;");
    for (const k of ["hatchTri", "sfHatchA", "siahraSheetFade"]) expect(o).not.toContain(k);
    expect((obs.mesh.material as THREE.Material).customProgramCacheKey()).toBe("siahra-gistda-sheet:observed");
    gfm.dispose();
    obs.dispose();
    tex.dispose();
  });
});
