import * as THREE from "three";
import type {
  DamObservation,
  EarthquakeEvent,
  FloodExtentFeature,
  RainfallObservation,
  WaterLevelObservation,
} from "@siahra/shared-types";
import { floodCellAt, type FloodCell, type FloodField, type FloodFieldGrid } from "./floodField";
import type { LocalProjection } from "./localProjection";
import type { SceneHandles } from "./setupScene";

/**
 * เซลล์ของฉาก Copernicus GFM ใต้จุดที่คลิก (E14.F5) + ฉากที่มันมาจาก — popup ต้อง
 * บอกเวลาบันทึกภาพของฉากนั้นเสมอ ไม่ใช่แค่ "ท่วม/ไม่ท่วม" ลอย ๆ
 */
export interface FloodCellPick extends FloodCell {
  sceneId: string;
  observedAt: string;
}

/** ฟิลด์ที่วาดอยู่ + กริดของมัน + ฉาก — `null` เมื่อไม่มีฉากในหน้าต่าง/ยังไม่โหลด */
export interface FloodFieldPickSource {
  field: FloodField;
  grid: FloodFieldGrid;
  scene: { sceneId: string; observedAt: string };
}

export type PickResult =
  | { kind: "waterlevel"; obs: WaterLevelObservation; anchor: THREE.Vector3 }
  | { kind: "rainfall"; obs: RainfallObservation; anchor: THREE.Vector3 }
  | { kind: "dam"; dam: DamObservation; anchor: THREE.Vector3 }
  | { kind: "quake"; event: EarthquakeEvent; anchor: THREE.Vector3 }
  | {
      kind: "ground";
      lon: number;
      lat: number;
      elevationM: number;
      flood: FloodExtentFeature | null;
      /** เซลล์ GFM ใต้จุดนี้ — null = ไม่มีฉากที่วาดอยู่ หรือจุดอยู่นอกกริด (ไม่ใช่ "แห้ง") */
      floodCell: FloodCellPick | null;
      anchor: THREE.Vector3;
    };

const raycaster = new THREE.Raycaster();

function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function featureContains(f: FloodExtentFeature, lon: number, lat: number): boolean {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    if (!poly.length || !pointInRing(lon, lat, poly[0])) continue;
    let inHole = false;
    for (let h = 1; h < poly.length; h++) if (pointInRing(lon, lat, poly[h])) inHole = true;
    if (!inHole) return true;
  }
  return false;
}

/**
 * Picks the most specific thing under a screen point: markers first (they
 * are screen-sized so they win at any zoom), then the ground — where the
 * clicked spot is turned into lon/lat, elevation and, if inside a satellite
 * flood polygon, that feature.
 */
export function pickAt(
  handles: SceneHandles,
  ndc: THREE.Vector2,
  opts: {
    projection: LocalProjection;
    terrainObjects: THREE.Object3D[];
    quakeGroup: THREE.Object3D | null;
    floodFeatures: FloodExtentFeature[];
    /** ฉาก GFM ที่วาดอยู่ (E14.F5) — ไม่ส่ง/null = ไม่มีฉาก ไม่ใส่ floodCell */
    floodField?: FloodFieldPickSource | null;
  },
): PickResult | null {
  raycaster.setFromCamera(ndc, handles.camera);
  // Sprites ignore sizeAttenuation in raycasting only in recent three; use a
  // generous threshold via the sprite's own bounds (three handles it).
  const markerHits = raycaster.intersectObjects(handles.markers.children, true);
  for (const hit of markerHits) {
    const ud = hit.object.userData as { kind?: string };
    if (ud.kind === "waterlevel" || ud.kind === "rainfall" || ud.kind === "dam") {
      const anchor = hit.object.getWorldPosition(new THREE.Vector3());
      return { ...(ud as PickResult), anchor } as PickResult;
    }
  }
  if (opts.quakeGroup) {
    const qh = raycaster.intersectObject(opts.quakeGroup, true).find((h) => (h.object.userData as { kind?: string }).kind === "quake");
    if (qh) return { kind: "quake", event: (qh.object.userData as { event: EarthquakeEvent }).event, anchor: qh.object.getWorldPosition(new THREE.Vector3()) };
  }
  const gh = raycaster.intersectObjects(opts.terrainObjects, true)[0];
  if (!gh) return null;
  // Undo the vertical exaggeration on the hit point for the anchor/elevation.
  const scaleY = handles.world.scale.y || 1;
  const [lon, lat] = opts.projection.localToLonLat(gh.point.x, gh.point.z);
  const elevationM = gh.point.y / scaleY;
  const flood = opts.floodFeatures.find((f) => featureContains(f, lon, lat)) ?? null;
  // เซลล์ GFM: พิกัดฉาก x/z ของจุดที่โดน (ไม่ขึ้นกับมาตราส่วนแนวดิ่ง) → เซลล์บนกริด overview
  const ff = opts.floodField ?? null;
  const cell = ff ? floodCellAt(ff.field, ff.grid, gh.point.x, gh.point.z) : null;
  const floodCell: FloodCellPick | null =
    ff && cell ? { ...cell, sceneId: ff.scene.sceneId, observedAt: ff.scene.observedAt } : null;
  return {
    kind: "ground",
    lon,
    lat,
    elevationM,
    flood,
    floodCell,
    anchor: new THREE.Vector3(gh.point.x, gh.point.y / scaleY, gh.point.z),
  };
}
