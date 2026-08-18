import { ChevronDown, ChevronUp, Info, Waves } from "lucide-react";
import { useState } from "react";
import type { SituationLevel, WaterLevelObservation } from "@siahra/shared-types";
import { useStationHistory } from "../../hooks/useStationHistory";
import { Panel } from "../ui/Panel";
import { Sparkline } from "./Sparkline";
import { NEVER_RECEIVED_TH, formatFetchedAt } from "../../lib/time";

/**
 * ThaiWater's own published situation levels. This app displays the source's
 * classification verbatim — it does not compute or reinterpret risk.
 */
const SITUATION_META: Record<SituationLevel, { label: string; cls: string; dot: string }> = {
  1: { label: "น้ำน้อยวิกฤต", cls: "text-red-300", dot: "bg-red-300" },
  2: { label: "น้ำน้อย", cls: "text-amber-300", dot: "bg-amber-300" },
  3: { label: "ปกติ", cls: "text-[var(--color-success)]", dot: "bg-[var(--color-success)]" },
  4: { label: "น้ำมาก", cls: "text-[var(--color-risk-high)]", dot: "bg-[var(--color-risk-high)]" },
  5: { label: "ล้นตลิ่ง", cls: "text-[var(--color-risk-extreme)]", dot: "bg-[var(--color-risk-extreme)]" },
};

function StationRow({ obs, historical }: { obs: WaterLevelObservation; historical: boolean }) {
  const meta = obs.situationLevel ? SITUATION_META[obs.situationLevel] : null;
  const [open, setOpen] = useState(false);
  const history = useStationHistory(obs.station.id, open);
  return (
    <li className="border-t border-[var(--color-border)] py-2 first:border-t-0">
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      className="flex w-full cursor-pointer items-start gap-2.5 text-left"
      aria-expanded={open}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-[var(--color-fg)]">
          {obs.station.nameTh ?? obs.station.nameEn ?? `สถานี ${obs.station.id}`}
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-[var(--color-fg-subtle)]">
          {obs.station.amphoeNameTh ? <span>{obs.station.amphoeNameTh}</span> : null}
          {obs.waterlevelMsl !== null ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{obs.waterlevelMsl.toFixed(2)} ม.รทก.</span>
            </>
          ) : null}
          {obs.freeboardM !== null ? (
            <>
              <span aria-hidden="true">·</span>
              <span
                className={`tabular-nums ${
                  obs.freeboardM <= 0 ? "text-[var(--color-risk-extreme)]" : ""
                }`}
              >
                {obs.freeboardM <= 0
                  ? `สูงกว่าตลิ่ง ${Math.abs(obs.freeboardM).toFixed(2)} ม.`
                  : `ต่ำกว่าตลิ่ง ${obs.freeboardM.toFixed(2)} ม.`}
              </span>
            </>
          ) : null}
        </p>
      </div>
      {meta ? (
        <span className={`flex shrink-0 items-center gap-1 text-[11px] ${meta.cls}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
          {meta.label}
        </span>
      ) : historical ? (
        <span className="shrink-0 text-[10px] text-[var(--color-fg-subtle)]">ค่าย้อนหลัง</span>
      ) : null}
      {open ? <ChevronUp size={12} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" /> : <ChevronDown size={12} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" />}
    </button>
    {open ? (
      <div className="mt-1.5 rounded-lg bg-[var(--color-bg-elevated)] px-2 py-1.5">
        {history.loading ? (
          <div className="h-16 animate-pulse rounded bg-white/8" />
        ) : history.error ? (
          <p className="text-[11px] text-[var(--color-danger)]">{history.error}</p>
        ) : history.data ? (
          <>
            <Sparkline
              points={history.data.points}
              bankMsl={history.data.datum === "msl" ? obs.minBankMsl : null}
            />
            <p className="text-[10px] text-[var(--color-fg-subtle)]">
              72 ชม. ล่าสุด · {history.data.datum === "msl" ? "ม.รทก." : history.data.datum === "local" ? "ม. (ระดับอ้างอิงสถานี)" : "ม."} · ค่าตรวจวัดจริง 10 นาที/จุด
            </p>
          </>
        ) : null}
      </div>
    ) : null}
    </li>
  );
}

export function WaterLevelCard({
  stations,
  loading,
  attribution,
  observedAt,
  historical = false,
}: {
  stations: WaterLevelObservation[];
  loading: boolean;
  attribution: string | null;
  observedAt: string | null;
  /** True while the timeline is scrubbed into the past (no situation levels). */
  historical?: boolean;
}) {
  // Most critical first: overflowing/high stations, then least freeboard.
  const ranked = [...stations].sort((a, b) => {
    const sl = (b.situationLevel ?? 0) - (a.situationLevel ?? 0);
    if (sl !== 0) return sl;
    return (a.freeboardM ?? Infinity) - (b.freeboardM ?? Infinity);
  });
  const overflowing = stations.filter((s) => (s.situationLevel ?? 0) >= 4).length;

  return (
    <Panel
      title="ระดับน้ำที่ตรวจวัดได้"
      icon={<Waves size={16} className="text-[var(--color-accent)]" aria-hidden="true" />}
      headerAction={
        <span className="text-[11px] text-[var(--color-fg-muted)]">
          {loading ? "กำลังโหลด..." : `${stations.length} สถานี`}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {historical ? (
          <p className="rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-2 text-xs text-[var(--color-risk-medium)]">
            กำลังดูค่าย้อนหลัง — สีจุดบนแผนที่คิดจากระยะต่ำกว่าตลิ่ง (ThaiWater ไม่เผยแพร่ระดับสถานการณ์ย้อนหลัง)
          </p>
        ) : overflowing > 0 ? (
          <p className="rounded-lg bg-[var(--color-risk-high)]/10 px-2.5 py-2 text-xs text-[var(--color-risk-high)]">
            มี {overflowing} สถานีอยู่ในเกณฑ์น้ำมากหรือล้นตลิ่ง
          </p>
        ) : null}

        {loading && stations.length === 0 ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-[var(--color-panel-2)]" />
            ))}
          </div>
        ) : ranked.length > 0 ? (
          <ul className="max-h-64 overflow-y-auto pr-0.5">
            {ranked.slice(0, 20).map((s) => (
              <StationRow key={s.station.id} obs={s} historical={historical} />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-3 text-center text-xs text-[var(--color-fg-muted)]">
            ไม่มีสถานีวัดระดับน้ำในจังหวัดนี้
          </p>
        )}

        <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-2 text-[11px] text-[var(--color-fg-muted)]">
          <Info size={13} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
          ค่าที่แสดงเป็นการตรวจวัดจริงจากสถานีโทรมาตร ไม่ใช่การพยากรณ์
          {attribution ? ` · ${attribution}` : ""}
          {/* NEVER_RECEIVED_TH already reads "ยังไม่เคยได้รับข้อมูล", so the "ข้อมูล" prefix
              would repeat the word; prefix it only when there is a real timestamp to label. */}
          {observedAt ? ` · ข้อมูล ${formatFetchedAt(observedAt)}` : ` · ${NEVER_RECEIVED_TH}`}
        </p>
      </div>
    </Panel>
  );
}
