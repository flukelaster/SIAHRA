import { AlertTriangle, CloudRain, Droplets, Waves } from "lucide-react";
import type { ObservationSummary } from "@siahra/shared-types";
import { formatNumber } from "../../lib/number";
import { useLang } from "../../i18n/context";

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
    <div className="glass flex min-w-0 items-center gap-2.5 rounded-2xl px-3 py-2.5">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
          emphasis
            ? "bg-[var(--color-risk-high)]/20 text-[var(--color-risk-high)] shadow-[0_0_16px_rgba(249,115,22,0.35)]"
            : "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
        }`}
      >
        {icon}
      </div>
      {/* ห้ามตัดหน่วยหรือเกณฑ์ทิ้ง: "5 stati…" ข้างไอคอนเตือนสีส้มไม่ได้สื่ออะไรเลย
          ป้ายและหน่วยจึงห่อบรรทัดแทนที่จะ truncate (ช่องกว้างจริงราว 68px ตอนจอ 1280) */}
      <div className="min-w-0 leading-tight">
        <p className="text-[11px] break-words text-[var(--color-fg-subtle)]" title={label}>
          {label}
        </p>
        <p
          className={`text-lg font-bold tabular-nums ${
            emphasis ? "text-[var(--color-risk-high)]" : "text-[var(--color-fg)]"
          }`}
        >
          <span className="whitespace-nowrap">{value}</span>{" "}
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
  const { lang, t } = useLang();
  if (loading && !summary) {
    return (
      <div className={GRID}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glass flex min-w-0 items-center gap-2.5 rounded-2xl px-3 py-2.5">
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-xl bg-white/8" />
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
        {t("stats.none")}
      </div>
    );
  }

  const fmt = (n: number | null, digits = 1) => formatNumber(lang, n, digits);

  return (
    <div className={GRID}>
      <Tile
        icon={<CloudRain size={17} aria-hidden="true" />}
        label={t("stats.rainStations")}
        value={formatNumber(lang, summary.rainfallStationCount)}
        unit={t("unit.stations")}
      />
      <Tile
        icon={<Droplets size={17} aria-hidden="true" />}
        label={t("stats.maxRain24h")}
        value={fmt(summary.maxRain24h)}
        unit={t("unit.mm")}
      />
      <Tile
        icon={<Waves size={17} aria-hidden="true" />}
        label={t("stats.waterStations")}
        value={formatNumber(lang, summary.waterlevelStationCount)}
        unit={t("unit.stations")}
      />
      <Tile
        icon={<AlertTriangle size={17} aria-hidden="true" />}
        label={t("stats.aboveWarning")}
        value={formatNumber(lang, summary.stationsAboveWarning)}
        unit={t("unit.stations")}
        emphasis={summary.stationsAboveWarning > 0}
      />
    </div>
  );
}
