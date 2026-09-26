import * as THREE from "three";
import { bboxContains, featureBbox } from "../lib/gistdaFlood";
import type {
  Camera,
  DamObservation,
  EarthquakeEvent,
  FloodExtentFeature,
  RainfallObservation,
  WaterLevelObservation,
} from "@siahra/shared-types";
import { floodCellAt, type FloodCell, type FloodField, type FloodFieldGrid } from "./floodField";
import type { LocalProjection } from "./localProjection";
import type { SceneHandles } from "./setupScene";
import type { StationSheetCellPick } from "./StationSheet";
import type { GistdaDepthCellPick } from "../lib/gistdaDepthField";

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
  /**
   * กล้อง CCTV ทุกแหล่ง (E15/E15.3) — แหล่งอยู่ใน `camera.sourceId`; ภาพ/สตรีมถูกขอเมื่อแผงกล้อง
   * เปิดเท่านั้น ไม่ใช่ตอนวาดหมุด
   */
  | { kind: "camera"; camera: Camera; anchor: THREE.Vector3 }
  | { kind: "quake"; event: EarthquakeEvent; anchor: THREE.Vector3 }
  | {
      kind: "ground";
      lon: number;
      lat: number;
      elevationM: number;
      flood: FloodExtentFeature | null;
      /** เซลล์ GFM ใต้จุดนี้ — null = ไม่มีฉากที่วาดอยู่ หรือจุดอยู่นอกกริด (ไม่ใช่ "แห้ง") */
      floodCell: FloodCellPick | null;
      /** เซลล์ของแผ่นน้ำจำลองจากสถานีใต้จุดนี้ — null = ชั้นซ่อน/ไม่มีแผ่นตรงนี้ (ไม่ใช่ "ไม่ท่วม") */
      stationSheet: StationSheetCellPick | null;
      /**
       * เซลล์ของแผ่นน้ำ GISTDA 3 มิติใต้จุดนี้ (E16 B-2) — null = ชั้นซ่อน/ไม่มีแผ่นตรงนี้/ฉาก GFM มาก่อน
       * (ไม่ใช่ "ไม่ท่วม") popup แสดงเฉพาะคู่กับเซลล์ GISTDA (`flood`) ที่ให้เวลาภาพ + ดาวเทียม
       */
      gistdaDepth: GistdaDepthCellPick | null;
      anchor: THREE.Vector3;
    };

/** แผ่นน้ำ GISTDA 3 มิติ (E16 B-2, `GistdaSheet.ts`) — null/ไม่ส่ง = ชั้นซ่อนหรือไม่มีแผ่น */
export interface GistdaSheetPickSource {
  cellAt: (x: number, z: number) => GistdaDepthCellPick | null;
}

/**
 * แผ่นน้ำจำลองจากระดับน้ำที่สถานี (E16 B-1, `StationSheet.ts`) — อ่านเซลล์ใต้จุดคลิกบนพื้น
 * null/ไม่ส่ง = ชั้นซ่อนหรือไม่มีแผ่น
 */
export interface StationSheetPickSource {
  cellAt: (x: number, z: number) => StationSheetCellPick | null;
}

const raycaster = new THREE.Raycaster();

/** ชนิดหมุดที่ `pickAt` ตอบกลับตรง ๆ จาก `userData` ของ sprite ใน `handles.markers` */
const MARKER_KINDS = new Set(["waterlevel", "rainfall", "dam", "camera"]);

/**
 * `userData` ของหมุดที่โดน → PickResult — null = ไม่ใช่หมุดที่คลิกได้ (เช่นฮาโลรอบสถานี)
 * แยกออกมาเป็นฟังก์ชันล้วนให้เทสได้โดยไม่ต้องมีกล้อง/raycaster
 */
export function markerPickFromUserData(ud: unknown, anchor: THREE.Vector3): PickResult | null {
  const kind = (ud as { kind?: unknown } | null)?.kind;
  if (typeof kind !== "string" || !MARKER_KINDS.has(kind)) return null;
  return { ...(ud as object), anchor } as PickResult;
}

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
  // E16.PR0: จังหวัดหนึ่งมีได้หลายพันเซลล์ — ตัดด้วยกรอบ (แคชต่อ feature) ก่อนเดิน ring
  const box = featureBbox(f);
  if (!box || !bboxContains(box, lon, lat)) return false;
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
    /** แผ่นน้ำจำลองจากระดับน้ำที่สถานี (E16 B-1) — ไม่ส่ง/null = ชั้นซ่อนหรือไม่มีแผ่น */
    stationSheet?: StationSheetPickSource | null;
    /** แผ่นน้ำ GISTDA 3 มิติ (E16 B-2) — ไม่ส่ง/null = ชั้นซ่อนหรือไม่มีแผ่น */
    gistdaSheet?: GistdaSheetPickSource | null;
  },
): PickResult | null {
  raycaster.setFromCamera(ndc, handles.camera);
  // Sprites ignore sizeAttenuation in raycasting only in recent three; use a
  // generous threshold via the sprite's own bounds (three handles it).
  const markerHits = raycaster.intersectObjects(handles.markers.children, true);
  for (const hit of markerHits) {
    const picked = markerPickFromUserData(hit.object.userData, hit.object.getWorldPosition(new THREE.Vector3()));
    if (picked) return picked;
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
    stationSheet: opts.stationSheet?.cellAt(gh.point.x, gh.point.z) ?? null,
    gistdaDepth: opts.gistdaSheet?.cellAt(gh.point.x, gh.point.z) ?? null,
    anchor: new THREE.Vector3(gh.point.x, gh.point.y / scaleY, gh.point.z),
  };
}
