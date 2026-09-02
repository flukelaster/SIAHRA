import { Pause, Play, RotateCcw, Satellite } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "../ui/Segmented";
import { floodCss } from "../../lib/floodStyle";
import { formatFetchedAt } from "../../lib/time";
import { applyRangeChange } from "../../lib/timelineRange";
import { useLang } from "../../i18n/context";
import type { MessageKey, TFunction } from "../../i18n";

/**
 * ขีดรอบบินของ Sentinel-1 บนแถบเวลา (E14.F5) — หนึ่งขีด = หนึ่ง `sceneId` = หนึ่งรอบบิน
 * (F3 รวมเฟรมของรอบเดียวกันไว้แล้ว จึงไม่มีทางเป็น 2–5 ขีดต่อรอบ)
 *
 * `atIso` คือเวลาที่ต้องตั้งเพื่อให้ฉากนั้นถูกเลือกพอดี (`sceneAtIso` ใน
 * lib/floodEvents.ts — ปัด observedAt ขึ้นเป็นขอบ 10 นาที) ไม่ใช่ observedAt ตรง ๆ
 */
export interface TimelineMark {
  atIso: string;
  /** true = ฉากนั้นจำแนกว่ามีน้ำท่วม (สีน้ำ) · false = ฉากแห้ง (สีกลาง ๆ ไม่ใช่หายไป) */
  flooded: boolean;
  /** ข้อความใน title/aria-label: วันเวลา + ตร.กม. */
  label: string;
}

/** ความกว้างหัวเลื่อนใน `.range-slider` (index.css) — จุดกึ่งกลางหัวเลื่อนวิ่งจาก ½ ถึง 100% − ½ ของราง */
const THUMB_PX = 14;

/** ตำแหน่ง CSS `left` ของสัดส่วน `frac` (0 = ซ้ายสุดของราง, 1 = ขวาสุด) ให้ตรงกับจุดกึ่งกลางหัวเลื่อน */
function trackLeft(frac: number): string {
  return `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${frac.toFixed(5)})`;
}

/** ขีดที่อยู่ในช่วงของแถบ พร้อมสัดส่วนตำแหน่ง — นอกช่วงไม่วาด (ไม่ใช่กองอยู่ที่ขอบ) */
function marksInRange(marks: TimelineMark[], nowMs: number, rangeHours: number): (TimelineMark & { frac: number })[] {
  const out: (TimelineMark & { frac: number })[] = [];
  for (const m of marks) {
    const ms = Date.parse(m.atIso);
    if (!Number.isFinite(ms)) continue;
    const ageH = (nowMs - ms) / 3600000;
    if (ageH < 0 || ageH > rangeHours) continue;
    out.push({ ...m, frac: 1 - ageH / rangeHours });
  }
  return out;
}

const MARK_DRY = "rgba(255, 255, 255, 0.45)";

/**
 * ชั้นขีดรอบบินทับราง (dense: ขีด 2 px) หรือแถวของตัวเองใต้ราง (full: ไอคอนดาวเทียมเล็ก ๆ)
 * ปุ่มมีพื้นที่กดกว้างกว่าขีดที่เห็น (padding) ไม่งั้นขีด 2 px กดไม่โดน
 */
function PassMarks({
  marks,
  variant,
  onSelect,
  t,
}: {
  marks: (TimelineMark & { frac: number })[];
  variant: "dense" | "full";
  onSelect: (atIso: string) => void;
  t: TFunction;
}) {
  if (marks.length === 0) return null;
  const floodedColor = floodCss("extent");
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 ${variant === "dense" ? "top-0 h-4" : "top-0 h-3"}`}
      role="group"
      aria-label={t("timeline.marks")}
    >
      {marks.map((m) => (
        <button
          key={m.atIso}
          type="button"
          onClick={() => onSelect(m.atIso)}
          title={m.label}
          aria-label={m.label}
          data-flooded={m.flooded ? "1" : "0"}
          className={`pointer-events-auto absolute -translate-x-1/2 cursor-pointer ${
            variant === "dense" ? "top-0 flex h-4 items-center px-1" : "top-0 flex h-3 items-center px-0.5"
          }`}
          style={{ left: trackLeft(m.frac) }}
        >
          {variant === "dense" ? (
            <span
              className="block h-2 w-0.5 rounded-sm"
              style={{ backgroundColor: m.flooded ? floodedColor : MARK_DRY }}
              aria-hidden="true"
            />
          ) : (
            <Satellite size={10} style={{ color: m.flooded ? floodedColor : MARK_DRY }} aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  );
}

function OutOfRangeChip({ t }: { t: TFunction }) {
  return (
    <span className="shrink-0 rounded-md bg-white/8 px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap text-[var(--color-fg-muted)]">
      {t("timeline.outOfRange")}
    </span>
  );
}

/** Selectable playback windows: hours, slider step in minutes, tick marks (hours ago). */
const RANGES: { hours: number; stepMin: number; labelKey: MessageKey; ticks: number[] }[] = [
  { hours: 72, stepMin: 30, labelKey: "timeline.range.72h", ticks: [72, 48, 24, 0] },
  { hours: 7 * 24, stepMin: 60, labelKey: "timeline.range.7d", ticks: [168, 120, 72, 24, 0] },
  { hours: 30 * 24, stepMin: 180, labelKey: "timeline.range.30d", ticks: [720, 480, 240, 0] },
];
/** Beyond this the backend reads from the long-term archive (R2). */
const HOT_HOURS = 7 * 24;

function tickLabel(h: number, t: TFunction): string {
  if (h === 0) return t("timeline.tick.now");
  return h >= 48 ? t("timeline.tick.days", { n: h / 24 }) : t("timeline.tick.hours", { n: h });
}

/**
 * Scrub the map back through *observed* water levels (ThaiWater 10-minute
 * series; hourly nationwide snapshots beyond 7 days). This is history
 * playback, not a forecast — the label says so and the live position is
 * always the right-hand end.
 */
export function TimelineBar({
  atIso,
  onChange,
  variant = "full",
  marks = [],
}: {
  atIso: string | null;
  onChange: (atIso: string | null) => void;
  /**
   * `full` = แถบสองบรรทัดพร้อมขีดเวลา (dock บนมือถือ) — markup เดิมไม่แก้
   * `dense` = บรรทัดเดียวสำหรับ dock ล่างบนจอกว้าง: เล่น/หยุด/รีเซ็ต · ช่วงเวลา ·
   *           slider · ป้ายสด/ย้อนหลัง · ชิปจากคลังถาวร (ซ่อนขีดเวลา)
   */
  variant?: "full" | "dense";
  /** รอบบินของ Sentinel-1 (E14.F5) — วาดเฉพาะที่อยู่ในช่วงของแถบ กดแล้วเลือกเวลาของฉากนั้น */
  marks?: TimelineMark[];
}) {
  const { lang, t } = useLang();
  const [playing, setPlaying] = useState(false);
  const [rangeIdx, setRangeIdx] = useState(0);
  const range = RANGES[rangeIdx];
  const RANGE_HOURS = range.hours;
  const STEP_MIN = range.stepMin;
  const steps = (RANGE_HOURS * 60) / STEP_MIN;
  const ageHours = atIso ? (Date.now() - Date.parse(atIso)) / 3600000 : 0;
  const fromArchive = ageHours > HOT_HOURS;
  // เวลาที่เลือกเก่ากว่าช่วงของแถบ (เช่น เหตุการณ์ปี 2024 ที่เลือกจากแผง): หัวเลื่อน
  // ถูกตรึงไว้ซ้ายสุดอยู่แล้ว ชิปนี้กันไม่ให้อ่านว่า "30 วันที่แล้ว"
  const outOfRange = atIso !== null && ageHours > RANGE_HOURS;
  const now = Date.now();
  // คิดใหม่ทุกเรนเดอร์โดยตั้งใจ: `now` เดินตลอด ขีดจึงเลื่อนซ้ายไปตามเวลาจริงเหมือนหัวเลื่อน
  const visibleMarks = marksInRange(marks, now, RANGE_HOURS);
  const selectMark = (iso: string) => {
    setPlaying(false);
    onChange(iso);
  };
  // เปลี่ยนช่วง = เลื่อน viewport เท่านั้น ไม่รีเซ็ต atIso (lib/timelineRange.ts)
  const changeRange = (i: number) => applyRangeChange(i, { setPlaying, setRangeIdx });
  const value = atIso ? Math.round((steps - (now - Date.parse(atIso)) / (STEP_MIN * 60000))) : steps;
  const clamped = Math.max(0, Math.min(steps, value));
  const timer = useRef<number | null>(null);

  const setStep = (step: number) => {
    if (step >= steps) onChange(null);
    else {
      const t = Date.now() - (steps - step) * STEP_MIN * 60000;
      onChange(new Date(Math.floor(t / 600000) * 600000).toISOString());
    }
  };

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      const current = clamped;
      if (current >= steps) {
        setPlaying(false);
        return;
      }
      setStep(current + 1);
    }, 400);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, clamped]);

  const label = useMemo(() => {
    if (!atIso) return t("timeline.live");
    return formatFetchedAt(lang, atIso);
  }, [atIso, lang, t]);

  const live = atIso === null;
  const progress = (clamped / steps) * 100;

  if (variant === "dense") {
    // ชื่อแถบ + "ไม่ใช่พยากรณ์" อยู่ใน title ของทั้งแถบ (บรรทัดเดียวไม่มีที่พอ)
    // และโผล่เป็นข้อความเมื่อ container กว้างพอ — ความหมาย "นี่คือย้อนหลัง" ยังอยู่ที่
    // ป้ายสีเหลือง/เขียวปลายขวาเสมอ
    return (
      <div
        className="glass flex h-10 min-w-0 items-center gap-2 overflow-hidden rounded-2xl py-1 pr-3 pl-1.5"
        title={`${t("timeline.title")} · ${t("timeline.notForecast")}`}
      >
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => {
              if (clamped >= steps) setStep(0);
              setPlaying((p) => !p);
            }}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-[var(--color-accent)] text-white shadow-[0_2px_10px_rgba(59,130,246,0.45)] transition-colors hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            aria-label={playing ? t("timeline.pause") : t("timeline.play")}
            title={playing ? t("timeline.pause") : t("timeline.play")}
          >
            {playing ? <Pause size={13} /> : <Play size={13} className="translate-x-px" />}
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              onChange(null);
            }}
            disabled={live}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[var(--color-fg-muted)] transition-colors hover:bg-white/8 hover:text-white disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
            aria-label={t("timeline.backToLive")}
            title={t("timeline.backToLive")}
          >
            <RotateCcw size={13} />
          </button>
        </div>
        <Segmented
          label={t("timeline.rangeLabel")}
          value={rangeIdx}
          onChange={changeRange}
          options={RANGES.map((r, i) => ({ value: i, label: t(r.labelKey) }))}
          // ห้ามย่อ: ป้ายช่วงเวลาที่ถูกตัดครึ่ง ("30 วั…") อ่านไม่ออกและกดผิดได้
          // ตัวที่ยอมย่อคือป้ายสด/ย้อนหลังด้านขวา ซึ่ง truncate โดยตั้งใจและมี
          // ข้อความเต็มอยู่ใน title อยู่แล้ว (เห็นครั้งแรกตอนแถบ dense ลงมาอยู่บน
          // แผ่นเลื่อนของมือถือกว้าง 372px — บน tablet ขึ้นไปมันไม่เคยแคบพอ)
          className="shrink-0"
        />
        {/* ราง + ขีดรอบบิน Sentinel-1 ซ้อนบนรางที่ตำแหน่งจริง (ขีด 2 px, กดได้) */}
        <div className="relative min-w-16 flex-1">
          <input
            type="range"
            min={0}
            max={steps}
            step={1}
            value={clamped}
            onChange={(e) => {
              setPlaying(false);
              setStep(Number(e.target.value));
            }}
            aria-label={t("timeline.slider")}
            aria-valuetext={label}
            className="range-slider block w-full"
            style={{ "--range-progress": `${progress}%` } as React.CSSProperties}
          />
          <PassMarks marks={visibleMarks} variant="dense" onSelect={selectMark} t={t} />
        </div>
        {/* บรรทัดเดียว overflow-hidden (บนมือถือ 390px ชิปท้าย ๆ ถูกตัด): เวลาที่นอกช่วง
            ชิป "นอกช่วง" **แทน** ชิปคลังถาวร ไม่ใช่ต่อท้าย — ข้อความที่ต้องเห็นคือ
            "หัวเลื่อนไม่ได้บอกเวลานี้" ส่วน "จากคลังถาวร" ตามมาโดยนัย (นอกช่วง 72 ชม.+
            ที่เก่ากว่า 7 วันย่อมมาจากคลัง) */}
        {outOfRange ? (
          <OutOfRangeChip t={t} />
        ) : fromArchive ? (
          <span className="shrink-0 rounded-md bg-[var(--color-risk-medium)]/15 px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap text-[var(--color-risk-medium)]">
            {t("timeline.fromArchive")}
          </span>
        ) : null}
        {/* ป้ายสด/ย้อนหลังย่อได้ (ข้อความเต็มอยู่ใน title) — ห้ามล้นออกนอกกล่องไปทับแถบ TMD */}
        <span
          className={`flex min-w-0 items-center gap-1.5 text-[11px] tabular-nums ${
            live ? "text-[var(--color-success)]" : "text-[var(--color-risk-medium)]"
          }`}
          title={label}
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              live ? "bg-[var(--color-success)] shadow-[0_0_6px_rgba(34,197,94,0.9)]" : "bg-[var(--color-risk-medium)]"
            }`}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate">{label}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="glass flex items-center gap-3 rounded-2xl py-2 pr-4 pl-2.5">
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => {
            if (clamped >= steps) setStep(0);
            setPlaying((p) => !p);
          }}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-[var(--color-accent)] text-white shadow-[0_2px_10px_rgba(59,130,246,0.45)] transition-colors hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          aria-label={playing ? t("timeline.pause") : t("timeline.play")}
          title={playing ? t("timeline.pause") : t("timeline.play")}
        >
          {playing ? <Pause size={15} /> : <Play size={15} className="translate-x-px" />}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            onChange(null);
          }}
          disabled={live}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-[var(--color-fg-muted)] transition-colors hover:bg-white/8 hover:text-white disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
          aria-label={t("timeline.backToLive")}
          title={t("timeline.backToLive")}
        >
          <RotateCcw size={15} />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="shrink-0 text-xs font-semibold text-[var(--color-fg)]">{t("timeline.title")}</span>
            <Segmented
              label={t("timeline.rangeLabel")}
              value={rangeIdx}
              onChange={changeRange}
              options={RANGES.map((r, i) => ({ value: i, label: t(r.labelKey) }))}
            />
            <span className="hidden truncate text-[11px] text-[var(--color-fg-subtle)] @2xl:inline">
              {t("timeline.notForecast")}
            </span>
            {fromArchive ? (
              <span className="shrink-0 rounded-md bg-[var(--color-risk-medium)]/15 px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap text-[var(--color-risk-medium)]">
                {t("timeline.fromArchive")}
              </span>
            ) : null}
            {outOfRange ? <OutOfRangeChip t={t} /> : null}
          </div>
          <span
            className={`ml-auto flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums ${
              live ? "text-[var(--color-success)]" : "text-[var(--color-risk-medium)]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                live ? "bg-[var(--color-success)] shadow-[0_0_6px_rgba(34,197,94,0.9)]" : "bg-[var(--color-risk-medium)]"
              }`}
              aria-hidden="true"
            />
            {label}
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={steps}
          step={1}
          value={clamped}
          onChange={(e) => {
            setPlaying(false);
            setStep(Number(e.target.value));
          }}
          aria-label={t("timeline.slider")}
          aria-valuetext={label}
          className="range-slider mt-2 w-full"
          style={{ "--range-progress": `${progress}%` } as React.CSSProperties}
        />

        {/* รอบบิน Sentinel-1 (E14.F5): แถวของตัวเองระหว่างรางกับขีดเวลา ตำแหน่งจริงตามเวลา */}
        {visibleMarks.length > 0 ? (
          <div className="relative h-3">
            <PassMarks marks={visibleMarks} variant="full" onSelect={selectMark} t={t} />
          </div>
        ) : null}

        {/* Ticks sit at their true position along the track, not evenly spaced. */}
        <div className="relative mt-0.5 h-3.5 text-[10px] leading-none text-[var(--color-fg-subtle)]">
          {range.ticks.map((h, i) => {
            const pct = (1 - h / RANGE_HOURS) * 100;
            const last = i === range.ticks.length - 1;
            return (
              <span
                key={h}
                className="absolute top-0 whitespace-nowrap tabular-nums"
                style={{
                  left: `${pct}%`,
                  transform: i === 0 ? "none" : last ? "translateX(-100%)" : "translateX(-50%)",
                }}
              >
                {tickLabel(h, t)}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
