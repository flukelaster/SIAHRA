import { createElement, lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Activity, BellRing, CloudRain, CloudSun, Dam, Layers, Route, Satellite, Tornado, Waves } from "lucide-react";
import { translator, type MessageKey } from "../../i18n";
import { alertRailBadge } from "../../lib/alertSummary";
import { summarizeStorms } from "../../lib/storms";
import { PANEL_KEYS, type PanelKey } from "../../lib/shellPrefs";
import { DamCard } from "../hazard/DamCard";
import { EarthquakeLiveCard } from "../hazard/EarthquakeLiveCard";
import { FloodScenesCard } from "../hazard/FloodScenesCard";
import { ForecastCard } from "../hazard/ForecastCard";
import type { RailBadge } from "./PanelBadge";
import { NorthWaterCard } from "../hazard/NorthWaterCard";
import { ImpactPanel, LayersPanel, RainPanel, WaterPanel, type PanelContext } from "./panelViews";

export { PANEL_KEYS };
export type { PanelContext, PanelKey };

/**
 * ทะเบียนแผง — ลำดับ = ลำดับปุ่มบน rail และแท็บบนแผ่นเลื่อน; `render(ctx)` ถูกเรียก
 * เฉพาะแผงที่เปิดอยู่ (ไฟล์นี้ไม่มี JSX โดยตั้งใจ — คอมโพเนนต์อยู่ใน panelViews.tsx)
 */
export interface PanelDef {
  key: PanelKey;
  icon: ComponentType<{ size?: number | string; className?: string; "aria-hidden"?: boolean | "true" }>;
  labelKey: MessageKey;
  render: (ctx: PanelContext) => ReactNode;
  /** สัญญาณที่ต้องเห็นแม้แผงปิดอยู่ (แจ้งเตือน อปท. และจำนวนพายุ) */
  badge?: (ctx: PanelContext) => RailBadge;
}

/**
 * แผงพายุโหลดแบบ lazy (chunk แยก เหมือน MethodologyPage ใน Root.tsx) — แผนที่ SVG + การ์ดทั้งหมด
 * ไม่อยู่ใน entry chunk; badge บน rail ใช้แค่ `lib/storms.ts` (เล็ก) จึงยังอยู่ใน entry ได้
 * fallback เป็นโครงกระพริบเดียวกับการ์ดอื่นตอนโหลด ไม่ใช่ข้อความ "ไม่มีพายุ"
 */
const StormPanel = lazy(() => import("../hazard/StormPanel").then((m) => ({ default: m.StormPanel })));
const stormPanelFallback = createElement("div", {
  className: "glass h-40 animate-pulse rounded-2xl",
  "aria-busy": true,
});

export const PANELS: readonly PanelDef[] = [
  { key: "layers", icon: Layers, labelKey: "panel.layers", render: (ctx) => createElement(LayersPanel, { ctx }) },
  {
    key: "flood",
    icon: Satellite,
    labelKey: "panel.flood",
    // E14.F5 — ฉาก Sentinel-1 (รอบบิน/เหตุการณ์/ฉากที่แสดง) + เนื้อการ์ด GISTDA เดิมเป็นส่วนล่าง
    render: (ctx) =>
      createElement(FloodScenesCard, {
        provinceCode: ctx.province.code,
        scenes: ctx.floodScenes,
        scene: ctx.floodScene,
        floodExtent: ctx.floodExtent,
        atIso: ctx.atIso,
        onSelectAt: ctx.setAtIso,
      }),
  },
  {
    key: "impact",
    icon: BellRing,
    labelKey: "panel.impact",
    render: (ctx) => createElement(ImpactPanel, { ctx }),
    badge: (ctx) => alertRailBadge(ctx.activeAlerts),
  },
  { key: "water", icon: Waves, labelKey: "panel.water", render: (ctx) => createElement(WaterPanel, { ctx }) },
  {
    // E16 — เส้นทางน้ำเหนือ (ระดับประเทศ ไม่ขึ้นกับจังหวัดที่เลือก) เดินตาม atIso ของ TimelineBar
    key: "north",
    icon: Route,
    labelKey: "panel.north",
    render: (ctx) =>
      createElement(NorthWaterCard, { state: ctx.northRoute, atIso: ctx.atIso, onFocusStation: ctx.focusStation }),
  },
  { key: "rain", icon: CloudRain, labelKey: "panel.rain", render: (ctx) => createElement(RainPanel, { ctx }) },
  {
    key: "forecast",
    icon: CloudSun,
    labelKey: "panel.forecast",
    render: (ctx) => createElement(ForecastCard, { state: ctx.forecast, health: ctx.apiHealth }),
  },
  { key: "dams", icon: Dam, labelKey: "panel.dams", render: (ctx) => createElement(DamCard, { state: ctx.dams }) },
  {
    key: "storm",
    icon: Tornado,
    labelKey: "panel.storm",
    render: (ctx) => createElement(Suspense, { fallback: stormPanelFallback }, createElement(StormPanel, { ctx })),
    badge: (ctx) => stormRailBadge(ctx),
  },
  {
    key: "quake",
    icon: Activity,
    labelKey: "panel.quake",
    render: (ctx) => createElement(EarthquakeLiveCard, { feed: ctx.earthquakes }),
  },
];

/**
 * badge ของแผงพายุ = จำนวนพายุในคำตอบ (ทุกแอ่ง ไม่ใช่เฉพาะที่ใกล้จังหวัด) — ไม่มีพายุ
 * ไม่ได้แปลว่าไม่มี badge เสมอไป: ถามไม่ได้ = จุดแดง, ยังไม่เคยดึงสำเร็จ = "?",
 * รอบล่าสุดพลาด/แหล่งหนึ่งล้มเหลว = จุดเหลือง (ตีความจาก `lib/storms.ts` ที่เดียว)
 */
function stormRailBadge(ctx: PanelContext): RailBadge {
  const t = translator(ctx.lang);
  const s = summarizeStorms(ctx.storms);
  if (s.kind === "api-unreachable") return { kind: "unreachable", title: t("storm.state.apiUnreachable") };
  if (s.kind === "never") return { kind: "neverEvaluated", title: t("storm.state.never") };
  if (s.kind === "unchecked") return { kind: "degraded", title: t("storm.state.unchecked") };
  if (s.kind === "storms") return { kind: "count", n: s.n, title: t("storm.badge.count", { n: s.n }) };
  return null;
}

export function panelByKey(key: PanelKey): PanelDef {
  return PANELS.find((p) => p.key === key) ?? PANELS[0];
}
