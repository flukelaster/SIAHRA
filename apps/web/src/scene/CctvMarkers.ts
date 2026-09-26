import * as THREE from "three";
import type { AoiManifest, CctvCamera, ItiCCamera } from "@siahra/shared-types";
import { createLocalProjection } from "./localProjection";

/** Sprite size in CSS px (sizeAttenuation off) — เล็กกว่าหมุดเขื่อนใหญ่ ไม่แย่งสายตาจากค่าตรวจวัด */
const MARKER_PX = 18;

export interface CctvMarkerResult {
  /** Screen-sized icons — lives OUTSIDE the exaggerated world group (handles.markers). */
  dots: THREE.Group;
  count: number;
  applyExaggeration: (factor: number) => void;
  dispose: () => void;
}

let sharedTexture: THREE.CanvasTexture | null = null;
let sharedIticTexture: THREE.CanvasTexture | null = null;
let sharedIticSnapshotTexture: THREE.CanvasTexture | null = null;

/**
 * ไอคอนกล้องสีเดียวทุกตัว (E15) — หมุดบอกแค่ "ตรงนี้มีกล้องของ DWR" ไม่ได้เข้ารหัสค่าใด ๆ
 * (ไม่มีสีตามความสด: ความสดรู้ได้ต่อเมื่อดึงภาพ ซึ่งเกิดเฉพาะตอนคลิก)
 */
function cameraTexture(): THREE.CanvasTexture {
  if (sharedTexture) return sharedTexture;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(32, 32, 24, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(10,16,30,0.88)";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
  // ตัวกล้อง + เลนส์
  ctx.fillStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.roundRect(15, 23, 26, 18, 3);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(41, 28);
  ctx.lineTo(50, 23);
  ctx.lineTo(50, 41);
  ctx.lineTo(41, 36);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#0ea5e9";
  ctx.beginPath();
  ctx.arc(28, 32, 5, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedTexture = tex;
  return tex;
}

/** พื้นสี่เหลี่ยมมุมมนสีอำพันของหมุด iTIC ทั้งสองแบบ — คืน context ไว้วาดสัญลักษณ์ต่อ */
function iticTile(): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.roundRect(9, 9, 46, 46, 11);
  ctx.fillStyle = "rgba(120,53,15,0.92)";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#fbbf24";
  ctx.stroke();
  return { c, ctx };
}

/**
 * ไอคอนกล้องถนนของ iTIC (E15.2) — ต่างจากกล้อง DWR ทั้งรูปทรง (สี่เหลี่ยมมุมมน ไม่ใช่วงกลม)
 * และสี (อำพัน) พร้อมสามเหลี่ยม "เล่น" = วิดีโอสด ไม่ใช่ภาพนิ่ง; ไม่ได้เข้ารหัสค่าใด ๆ เช่นกัน
 */
function iticTexture(): THREE.CanvasTexture {
  if (sharedIticTexture) return sharedIticTexture;
  const { c, ctx } = iticTile();
  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.moveTo(25, 20);
  ctx.lineTo(45, 32);
  ctx.lineTo(25, 44);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedIticTexture = tex;
  return tex;
}

/**
 * กล้อง iTIC ที่ให้ภาพนิ่งรีเฟรชอัตโนมัติ (`stream.kind = "jpeg"`) — พื้นเดียวกับหมุดวิดีโอ
 * (ยังเป็นกล้องถนนของ iTIC) แต่สัญลักษณ์เป็นรูปกล้อง ไม่ใช่สามเหลี่ยม "เล่น" เพื่อไม่ให้อ่านเป็นวิดีโอสด
 */
function iticSnapshotTexture(): THREE.CanvasTexture {
  if (sharedIticSnapshotTexture) return sharedIticSnapshotTexture;
  const { c, ctx } = iticTile();
  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.roundRect(17, 24, 30, 20, 3);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(25, 20, 10, 6, 2);
  ctx.fill();
  ctx.fillStyle = "rgba(120,53,15,1)";
  ctx.beginPath();
  ctx.arc(32, 34, 6, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedIticSnapshotTexture = tex;
  return tex;
}

/** กล้องของแหล่งไหน — กำหนดไอคอนและ `userData.kind` ที่ picking ส่งต่อให้ popup */
export type CctvMarkerSource =
  | { kind: "cctv"; cameras: readonly CctvCamera[] }
  | { kind: "itic"; cameras: readonly ItiCCamera[] };

/** หมุดกล้องทุกตัวในบัญชีที่ตกในกริดของจังหวัดนี้ (รวมกล้องของจังหวัดข้างเคียงที่อยู่ในกรอบ) */
export function buildCctvMarkers(
  manifest: AoiManifest,
  source: CctvMarkerSource,
  sampleGround: (x: number, z: number) => number,
  viewportHeightPx: number,
): CctvMarkerResult {
  const cameras: readonly (CctvCamera | ItiCCamera)[] = source.cameras;
  const proj = createLocalProjection(manifest);
  const dots = new THREE.Group();
  dots.name = `${source.kind}:dots`;
  const placed: { sprite: THREE.Sprite; groundY: number }[] = [];
  const makeMaterial = (map: THREE.Texture) =>
    new THREE.SpriteMaterial({ map, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true });
  const material = makeMaterial(source.kind === "itic" ? iticTexture() : cameraTexture());
  /** หมุดภาพนิ่งของ iTIC — สร้างเมื่อมีกล้องแบบนี้ในชุดจริงเท่านั้น */
  let snapshotMaterial: THREE.SpriteMaterial | null = null;
  const materialFor = (cam: CctvCamera | ItiCCamera): THREE.SpriteMaterial => {
    if (!("stream" in cam) || cam.stream.kind !== "jpeg") return material;
    snapshotMaterial ??= makeMaterial(iticSnapshotTexture());
    return snapshotMaterial;
  };
  for (const cam of cameras) {
    const [x, z] = proj.lonLatToLocal(cam.lon, cam.lat);
    if (!proj.insideGrid(x, z)) continue;
    const groundY = sampleGround(x, z);
    const sprite = new THREE.Sprite(materialFor(cam));
    sprite.scale.setScalar((MARKER_PX / Math.max(1, viewportHeightPx)) * 2);
    sprite.position.set(x, groundY, z);
    // กล้อง DWR อยู่บนกล้องถนนเมื่อทับกัน (หมุดริมน้ำสัมพันธ์กับชั้นอุทกภัยมากกว่า)
    sprite.renderOrder = source.kind === "itic" ? 30 : 31;
    sprite.userData = { kind: source.kind, camera: cam };
    dots.add(sprite);
    placed.push({ sprite, groundY });
  }
  return {
    dots,
    count: placed.length,
    applyExaggeration: (f) => {
      for (const p of placed) p.sprite.position.y = p.groundY * f;
    },
    // texture ใช้ร่วมกันทั้งแอป (สร้างครั้งเดียว) จึงทิ้งแค่ material ของชุดนี้
    dispose: () => {
      material.dispose();
      snapshotMaterial?.dispose();
    },
  };
}
