import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { AoiManifest } from "@siahra/shared-types";
import { createLocalProjection } from "./localProjection";

type Ring = [number, number][];
type Polygon = Ring[];

interface BuildingFeature {
  type: "Feature";
  properties: { building?: string; height?: number; heightSource?: string };
  geometry:
    | { type: "Polygon"; coordinates: Polygon }
    | { type: "MultiPolygon"; coordinates: Polygon[] };
}

interface BuildingCollection {
  type: "FeatureCollection";
  features: BuildingFeature[];
}

const CHUNK_SIZE = 2000;
const DEFAULT_HEIGHT_M = 6;
/** Sink each footprint slightly so it never floats over uneven terrain. */
const FOUNDATION_SINK_M = 4;

export interface BuildingLayerResult {
  mesh: THREE.Mesh;
  count: number;
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Builds one extruded footprint.
 *
 * Two geometry details that are easy to get wrong (and were, initially):
 *  - ExtrudeGeometry extrudes a shape drawn in the XY plane along +Z. After
 *    rotateX(-90°) a point (x, y, z) maps to (x, z, -y), so the shape's Y must
 *    be pre-negated to keep north/south from mirroring against the terrain.
 *  - The result sits at y=0, but this AOI's terrain is 300-560 m above sea
 *    level, so every footprint must be lifted onto the sampled ground height
 *    or it renders buried inside the terrain mesh.
 */
function polygonToGeometry(
  polygon: Polygon,
  height: number,
  toLocal: (e: number, n: number) => [number, number],
  sampleGround: (x: number, z: number) => number,
): THREE.BufferGeometry | null {
  const [outer, ...holes] = polygon;
  if (!outer || outer.length < 3) return null;

  let sumX = 0;
  let sumZ = 0;
  const outerPts = outer.map(([e, n]) => {
    const [x, z] = toLocal(e, n);
    sumX += x;
    sumZ += z;
    // Negate Z here so the post-rotation flip restores true orientation.
    return new THREE.Vector2(x, -z);
  });

  const shape = new THREE.Shape(outerPts);
  for (const hole of holes) {
    if (hole.length < 3) continue;
    shape.holes.push(
      new THREE.Path(
        hole.map(([e, n]) => {
          const [x, z] = toLocal(e, n);
          return new THREE.Vector2(x, -z);
        }),
      ),
    );
  }

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);

  const groundY = sampleGround(sumX / outer.length, sumZ / outer.length);
  geometry.translate(0, groundY - FOUNDATION_SINK_M, 0);

  return geometry;
}

export async function buildBuildingLayer(
  manifest: AoiManifest,
  sampleGround: (x: number, z: number) => number,
  onProgress?: (done: number, total: number) => void,
): Promise<BuildingLayerResult | null> {
  const buildings = manifest.buildings;
  if (!buildings) return null;

  // E8.3 — ชั้นนี้เป็นทางสำรองของ AOI รุ่นเก่าเท่านั้น: จังหวัดทั้ง 77 ใช้ tile
  // pyramid (BuildingTiles) ซึ่งสตรีมเองและไม่ต้องมี geojson อีกแล้ว ถ้า
  // manifest มี tiles ก็ไม่ควรมาถึงที่นี่ — Map3DCanvas เรียกฟังก์ชันนี้เฉพาะตอน
  // ไม่มี BuildingTileLayer เท่านั้น
  if (buildings.tiles) {
    console.warn(
      `[buildings] ${manifest.aoiId}: manifest มี tile pyramid แต่ชั้น tile ไม่ได้ถูกสร้าง ` +
        `(ต้องมี terrain.tiles ด้วย) — ไม่แสดงอาคาร`,
    );
    return null;
  }
  // ไม่มีทั้ง tiles และ url = ไม่มีข้อมูลอาคารสำหรับ AOI นี้ ต้องเงียบแบบเห็นได้
  // (คำเตือนใน console + attribution นับ 0 หลัง) ไม่ใช่โยน error ทั้งฉาก
  if (!buildings.url) {
    console.warn(`[buildings] ${manifest.aoiId}: manifest ไม่มีทั้ง buildings.tiles และ buildings.url — ไม่แสดงอาคาร`);
    return null;
  }

  // การโหลดล้มเหลวต้องไม่ทำให้ทั้งฉากขึ้น error: static host ตอบ 404 ด้วย SPA
  // shell ได้ (`.json()` จะพังตรงนั้น) ซึ่งเป็นอาการเดียวกับที่ docs/deploy.md §2
  // เตือนไว้เรื่อง tile — ชั้นอาคารเป็นชั้นเสริม จึงยอมหายไปทั้งชั้นแทน
  let collection: BuildingCollection;
  try {
    const res = await fetch(buildings.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    collection = (await res.json()) as BuildingCollection;
    if (!Array.isArray(collection?.features)) throw new Error("ไม่ใช่ FeatureCollection");
  } catch (err) {
    console.warn(`[buildings] ${manifest.aoiId}: โหลด ${buildings.url} ไม่สำเร็จ — ไม่แสดงอาคาร`, err);
    return null;
  }

  const { toLocal } = createLocalProjection(manifest);
  const total = collection.features.length;
  const geometries: THREE.BufferGeometry[] = [];

  for (let i = 0; i < total; i++) {
    const feature = collection.features[i];
    const height = feature.properties.height ?? DEFAULT_HEIGHT_M;
    const polygons =
      feature.geometry.type === "MultiPolygon"
        ? feature.geometry.coordinates
        : [feature.geometry.coordinates];

    for (const polygon of polygons) {
      const geom = polygonToGeometry(polygon, height, toLocal, sampleGround);
      if (geom) geometries.push(geom);
    }

    if (i % CHUNK_SIZE === CHUNK_SIZE - 1) {
      onProgress?.(i + 1, total);
      await yieldToMainThread();
    }
  }
  onProgress?.(total, total);

  if (geometries.length === 0) return null;

  const merged = mergeGeometries(geometries, false);
  geometries.forEach((g) => g.dispose());
  merged.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0xd6d9de,
    roughness: 0.8,
    metalness: 0.05,
  });

  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `buildings:${manifest.aoiId}`;
  return { mesh, count: total };
}
