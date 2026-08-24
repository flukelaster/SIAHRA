import { AlertTriangle, CloudRain, Droplets, Waves } from "lucide-react";
import type { ObservationSummary } from "@siahra/shared-types";
import { formatNumber } from "../../lib/number";
import { useLang } from "../../i18n/context";

const PILL = "inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-0.5 text-[11px] leading-5 tabular-nums backdrop-blur-sm";
/** มือถือ: แน่นกว่า (ไม่มีไอคอน ตัวอักษร 10px) ให้สอง pill อยู่แถวเดียวกันในความกว้าง ~300px */
const PILL_COMPACT = "inline-flex items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] leading-4 tabular-nums backdrop-blur-sm";

function Pill({
  icon,
  label,
  value,
  unit,
  emphasis = false,
  compact = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  emphasis?: boolean;
  compact?: boolean;
}) {
  return (
    // ห้ามตัดหน่วยหรือเกณฑ์ทิ้ง: ป้าย+ค่า+หน่วยอยู่ครบใน pill เดียว (ป้ายเต็มอยู่ใน title ด้วย)
    <span
      className={`${compact ? PILL_COMPACT : PILL} ${emphasis ? "text-[var(--color-risk-high)]" : "text-white/85"}`}
      title={`${label}: ${value} ${unit}`}
    >
      {compact ? null : (
        <span className={emphasis ? "text-[var(--color-risk-high)]" : "text-[var(--color-accent)]"}>{icon}</span>
      )}
      <span className="text-white/60">{label}</span>
      <span className="font-semibold">{value}</span>
      <span className="text-white/60">{unit}</span>
    </span>
  );
}

/**
 * แถวตัวเลขสรุปใต้ชื่อจังหวัด — แทนที่ StatStrip (สี่กล่องใหญ่ใน dock ล่าง)
 * ด้วย pill เล็กสี่อันที่ไม่กินพื้นที่แผนที่ ห่อเป็น 2×2 บนจอ 390
 */
export function StatPills({
  summary,
  loading,
  compact = false,
}: {
  summary: ObservationSummary | null;
  loading: boolean;
  /** มือถือ: pill แน่นขึ้น ไม่มีไอคอน */
  compact?: boolean;
}) {
  const { lang, t } = useLang();
  const pill = compact ? PILL_COMPACT : PILL;
  const row = compact ? "flex flex-wrap gap-1" : "flex flex-wrap gap-1.5";
  if (loading && !summary) {
    return (
      <div className={row} aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`${pill} ${compact ? "h-5 w-20" : "h-6 w-24"} animate-pulse bg-black/50`} />
        ))}
      </div>
    );
  }
  if (!summary) {
    return (
      <div className={row}>
        <span className={`${pill} text-white/60`}>{t("stats.none")}</span>
      </div>
    );
  }
  const fmt = (n: number | null, digits = 1) => formatNumber(lang, n, digits);
  return (
    <div className={row}>
      <Pill
        compact={compact}
        icon={<CloudRain size={12} aria-hidden="true" />}
        label={t("stats.rainStations")}
        value={formatNumber(lang, summary.rainfallStationCount)}
        unit={t("unit.stations")}
      />
      <Pill
        compact={compact}
        icon={<Droplets size={12} aria-hidden="true" />}
        label={t("stats.maxRain24h")}
        value={fmt(summary.maxRain24h)}
        unit={t("unit.mm")}
      />
      <Pill
        compact={compact}
        icon={<Waves size={12} aria-hidden="true" />}
        label={t("stats.waterStations")}
        value={formatNumber(lang, summary.waterlevelStationCount)}
        unit={t("unit.stations")}
      />
      <Pill
        compact={compact}
        icon={<AlertTriangle size={12} aria-hidden="true" />}
        label={t("stats.aboveWarning")}
        value={formatNumber(lang, summary.stationsAboveWarning)}
        unit={t("unit.stations")}
        emphasis={summary.stationsAboveWarning > 0}
      />
    </div>
  );
}
