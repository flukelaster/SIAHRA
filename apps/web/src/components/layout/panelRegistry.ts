import { createElement, type ComponentType } from "react";
import { Activity, BellRing, CloudRain, CloudSun, Dam, Layers, Route, Satellite, Tornado, Waves } from "lucide-react";
import { translator, type MessageKey } from "../../i18n";
import { alertRailBadge } from "../../lib/alertSummary";
import { summarizeStorms } from "../../lib/storms";
import { PANEL_KEYS, type PanelKey } from "../../lib/shellPrefs";
import { lazyView, type LazyView } from "../ui/lazyView";
import type { RailBadge } from "./PanelBadge";
import type { PanelContext } from "./panelViews";

export { PANEL_KEYS };
export type { PanelContext, PanelKey };

/** props ของทุกแผง — คอมโพเนนต์ในแต่ละ chunk รับ `ctx` ก้อนเดียว */
export type PanelProps = { ctx: PanelContext };

/**
 * เนื้อแผงที่อยู่ใน chunk แยก — **ทุกแผงต้องมาทางนี้** (ไม่มีช่องให้ใส่คอมโพเนนต์ที่
 * import แบบ static อีกแล้ว) แผงใหม่จึงไม่ไปบวกขนาดบันเดิลหลักโดยไม่มีใครเห็น:
 *
 *   view: panelView(() => import("../hazard/XCard"), (m) => ({ ctx }) =>
 *     createElement(m.XCard, { ... })),
 *
 * `pick` แปลง `ctx` เป็น props ของการ์ด (เรียกครั้งเดียวตอนโหลดเสร็จ) — การ์ดที่รับ
 * `{ ctx }` อยู่แล้ว (panelViews.tsx) ใช้ `(m) => m.WaterPanel`
 */
export function panelView<M>(
  load: () => Promise<M>,
  pick: (m: M) => ComponentType<PanelProps>,
): LazyView<PanelProps> {
  return lazyView(() => load().then(pick));
}

/**
 * ทะเบียนแผง — ลำดับ = ลำดับปุ่มบน rail และแท็บบนแผ่นเลื่อน; `view` ถูกเรนเดอร์
 * เฉพาะแผงที่เปิดอยู่ ผ่าน `<PanelSlot>` (วงหมุนระหว่างโหลด chunk + กล่องลองใหม่เมื่อ
 * โหลดพลาด) — ไฟล์นี้ไม่มี JSX โดยตั้งใจ คอมโพเนนต์อยู่ใน panelViews.tsx
 *
 * ไอคอน/ป้าย/badge อยู่ในบันเดิลหลัก เพราะ rail ต้องวาดปุ่มทุกแผง (และ badge แจ้งเตือน
 * ต้องเห็นแม้แผงปิดอยู่) ก่อนผู้ใช้เปิดแผงใด
 */
export interface PanelDef {
  key: PanelKey;
  icon: ComponentType<{ size?: number | string; className?: string; "aria-hidden"?: boolean | "true" }>;
  labelKey: MessageKey;
  view: LazyView<PanelProps>;
  /** สัญญาณที่ต้องเห็นแม้แผงปิดอยู่ (แจ้งเตือน อปท. และจำนวนพายุ) */
  badge?: (ctx: PanelContext) => RailBadge;
}

export const PANELS: readonly PanelDef[] = [
  { key: "layers", icon: Layers, labelKey: "panel.layers", view: panelView(() => import("./panelViews"), (m) => m.LayersPanel) },
  {
    key: "flood",
    icon: Satellite,
    labelKey: "panel.flood",
    // E14.F5 — ฉาก Sentinel-1 (รอบบิน/เหตุการณ์/ฉากที่แสดง) + เนื้อการ์ด GISTDA เดิมเป็นส่วนล่าง
    view: panelView(() => import("../hazard/FloodScenesCard"), (m) => ({ ctx }) =>
      createElement(m.FloodScenesCard, {
        provinceCode: ctx.province.code,
        scenes: ctx.floodScenes,
        scene: ctx.floodScene,
        floodExtent: ctx.floodExtent,
        atIso: ctx.atIso,
        onSelectAt: ctx.setAtIso,
      })),
  },
  {
    key: "impact",
    icon: BellRing,
    labelKey: "panel.impact",
    view: panelView(() => import("./panelViews"), (m) => m.ImpactPanel),
    badge: (ctx) => alertRailBadge(ctx.activeAlerts),
  },
  { key: "water", icon: Waves, labelKey: "panel.water", view: panelView(() => import("./panelViews"), (m) => m.WaterPanel) },
  {
    // E16 — เส้นทางน้ำเหนือ (ระดับประเทศ ไม่ขึ้นกับจังหวัดที่เลือก) เดินตาม atIso ของ TimelineBar
    key: "north",
    icon: Route,
    labelKey: "panel.north",
    view: panelView(() => import("../hazard/NorthWaterCard"), (m) => ({ ctx }) =>
      createElement(m.NorthWaterCard, { state: ctx.northRoute, atIso: ctx.atIso, onFocusStation: ctx.focusStation })),
  },
  { key: "rain", icon: CloudRain, labelKey: "panel.rain", view: panelView(() => import("./panelViews"), (m) => m.RainPanel) },
  {
    key: "forecast",
    icon: CloudSun,
    labelKey: "panel.forecast",
    view: panelView(() => import("../hazard/ForecastCard"), (m) => ({ ctx }) =>
      createElement(m.ForecastCard, { state: ctx.forecast, health: ctx.apiHealth })),
  },
  { key: "dams", icon: Dam, labelKey: "panel.dams", view: panelView(() => import("../hazard/DamCard"), (m) => ({ ctx }) => createElement(m.DamCard, { state: ctx.dams })) },
  {
    // แผนที่ SVG + การ์ดทั้งหมดอยู่ใน chunk แยก; badge บน rail ใช้แค่ `lib/storms.ts` (เล็ก) จึงอยู่ใน entry ได้
    key: "storm",
    icon: Tornado,
    labelKey: "panel.storm",
    view: panelView(() => import("../hazard/StormPanel"), (m) => m.StormPanel),
    badge: (ctx) => stormRailBadge(ctx),
  },
  {
    key: "quake",
    icon: Activity,
    labelKey: "panel.quake",
    view: panelView(() => import("../hazard/EarthquakeLiveCard"), (m) => ({ ctx }) =>
      createElement(m.EarthquakeLiveCard, { feed: ctx.earthquakes })),
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
