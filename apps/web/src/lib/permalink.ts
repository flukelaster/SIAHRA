/**
 * Pure permalink codec: the URL query string is the only shareable projection
 * of the UI state, so parsing and serialising it live here — free of React and
 * of `window` — and `hooks/usePermalink.ts` is the thin binding to the browser.
 *
 * The two directions are deliberately *not* symmetric, and that asymmetry is
 * part of the contract:
 *   - `ex` is omitted at the default exaggeration of 1, so parsing a link
 *     without it yields `null` ("use the default"), not `1`
 *   - `cam` is rounded to whole metres — a link is a viewpoint, not a state dump
 *   - `layers` is only written when at least one layer is off, so an absent
 *     `layers` means "everything the app defaults to", not "no layers"
 */
import type { CameraPose } from "../scene/setupScene";

export interface PermalinkState {
  provinceCode: string | null;
  pose: CameraPose | null;
  exaggeration: number | null;
  layers: string[] | null;
  atIso: string | null;
}

export interface PermalinkInput {
  provinceCode: string;
  pose: CameraPose | null;
  exaggeration: number;
  layers: Record<string, boolean>;
  atIso: string | null;
}

/** Reads a `?p=..&cam=..` query string (leading `?` optional) into state. */
export function parsePermalink(search: string): PermalinkState {
  const q = new URLSearchParams(search);
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

/** Renders the shareable UI state as a `?...` query string. */
export function serialisePermalink(state: PermalinkInput): string {
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
}
