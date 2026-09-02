import type { ReactNode } from "react";
import { ExternalLink, Satellite } from "lucide-react";
import type { FloodSceneIndexEntry } from "@siahra/shared-types";
import type { FloodExtentState } from "../../hooks/useFloodExtent";
import type { FloodSceneState } from "../../hooks/useFloodScene";
import type { FloodScenesState } from "../../hooks/useFloodScenes";
import type { Lang, TFunction } from "../../i18n";
import { useLang } from "../../i18n/context";
import { resolveError } from "../../lib/errorMessage";
import { gapParts, groupFloodEvents, isFloodedScene, sceneAtIso, type FloodEvent, type GapParts } from "../../lib/floodEvents";
import { FLOOD_SCENE_MAX_AGE_MS, indexForProvince } from "../../lib/floodScenes";
import { floodCss, floodDepthMaxLabel } from "../../lib/floodStyle";
import { formatNumber } from "../../lib/number";
import { formatDateTime, formatFullDateTime } from "../../lib/time";
import { Panel } from "../ui/Panel";
import { FloodExtentBody, FloodObservedChip } from "./FloodExtentCard";

/**
 * แผง "น้ำท่วมจากภาพดาวเทียม" ตั้งแต่ E14.F5 — สี่ส่วนจากบนลงล่าง:
 *
 *   (a) ฉาก Copernicus GFM ที่กำลังแสดง: ตัวเลขของฉาก + ป้าย "ภาพล่าสุดก่อนเวลาที่เลือก"
 *       ซึ่งบอกแค่ว่าภาพเก่ากว่าเวลาที่เลือกเท่าไร **ไม่เคย** บอกสภาพ ณ เวลาที่เลือก
 *       (สี่สถานะของ legend — ถามไม่ได้ / จังหวัดไม่มีฉาก / ไม่มีภาพในหน้าต่าง / มีฉาก —
 *       เป็นคนละประโยคเสมอ และใช้คีย์ข้อความชุดเดียวกับ MapLegend)
 *   (b) รอบบินของ Sentinel-1 ทั้งหมดในดัชนี (ฉากแห้งก็อยู่ในรายการ — เป็นข้อมูล)
 *   (c) เหตุการณ์น้ำท่วมที่ดาวเทียมเห็น (`groupFloodEvents`)
 *   (d) ขอบเขตน้ำท่วมจาก GISTDA — เนื้อการ์ดเดิม (`FloodExtentBody`) ไม่ทำซ้ำตรรกะ
 *
 * การเลือกเวลาทุกจุด (b/c/ปุ่มกระโดด) ผ่าน `onSelectAt` ซึ่ง App ผูกกับตัวตั้ง `atIso`
 * ตัวเดียวกับ TimelineBar — มาตรวัดน้ำ ดวงอาทิตย์ GISTDA `?at=` และเรดาร์จึงเดินตามด้วย
 */
export interface FloodScenesCardProps {
  provinceCode: string;
  scenes: FloodScenesState;
  scene: FloodSceneState;
  floodExtent: FloodExtentState;
  atIso: string | null;
  onSelectAt: (atIso: string | null) => void;
}

const FLOOD_SCENE_WINDOW_DAYS = Math.round(FLOOD_SCENE_MAX_AGE_MS / 86_400_000);
/** แสดงรอบบินล่าสุดกี่รายการก่อนพับที่เหลือ */
const PASSES_CAP = 30;
const KM2_DIGITS = 1;

function Fact({ k, v, muted = false }: { k: string; v: ReactNode; muted?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-[11px]">
      <span className="text-[var(--color-fg-subtle)]">{k}</span>
      <span className={`text-right tabular-nums ${muted ? "text-[var(--color-fg-muted)]" : "text-[var(--color-fg)]"}`}>{v}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold text-[var(--color-fg-subtle)]">{children}</p>;
}

function formatGap(t: TFunction, g: GapParts): string {
  if (g.days > 0) return t("floodScenes.gap.days", { d: g.days, h: g.hours });
  if (g.hours > 0) return t("floodScenes.gap.hours", { h: g.hours, m: g.minutes });
  return t("floodScenes.gap.minutes", { m: g.minutes });
}

/** ตร.กม. ทศนิยมหนึ่งตำแหน่ง — `formatNumber` ค่าเริ่มต้นปัดเป็นจำนวนเต็ม (F4 เคยโดน) */
function km2Label(lang: Lang, km2: number): string {
  return formatNumber(lang, km2, KM2_DIGITS);
}

/**
 * ป้ายระยะห่างจากภาพถึงเวลาที่เลือก — แสดงเฉพาะตอนเลือกเวลาเองและภาพเก่ากว่าเวลานั้น
 * ประโยคที่สองย้ำเสมอว่าภาพบอกสภาพ ณ เวลาบันทึกภาพเท่านั้น
 */
function GapNote({ atIso, observedAt, lang, t }: { atIso: string | null; observedAt: string; lang: Lang; t: TFunction }) {
  const g = gapParts(atIso, observedAt);
  if (!g || !atIso) return null;
  return (
    <p className="rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-2 text-[11px] text-[var(--color-risk-medium)]">
      <span className="block">{t("floodScenes.selectedTime", { time: formatFullDateTime(lang, atIso) })}</span>
      <span className="block font-medium">{t("floodScenes.gap", { duration: formatGap(t, g) })}</span>
      <span className="block text-[10px] text-[var(--color-fg-muted)]">{t("floodScenes.gap.why")}</span>
    </p>
  );
}

function ShownScene({
  scenes,
  scene,
  atIso,
  onSelectAt,
  lang,
  t,
}: {
  scenes: FloodScenesState;
  scene: FloodSceneState;
  atIso: string | null;
  onSelectAt: (atIso: string | null) => void;
  lang: Lang;
  t: TFunction;
}) {
  if (scenes.error) {
    // "ถามไม่ได้" — ห้ามพูดถึงสถานะของฉากใด ๆ
    return (
      <p className="rounded-lg bg-[var(--color-danger)]/10 px-2.5 py-2 text-xs text-[var(--color-danger)]">
        {t("legend.floodGfm.indexError", { error: resolveError(t, scenes.error) ?? "" })}
      </p>
    );
  }
  if (scenes.missing) {
    // 404: ยังไม่มีฉากของจังหวัดนี้ในระบบ (ingest ยังไม่ถึง) — ไม่ใช่ "ไม่มีน้ำท่วม"
    return (
      <p className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-3 text-center text-xs text-[var(--color-fg-muted)]">
        {t("legend.floodGfm.noScenesForProvince")}
      </p>
    );
  }
  if (scene.reason === "no-scene-in-window") {
    const lb = scene.latestBefore;
    return (
      <div className="flex flex-col gap-1.5 rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-2 text-xs text-[var(--color-risk-medium)]">
        <span>{t("legend.floodGfm.noSceneInWindow", { days: FLOOD_SCENE_WINDOW_DAYS })}</span>
        {lb ? (
          <>
            <span className="text-[11px] text-[var(--color-fg-muted)]">
              {t("legend.floodGfm.latestBefore", { time: formatFullDateTime(lang, lb.observedAt) })}
            </span>
            <button
              type="button"
              onClick={() => onSelectAt(sceneAtIso(lb))}
              className="self-start cursor-pointer rounded-md bg-[var(--color-accent)]/20 px-2 py-1 text-[11px] text-[var(--color-fg)] hover:bg-[var(--color-accent)]/35"
            >
              {t("floodScenes.jumpToLatest")}
            </button>
          </>
        ) : null}
      </div>
    );
  }
  const s = scene.scene;
  if (!s) {
    if (scenes.loading || scene.loading) return <div className="h-10 animate-pulse rounded bg-white/8" />;
    // ดัชนีมีแต่รายการว่าง — เหมือน 404 ในสายตาผู้ใช้: ยังไม่มีฉาก ไม่ใช่ไม่มีน้ำท่วม
    return (
      <p className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-3 text-center text-xs text-[var(--color-fg-muted)]">
        {t("legend.floodGfm.noScenesForProvince")}
      </p>
    );
  }
  const depthPct = Math.round(s.depthEstimatedFraction * 100);
  const flooded = isFloodedScene(s);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <Fact k={t("floodScenes.sceneId")} v={<span className="font-mono text-[10px]">{s.sceneId}</span>} />
        <Fact k={t("floodScenes.observedAt")} v={formatFullDateTime(lang, s.observedAt)} />
        <Fact
          k={t("floodScenes.publishedAt")}
          v={s.publishedAt ? formatFullDateTime(lang, s.publishedAt) : t("floodScenes.publishedAt.unknown")}
          muted={s.publishedAt === null}
        />
        <Fact
          k={t("floodScenes.area")}
          v={flooded ? t("floodScenes.area.value", { km2: km2Label(lang, s.floodedAreaKm2) }) : t("legend.floodGfm.dry")}
        />
        <Fact
          k={t("floodScenes.depthShare")}
          v={flooded ? `${formatNumber(lang, depthPct)}${t("unit.percent")}` : "—"}
          muted={!flooded}
        />
        <Fact
          k={t("floodScenes.maxDepth")}
          v={s.maxDepthCm !== null ? `${floodDepthMaxLabel(lang, s.maxDepthCm)} ${t("unit.m")}` : "—"}
          muted={s.maxDepthCm === null}
        />
        <Fact
          k={t("floodScenes.medianDepth")}
          v={s.medianDepthCm !== null ? `${floodDepthMaxLabel(lang, s.medianDepthCm)} ${t("unit.m")}` : "—"}
          muted={s.medianDepthCm === null}
        />
      </div>
      <GapNote atIso={atIso} observedAt={s.observedAt} lang={lang} t={t} />
      {scene.error ? (
        <p className="text-[11px] text-[var(--color-risk-medium)]">
          {t("legend.floodGfm.fieldError", { error: resolveError(t, scene.error) ?? "" })}
        </p>
      ) : scene.loading ? (
        <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("legend.floodGfm.loading")}</p>
      ) : null}
    </div>
  );
}

function PassRow({
  s,
  shown,
  onSelect,
  lang,
  t,
}: {
  s: FloodSceneIndexEntry;
  shown: boolean;
  onSelect: () => void;
  lang: Lang;
  t: TFunction;
}) {
  const flooded = isFloodedScene(s);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={shown ? "true" : undefined}
        title={t("floodScenes.selectScene")}
        className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-white/5 ${
          shown ? "bg-white/8" : ""
        }`}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{
            backgroundColor: shown ? "var(--color-accent)" : flooded ? floodCss("extent") : "transparent",
            border: shown || flooded ? "none" : "1px solid rgba(255,255,255,0.35)",
          }}
          aria-label={shown ? t("floodScenes.shownMarker") : undefined}
          aria-hidden={shown ? undefined : "true"}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-[var(--color-fg)]">
          {formatFullDateTime(lang, s.observedAt)}
        </span>
        <span className={`shrink-0 text-[11px] tabular-nums ${flooded ? "text-[#4d94b8]" : "text-[var(--color-fg-subtle)]"}`}>
          {flooded ? t("floodScenes.km2", { km2: km2Label(lang, s.floodedAreaKm2) }) : t("floodScenes.dry")}
        </span>
      </button>
    </li>
  );
}

function EventRow({ ev, onSelect, lang, t }: { ev: FloodEvent; onSelect: () => void; lang: Lang; t: TFunction }) {
  const range =
    ev.sceneCount === 1
      ? formatFullDateTime(lang, ev.startAt)
      : `${formatFullDateTime(lang, ev.startAt)} – ${formatFullDateTime(lang, ev.endAt)}`;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        title={t("floodScenes.event.select")}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-white/5"
      >
        <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-[#4d94b8]">
          {km2Label(lang, ev.peak.floodedAreaKm2)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] tabular-nums text-[var(--color-fg)]">{range}</span>
          <span className="block truncate text-[10px] text-[var(--color-fg-subtle)]">
            {t("floodScenes.event.peak", {
              km2: km2Label(lang, ev.peak.floodedAreaKm2),
              time: formatDateTime(lang, ev.peak.observedAt),
            })}
            {" · "}
            {ev.sceneCount === 1 ? t("floodScenes.event.scenes.one") : t("floodScenes.event.scenes", { n: ev.sceneCount })}
          </span>
        </span>
      </button>
    </li>
  );
}

export function FloodScenesCard({ provinceCode, scenes, scene, floodExtent, atIso, onSelectAt }: FloodScenesCardProps) {
  const { lang, t } = useLang();
  const historical = atIso !== null;
  // ดัชนีของจังหวัดอื่น (หนึ่งเฟรมหลังสลับจังหวัด) = ไม่มีดัชนี — กฎเดียวกับ useFloodScene
  const index = indexForProvince(scenes.index, provinceCode);
  const passes = index ? [...index.scenes].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)) : [];
  const events = index ? groupFloodEvents(index.scenes) : [];
  const shownId = scene.scene?.sceneId ?? null;
  const methodologyUrl = index?.layers.depth.methodologyUrl ?? "/methodology/flood-depth";
  const href = lang === "th" || methodologyUrl.includes("lang=") ? methodologyUrl : `${methodologyUrl}${methodologyUrl.includes("?") ? "&" : "?"}lang=${lang}`;

  return (
    <Panel
      title={t("flood.title")}
      icon={<Satellite size={16} className="text-[var(--color-accent)]" aria-hidden="true" />}
      headerAction={<FloodObservedChip historical={historical} />}
    >
      <div className="flex flex-col gap-3">
        {/* (a) ฉากที่กำลังแสดง */}
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <SectionTitle>{t("floodScenes.section.shown")}</SectionTitle>
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-[var(--color-accent)] hover:underline"
            >
              {t("freshness.methodology")}
              <ExternalLink size={9} aria-hidden="true" />
            </a>
          </div>
          <ShownScene scenes={scenes} scene={scene} atIso={atIso} onSelectAt={onSelectAt} lang={lang} t={t} />
        </section>

        {/* (b) รอบบิน */}
        {index && passes.length > 0 ? (
          <section className="flex flex-col gap-1">
            <SectionTitle>{t("floodScenes.section.passes")}</SectionTitle>
            <ul className="max-h-40 overflow-y-auto pr-0.5">
              {passes.slice(0, PASSES_CAP).map((s) => (
                <PassRow
                  key={s.sceneId}
                  s={s}
                  shown={s.sceneId === shownId}
                  onSelect={() => onSelectAt(sceneAtIso(s))}
                  lang={lang}
                  t={t}
                />
              ))}
            </ul>
            {passes.length > PASSES_CAP ? (
              <p className="px-1.5 text-[10px] text-[var(--color-fg-subtle)]">
                {t("floodScenes.more", { n: passes.length - PASSES_CAP })}
              </p>
            ) : null}
            <p className="px-1.5 text-[10px] text-[var(--color-fg-subtle)]">{t("floodScenes.passes.note")}</p>
          </section>
        ) : null}

        {/* (c) เหตุการณ์ */}
        {index && passes.length > 0 ? (
          <section className="flex flex-col gap-1">
            <SectionTitle>{t("floodScenes.section.events")}</SectionTitle>
            {events.length === 0 ? (
              <p className="px-1.5 text-[11px] text-[var(--color-fg-muted)]">{t("floodScenes.events.none")}</p>
            ) : (
              <ul className="max-h-40 overflow-y-auto pr-0.5">
                {events.map((ev) => (
                  <EventRow
                    key={ev.peak.sceneId}
                    ev={ev}
                    onSelect={() => onSelectAt(sceneAtIso(ev.peak))}
                    lang={lang}
                    t={t}
                  />
                ))}
              </ul>
            )}
            <p className="px-1.5 text-[10px] text-[var(--color-fg-subtle)]">{t("floodScenes.events.note")}</p>
          </section>
        ) : null}

        {/* (d) GISTDA — เนื้อการ์ดเดิมทั้งก้อน */}
        <section className="flex flex-col gap-1.5 border-t border-white/8 pt-3">
          <SectionTitle>{t("floodScenes.section.gistda")}</SectionTitle>
          <FloodExtentBody state={floodExtent} atIso={atIso} />
        </section>
      </div>
    </Panel>
  );
}
