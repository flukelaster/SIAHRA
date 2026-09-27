import { createElement, type ComponentType } from "react";
import {
  Activity,
  BellRing,
  CloudRain,
  CloudSun,
  CloudSunRain,
  Dam,
  Droplets,
  LayoutDashboard,
  Route,
  Satellite,
  Tornado,
  Waves,
} from "lucide-react";
import { translator, type MessageKey } from "../../i18n";
import { alertRailBadge } from "../../lib/alertSummary";
import { summarizeStorms } from "../../lib/storms";
import { PANEL_KEYS, type PanelKey } from "../../lib/shellPrefs";
import { mostSevereBadge, topicByKey, type TopicKey } from "../../lib/topics";
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

type IconComponent = ComponentType<{ size?: number | string; className?: string; "aria-hidden"?: boolean | "true" }>;

/**
 * ทะเบียนแผง (= มุมมองย่อยของหัวข้อ, `lib/topics.ts`) — ลำดับ = `PANEL_KEYS` = ลำดับ
 * หัวข้อ → แท็บย่อย; `view` ถูกเรนเดอร์
 * เฉพาะแผงที่เปิดอยู่ ผ่าน `<PanelSlot>` (วงหมุนระหว่างโหลด chunk + กล่องลองใหม่เมื่อ
 * โหลดพลาด) — ไฟล์นี้ไม่มี JSX โดยตั้งใจ คอมโพเนนต์อยู่ใน panelViews.tsx
 *
 * ไอคอน/ป้าย/badge อยู่ในบันเดิลหลัก เพราะ rail ต้องวาด badge ของหัวข้อ (badge แจ้งเตือน
 * ต้องเห็นแม้แผงปิดอยู่) ก่อนผู้ใช้เปิดแผงใด
 */
export interface PanelDef {
  key: PanelKey;
  icon: IconComponent;
  labelKey: MessageKey;
  view: LazyView<PanelProps>;
  /** สัญญาณที่ต้องเห็นแม้แผงปิดอยู่ (แจ้งเตือน อปท. และจำนวนพายุ) */
  badge?: (ctx: PanelContext) => RailBadge;
}

/**
 * เนื้อของปุ่ม "ชั้นข้อมูล" บนแผนที่ (popover ≥ tablet / แผ่นล่างบนมือถือ) — ไม่ใช่แผงของ
 * หัวข้อใดแล้ว แต่ยังเป็น chunk แยกแบบเดียวกัน (MapLegend ห้ามเข้าบันเดิลหลัก)
 */
export const LAYERS_VIEW = panelView(() => import("./panelViews"), (m) => m.LayersPanel);

export const PANELS: readonly PanelDef[] = [
  // ── ภาพรวม ──
  {
    key: "impact",
    icon: BellRing,
    labelKey: "panel.impact",
    view: panelView(() => import("./panelViews"), (m) => m.ImpactPanel),
    badge: (ctx) => alertRailBadge(ctx.activeAlerts),
  },
  // ── น้ำ ──
  { key: "water", icon: Waves, labelKey: "panel.water", view: panelView(() => import("./panelViews"), (m) => m.WaterPanel) },
  {
    // E16 — เส้นทางน้ำเหนือ (ระดับประเทศ ไม่ขึ้นกับจังหวัดที่เลือก) เดินตาม atIso ของ TimelineBar
    key: "north",
    icon: Route,
    labelKey: "panel.north",
    view: panelView(() => import("../hazard/NorthWaterCard"), (m) => ({ ctx }) =>
      createElement(m.NorthWaterCard, { state: ctx.northRoute, atIso: ctx.atIso, onFocusStation: ctx.focusStation })),
  },
  { key: "dams", icon: Dam, labelKey: "panel.dams", view: panelView(() => import("../hazard/DamCard"), (m) => ({ ctx }) => createElement(m.DamCard, { state: ctx.dams })) },
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
  // ── ฝนและพายุ ──
  { key: "rain", icon: CloudRain, labelKey: "panel.rain", view: panelView(() => import("./panelViews"), (m) => m.RainPanel) },
  {
    // E18.4 — แถบเลื่อนพยากรณ์รายชั่วโมงของ TMD ย้ายมาจาก dock/แผ่นเลื่อน: อยู่บนสุดของมุมมองนี้
    // ข้อมูลมาจาก `ctx.forecast` (โพลตัวเดียวใน App.tsx — ไม่ย้ายเข้ามาในแผง เพราะศูนย์แจ้งเตือนใช้ด้วย)
    // และ `forecastAtIso`/ตัวตั้งของ App ผ่าน ctx; ถ้อยคำความซื่อสัตย์ของแถบคงเดิมทุกตัว
    key: "forecast",
    icon: CloudSun,
    labelKey: "panel.forecast",
    view: panelView(
      () => Promise.all([import("../hazard/ForecastCard"), import("./ForecastStrip")]),
      ([card, strip]) =>
        ({ ctx }) =>
          createElement(
            "div",
            { className: "flex flex-col gap-3" },
            createElement(strip.ForecastStrip, {
              state: ctx.forecast,
              forecastAtIso: ctx.forecastAtIso,
              onChange: ctx.setForecastAtIso,
              atIso: ctx.atIso,
            }),
            createElement(card.ForecastCard, { state: ctx.forecast, health: ctx.apiHealth }),
          ),
    ),
  },
  {
    // แผนที่ SVG + การ์ดทั้งหมดอยู่ใน chunk แยก; badge บน rail ใช้แค่ `lib/storms.ts` (เล็ก) จึงอยู่ใน entry ได้
    key: "storm",
    icon: Tornado,
    labelKey: "panel.storm",
    view: panelView(() => import("../hazard/StormPanel"), (m) => m.StormPanel),
    badge: (ctx) => stormRailBadge(ctx),
  },
  // ── แผ่นดินไหว ──
  {
    key: "quake",
    icon: Activity,
    labelKey: "panel.quake",
    view: panelView(() => import("../hazard/EarthquakeLiveCard"), (m) => ({ ctx }) =>
      createElement(m.EarthquakeLiveCard, { feed: ctx.earthquakes })),
  },
];

/** ไอคอนของหัวข้อ (ป้าย/มุมมองย่อยอยู่ใน `lib/topics.ts` ซึ่งไม่ import React) */
export const TOPIC_ICONS: Record<TopicKey, IconComponent> = {
  overview: LayoutDashboard,
  water: Droplets,
  weather: CloudSunRain,
  quake: Activity,
};

/**
 * badge ของหัวข้อบน rail/แถบแท็บ = badge ที่รุนแรงที่สุดของมุมมองย่อย (`mostSevereBadge`)
 * — แจ้งเตือน อปท. → ภาพรวม, พายุ → ฝนและพายุ; ตัวละเอียดยังอยู่บนแท็บย่อยของแต่ละมุมมอง
 */
export function topicBadge(topic: TopicKey, ctx: PanelContext): RailBadge {
  return mostSevereBadge(topicByKey(topic).views.map((v) => panelByKey(v).badge?.(ctx) ?? null));
}

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
