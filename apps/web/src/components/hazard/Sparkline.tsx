import type { WaterLevelHistoryPoint } from "@siahra/shared-types";
import { useT } from "../../i18n/context";
import { sparklineRange } from "../../lib/sparklineRange";

/**
 * Tiny inline SVG line chart for a station's history. `series` picks the
 * observed column to draw: water level (default; optional reference line for
 * the lowest bank, only when the series is on MSL) or discharge (m³/s, from
 * the same `waterlevel_graph` rows — no bank line, it is a different unit).
 * `cursorMs` draws a thin vertical line at the time the timeline is scrubbed to.
 */
export function Sparkline({
  points,
  bankMsl,
  width = 300,
  height = 64,
  series = "level",
  cursorMs = null,
  className = "h-16 w-full",
}: {
  points: WaterLevelHistoryPoint[];
  bankMsl: number | null;
  width?: number;
  height?: number;
  series?: "level" | "discharge";
  cursorMs?: number | null;
  className?: string;
}) {
  const t = useT();
  const discharge = series === "discharge";
  const pick = (p: WaterLevelHistoryPoint) => (discharge ? p.discharge : p.value);
  // Long series (30 days at 10 min = 4,320 pts) are thinned for the tiny chart.
  const allValid = points
    .filter((p) => pick(p) !== null)
    .map((p) => ({ t: p.t, v: pick(p) as number }));
  const stride = Math.max(1, Math.ceil(allValid.length / 600));
  const valid = stride === 1 ? allValid : allValid.filter((_, i) => i % stride === 0 || i === allValid.length - 1);
  if (valid.length < 2) {
    return (
      <p className="text-[11px] text-[var(--color-fg-subtle)]">
        {t(discharge ? "water.sparkline.noneDischarge" : "water.sparkline.none")}
      </p>
    );
  }
  const bank = discharge ? null : bankMsl;
  const t0 = Date.parse(valid[0].t);
  const t1 = Date.parse(valid[valid.length - 1].t);
  // ป้ายแกนใช้ค่าที่วัดได้จริงจากอนุกรมเต็ม (ก่อนตัดความถี่ — ยอดอาจตกไป) ช่วงที่ขยายใช้วาดเท่านั้น
  const { observedMin, observedMax, scaleMin: min, scaleMax: max } = sparklineRange(
    allValid.map((p) => p.v),
    bank,
    discharge,
  );
  const pad = 4;
  const x = (ms: number) => pad + ((ms - t0) / Math.max(1, t1 - t0)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / (max - min)) * (height - pad * 2);
  const d = valid.map((p, i) => `${i === 0 ? "M" : "L"}${x(Date.parse(p.t)).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const last = valid[valid.length - 1];
  const stroke = discharge ? "#a78bfa" : "#38bdf8";
  const digits = discharge ? 0 : 2;
  const showCursor = cursorMs !== null && cursorMs >= t0 && cursorMs <= t1;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={t(discharge ? "water.sparkline.dischargeAria" : "water.sparkline.aria")}
    >
      {bank !== null ? (
        <>
          <line x1={pad} x2={width - pad} y1={y(bank)} y2={y(bank)} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} />
          <text x={width - pad} y={y(bank) - 3} textAnchor="end" fontSize={9} fill="#fca5a5">{t("water.sparkline.bank")}</text>
        </>
      ) : null}
      {showCursor ? (
        <line x1={x(cursorMs)} x2={x(cursorMs)} y1={pad} y2={height - pad} stroke="#fbbf24" strokeWidth={1} strokeDasharray="2 2" />
      ) : null}
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.6} />
      <circle cx={x(Date.parse(last.t))} cy={y(last.v)} r={2.5} fill={stroke} />
      <text x={pad} y={10} fontSize={9} fill="#94a3b8">{observedMax.toFixed(digits)}</text>
      <text x={pad} y={height - 2} fontSize={9} fill="#94a3b8">{observedMin.toFixed(digits)}</text>
    </svg>
  );
}
