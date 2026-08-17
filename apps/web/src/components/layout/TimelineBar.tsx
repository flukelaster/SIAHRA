import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/** Selectable playback windows: hours and slider step in minutes. */
const RANGES: { hours: number; stepMin: number; label: string }[] = [
  { hours: 72, stepMin: 30, label: "72 ชม." },
  { hours: 7 * 24, stepMin: 60, label: "7 วัน" },
  { hours: 30 * 24, stepMin: 180, label: "30 วัน" },
];
/** Beyond this the backend reads from the long-term archive (R2). */
const HOT_HOURS = 7 * 24;

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
  const RANGE_HOURS = RANGES[rangeIdx].hours;
  const STEP_MIN = RANGES[rangeIdx].stepMin;
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
    if (!atIso) return "ปัจจุบัน (ค่าล่าสุด)";
    return new Date(atIso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " น.";
  }, [atIso]);

  const ticks = rangeIdx === 0 ? [72, 48, 24, 0] : rangeIdx === 1 ? [168, 120, 72, 24, 0] : [720, 480, 240, 0];

  return (
    <div className="glass flex items-center gap-3 rounded-2xl px-3 py-2">
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => {
            if (clamped >= steps) setStep(0);
            setPlaying((p) => !p);
          }}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-[var(--color-accent)] text-white hover:bg-blue-500"
          aria-label={playing ? "หยุด" : "เล่นย้อนหลัง"}
        >
          {playing ? <Pause size={14} /> : <Play size={14} className="translate-x-px" />}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            onChange(null);
          }}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-[var(--color-fg-muted)] hover:bg-white/8 hover:text-white"
          aria-label="กลับสู่ปัจจุบัน"
          title="กลับสู่ปัจจุบัน"
        >
          <RotateCcw size={14} />
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="flex items-center gap-2 font-medium text-[var(--color-fg)]">
            ระดับน้ำย้อนหลัง
            <span className="flex rounded-md bg-white/5 p-0.5">
              {RANGES.map((r, i) => (
                <button
                  key={r.hours}
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setRangeIdx(i);
                    onChange(null);
                  }}
                  aria-pressed={rangeIdx === i}
                  className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] ${
                    rangeIdx === i ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </span>
            <span className="text-[var(--color-fg-subtle)]">· ค่าตรวจวัดจริง ไม่ใช่พยากรณ์</span>
            {fromArchive ? (
              <span className="rounded bg-[var(--color-risk-medium)]/15 px-1.5 text-[10px] text-[var(--color-risk-medium)]">
                จากคลังถาวร (รายชั่วโมง)
              </span>
            ) : null}
          </span>
          <span className={`tabular-nums ${atIso ? "text-[var(--color-risk-medium)]" : "text-[var(--color-success)]"}`}>
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
          className="mt-1 w-full accent-[var(--color-accent)]"
        />
        <div className="flex justify-between text-[10px] text-[var(--color-fg-subtle)]">
          {ticks.map((h) => (
            <span key={h}>{h === 0 ? "ตอนนี้" : h >= 48 ? `-${h / 24} วัน` : `-${h} ชม.`}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
