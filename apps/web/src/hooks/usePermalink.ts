import { useEffect, useMemo, useRef } from "react";
import { parsePermalink, serialisePermalink } from "../lib/permalink";
import type { PermalinkInput, PermalinkState } from "../lib/permalink";

export type { PermalinkState } from "../lib/permalink";

/** Parses the URL once (initial state). */
export function readPermalink(): PermalinkState {
  return parsePermalink(window.location.search);
}

/**
 * Mirrors the shareable part of the UI state into the URL (replaceState,
 * debounced) so a copied link reopens the same province, camera, layers and
 * timeline position.
 */
export function usePermalinkSync(state: PermalinkInput) {
  const { provinceCode, pose, exaggeration, layers, atIso, lang } = state;
  const timer = useRef<number | null>(null);
  const serialized = useMemo(
    () => serialisePermalink({ provinceCode, pose, exaggeration, layers, atIso, lang }),
    [provinceCode, pose, exaggeration, layers, atIso, lang],
  );

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
