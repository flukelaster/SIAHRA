import * as THREE from "three";
import type { AoiManifest, DamObservation } from "@siahra/shared-types";
import { makeLabel } from "./labels";
import type { Lang, TFunction } from "../i18n";
import { createLocalProjection } from "./localProjection";
import { damDisplayName } from "../lib/damName";

/** Sprite size in CSS px (sizeAttenuation off). */
const LARGE_PX = 22;
const MEDIUM_PX = 14;

export interface DamMarkerResult {
  /** Screen-sized icons — lives OUTSIDE the exaggerated world group. */
  dots: THREE.Group;
  /** Labels — inside the world group. */
  labels: THREE.Group;
  count: number;
  applyExaggeration: (factor: number) => void;
  dispose: () => void;
}

/** Storage-percent colour: low = amber, normal = blue, high = orange, over = red. */
export function damColor(pct: number | null): number {
  if (pct === null) return 0x94a3b8;
  if (pct >= 100) return 0xef4444;
  if (pct >= 80) return 0xf97316;
  if (pct < 30) return 0xfbbf24;
  return 0x38bdf8;
}

const cache = new Map<string, THREE.CanvasTexture>();

/** Rounded square with a fill bar showing % of capacity. */
function damTexture(color: number, pct: number | null): THREE.CanvasTexture {
  const key = `${color}:${pct === null ? "n" : Math.round(pct / 5) * 5}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const hex = `#${color.toString(16).padStart(6, "0")}`;
  const r = 10;
  const x0 = 10;
  const y0 = 10;
  const w = 44;
  const h = 44;
  const round = () => {
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r);
    ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
    ctx.arcTo(x0, y0 + h, x0, y0, r);
    ctx.arcTo(x0, y0, x0 + w, y0, r);
    ctx.closePath();
  };
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 6;
  round();
  ctx.fillStyle = "rgba(10,16,30,0.85)";
  ctx.fill();
  ctx.shadowBlur = 0;
  // Fill from bottom to the storage percentage.
  const frac = pct === null ? 0 : Math.max(0.04, Math.min(1, pct / 100));
  ctx.save();
  round();
  ctx.clip();
  ctx.fillStyle = hex;
  ctx.fillRect(x0, y0 + h * (1 - frac), w, h * frac);
  ctx.restore();
  round();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

export function buildDamMarkers(
  manifest: AoiManifest,
  dams: DamObservation[],
  sampleGround: (x: number, z: number) => number,
  viewportHeightPx: number,
  /** ภาษาปัจจุบัน — ชื่อเขื่อนมาจากต้นทาง (nameTh/nameEn) ไม่ได้แปลเอง */
  lang: Lang,
  t: TFunction,
): DamMarkerResult {
  const proj = createLocalProjection(manifest);
  const dots = new THREE.Group();
  dots.name = "dams:dots";
  const labels = new THREE.Group();
  labels.name = "dams:labels";
  const placed: { sprite: THREE.Sprite; groundY: number }[] = [];
  let count = 0;
  for (const d of dams) {
    const [x, z] = proj.lonLatToLocal(d.lon, d.lat);
    if (!proj.insideGrid(x, z)) continue;
    count++;
    const groundY = sampleGround(x, z);
    const px = d.kind === "large" ? LARGE_PX : MEDIUM_PX;
    const material = new THREE.SpriteMaterial({
      map: damTexture(damColor(d.storagePercent), d.storagePercent),
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar((px / Math.max(1, viewportHeightPx)) * 2);
    sprite.position.set(x, groundY, z);
    sprite.renderOrder = 32;
    sprite.userData = { kind: "dam", dam: d };
    dots.add(sprite);
    placed.push({ sprite, groundY });
    if (d.kind === "large" || (d.storagePercent !== null && (d.storagePercent >= 80 || d.storagePercent < 30))) {
      labels.add(
        makeLabel(
          damDisplayName(d, lang, t),
          d.storagePercent !== null
            ? t("scene.damCapacity", { n: d.storagePercent.toFixed(0) })
            : t("scene.damNoCapacity"),
          d.storagePercent !== null && d.storagePercent >= 100 ? "severe" : d.storagePercent !== null && d.storagePercent >= 80 ? "warning" : "info",
          new THREE.Vector3(x, groundY + 40, z),
          d.kind === "large" ? 70 : 20,
        ),
      );
    }
  }
  return {
    dots,
    labels,
    count,
    applyExaggeration: (f) => {
      for (const p of placed) p.sprite.position.y = p.groundY * f;
    },
    dispose: () => {
      for (const p of placed) p.sprite.material.dispose();
    },
  };
}
