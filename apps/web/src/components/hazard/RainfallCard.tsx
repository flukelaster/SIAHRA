import { CloudRain, Info } from "lucide-react";
import type { RainfallObservation } from "@siahra/shared-types";
import { Panel } from "../ui/Panel";

/** Colour by observed 24 h accumulation. Thresholds follow TMD's rainfall
 *  descriptive bands (light / moderate / heavy / very heavy). */
function rainClass(mm: number): string {
  if (mm >= 90) return "text-[var(--color-risk-extreme)]";
  if (mm >= 35) return "text-[var(--color-risk-high)]";
  if (mm >= 10) return "text-[var(--color-risk-medium)]";
  return "text-[var(--color-risk-low)]";
}

export function RainfallCard({
  stations,
  loading,
  attribution,
}: {
  stations: RainfallObservation[];
  loading: boolean;
  attribution: string | null;
}) {
  const reporting = stations.filter((s) => s.rain24h !== null);
  const ranked = [...reporting].sort((a, b) => (b.rain24h ?? 0) - (a.rain24h ?? 0));
  const wet = reporting.filter((s) => (s.rain24h ?? 0) > 0).length;

  return (
    <Panel
      title="ปริมาณฝน 24 ชั่วโมง"
      icon={<CloudRain size={16} className="text-[var(--color-accent)]" aria-hidden="true" />}
      headerAction={
        <span className="text-[11px] text-[var(--color-fg-muted)]">
          {loading ? "กำลังโหลด..." : `${reporting.length} สถานี`}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {!loading && reporting.length > 0 ? (
          <p className="text-xs text-[var(--color-fg-muted)]">
            มีฝนตก <span className="font-semibold text-[var(--color-fg)]">{wet}</span> สถานี จาก{" "}
            {reporting.length} สถานีที่รายงาน
          </p>
        ) : null}

        {loading && stations.length === 0 ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-7 animate-pulse rounded bg-[var(--color-panel-2)]" />
            ))}
          </div>
        ) : ranked.length > 0 ? (
          <ul className="max-h-56 overflow-y-auto pr-0.5">
            {ranked.slice(0, 15).map((s) => (
              <li
                key={s.station.id}
                className="flex items-center gap-2.5 border-t border-[var(--color-border)] py-1.5 first:border-t-0"
              >
                <span
                  className={`w-14 shrink-0 text-right text-sm font-bold tabular-nums ${rainClass(
                    s.rain24h ?? 0,
                  )}`}
                >
                  {(s.rain24h ?? 0).toFixed(1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-[var(--color-fg)]">
                    {s.station.nameTh ?? `สถานี ${s.station.id}`}
                  </p>
                  <p className="truncate text-[11px] text-[var(--color-fg-subtle)]">
                    {[s.station.amphoeNameTh, s.station.agencyShortTh].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-3 text-center text-xs text-[var(--color-fg-muted)]">
            ไม่มีสถานีวัดน้ำฝนในจังหวัดนี้
          </p>
        )}

        <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-2 text-[11px] text-[var(--color-fg-muted)]">
          <Info size={13} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
          ปริมาณฝนสะสมที่ตรวจวัดจริงจากสถานีโทรมาตร ไม่ใช่การพยากรณ์
          {attribution ? ` · ${attribution}` : ""}
        </p>
      </div>
    </Panel>
  );
}
