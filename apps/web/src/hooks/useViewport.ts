import { useEffect, useState } from "react";
import { tierFor, type Tier } from "../lib/shellLayout";

export interface ViewportInfo {
  width: number;
  height: number;
  /** Phones/tablets in portrait or narrow windows: docks become a bottom sheet. */
  compact: boolean;
  /** ชั้นของเปลือกหน้าต่าง (lib/shellLayout.ts) — `compact` คงความหมาย < 1024 ไว้ให้ผู้เรียกเดิม */
  tier: Tier;
}

const COMPACT_MAX_WIDTH = 1024;

export function useViewport(): ViewportInfo {
  const read = (): ViewportInfo => ({
    width: window.innerWidth,
    height: window.innerHeight,
    compact: window.innerWidth < COMPACT_MAX_WIDTH,
    tier: tierFor(window.innerWidth),
  });
  const [vp, setVp] = useState<ViewportInfo>(read);
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setVp(read()));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, []);
  return vp;
}
