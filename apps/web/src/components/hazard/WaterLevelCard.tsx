import { ChevronDown, ChevronUp, Info, Waves } from "lucide-react";
import { useState } from "react";
import type { SituationLevel, WaterLevelObservation } from "@siahra/shared-types";
import { useStationHistory } from "../../hooks/useStationHistory";
import { Panel } from "../ui/Panel";
import { Sparkline } from "./Sparkline";
import { neverReceived, formatFetchedAt } from "../../lib/time";
import { useLang } from "../../i18n/context";
import type { Lang, MessageKey, TFunction } from "../../i18n";
import { resolveError } from "../../lib/errorMessage";

/**
 * ThaiWater's own published situation levels. This app displays the source's
 * classification verbatim — it does not compute or reinterpret risk.
 */
const SITUATION_META: Record<SituationLevel, { labelKey: MessageKey; cls: string; dot: string }> = {
  1: { labelKey: "situation.1", cls: "text-red-300", dot: "bg-red-300" },
  2: { labelKey: "situation.2", cls: "text-amber-300", dot: "bg-amber-300" },
  3: { labelKey: "situation.3", cls: "text-[var(--color-success)]", dot: "bg-[var(--color-success)]" },
  4: { labelKey: "situation.4", cls: "text-[var(--color-risk-high)]", dot: "bg-[var(--color-risk-high)]" },
  5: { labelKey: "situation.5", cls: "text-[var(--color-risk-extreme)]", dot: "bg-[var(--color-risk-extreme)]" },
};

/** ชื่อสถานีที่ต้นทางให้มา — ไม่ใช่ข้อความ UI จึงเลือกฟิลด์ตามภาษา ไม่ได้แปลเอง */
function stationName(
  station: { nameTh: string | null; nameEn: string | null; id: number },
  lang: Lang,
  t: TFunction,
): string {
  const name = lang === "th" ? (station.nameTh ?? station.nameEn) : (station.nameEn ?? station.nameTh);
  return name ?? t("water.stationFallback", { id: station.id });
}

function StationRow({
  obs,
  historical,
  lang,
  t,
}: {
  obs: WaterLevelObservation;
  historical: boolean;
  lang: Lang;
  t: TFunction;
}) {
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
          {stationName(obs.station, lang, t)}
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-[var(--color-fg-subtle)]">
          {obs.station.amphoeNameTh ? <span>{obs.station.amphoeNameTh}</span> : null}
          {obs.waterlevelMsl !== null ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{`${obs.waterlevelMsl.toFixed(2)} ${t("unit.msl")}`}</span>
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
                  ? t("water.aboveBank", { n: Math.abs(obs.freeboardM).toFixed(2), unit: t("unit.m") })
                  : t("water.belowBank", { n: obs.freeboardM.toFixed(2), unit: t("unit.m") })}
              </span>
            </>
          ) : null}
        </p>
      </div>
      {meta ? (
        <span className={`flex shrink-0 items-center gap-1 text-[11px] ${meta.cls}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
          {t(meta.labelKey)}
        </span>
      ) : historical ? (
        <span className="shrink-0 text-[10px] text-[var(--color-fg-subtle)]">{t("water.historicalChip")}</span>
      ) : null}
      {open ? <ChevronUp size={12} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" /> : <ChevronDown size={12} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" />}
    </button>
    {open ? (
      <div className="mt-1.5 rounded-lg bg-[var(--color-bg-elevated)] px-2 py-1.5">
        {history.loading ? (
          <div className="h-16 animate-pulse rounded bg-white/8" />
        ) : history.error ? (
          <p className="text-[11px] text-[var(--color-danger)]">{resolveError(t, history.error)}</p>
        ) : history.data ? (
          <>
            <Sparkline
              points={history.data.points}
              bankMsl={history.data.datum === "msl" ? obs.minBankMsl : null}
            />
            <p className="text-[10px] text-[var(--color-fg-subtle)]">
              {t("water.history.caption", {
                datum: t(
                  history.data.datum === "msl"
                    ? "water.datum.msl"
                    : history.data.datum === "local"
                      ? "water.datum.local"
                      : "water.datum.unknown",
                ),
              })}
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
  const { lang, t } = useLang();
  // Most critical first: overflowing/high stations, then least freeboard.
  const ranked = [...stations].sort((a, b) => {
    const sl = (b.situationLevel ?? 0) - (a.situationLevel ?? 0);
    if (sl !== 0) return sl;
    return (a.freeboardM ?? Infinity) - (b.freeboardM ?? Infinity);
  });
  const overflowing = stations.filter((s) => (s.situationLevel ?? 0) >= 4).length;

  return (
    <Panel
      title={t("water.title")}
      icon={<Waves size={16} className="text-[var(--color-accent)]" aria-hidden="true" />}
      headerAction={
        <span className="text-[11px] text-[var(--color-fg-muted)]">
          {loading ? t("common.loading") : `${stations.length} ${t("unit.stations")}`}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {historical ? (
          <p className="rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-2 text-xs text-[var(--color-risk-medium)]">
            {t("water.historicalNote")}
          </p>
        ) : overflowing > 0 ? (
          <p className="rounded-lg bg-[var(--color-risk-high)]/10 px-2.5 py-2 text-xs text-[var(--color-risk-high)]">
            {t("water.overflowing", { n: overflowing })}
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
              <StationRow key={s.station.id} obs={s} historical={historical} lang={lang} t={t} />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-3 text-center text-xs text-[var(--color-fg-muted)]">
            {t("water.none")}
          </p>
        )}

        <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-2 text-[11px] text-[var(--color-fg-muted)]">
          <Info size={13} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
          {t("water.note")}
          {/* attribution มาจาก API (ข้อความเครดิตของต้นทาง) — แสดงตามที่ได้มา ไม่แปล */}
          {attribution ? ` · ${attribution}` : ""}
          {/* `neverReceived` อ่านว่า "ยังไม่เคยได้รับข้อมูล" อยู่แล้ว การเติมคำว่า
              "ข้อมูล" นำหน้าจึงซ้ำ — ใส่คำนำหน้าเฉพาะตอนที่มีเวลาจริงให้กำกับ */}
          {observedAt
            ? t("water.observedAt", { time: formatFetchedAt(lang, observedAt) })
            : ` · ${neverReceived(lang)}`}
        </p>
      </div>
    </Panel>
  );
}
