import type { ObservationSummary } from "@siahra/shared-types";
import { BRAND, DATA_ATTRIBUTION_TH } from "../../branding";
import { StatStrip } from "./StatStrip";

/** Bottom dock between the side docks: stat tiles + copyright/attribution. */
export function BottomBar({
  summary,
  loading,
  left,
  right,
}: {
  summary: ObservationSummary | null;
  loading: boolean;
  left: number;
  right: number;
}) {
  return (
    <div
      className="pointer-events-none absolute bottom-3 flex flex-col items-end gap-1.5"
      style={{ left, right }}
    >
      <div className="pointer-events-auto">
        <StatStrip summary={summary} loading={loading} />
      </div>
      <p className="truncate rounded-md bg-black/30 px-2 py-0.5 text-[10px] text-white/45 backdrop-blur-sm">
        © {BRAND.copyrightYear} {BRAND.name} · {DATA_ATTRIBUTION_TH}
      </p>
    </div>
  );
}
