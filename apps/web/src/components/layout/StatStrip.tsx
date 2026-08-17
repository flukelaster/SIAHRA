import { AlertTriangle, CloudRain, Droplets, Waves } from "lucide-react";
import type { ObservationSummary } from "@siahra/shared-types";

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
    <div className="glass flex min-w-[9.5rem] items-center gap-3 rounded-2xl px-3.5 py-2.5">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          emphasis
            ? "bg-[var(--color-risk-high)]/20 text-[var(--color-risk-high)] shadow-[0_0_16px_rgba(249,115,22,0.35)]"
            : "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
        }`}
      >
        {icon}
      </div>
      <div className="leading-tight">
        <p className="text-[11px] whitespace-nowrap text-[var(--color-fg-subtle)]">{label}</p>
        <p
          className={`text-lg font-bold tabular-nums ${
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
      <div className="flex items-center gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glass flex min-w-[9.5rem] items-center gap-3 rounded-2xl px-3.5 py-2.5">
            <div className="h-9 w-9 animate-pulse rounded-xl bg-white/8" />
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
      <div className="glass-soft rounded-2xl px-3.5 py-2.5 text-xs text-[var(--color-fg-subtle)]">
        ไม่มีข้อมูลตรวจวัด
      </div>
    );
  }

  const fmt = (n: number | null, digits = 1) =>
    n === null ? "—" : n.toLocaleString("th-TH", { maximumFractionDigits: digits });

  return (
    <div className="flex items-center gap-2">
      <Tile
        icon={<CloudRain size={17} aria-hidden="true" />}
        label="สถานีวัดน้ำฝน"
        value={summary.rainfallStationCount.toLocaleString("th-TH")}
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
        value={summary.waterlevelStationCount.toLocaleString("th-TH")}
        unit="สถานี"
      />
      <Tile
        icon={<AlertTriangle size={17} aria-hidden="true" />}
        label="เกินเกณฑ์เฝ้าระวัง"
        value={summary.stationsAboveWarning.toLocaleString("th-TH")}
        unit="สถานี"
        emphasis={summary.stationsAboveWarning > 0}
      />
    </div>
  );
}
