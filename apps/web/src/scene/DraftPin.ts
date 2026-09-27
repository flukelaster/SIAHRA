import * as THREE from "three";
import { COMMUNITY_PIN_RIM } from "../lib/communityReports";

/**
 * หมุดชั่วคราวของรายงานที่กำลังกรอก (โหมดปักหมุด) — **ไม่ใช่รายงาน**: ยังไม่ได้ส่ง ไม่มีใครเห็นนอกจากผู้ใช้เอง
 * รูปจึงต่างจากหมุดรายงานจริง (`CommunityMarkers.ts`) ชัดเจน: หยดน้ำโปร่งไม่มีพื้นทึบ ขอบเส้นประชมพูเดียวกับ
 * ชิป crowdsourced และกากบาทตรงกลาง ไม่มี glyph ของหมวด
 *
 * sprite ขนาดคงที่บนจอ (`sizeAttenuation: false`, ปิด depthTest) อยู่ใน `handles.markers` แบบเดียวกับหมุดอื่น —
 * `userData` ว่าง `pickAt` จึงไม่เคยเลือกมัน `renderOrder` สูงกว่าหมุดทุกชนิด (เห็นเสมอระหว่างย้าย)
 */

const MARKER_PX = 30;
export const DRAFT_PIN_RENDER_ORDER = 60;

let texture: THREE.CanvasTexture | null = null;

function draftTexture(): THREE.CanvasTexture {
  if (texture) return texture;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  // หยดน้ำ: วงกลมบน + ปลายแหลมลงที่จุด (32, 62)
  const path = () => {
    ctx.beginPath();
    ctx.arc(32, 24, 17, Math.PI * 0.8, Math.PI * 0.2);
    ctx.lineTo(32, 61);
    ctx.closePath();
  };
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 4;
  path();
  ctx.fillStyle = "rgba(236,72,153,0.18)";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = COMMUNITY_PIN_RIM;
  path();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(32, 16);
  ctx.lineTo(32, 32);
  ctx.moveTo(24, 24);
  ctx.lineTo(40, 24);
  ctx.stroke();
  texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface DraftPin {
  sprite: THREE.Sprite;
  /** ตำแหน่งบนพื้น — `groundY` = ความสูงจริง (ยังไม่คูณ exaggeration) */
  setGround: (x: number, groundY: number, z: number) => void;
  applyExaggeration: (factor: number) => void;
  dispose: () => void;
}

export function buildDraftPin(viewportHeightPx: number): DraftPin {
  const material = new THREE.SpriteMaterial({
    map: draftTexture(),
    sizeAttenuation: false,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = "community:draft";
  sprite.scale.setScalar((MARKER_PX / Math.max(1, viewportHeightPx)) * 2);
  sprite.center.set(0.5, 0.03);
  sprite.renderOrder = DRAFT_PIN_RENDER_ORDER;
  let groundY = 0;
  let factor = 1;
  return {
    sprite,
    setGround: (x, y, z) => {
      groundY = y;
      sprite.position.set(x, groundY * factor, z);
    },
    applyExaggeration: (f) => {
      factor = f;
      sprite.position.y = groundY * factor;
    },
    // texture ใช้ร่วมกันทั้งแอป
    dispose: () => material.dispose(),
  };
}
