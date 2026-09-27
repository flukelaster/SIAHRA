import * as THREE from "three";
import type { AoiManifest, CommunityCategory, CommunityReport } from "@siahra/shared-types";
import { createLocalProjection } from "./localProjection";
import {
  COMMUNITY_CATEGORY_COLOR,
  COMMUNITY_PIN_RIM,
  communityMarkerAlpha,
  communityRenderOrder,
  primaryCategory,
} from "../lib/communityReports";

/**
 * หมุดรายงานจากประชาชน (community report pins) — แบบเดียวกับ `CctvMarkers.ts`: sprite ขนาดคงที่บนจอ
 * (`sizeAttenuation: false`) อยู่นอกกลุ่มที่ถูกยืดแนวดิ่ง (`handles.markers`) วางบนพื้นด้วย `sampleGround`
 * และคูณ exaggeration เอง
 *
 * รูปหมุด: กรอบสี่เหลี่ยมมุมมนมีหางชี้ลง (ต่างจากวงกลมของสถานี/กล้อง) ขอบชมพูเดียวกับชิป "รายงานจาก
 * ประชาชน — ยังไม่ได้ตรวจสอบ" ทุกหมวด และ glyph วาดเองบน canvas ตามหมวดหลัก (หมวดแรก) — ไม่ใช้ emoji
 * เพราะฟอนต์ต่างกันทุกเครื่อง
 *
 * ความจาง (`communityMarkerAlpha`): ตามอายุ + โหวตค้าน — material ใช้ร่วมต่อ (หมวด, ขั้นความทึบ 0.05)
 * และ `setDimmed` (รอบล่าสุดของรายการล้มเหลว) คูณทับโดยไม่ลบค่าเดิม — หรี่ ไม่ใช่ซ่อน
 */

/** ขนาดหมุดบนจอ (CSS px) — ใหญ่กว่าหมุดกล้องเล็กน้อยเพราะมีหาง */
const MARKER_PX = 22;
/** ความทึบถูกปัดเป็นขั้นนี้ ให้ material ใช้ร่วมกันได้ (หมุดสูงสุด 500 ตัว) */
const ALPHA_STEP = 0.05;
/** คูณเมื่อรอบล่าสุดของรายการล้มเหลว */
const DIMMED_FACTOR = 0.5;

export interface CommunityMarkerResult {
  dots: THREE.Group;
  count: number;
  applyExaggeration: (factor: number) => void;
  setDimmed: (dimmed: boolean) => void;
  dispose: () => void;
}

const textures = new Map<CommunityCategory, THREE.CanvasTexture>();

/** glyph ของแต่ละหมวด — เส้น/รูปทรงง่าย ๆ บนพื้นที่ 64×64 ศูนย์กลางราว (32, 26) */
function drawGlyph(ctx: CanvasRenderingContext2D, category: CommunityCategory): void {
  const color = COMMUNITY_CATEGORY_COLOR[category];
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (category) {
    case "flood": {
      // คลื่นสามเส้น
      ctx.lineWidth = 3.5;
      for (const y of [18, 26, 34]) {
        ctx.beginPath();
        ctx.moveTo(19, y);
        ctx.bezierCurveTo(23, y - 5, 27, y + 5, 32, y);
        ctx.bezierCurveTo(37, y - 5, 41, y + 5, 45, y);
        ctx.stroke();
      }
      break;
    }
    case "road-blocked": {
      // ป้ายห้ามผ่าน: วงกลม + แถบขาว
      ctx.beginPath();
      ctx.arc(32, 26, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0a101e";
      ctx.fillRect(24, 23.5, 16, 5);
      break;
    }
    case "power-out": {
      // สายฟ้า
      ctx.beginPath();
      ctx.moveTo(35, 13);
      ctx.lineTo(24, 28);
      ctx.lineTo(31, 28);
      ctx.lineTo(28, 40);
      ctx.lineTo(40, 23);
      ctx.lineTo(33, 23);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "landslide": {
      // ลาดเขา + ก้อนหิน
      ctx.beginPath();
      ctx.moveTo(18, 38);
      ctx.lineTo(30, 15);
      ctx.lineTo(46, 38);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#0a101e";
      ctx.beginPath();
      ctx.arc(37, 32, 3, 0, Math.PI * 2);
      ctx.arc(30, 34, 2.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "fallen-tree": {
      // ต้นไม้ล้ม: ลำต้นเอียง + พุ่มกลม
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(18, 37);
      ctx.lineTo(34, 27);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(39, 22, 8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "building-damage": {
      // บ้าน + รอยร้าว
      ctx.beginPath();
      ctx.moveTo(20, 26);
      ctx.lineTo(32, 15);
      ctx.lineTo(44, 26);
      ctx.lineTo(44, 38);
      ctx.lineTo(20, 38);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#0a101e";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(33, 20);
      ctx.lineTo(29, 27);
      ctx.lineTo(34, 30);
      ctx.lineTo(30, 38);
      ctx.stroke();
      break;
    }
    case "other": {
      // เครื่องหมาย "!" ในวงกลม
      ctx.beginPath();
      ctx.arc(32, 26, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0a101e";
      ctx.fillRect(30.25, 18, 3.5, 10);
      ctx.beginPath();
      ctx.arc(32, 32.5, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

/** texture ต่อหมวด (สร้างครั้งเดียวทั้งแอป) — ความจางอยู่ที่ material ไม่ใช่ที่ texture */
function markerTexture(category: CommunityCategory): THREE.CanvasTexture {
  const cached = textures.get(category);
  if (cached) return cached;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 5;
  // กรอบมุมมน + หางชี้ลงที่จุดของรายงาน
  ctx.beginPath();
  ctx.roundRect(9, 4, 46, 44, 10);
  ctx.moveTo(26, 47);
  ctx.lineTo(32, 60);
  ctx.lineTo(38, 47);
  ctx.closePath();
  ctx.fillStyle = "rgba(10,16,30,0.92)";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.strokeStyle = COMMUNITY_PIN_RIM;
  ctx.stroke();
  drawGlyph(ctx, category);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  textures.set(category, tex);
  return tex;
}

/**
 * หมุดของรายงานที่ **กรองตามหน้าต่างเวลาแล้ว** (`reportsInWindow` ใน App.tsx) ที่ตกในกริดของจังหวัดนี้
 * `refMs` = เวลาที่ดูอยู่ (ย้อนหลัง = atIso, สด = ตอนนี้) ใช้คิดอายุ
 */
export function buildCommunityMarkers(
  manifest: AoiManifest,
  reports: readonly CommunityReport[],
  sampleGround: (x: number, z: number) => number,
  viewportHeightPx: number,
  refMs: number,
): CommunityMarkerResult {
  const proj = createLocalProjection(manifest);
  const dots = new THREE.Group();
  dots.name = "community:dots";
  const placed: { sprite: THREE.Sprite; groundY: number }[] = [];
  const materials = new Map<string, { material: THREE.SpriteMaterial; base: number }>();
  let dimmed = false;
  const materialFor = (category: CommunityCategory, alpha: number): THREE.SpriteMaterial => {
    const base = Math.max(ALPHA_STEP, Math.round(alpha / ALPHA_STEP) * ALPHA_STEP);
    const key = `${category}:${base.toFixed(2)}`;
    let m = materials.get(key);
    if (!m) {
      m = {
        material: new THREE.SpriteMaterial({
          map: markerTexture(category),
          sizeAttenuation: false,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: base * (dimmed ? DIMMED_FACTOR : 1),
        }),
        base,
      };
      materials.set(key, m);
    }
    return m.material;
  };
  // ใหม่สุดวาดบนสุด (API ส่งมาใหม่สุดก่อน) — หมุดที่ทับกันจึงเห็นรายงานล่าสุด
  const count = reports.length;
  reports.forEach((r, i) => {
    const [x, z] = proj.lonLatToLocal(r.lon, r.lat);
    if (!proj.insideGrid(x, z)) return;
    const groundY = sampleGround(x, z);
    const sprite = new THREE.Sprite(materialFor(primaryCategory(r), communityMarkerAlpha(r, refMs)));
    const s = (MARKER_PX / Math.max(1, viewportHeightPx)) * 2;
    sprite.scale.setScalar(s);
    // หางอยู่ล่างสุดของรูป — ยกศูนย์กลางขึ้นให้ปลายหางแตะจุดของรายงาน
    sprite.center.set(0.5, 0.06);
    sprite.position.set(x, groundY, z);
    // เหนือหมุดกล้องทุกแหล่ง (`COMMUNITY_RENDER_ORDER_BASE`) — การคลิกเลือกตัวที่วาดบนสุดเช่นกัน
    sprite.renderOrder = communityRenderOrder(i, count);
    sprite.userData = { kind: "community", report: r };
    dots.add(sprite);
    placed.push({ sprite, groundY });
  });
  return {
    dots,
    count: placed.length,
    applyExaggeration: (f) => {
      for (const p of placed) p.sprite.position.y = p.groundY * f;
    },
    setDimmed: (d) => {
      dimmed = d;
      for (const m of materials.values()) m.material.opacity = m.base * (d ? DIMMED_FACTOR : 1);
    },
    // texture ใช้ร่วมกันทั้งแอป จึงทิ้งแค่ material ของชุดนี้
    dispose: () => {
      for (const m of materials.values()) m.material.dispose();
    },
  };
}
