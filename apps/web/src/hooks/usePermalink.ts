import { useEffect, useMemo, useRef } from "react";
import type { CameraPose } from "../scene/setupScene";

export interface PermalinkState {
  provinceCode: string | null;
  pose: CameraPose | null;
  exaggeration: number | null;
  layers: string[] | null;
  atIso: string | null;
}

/** Parses the URL once (initial state). */
export function readPermalink(): PermalinkState {
  const q = new URLSearchParams(window.location.search);
  const p = q.get("p");
  const cam = q.get("cam");
  let pose: CameraPose | null = null;
  if (cam) {
    const n = cam.split(",").map(Number);
    if (n.length === 6 && n.every((v) => Number.isFinite(v))) {
      pose = { position: [n[0], n[1], n[2]], target: [n[3], n[4], n[5]] };
    }
  }
  const ex = q.get("ex");
  const layers = q.get("layers");
  const t = q.get("t");
  return {
    provinceCode: p && /^[0-9]{2}$/.test(p) ? p : null,
    pose,
    exaggeration: ex && Number.isFinite(Number(ex)) ? Number(ex) : null,
    layers: layers ? layers.split(",").filter(Boolean) : null,
    atIso: t && Number.isFinite(Date.parse(t)) ? t : null,
  };
}

/**
 * Mirrors the shareable part of the UI state into the URL (replaceState,
 * debounced) so a copied link reopens the same province, camera, layers and
 * timeline position.
 */
export function usePermalinkSync(state: {
  provinceCode: string;
  pose: CameraPose | null;
  exaggeration: number;
  layers: Record<string, boolean>;
  atIso: string | null;
}) {
  const timer = useRef<number | null>(null);
  const serialized = useMemo(() => {
    const q = new URLSearchParams();
    q.set("p", state.provinceCode);
    if (state.pose) {
      q.set("cam", [...state.pose.position, ...state.pose.target].map((v) => Math.round(v)).join(","));
    }
    if (state.exaggeration !== 1) q.set("ex", String(state.exaggeration));
    const on = Object.entries(state.layers)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const off = Object.entries(state.layers).filter(([, v]) => !v).length;
    if (off > 0) q.set("layers", on.join(","));
    if (state.atIso) q.set("t", state.atIso);
    return `?${q.toString()}`;
  }, [state.provinceCode, state.pose, state.exaggeration, state.layers, state.atIso]);

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (window.location.search !== serialized) {
        window.history.replaceState(null, "", `${window.location.pathname}${serialized}`);
      }
    }, 400);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [serialized]);
}
