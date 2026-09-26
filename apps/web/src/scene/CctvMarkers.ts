import * as THREE from "three";
import { CAMERA_SOURCES, type AoiManifest, type Camera, type CameraStreamKind } from "@siahra/shared-types";
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

/** ไอคอนของหมุด: ชนิดของสตรีมหลัก (วิดีโอ/ภาพนิ่ง) × ตรวจแล้วตอน build (ok) หรือยังไม่ยืนยัน (หรี่) */
export interface MarkerStyle {
  kind: "video" | "still";
  /** สตรีมใดสตรีมหนึ่งของกล้องมี `probe.result === "ok"` — `not-probed` นับว่า *ยังไม่ยืนยัน* เช่นกัน */
  verified: boolean;
}

const VIDEO_KINDS: ReadonlySet<CameraStreamKind> = new Set(["hls", "mjpeg", "dwr-mjpeg"]);

/**
 * หมุดบอกแค่ "ตรงนี้มีกล้อง ชนิดไหน ตรวจแล้วหรือยัง" (E15.3) — ไม่ได้เข้ารหัสค่าใด ๆ และไม่บอกแหล่ง
 * (แหล่งอยู่ในแผงกล้อง/legend): ชนิด = สตรีมแรกของกล้อง (สตรีมค่าเริ่มต้นที่แผงเปิด) และ "ตรวจแล้ว"
 * = อย่างน้อยหนึ่งสตรีมตอบตอน build — สตรีมที่ไม่ตอบหรือไม่ได้ probe ทำให้หมุดหรี่ ไม่หายไป
 * (ไม่มีสีตามความสด: ความสดรู้ได้ต่อเมื่อดึงภาพ ซึ่งเกิดเฉพาะตอนคลิก)
 */
export function markerStyle(camera: Pick<Camera, "streams">): MarkerStyle {
  const first = camera.streams[0];
  return {
    kind: first && VIDEO_KINDS.has(first.kind) ? "video" : "still",
    verified: camera.streams.some((s) => s.probe.result === "ok"),
  };
}

const textures = new Map<string, THREE.CanvasTexture>();

/** สี glyph — ฟ้า (ตรงกับ swatch ใน MapLegend) / เทาเมื่อยังไม่ยืนยัน */
const GLYPH_VERIFIED = "#38bdf8";
const GLYPH_DIMMED = "#94a3b8";

/**
 * วงกลมพื้นเข้มขอบขาวหนึ่งแบบสำหรับทุกแหล่ง สัญลักษณ์ในวง: สามเหลี่ยม "เล่น" = วิดีโอ, รูปกล้อง =
 * ภาพนิ่ง; หมุดที่ยังไม่ยืนยันวาดจางลงทั้งหมุด (globalAlpha) และ glyph เป็นสีเทา — legend มี swatch
 * ที่ตรงกัน (`MapLegend.tsx` `CamSwatch`)
 */
function markerTexture(style: MarkerStyle): THREE.CanvasTexture {
  const key = `${style.kind}:${style.verified ? "ok" : "dim"}`;
  const cached = textures.get(key);
  if (cached) return cached;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.globalAlpha = style.verified ? 1 : 0.55;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(32, 32, 24, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(10,16,30,0.88)";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.strokeStyle = style.verified ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.55)";
  ctx.stroke();
  const glyph = style.verified ? GLYPH_VERIFIED : GLYPH_DIMMED;
  if (style.kind === "video") {
    ctx.fillStyle = glyph;
    ctx.beginPath();
    ctx.moveTo(25, 20);
    ctx.lineTo(45, 32);
    ctx.lineTo(25, 44);
    ctx.closePath();
    ctx.fill();
  } else {
    // ตัวกล้อง + เลนส์
    ctx.fillStyle = style.verified ? "#e2e8f0" : GLYPH_DIMMED;
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
    ctx.fillStyle = style.verified ? GLYPH_VERIFIED : "rgba(10,16,30,0.9)";
    ctx.beginPath();
    ctx.arc(28, 32, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, tex);
  return tex;
}

/**
 * หมุดกล้องทุกแหล่งในบัญชีรวมที่ตกในกริดของจังหวัดนี้ (รวมกล้องของจังหวัดข้างเคียงที่อยู่ในกรอบ) —
 * กลุ่มเดียว material สูงสุดสี่แบบ (ชนิด × ยืนยัน) และ `renderOrder` ตาม `markerPriority` ของแหล่ง
 * (หมุดริมน้ำของ DWR อยู่บนกล้องถนนเมื่อทับกัน)
 */
export function buildCctvMarkers(
  manifest: AoiManifest,
  cameras: readonly Camera[],
  sampleGround: (x: number, z: number) => number,
  viewportHeightPx: number,
): CctvMarkerResult {
  const proj = createLocalProjection(manifest);
  const dots = new THREE.Group();
  dots.name = "cameras:dots";
  const placed: { sprite: THREE.Sprite; groundY: number }[] = [];
  /** material ต่อรูปแบบ — สร้างเมื่อมีกล้องแบบนั้นในชุดจริงเท่านั้น */
  const materials = new Map<string, THREE.SpriteMaterial>();
  const materialFor = (style: MarkerStyle): THREE.SpriteMaterial => {
    const key = `${style.kind}:${style.verified}`;
    let m = materials.get(key);
    if (!m) {
      m = new THREE.SpriteMaterial({
        map: markerTexture(style),
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      });
      materials.set(key, m);
    }
    return m;
  };
  for (const cam of cameras) {
    const [x, z] = proj.lonLatToLocal(cam.lon, cam.lat);
    if (!proj.insideGrid(x, z)) continue;
    const groundY = sampleGround(x, z);
    const sprite = new THREE.Sprite(materialFor(markerStyle(cam)));
    sprite.scale.setScalar((MARKER_PX / Math.max(1, viewportHeightPx)) * 2);
    sprite.position.set(x, groundY, z);
    sprite.renderOrder = CAMERA_SOURCES[cam.sourceId].markerPriority;
    sprite.userData = { kind: "camera", camera: cam };
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
      for (const m of materials.values()) m.dispose();
    },
  };
}
