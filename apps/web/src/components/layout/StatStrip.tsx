import { AlertTriangle, CloudRain, Droplets, Waves } from "lucide-react";
import type { ObservationSummary } from "@siahra/shared-types";
import { formatNumber } from "../../lib/number";

function Tile({
  icon,
  label,
  value,
  unit,
  emphasis = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  emphasis?: boolean;
}) {
  return (
    <div className="glass flex min-w-0 items-center gap-3 rounded-2xl px-3.5 py-2.5">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          emphasis
            ? "bg-[var(--color-risk-high)]/20 text-[var(--color-risk-high)] shadow-[0_0_16px_rgba(249,115,22,0.35)]"
            : "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-[11px] text-[var(--color-fg-subtle)]" title={label}>
          {label}
        </p>
        <p
          className={`truncate text-lg font-bold tabular-nums ${
            emphasis ? "text-[var(--color-risk-high)]" : "text-[var(--color-fg)]"
          }`}
        >
          {value}{" "}
          <span className="text-[11px] font-normal text-[var(--color-fg-muted)]">{unit}</span>
        </p>
      </div>
    </div>
  );
}

/** Two columns when the dock is narrow, four when there is room. */
const GRID = "grid grid-cols-2 gap-2 @xl:grid-cols-4";

/** Bottom stat tiles: latest observed values for the selected province. */
export function StatStrip({
  summary,
  loading,
}: {
  summary: ObservationSummary | null;
  loading: boolean;
}) {
  if (loading && !summary) {
    return (
      <div className={GRID}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glass flex min-w-0 items-center gap-3 rounded-2xl px-3.5 py-2.5">
            <div className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-white/8" />
            <div className="flex flex-col gap-1.5">
              <div className="h-2.5 w-20 animate-pulse rounded bg-white/8" />
              <div className="h-4 w-12 animate-pulse rounded bg-white/8" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="glass-soft rounded-2xl px-3.5 py-2.5 text-center text-xs text-[var(--color-fg-subtle)]">
        ไม่มีข้อมูลตรวจวัด
      </div>
    );
  }

  const fmt = (n: number | null, digits = 1) =>
    formatNumber(n, digits);

  return (
    <div className={GRID}>
      <Tile
        icon={<CloudRain size={17} aria-hidden="true" />}
        label="สถานีวัดน้ำฝน"
        value={formatNumber(summary.rainfallStationCount)}
        unit="สถานี"
      />
      <Tile
        icon={<Droplets size={17} aria-hidden="true" />}
        label="ฝนสูงสุด 24 ชม."
        value={fmt(summary.maxRain24h)}
        unit="มม."
      />
      <Tile
        icon={<Waves size={17} aria-hidden="true" />}
        label="สถานีวัดระดับน้ำ"
        value={formatNumber(summary.waterlevelStationCount)}
        unit="สถานี"
      />
      <Tile
        icon={<AlertTriangle size={17} aria-hidden="true" />}
        label="เกินเกณฑ์เฝ้าระวัง"
        value={formatNumber(summary.stationsAboveWarning)}
        unit="สถานี"
        emphasis={summary.stationsAboveWarning > 0}
      />
    </div>
  );
}
