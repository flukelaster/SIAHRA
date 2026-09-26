import * as THREE from "three";
import type { AoiManifest, CctvCamera } from "@siahra/shared-types";
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

/** หมุดกล้องทุกตัวในบัญชีที่ตกในกริดของจังหวัดนี้ (รวมกล้องของจังหวัดข้างเคียงที่อยู่ในกรอบ) */
export function buildCctvMarkers(
  manifest: AoiManifest,
  cameras: readonly CctvCamera[],
  sampleGround: (x: number, z: number) => number,
  viewportHeightPx: number,
): CctvMarkerResult {
  const proj = createLocalProjection(manifest);
  const dots = new THREE.Group();
  dots.name = "cctv:dots";
  const placed: { sprite: THREE.Sprite; groundY: number }[] = [];
  const material = new THREE.SpriteMaterial({
    map: cameraTexture(),
    sizeAttenuation: false,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  for (const cam of cameras) {
    const [x, z] = proj.lonLatToLocal(cam.lon, cam.lat);
    if (!proj.insideGrid(x, z)) continue;
    const groundY = sampleGround(x, z);
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar((MARKER_PX / Math.max(1, viewportHeightPx)) * 2);
    sprite.position.set(x, groundY, z);
    sprite.renderOrder = 31;
    sprite.userData = { kind: "cctv", camera: cam };
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
    dispose: () => material.dispose(),
  };
}
