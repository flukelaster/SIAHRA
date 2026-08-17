import * as THREE from "three";
import type { AoiManifest } from "@siahra/shared-types";
import { loadBoundaryMask } from "./boundaryMask";
import { buildOverlayField, type OverlayField } from "./hazardOverlay";
import { createLocalProjection, type LocalProjection } from "./localProjection";
import { imageryUv, type ImageryPlan } from "./SatelliteImagery";
import {
  createTerrainMaterial,
  createTerrainSharedUniforms,
  type TerrainMaterial,
  type TerrainSharedUniforms,
} from "./terrainMaterial";

const NODATA_SENTINEL = -32768;

export interface TerrainField {
  mesh: THREE.Mesh;
  /** Bilinear elevation (metres) at a local scene coordinate. */
  sample: (x: number, z: number) => number;
  minZ: number;
  maxZ: number;
  heights: Float32Array;
  insideMask: Uint8Array | null;
  projection: LocalProjection;
  material: TerrainMaterial;
  overlay: OverlayField;
  dispose: () => void;
}

/**
 * Reads the ETL pipeline's raw Int16 heightfield (see Workstream A —
 * deliberately not a Terrain-RGB PNG: exact metre values, no encoding
 * scheme, trivially debuggable) and builds a real BufferGeometry.
 *
 * Grid convention, matching the EHdr header the GDAL pipeline emits
 * (LAYOUT BIL, upper-left origin, row-major): row 0 is the NORTH edge.
 *
 * Two UV sets are written: `uv` is the plain grid parameterisation (used by
 * the hazard overlay), `uv1` maps every vertex into the stitched Web
 * Mercator imagery canvas so the satellite basemap lands exactly on the
 * ground it photographs.
 */
export async function buildTerrainMesh(
  manifest: AoiManifest,
  imageryPlan: ImageryPlan | null,
  sharedUniforms: TerrainSharedUniforms = createTerrainSharedUniforms(),
): Promise<TerrainField> {
  const { width, height, cellSizeM, minZ, maxZ } = manifest.terrain;

  const buf = await fetch(manifest.terrain.url).then((r) => r.arrayBuffer());
  const raw = new Int16Array(buf);
  if (raw.length !== width * height) {
    throw new Error(
      `terrain.bin size mismatch: expected ${width * height} cells, got ${raw.length}`,
    );
  }

  // Replace nodata up-front so both the mesh and the sampler see clean values.
  const heights = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    heights[i] = raw[i] === NODATA_SENTINEL ? minZ : raw[i];
  }

  const projection = createLocalProjection(manifest);
  const { gridWidthM, gridHeightM } = projection;
  const insideMask = await loadBoundaryMask(manifest);

  const positions = new Float32Array(width * height * 3);
  const uvs = new Float32Array(width * height * 2);
  const uv1s = new Float32Array(width * height * 2);
  const colors = new Float32Array(width * height * 3);

  // Elevation ramp used only when imagery is unavailable:
  // valley green -> foothill olive -> ridge tan.
  const lowColor = new THREE.Color(0x3f5d3a);
  const midColor = new THREE.Color(0x5c6b3a);
  const highColor = new THREE.Color(0x8a7d5e);
  const scratch = new THREE.Color();
  const span = Math.max(1, maxZ - minZ);

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      const elevation = heights[i];

      const x = c * cellSizeM - gridWidthM / 2;
      // row 0 = north edge => most negative Z (north is -Z).
      const z = r * cellSizeM - gridHeightM / 2;

      positions[i * 3] = x;
      positions[i * 3 + 1] = elevation;
      positions[i * 3 + 2] = z;

      uvs[i * 2] = c / (width - 1);
      uvs[i * 2 + 1] = 1 - r / (height - 1);

      if (imageryPlan) {
        const [lon, lat] = projection.localToLonLat(x, z);
        const [u, v] = imageryUv(imageryPlan, lon, lat);
        uv1s[i * 2] = u;
        uv1s[i * 2 + 1] = v;
      }

      const t = THREE.MathUtils.clamp((elevation - minZ) / span, 0, 1);
      if (t < 0.5) scratch.copy(lowColor).lerp(midColor, t / 0.5);
      else scratch.copy(midColor).lerp(highColor, (t - 0.5) / 0.5);
      colors[i * 3] = scratch.r;
      colors[i * 3 + 1] = scratch.g;
      colors[i * 3 + 2] = scratch.b;
    }
  }

  const indices = new Uint32Array((width - 1) * (height - 1) * 6);
  let k = 0;
  for (let r = 0; r < height - 1; r++) {
    for (let c = 0; c < width - 1; c++) {
      const a = r * width + c;
      const b = a + 1;
      const cIdx = a + width;
      const d = cIdx + 1;
      indices[k++] = a;
      indices[k++] = cIdx;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = cIdx;
      indices[k++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("uv1", new THREE.BufferAttribute(uv1s, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const overlay = buildOverlayField(manifest, heights, insideMask);
  const material = createTerrainMaterial(sharedUniforms);
  material.setOverlay(overlay.texture);

  let hillshade: THREE.Texture | null = null;
  if (manifest.terrain.hillshadeUrl) {
    try {
      hillshade = await new THREE.TextureLoader().loadAsync(manifest.terrain.hillshadeUrl);
      hillshade.colorSpace = THREE.NoColorSpace;
      hillshade.minFilter = THREE.LinearFilter;
      hillshade.magFilter = THREE.LinearFilter;
      hillshade.generateMipmaps = false;
      material.setHillshade(hillshade);
    } catch {
      hillshade = null; // purely cosmetic; the DEM lighting still works
    }
  }

  const mesh = new THREE.Mesh(geometry, material.material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = `terrain:${manifest.aoiId}`;

  const sample = (x: number, z: number): number => {
    const fc = (x + gridWidthM / 2) / cellSizeM;
    const fr = (z + gridHeightM / 2) / cellSizeM;
    const c0 = THREE.MathUtils.clamp(Math.floor(fc), 0, width - 1);
    const r0 = THREE.MathUtils.clamp(Math.floor(fr), 0, height - 1);
    const c1 = Math.min(c0 + 1, width - 1);
    const r1 = Math.min(r0 + 1, height - 1);
    const tx = THREE.MathUtils.clamp(fc - c0, 0, 1);
    const tz = THREE.MathUtils.clamp(fr - r0, 0, 1);

    const h00 = heights[r0 * width + c0];
    const h10 = heights[r0 * width + c1];
    const h01 = heights[r1 * width + c0];
    const h11 = heights[r1 * width + c1];

    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(h00, h10, tx),
      THREE.MathUtils.lerp(h01, h11, tx),
      tz,
    );
  };

  const dispose = () => {
    geometry.dispose();
    material.material.map?.dispose();
    material.material.dispose();
    hillshade?.dispose();
    overlay.dispose();
  };

  return { mesh, sample, minZ, maxZ, heights, insideMask, projection, material, overlay, dispose };
}
