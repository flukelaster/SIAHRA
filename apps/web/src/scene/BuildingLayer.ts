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
  if (!manifest.buildings) return null;

  const collection: BuildingCollection = await fetch(manifest.buildings.url).then((r) => r.json());
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
