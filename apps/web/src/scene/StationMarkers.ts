import * as THREE from "three";
import type { AoiManifest, RainfallObservation, WaterLevelObservation } from "@siahra/shared-types";
import { createLocalProjection } from "./localProjection";

/** Sprite size in CSS pixels (sizeAttenuation is off, so it is constant). */
const DOT_PX = 8;
const HAZARD_DOT_PX = 15;
const RING_RADIUS_M = 2600;
const PULSE_PERIOD_S = 2.6;

export interface StationMarkerResult {
  /** Screen-sized dots — lives OUTSIDE the exaggerated world group. */
  dots: THREE.Group;
  /**
   * Stations with nothing to report (dry gauges, normal water levels).
   * A child of `dots`; the caller hides it at province scale so the map is
   * not carpeted with idle markers, and shows it once zoomed in.
   */
  quietDots: THREE.Group;
  /** Flat, ground-hugging pulse rings — lives INSIDE the world group. */
  rings: THREE.Group;
  /** Stations that actually fall inside the AOI bounds. */
  visibleCount: number;
  /** Stations at warning level or above (heavy rain / high water). */
  hazardCount: number;
  applyExaggeration: (factor: number) => void;
  /** Stale/unreachable source: markers fade so old readings don't look live. */
  setDimmed: (dimmed: boolean) => void;
  tick: (timeS: number) => void;
  dispose: () => void;
}

export function rainColor(mm: number): number {
  if (mm >= 90) return 0xef4444;
  if (mm >= 35) return 0xf97316;
  if (mm >= 10) return 0xeab308;
  return 0x38bdf8;
}

export function situationColor(level: number | null): number {
  if (level === 5) return 0xef4444;
  if (level === 4) return 0xf97316;
  if (level === 1 || level === 2) return 0xfcd34d;
  return 0x22c55e;
}

/**
 * Historical snapshots carry no ThaiWater situation level (it is only
 * published for the live reading), so colour by freeboard — plain arithmetic
 * on two observed numbers (bank height − water level), labelled as such.
 */
export function freeboardColor(freeboardM: number | null): number {
  if (freeboardM === null) return 0x64748b;
  if (freeboardM <= 0) return 0xef4444;
  if (freeboardM <= 1) return 0xf97316;
  return 0x38bdf8;
}

const spriteTextureCache = new Map<string, THREE.CanvasTexture>();

/** Round dot with a white rim and a soft glow, cached per colour/shape. */
function dotTexture(colorHex: number, shape: "circle" | "diamond"): THREE.CanvasTexture {
  const key = `${colorHex}:${shape}`;
  const cached = spriteTextureCache.get(key);
  if (cached) return cached;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const color = `#${colorHex.toString(16).padStart(6, "0")}`;
  const cx = size / 2;
  const cy = size / 2;

  const glow = ctx.createRadialGradient(cx, cy, 6, cx, cy, size / 2);
  glow.addColorStop(0, `${color}aa`);
  glow.addColorStop(1, `${color}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.beginPath();
  if (shape === "circle") ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  else {
    ctx.moveTo(cx, cy - 16);
    ctx.lineTo(cx + 16, cy);
    ctx.lineTo(cx, cy + 16);
    ctx.lineTo(cx - 16, cy);
    ctx.closePath();
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  spriteTextureCache.set(key, texture);
  return texture;
}

export function buildStationMarkers(
  manifest: AoiManifest,
  rainfall: RainfallObservation[],
  waterlevel: WaterLevelObservation[],
  sampleGround: (x: number, z: number) => number,
  viewportHeightPx: number,
): StationMarkerResult {
  const proj = createLocalProjection(manifest);
  const dots = new THREE.Group();
  dots.name = "stations:dots";
  const quietDots = new THREE.Group();
  quietDots.name = "stations:dots:quiet";
  dots.add(quietDots);
  const rings = new THREE.Group();
  rings.name = "stations:rings";
  let visibleCount = 0;
  let hazardCount = 0;

  const spriteScale = (DOT_PX / Math.max(1, viewportHeightPx)) * 2;
  const placed: { sprite: THREE.Sprite; groundY: number; baseOpacity: number }[] = [];
  const pulses: { mesh: THREE.Mesh; phase: number; material: THREE.MeshBasicMaterial }[] = [];
  const ringGeometry = new THREE.RingGeometry(0.82, 1, 64);
  ringGeometry.rotateX(-Math.PI / 2);

  const addStation = (
    lon: number,
    lat: number,
    color: number,
    shape: "circle" | "diamond",
    hazard: number, // 0 = none, 1 = warning, 2 = severe
    quiet: boolean,
    pick: { kind: "waterlevel"; obs: WaterLevelObservation } | { kind: "rainfall"; obs: RainfallObservation },
  ) => {
    const [x, z] = proj.lonLatToLocal(lon, lat);
    if (!proj.insideGrid(x, z)) return;
    visibleCount++;
    const groundY = sampleGround(x, z);

    const material = new THREE.SpriteMaterial({
      map: dotTexture(color, shape),
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      // Quiet stations stay legible but recede; hazards pop.
      opacity: hazard > 0 ? 1 : 0.62,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(spriteScale * (hazard > 0 ? HAZARD_DOT_PX / DOT_PX : 1));
    sprite.position.set(x, groundY, z);
    sprite.userData = pick;
    sprite.renderOrder = 30 + hazard;
    (quiet ? quietDots : dots).add(sprite);
    placed.push({ sprite, groundY, baseOpacity: material.opacity });

    if (hazard > 0) {
      hazardCount++;
      for (let k = 0; k < 2; k++) {
        const ringMaterial = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(ringGeometry, ringMaterial);
        mesh.position.set(x, groundY + 12, z);
        mesh.renderOrder = 25;
        rings.add(mesh);
        pulses.push({ mesh, phase: k / 2, material: ringMaterial });
      }
    }
  };

  for (const w of waterlevel) {
    const level = w.situationLevel ?? 0;
    if (w.situationLevel === null && w.observedAt !== null && w.waterlevelMsl === null && w.waterlevelLocalM === null) continue;
    const historical = w.situationLevel === null;
    const hazard = historical
      ? w.freeboardM !== null && w.freeboardM <= 0
        ? 2
        : w.freeboardM !== null && w.freeboardM <= 1
          ? 1
          : 0
      : level >= 5
        ? 2
        : level === 4
          ? 1
          : 0;
    addStation(
      w.station.lon,
      w.station.lat,
      historical ? freeboardColor(w.freeboardM) : situationColor(w.situationLevel),
      "circle",
      hazard,
      historical ? hazard === 0 && w.freeboardM === null : level === 3 || level === 0,
      { kind: "waterlevel", obs: w },
    );
  }
  for (const r of rainfall) {
    const mm = r.rain24h ?? 0;
    addStation(
      r.station.lon,
      r.station.lat,
      rainColor(mm),
      "diamond",
      mm >= 90 ? 2 : mm >= 35 ? 1 : 0,
      mm < 10,
      { kind: "rainfall", obs: r },
    );
  }

  return {
    dots,
    quietDots,
    rings,
    visibleCount,
    hazardCount,
    applyExaggeration: (factor) => {
      for (const p of placed) p.sprite.position.y = p.groundY * factor;
    },
    setDimmed: (dimmed) => {
      for (const p of placed) p.sprite.material.opacity = p.baseOpacity * (dimmed ? 0.35 : 1);
      rings.visible = !dimmed;
    },
    tick: (timeS) => {
      for (const p of pulses) {
        const t = ((timeS / PULSE_PERIOD_S + p.phase) % 1 + 1) % 1;
        const s = RING_RADIUS_M * (0.15 + 0.85 * t);
        p.mesh.scale.set(s, 1, s);
        p.material.opacity = 0.75 * (1 - t) * (1 - t);
      }
    },
    dispose: () => {
      ringGeometry.dispose();
      for (const p of placed) p.sprite.material.dispose();
      for (const p of pulses) p.material.dispose();
    },
  };
}
