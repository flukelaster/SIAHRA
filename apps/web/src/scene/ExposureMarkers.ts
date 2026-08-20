import * as THREE from "three";
import type { AoiManifest, StationExposure } from "@siahra/shared-types";
import {
  exposureHex,
  exposureRenderClass,
  type ExposureRenderClass,
} from "../lib/exposureStyle";
import { createLocalProjection } from "./localProjection";
import { disposeLabels, makeLabel } from "./labels";
import type { TFunction } from "../i18n";

/**
 * หมุดของชั้น "ระดับการเผชิญน้ำ (ภาพประกอบ)" (E10.4)
 *
 * ทำไมต้องมีหมุด ทั้งที่ shader ระบายลงบนภูมิประเทศอยู่แล้ว: การระบาย **ถูกคุมด้วย
 * แชนแนลพื้นที่ลุ่มต่ำ** ตามนิยามของชั้น (เฉพาะที่ลุ่มต่ำเท่านั้นที่ติดสี) สถานีที่อยู่
 * บนที่ดอนจึงไม่มีอะไรวาดออกมาเลย — และสถานีประเภทที่ **ห้ามหายไปที่สุด** คือสถานีที่
 * "ไม่มีปัจจัยใดวัดได้" ซึ่งจะบังเอิญเงียบหายไปพร้อมกัน หมุดจึงเป็นชั้นที่ไม่ถูกคุมด้วย
 * พื้นที่ลุ่มต่ำ: ทุกสถานีใน run ถูกวาด และสองสถานะของคำว่า `low` ถูกวาดคนละแบบ
 *
 *   - แถบที่วัดได้ (low/elevated/high/severe) → วงกลมทึบ สีตาม ramp ใน
 *     `lib/exposureStyle.ts` โตขึ้นตามแถบ
 *   - ไม่มีปัจจัยใดวัดได้                      → **วงแหวนกลวง เส้นประ สีเทา + "?"**
 *     พร้อมป้ายกำกับบนแผนที่ ไม่ใช้สีของแถบต่ำสุด และไม่ใช่ความว่างเปล่า เพราะสถานี
 *     ที่ไม่มีใครวัดไม่ใช่สถานีที่ปลอดภัย (AGENTS.md — ข้อมูลที่ขาดต้องยังเห็นอยู่)
 *
 * ชั้นนี้ถูกปิดทั้งชุดเมื่อ `terrain.bin` ไม่ผ่านการตรวจลายเซ็น (E9.1): ผู้เรียกไม่สร้าง
 * หมุดเลย เพราะระดับความสูงที่ใช้วางหมุดมาจาก DEM ก้อนเดียวกับที่เชื่อไม่ได้
 */

/** ขนาดหมุดเป็นพิกเซลบนจอ (sizeAttenuation ปิด ขนาดจึงคงที่ทุกระยะ) */
const DOT_PX: Record<ExposureRenderClass, number> = {
  low: 9,
  elevated: 14,
  high: 17,
  severe: 20,
  // เท่ากับแถบ "สูง" โดยตั้งใจ — สถานะนี้ต้องไม่ดูเล็กกว่าหรือด้อยกว่าค่าที่วัดได้
  "no-data": 17,
};

/** ความทึบของหมุด — แถบต่ำสุดเงียบที่สุด แต่ยังอ่านออก */
const OPACITY: Record<ExposureRenderClass, number> = {
  low: 0.55,
  elevated: 0.9,
  high: 1,
  severe: 1,
  "no-data": 0.92,
};

/**
 * ป้ายกำกับสถานี "ไม่มีข้อมูล" มากสุดกี่ป้าย ก่อนที่แผนที่จะรกจนอ่านไม่ออก
 *
 * ตั้งไว้ต่ำโดยตั้งใจ: จังหวัดที่มีสถานีเงียบ 29 ตัว (นครราชสีมา) จะถูกป้ายกลบทั้ง
 * จังหวัด สิ่งที่แบกความหมายจริง ๆ คือ **วงแหวนประทุกตัว** ซึ่งไม่มีเพดาน ป้ายเป็น
 * เพียงคำอธิบายว่าวงแหวนนั้นแปลว่าอะไร (และ legend เรียกชื่อสถานะนี้ไว้อีกที่)
 */
const MAX_NO_DATA_LABELS = 3;

export interface ExposureMarkerResult {
  /** หมุดขนาดคงที่บนจอ — อยู่ **นอก** กลุ่มที่ถูกยืดตามค่า exaggeration */
  dots: THREE.Group;
  /** ป้ายกำกับของสถานีที่ไม่มีปัจจัยใดวัดได้ — อยู่ **ใน** กลุ่ม world */
  labels: THREE.Group;
  /** จำนวนสถานีที่วาดจริง (ตกอยู่ในกริดของจังหวัด) แยกตามสถานะ */
  counts: Record<ExposureRenderClass, number>;
  applyExaggeration: (factor: number) => void;
  /** ไม่มีผลคำนวณรอบใหม่ = หรี่ลง ไม่ใช่ซ่อน */
  setDimmed: (dimmed: boolean) => void;
  dispose: () => void;
}

const textureCache = new Map<string, THREE.CanvasTexture>();

/**
 * รูปหมุดหนึ่งแบบ (แคชตามสถานะ) — วงกลมทึบสำหรับแถบที่วัดได้ และวงแหวนกลวงเส้นประ
 * พร้อมเครื่องหมายคำถามสำหรับสถานีที่ไม่มีปัจจัยใดวัดได้ ต่างกันทั้ง "เนื้อรูป" ไม่ใช่
 * แค่สี จึงแยกออกได้แม้ในภาพขาวดำหรือสำหรับคนตาบอดสี
 */
function markerTexture(cls: ExposureRenderClass): THREE.CanvasTexture {
  const cached = textureCache.get(cls);
  if (cached) return cached;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const color = `#${exposureHex(cls).toString(16).padStart(6, "0")}`;
  const c = size / 2;

  if (cls === "no-data") {
    // เส้นขอบเข้มรองไว้ก่อน แล้ววงประทับบน — วงแหวนบาง ๆ บนภาพดาวเทียมที่สว่าง
    // จะจมหายไปถ้าไม่มีคอนทราสต์รอง
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(4,8,18,0.85)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(c, c, 21, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.arc(c, c, 21, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(4,8,18,0.85)";
    ctx.strokeText("?", c, c + 1);
    ctx.fillStyle = color;
    ctx.fillText("?", c, c + 1);
  } else {
    const glow = ctx.createRadialGradient(c, c, 5, c, c, c);
    glow.addColorStop(0, `${color}99`);
    glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(c, c, 15, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // แคชระดับโมดูล: มีได้ห้าแบบเท่านั้น และถูกใช้ซ้ำข้ามจังหวัด จึงไม่ dispose ที่นี่
  // (รูปแบบเดียวกับ `StationMarkers.spriteTextureCache`) — ตัวที่ต้องคืนคือ material
  textureCache.set(cls, texture);
  return texture;
}

export function buildExposureMarkers(
  manifest: AoiManifest,
  stations: readonly StationExposure[],
  sampleGround: (x: number, z: number) => number,
  viewportHeightPx: number,
  t: TFunction,
): ExposureMarkerResult {
  const proj = createLocalProjection(manifest);
  const dots = new THREE.Group();
  dots.name = "exposure:dots";
  const labels = new THREE.Group();
  labels.name = "exposure:labels";
  const counts: Record<ExposureRenderClass, number> = {
    low: 0,
    elevated: 0,
    high: 0,
    severe: 0,
    "no-data": 0,
  };
  const placed: { sprite: THREE.Sprite; groundY: number; baseOpacity: number }[] = [];
  const pxToScale = 2 / Math.max(1, viewportHeightPx);
  let noDataLabels = 0;

  // เรียงให้แถบสูงและสถานะ "ไม่มีข้อมูล" ถูกวาดทีหลัง = อยู่บนสุดเวลาหมุดซ้อนกัน
  const order: Record<ExposureRenderClass, number> = {
    low: 0,
    elevated: 1,
    high: 2,
    severe: 3,
    "no-data": 4,
  };
  const sorted = [...stations].sort(
    (a, b) => order[exposureRenderClass(a)] - order[exposureRenderClass(b)],
  );

  for (const station of sorted) {
    const cls = exposureRenderClass(station);
    const [x, z] = proj.lonLatToLocal(station.lon, station.lat);
    if (!proj.insideGrid(x, z)) continue;
    counts[cls] += 1;
    const groundY = sampleGround(x, z);

    const material = new THREE.SpriteMaterial({
      map: markerTexture(cls),
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: OPACITY[cls],
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(DOT_PX[cls] * pxToScale);
    sprite.position.set(x, groundY, z);
    // ไม่ใช้คีย์ `kind` โดยตั้งใจ — `scene/picking.ts` เลือกวัตถุจากคีย์นั้น หมุดชุดนี้
    // จึงไม่ไปแย่งการคลิกของสถานีตรวจวัด แต่ยัง "ตรวจได้ด้วยโปรแกรม" ว่าอันไหนคือ
    // สถานีที่ไม่มีปัจจัยใดวัดได้ (ใช้ตอนตรวจรับด้วยภาพ)
    sprite.userData = { exposureClass: cls, stationId: station.stationId };
    sprite.renderOrder = 20 + order[cls];
    dots.add(sprite);
    placed.push({ sprite, groundY, baseOpacity: material.opacity });

    if (cls === "no-data" && noDataLabels < MAX_NO_DATA_LABELS) {
      noDataLabels += 1;
      labels.add(
        makeLabel(
          t("exposure.noData.label"),
          t("exposure.noData.sub"),
          "neutral",
          new THREE.Vector3(x, groundY + 30, z),
          -50,
        ),
      );
    }
  }

  return {
    dots,
    labels,
    counts,
    applyExaggeration: (factor) => {
      for (const p of placed) p.sprite.position.y = p.groundY * factor;
    },
    setDimmed: (dimmed) => {
      for (const p of placed) p.sprite.material.opacity = p.baseOpacity * (dimmed ? 0.4 : 1);
    },
    dispose: () => {
      for (const p of placed) p.sprite.material.dispose();
      // ป้ายเป็น DOM จริง ไม่ใช่ texture — ต้องถอดออกจากหน้า ไม่งั้นค้างสะสม
      disposeLabels(labels);
    },
  };
}
