import type { WaterLevelHistoryPoint } from "@siahra/shared-types";

/**
 * Tiny inline SVG line chart for a station's 72 h water level. Optional
 * reference line for the lowest bank (only when the series is on MSL).
 */
export function Sparkline({
  points,
  bankMsl,
  width = 300,
  height = 64,
}: {
  points: WaterLevelHistoryPoint[];
  bankMsl: number | null;
  width?: number;
  height?: number;
}) {
  // Long series (30 days at 10 min = 4,320 pts) are thinned for the tiny chart.
  const allValid = points.filter((p) => p.value !== null) as (WaterLevelHistoryPoint & { value: number })[];
  const stride = Math.max(1, Math.ceil(allValid.length / 600));
  const valid = stride === 1 ? allValid : allValid.filter((_, i) => i % stride === 0 || i === allValid.length - 1);
  if (valid.length < 2) {
    return <p className="text-[11px] text-[var(--color-fg-subtle)]">ไม่มีข้อมูลย้อนหลังเพียงพอ</p>;
  }
  const t0 = Date.parse(valid[0].t);
  const t1 = Date.parse(valid[valid.length - 1].t);
  const values = valid.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (bankMsl !== null) {
    min = Math.min(min, bankMsl);
    max = Math.max(max, bankMsl);
  }
  if (max - min < 0.2) {
    const mid = (max + min) / 2;
    min = mid - 0.1;
    max = mid + 0.1;
  }
  const pad = 4;
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / (max - min)) * (height - pad * 2);
  const d = valid.map((p, i) => `${i === 0 ? "M" : "L"}${x(Date.parse(p.t)).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = valid[valid.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full" role="img" aria-label="กราฟระดับน้ำ 72 ชั่วโมง">
      {bankMsl !== null ? (
        <>
          <line x1={pad} x2={width - pad} y1={y(bankMsl)} y2={y(bankMsl)} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} />
          <text x={width - pad} y={y(bankMsl) - 3} textAnchor="end" fontSize={9} fill="#fca5a5">ตลิ่งต่ำสุด</text>
        </>
      ) : null}
      <path d={d} fill="none" stroke="#38bdf8" strokeWidth={1.6} />
      <circle cx={x(Date.parse(last.t))} cy={y(last.value)} r={2.5} fill="#38bdf8" />
      <text x={pad} y={10} fontSize={9} fill="#94a3b8">{max.toFixed(2)}</text>
      <text x={pad} y={height - 2} fontSize={9} fill="#94a3b8">{min.toFixed(2)}</text>
    </svg>
  );
}
