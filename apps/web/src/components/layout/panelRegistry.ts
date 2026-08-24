import { createElement, type ComponentType, type ReactNode } from "react";
import { Activity, BellRing, CloudRain, CloudSun, Dam, Layers, Satellite, Waves } from "lucide-react";
import type { MessageKey } from "../../i18n";
import { alertRailBadge, type AlertRailBadge } from "../../lib/alertSummary";
import { PANEL_KEYS, type PanelKey } from "../../lib/shellPrefs";
import { DamCard } from "../hazard/DamCard";
import { EarthquakeLiveCard } from "../hazard/EarthquakeLiveCard";
import { FloodExtentCard } from "../hazard/FloodExtentCard";
import { ForecastCard } from "../hazard/ForecastCard";
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
  /** สัญญาณที่ต้องเห็นแม้แผงปิดอยู่ (ตอนนี้มีแค่แจ้งเตือน อปท.) */
  badge?: (ctx: PanelContext) => AlertRailBadge;
}

export const PANELS: readonly PanelDef[] = [
  { key: "layers", icon: Layers, labelKey: "panel.layers", render: (ctx) => createElement(LayersPanel, { ctx }) },
  {
    key: "flood",
    icon: Satellite,
    labelKey: "panel.flood",
    render: (ctx) => createElement(FloodExtentCard, { state: ctx.floodExtent }),
  },
  {
    key: "impact",
    icon: BellRing,
    labelKey: "panel.impact",
    render: (ctx) => createElement(ImpactPanel, { ctx }),
    badge: (ctx) => alertRailBadge(ctx.activeAlerts),
  },
  { key: "water", icon: Waves, labelKey: "panel.water", render: (ctx) => createElement(WaterPanel, { ctx }) },
  { key: "rain", icon: CloudRain, labelKey: "panel.rain", render: (ctx) => createElement(RainPanel, { ctx }) },
  {
    key: "forecast",
    icon: CloudSun,
    labelKey: "panel.forecast",
    render: (ctx) => createElement(ForecastCard, { state: ctx.forecast, health: ctx.apiHealth }),
  },
  { key: "dams", icon: Dam, labelKey: "panel.dams", render: (ctx) => createElement(DamCard, { state: ctx.dams }) },
  {
    key: "quake",
    icon: Activity,
    labelKey: "panel.quake",
    render: (ctx) => createElement(EarthquakeLiveCard, { feed: ctx.earthquakes }),
  },
];

export function panelByKey(key: PanelKey): PanelDef {
  return PANELS.find((p) => p.key === key) ?? PANELS[0];
}
