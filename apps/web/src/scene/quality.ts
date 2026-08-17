import type { SceneHandles } from "./setupScene";
import type { TerrainTileTree } from "./TerrainTiles";

export type QualityMode = "auto" | "high" | "balanced" | "low";
export type QualityLevel = "high" | "balanced" | "low";

interface Preset {
  pixelRatio: number;
  shadows: boolean;
  splitFactor: number;
  imageryZoomOffset: number;
}

const PRESETS: Record<QualityLevel, Preset> = {
  high: { pixelRatio: 2, shadows: true, splitFactor: 2.3, imageryZoomOffset: 0 },
  balanced: { pixelRatio: 1.5, shadows: true, splitFactor: 2.0, imageryZoomOffset: 0 },
  low: { pixelRatio: 1, shadows: false, splitFactor: 1.6, imageryZoomOffset: -1 },
};

/**
 * Picks rendering quality from the measured frame time (auto) or a fixed
 * preset. Steps down quickly when frames get slow (>33 ms sustained) and back
 * up cautiously (<14 ms for a while), so integrated GPUs stay interactive.
 */
export class QualityManager {
  private level: QualityLevel = "high";
  private mode: QualityMode = "auto";
  private slowSince: number | null = null;
  private fastSince: number | null = null;
  private lastChange = 0;
  onLevel?: (level: QualityLevel, mode: QualityMode) => void;
  private readonly handles: SceneHandles;
  private tree: TerrainTileTree | null;

  constructor(handles: SceneHandles, tree: TerrainTileTree | null) {
    this.handles = handles;
    this.tree = tree;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    PRESETS.high.pixelRatio = dpr;
    PRESETS.balanced.pixelRatio = Math.max(1, dpr * 0.75);
    this.apply("high");
  }

  setTree(tree: TerrainTileTree | null) {
    this.tree = tree;
    this.apply(this.level);
  }

  setMode(mode: QualityMode) {
    this.mode = mode;
    if (mode !== "auto") this.apply(mode);
    else this.onLevel?.(this.level, this.mode);
  }

  private apply(level: QualityLevel) {
    this.level = level;
    const p = PRESETS[level];
    this.handles.setPixelRatio(p.pixelRatio);
    this.handles.setShadows(p.shadows);
    this.tree?.setQuality(p.splitFactor, p.imageryZoomOffset);
    this.lastChange = performance.now();
    this.onLevel?.(level, this.mode);
  }

  /** Call every frame. */
  tick(nowMs: number) {
    if (this.mode !== "auto") return;
    if (nowMs - this.lastChange < 4000) return;
    const ft = this.handles.frameTimeMs();
    if (ft > 33) {
      this.slowSince ??= nowMs;
      this.fastSince = null;
      if (nowMs - this.slowSince > 2500) {
        this.slowSince = null;
        if (this.level === "high") this.apply("balanced");
        else if (this.level === "balanced") this.apply("low");
      }
    } else if (ft < 14) {
      this.fastSince ??= nowMs;
      this.slowSince = null;
      if (nowMs - this.fastSince > 12000) {
        this.fastSince = null;
        if (this.level === "low") this.apply("balanced");
        else if (this.level === "balanced") this.apply("high");
      }
    } else {
      this.slowSince = null;
      this.fastSince = null;
    }
  }
}
