import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "../ui/Segmented";
import { formatFetchedAt } from "../../lib/time";

/** Selectable playback windows: hours, slider step in minutes, tick marks (hours ago). */
const RANGES: { hours: number; stepMin: number; label: string; ticks: number[] }[] = [
  { hours: 72, stepMin: 30, label: "72 ชม.", ticks: [72, 48, 24, 0] },
  { hours: 7 * 24, stepMin: 60, label: "7 วัน", ticks: [168, 120, 72, 24, 0] },
  { hours: 30 * 24, stepMin: 180, label: "30 วัน", ticks: [720, 480, 240, 0] },
];
/** Beyond this the backend reads from the long-term archive (R2). */
const HOT_HOURS = 7 * 24;

function tickLabel(h: number): string {
  if (h === 0) return "ตอนนี้";
  return h >= 48 ? `-${h / 24} วัน` : `-${h} ชม.`;
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
}: {
  atIso: string | null;
  onChange: (atIso: string | null) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [rangeIdx, setRangeIdx] = useState(0);
  const range = RANGES[rangeIdx];
  const RANGE_HOURS = range.hours;
  const STEP_MIN = range.stepMin;
  const steps = (RANGE_HOURS * 60) / STEP_MIN;
  const ageHours = atIso ? (Date.now() - Date.parse(atIso)) / 3600000 : 0;
  const fromArchive = ageHours > HOT_HOURS;
  const now = Date.now();
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
    if (!atIso) return "ปัจจุบัน · ค่าล่าสุด";
    return formatFetchedAt(atIso);
  }, [atIso]);

  const live = atIso === null;
  const progress = (clamped / steps) * 100;

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
          aria-label={playing ? "หยุด" : "เล่นย้อนหลัง"}
          title={playing ? "หยุด" : "เล่นย้อนหลัง"}
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
          aria-label="กลับสู่ปัจจุบัน"
          title="กลับสู่ปัจจุบัน"
        >
          <RotateCcw size={15} />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="shrink-0 text-xs font-semibold text-[var(--color-fg)]">ระดับน้ำย้อนหลัง</span>
            <Segmented
              label="ช่วงเวลาย้อนหลัง"
              value={rangeIdx}
              onChange={(i) => {
                setPlaying(false);
                setRangeIdx(i);
                onChange(null);
              }}
              options={RANGES.map((r, i) => ({ value: i, label: r.label }))}
            />
            <span className="hidden truncate text-[11px] text-[var(--color-fg-subtle)] @2xl:inline">
              ค่าตรวจวัดจริง · ไม่ใช่พยากรณ์
            </span>
            {fromArchive ? (
              <span className="shrink-0 rounded-md bg-[var(--color-risk-medium)]/15 px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap text-[var(--color-risk-medium)]">
                จากคลังถาวร · รายชั่วโมง
              </span>
            ) : null}
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
          aria-label="เลื่อนเวลา"
          aria-valuetext={label}
          className="range-slider mt-2 w-full"
          style={{ "--range-progress": `${progress}%` } as React.CSSProperties}
        />

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
                {tickLabel(h)}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
