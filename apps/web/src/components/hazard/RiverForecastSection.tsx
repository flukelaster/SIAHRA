import { useMemo } from "react";
import { SOURCES, type NorthRouteHistoryPoint } from "@siahra/shared-types";
import type { RiverForecastState } from "../../hooks/useRiverForecast";
import type { Lang, MessageKey, TFunction } from "../../i18n";
import { EPISTEMIC_BADGE } from "../../lib/layerFreshness";
import { formatNumber } from "../../lib/number";
import {
  FORECAST_STALE_MS,
  chartModel,
  observedForChart,
  relativeTime,
  stackLabelYs,
  type ForecastEntry,
  type RelativeTime,
} from "../../lib/riverForecast";
import { formatDateTime } from "../../lib/time";

/**
 * ส่วน "ผลลัพธ์แบบจำลอง HII" ของแผงน้ำเหนือ — แยกออกจากค่าตรวจวัดทุกจุด: ป้ายชนิด `forecast` เส้นประ, ที่มา, และทุกเส้นที่วาด
 * จากแบบจำลองเป็น **เส้นประ** ส่วนค่าที่วัดได้เป็นเส้นทึบ
 *
 * ไม่มีความน่าจะเป็น ไม่มีเวลาที่น้ำจะมาถึง ไม่มีตัวเลขที่เราคำนวณเอง (`lib/riverForecast.ts`): ที่แสดงมีแค่ค่าสูงสุดของ
 * แบบจำลอง จุดแรกที่ค่าเกินเกณฑ์ที่ HII เผยแพร่ และเลขคณิตของเวลา ("อีก N ชม.") — และเฉพาะโหมดสด
 */

const iso = (ms: number) => new Date(ms).toISOString();
const digitsFor = (kind: "discharge" | "waterlevel") => (kind === "discharge" ? 0 : 2);
const unitText = (unit: "m3/s" | "m", t: TFunction) => (unit === "m3/s" ? t("unit.m3s") : t("unit.m"));

function relText(rel: RelativeTime, t: TFunction): string {
  if (rel.dir === "now") return t("north.forecast.rel.now");
  const n = String(rel.n);
  if (rel.dir === "future") return t(rel.unit === "h" ? "north.forecast.rel.inH" : "north.forecast.rel.inD", { n });
  return t(rel.unit === "h" ? "time.hoursAgo" : "time.daysAgo", { n });
}

function maxText(entry: ForecastEntry, nowMs: number, lang: Lang, t: TFunction): string | null {
  const peak = entry.summary.peak;
  if (!peak) return null;
  const { kind, unit } = entry.station;
  return t("north.forecast.max", {
    value: formatNumber(lang, peak.value, digitsFor(kind)),
    unit: unitText(unit, t),
    time: formatDateTime(lang, iso(peak.t)),
    rel: relText(relativeTime(peak.t, nowMs), t),
  });
}

/** ไฟล์เก่ากว่า `FORECAST_STALE_MS` — ข้อความ "ไฟล์ไม่ได้อัปเดตตั้งแต่ …" (คนละเรื่องกับสำเนาของ API เก่า) */
function staleText(entry: ForecastEntry, lang: Lang, t: TFunction): string | null {
  if (entry.published.kind !== "stale" || entry.station.publishedAt === null) return null;
  return t("north.forecast.publishedStale", {
    time: formatDateTime(lang, entry.station.publishedAt),
    h: String(FORECAST_STALE_MS / 3_600_000),
  });
}

/** เหตุที่สถานีนี้ไม่มีส่วนพยากรณ์ให้แสดง (สถานะที่ไม่ใช่ ok) */
function unavailableKey(status: ForecastEntry["summary"]["status"]): MessageKey | null {
  if (status === "never-fetched") return "north.forecast.stationNever";
  if (status === "no-publish-time") return "north.forecast.publishedUnknown";
  if (status === "empty") return "north.forecast.empty";
  return null;
}

/**
 * บรรทัดเดียวใต้แถว (สถานี/จังหวัด): "ค่าสูงสุดของแบบจำลอง HII … เมื่อ … (อีก N ชม.)" หรือเหตุที่ไม่มี พร้อมขอบเส้นประ
 * (ผลลัพธ์แบบจำลอง ไม่ใช่ค่าตรวจวัด) หรี่เมื่อไฟล์/สำเนาเก่า
 */
export function ForecastBrief({
  entry,
  nowMs,
  lang,
  t,
  prefix,
}: {
  entry: ForecastEntry;
  nowMs: number;
  lang: Lang;
  t: TFunction;
  prefix?: string;
}) {
  const key = unavailableKey(entry.summary.status);
  const text = key ? t(key) : maxText(entry, nowMs, lang, t);
  if (!text) return null;
  const stale = key ? null : staleText(entry, lang, t);
  return (
    <span
      data-forecast-line={entry.station.code}
      className={`block border-l border-dashed border-[var(--color-accent)]/60 pl-1.5 text-[11px] leading-snug text-[var(--color-fg-muted)] tabular-nums ${entry.dim ? "opacity-55" : ""}`}
    >
      {prefix ? `${prefix} · ` : ""}
      {text}
      {stale ? ` · ${stale}` : ""}
    </span>
  );
}

/** ป้ายชนิด `forecast` (สี/เส้นประเดียวกับชิปเวลาโหมดพยากรณ์) แต่ข้อความเป็นของ HII ไม่ใช่ TMD */
function ForecastBadge({ t }: { t: TFunction }) {
  return (
    <span
      title={t("north.forecast.badgeTitle")}
      className={`inline-flex w-fit items-center rounded-md border border-dashed border-[var(--color-accent)]/60 px-1.5 py-0.5 text-[10px] leading-none ring-0 ${EPISTEMIC_BADGE.forecast.className}`}
    >
      {t("north.forecast.badge")}
    </span>
  );
}

const W = 300;
const H = 112;
const PAD = 5;
const OBSERVED = "#38bdf8";
const MODEL = "#9dc0ff";
/** ขอบสีพื้นการ์ดรอบตัวอักษรในกราฟ (วาดขอบก่อนเนื้อ) — ป้ายที่ทับเส้นประของแบบจำลองยังอ่านออก */
const HALO = { paintOrder: "stroke", stroke: "var(--color-bg-elevated)", strokeWidth: 3, strokeLinejoin: "round" } as const;

function ForecastChart({
  entry,
  history,
  nowMs,
  lang,
  t,
}: {
  entry: ForecastEntry;
  history: readonly NorthRouteHistoryPoint[] | undefined;
  nowMs: number;
  lang: Lang;
  t: TFunction;
}) {
  const { station, summary } = entry;
  const observed = useMemo(() => observedForChart(station.kind, history, nowMs), [station.kind, history, nowMs]);
  const model = useMemo(
    () =>
      chartModel({
        kind: station.kind,
        observed,
        forecast: summary.points,
        thresholds: station.thresholds,
        peak: summary.peak,
        nowMs,
        width: W,
        height: H,
        pad: PAD,
      }),
    [station.kind, station.thresholds, observed, summary, nowMs],
  );
  if (!model) return null;
  const digits = digitsFor(station.kind);
  const sortedLines = [...model.thresholdLines].sort((a, b) => a.y - b.y);
  const labelYs = stackLabelYs(
    sortedLines.map((l) => l.y),
    9,
  );
  const thresholdLabels = sortedLines.map((l, i) => ({ l, y: labelYs[i] }));
  return (
    <div className="flex flex-col gap-0.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-28 w-full"
        role="img"
        aria-label={t("north.forecast.chartAria", { code: station.code })}
      >
        {model.thresholdLines.map((l) => (
          <line key={l.level} x1={PAD} x2={W - PAD} y1={l.y} y2={l.y} stroke="#94a3b8" strokeOpacity={0.7} strokeWidth={1} strokeDasharray="1 3">
            <title>{t("north.forecast.legend.threshold", { level: t(`north.forecast.level.${l.level}`) })}</title>
          </line>
        ))}
        {model.nowX !== null ? (
          <line x1={model.nowX} x2={model.nowX} y1={PAD} y2={H - PAD} stroke="#e2e8f0" strokeOpacity={0.55} strokeWidth={1} />
        ) : null}
        {model.observedPath ? <path d={model.observedPath} fill="none" stroke={OBSERVED} strokeWidth={1.6} strokeLinejoin="round" /> : null}
        {model.forecastPath ? (
          <path d={model.forecastPath} fill="none" stroke={MODEL} strokeWidth={1.6} strokeDasharray="4 3" strokeLinejoin="round" />
        ) : null}
        {model.peak ? (
          <circle cx={model.peak.x} cy={model.peak.y} r={3.2} fill="#0f172a" stroke={MODEL} strokeWidth={1.5}>
            <title>{t("north.forecast.legend.max")}</title>
          </circle>
        ) : null}
        {thresholdLabels.map(({ l, y }) => (
          // ป้ายเกณฑ์ชิดขวา เรียงจากบนลงล่างและดันลงถ้าชนกัน (เกณฑ์ที่ค่าใกล้กันจะไม่ทับกัน)
          <text key={l.level} x={W - PAD} y={y} textAnchor="end" fontSize={8} fill="#cbd5e1" style={HALO}>
            {`${t(`north.forecast.level.${l.level}`)} ${formatNumber(lang, l.value, station.kind === "discharge" ? 1 : 2)}`}
          </text>
        ))}
        {model.nowX !== null ? (
          <text x={model.nowX + 2} y={PAD + 17} fontSize={8} fill="#e2e8f0" style={HALO}>
            {t("north.forecast.legend.now")}
          </text>
        ) : null}
        <text x={PAD} y={PAD + 7} fontSize={8} fill="#94a3b8" style={HALO}>
          {formatNumber(lang, model.yMax, digits)}
        </text>
        <text x={PAD} y={H - PAD - 1} fontSize={8} fill="#94a3b8" style={HALO}>
          {formatNumber(lang, model.yMin, digits)}
        </text>
      </svg>
      <div className="flex justify-between text-[10px] text-[var(--color-fg-subtle)] tabular-nums">
        <span>{formatDateTime(lang, iso(model.xMin))}</span>
        <span>{formatDateTime(lang, iso(model.xMax))}</span>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--color-fg-muted)]">
        {model.observedPath ? (
          <li className="flex items-center gap-1">
            <svg viewBox="0 0 20 6" className="h-1.5 w-5" aria-hidden="true">
              <line x1={0} x2={20} y1={3} y2={3} stroke={OBSERVED} strokeWidth={2} />
            </svg>
            {t("north.forecast.legend.measured")}
          </li>
        ) : null}
        <li className="flex items-center gap-1">
          <svg viewBox="0 0 20 6" className="h-1.5 w-5" aria-hidden="true">
            <line x1={0} x2={20} y1={3} y2={3} stroke={MODEL} strokeWidth={2} strokeDasharray="4 3" />
          </svg>
          {t("north.forecast.legend.model")}
        </li>
        <li className="flex items-center gap-1">
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
            <circle cx={5} cy={5} r={3.2} fill="#0f172a" stroke={MODEL} strokeWidth={1.5} />
          </svg>
          {t("north.forecast.legend.max")}
        </li>
      </ul>
    </div>
  );
}

function StationForecast({
  entry,
  history,
  staleAfterH,
  nowMs,
  lang,
  t,
}: {
  entry: ForecastEntry;
  history: readonly NorthRouteHistoryPoint[] | undefined;
  /** `layer.staleAfterSeconds` ของ descriptor เป็นชั่วโมง — เกณฑ์ "สำเนาของ API เก่า" */
  staleAfterH: number | null;
  nowMs: number;
  lang: Lang;
  t: TFunction;
}) {
  const { station, summary } = entry;
  const key = unavailableKey(summary.status);
  const stale = staleText(entry, lang, t);
  const rel = (ms: number) => relText(relativeTime(ms, nowMs), t);
  const shape =
    summary.shape === "peak-at-start"
      ? "north.forecast.shape.start"
      : summary.shape === "peak-at-end"
        ? "north.forecast.shape.end"
        : summary.shape === "flat"
          ? "north.forecast.shape.flat"
          : null;
  const unit = unitText(station.unit, t);
  return (
    <article
      className={`flex flex-col gap-1 border-t border-[var(--color-border)] pt-2 first:border-t-0 first:pt-0 ${entry.dim ? "opacity-60" : ""}`}
      data-forecast-station={station.code}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h4 className="text-xs leading-thai text-[var(--color-fg)]">{station.nameTh ? `${station.code} ${station.nameTh}` : station.code}</h4>
        <span className="text-[10px] text-[var(--color-fg-subtle)]">
          {t(station.kind === "discharge" ? "north.forecast.kind.discharge" : "north.forecast.kind.waterlevel", { unit })}
        </span>
      </div>
      <p className={`text-[10px] ${stale || summary.status === "no-publish-time" ? "text-[var(--color-risk-medium)]" : "text-[var(--color-fg-subtle)]"}`}>
        {station.publishedAt !== null && !stale ? t("north.forecast.published", { time: formatDateTime(lang, station.publishedAt) }) : null}
        {stale}
      </p>
      {key ? (
        <p className="text-[11px] text-[var(--color-fg-muted)]">{t(key)}</p>
      ) : (
        <>
          {station.kind === "waterlevel" ? <p className="text-[10px] text-[var(--color-fg-subtle)]">{t("north.forecast.noObservedChart")}</p> : null}
          <ForecastChart entry={entry} history={history} nowMs={nowMs} lang={lang} t={t} />
          <p className="text-[11px] text-[var(--color-fg)] tabular-nums">{maxText(entry, nowMs, lang, t)}</p>
          {shape ? <p className="text-[11px] text-[var(--color-fg-muted)]">{t(shape)}</p> : null}
          <p className="text-[11px] text-[var(--color-fg-muted)] tabular-nums">
            {summary.highest
              ? t("north.forecast.cross", {
                  level: t(`north.forecast.level.${summary.highest.level}`),
                  threshold: formatNumber(lang, summary.highest.threshold, station.kind === "discharge" ? 1 : 2),
                  unit,
                  time: formatDateTime(lang, iso(summary.highest.t)),
                  rel: rel(summary.highest.t),
                }) + ` ${t("north.forecast.crossNote")}`
              : summary.hasThresholds
                ? t("north.forecast.noCross")
                : t("north.forecast.noThresholds")}
          </p>
        </>
      )}
      {station.fetchedAt !== null ? (
        <p className={`text-[10px] ${entry.copyOld ? "text-[var(--color-risk-medium)]" : "text-[var(--color-fg-subtle)]"}`}>
          {station.lastError
            ? t("north.forecast.fileError", { error: station.lastError, time: formatDateTime(lang, station.fetchedAt) })
            : t("north.forecast.copyAt", { time: formatDateTime(lang, station.fetchedAt) })}
          {entry.copyOld && staleAfterH !== null ? ` (${t("north.forecast.copyOld", { h: formatNumber(lang, staleAfterH, 1) })})` : ""}
        </p>
      ) : station.lastError ? (
        <p className="text-[10px] text-[var(--color-risk-medium)]">{station.lastError}</p>
      ) : null}
    </article>
  );
}

/**
 * การ์ดผลลัพธ์แบบจำลอง HII — `live` เท่านั้น: ขณะดูเวลาอื่น (`atIso` ตั้งอยู่ หรือนอกช่วง 48 ชม.) ซ่อนทั้งส่วนและบอกว่าแสดงเฉพาะ
 * เวลาปัจจุบัน ไม่นำผลลัพธ์ไปประเมินค่าย้อนหลังใหม่
 */
export function ForecastSection({
  forecast,
  entries,
  live,
  histories,
  nowMs,
  lang,
  t,
}: {
  forecast: RiverForecastState;
  entries: ReadonlyMap<string, ForecastEntry>;
  live: boolean;
  histories: ReadonlyMap<string, readonly NorthRouteHistoryPoint[]>;
  nowMs: number;
  lang: Lang;
  t: TFunction;
}) {
  const { data, error, errorSince } = forecast;
  const shell = "flex flex-col gap-2 rounded-lg border border-dashed border-[var(--color-accent)]/40 bg-[var(--color-bg-elevated)] px-2.5 py-2";
  const head = (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <h3 className="text-[11px] font-semibold text-[var(--color-fg)]">{t("north.forecast.title")}</h3>
      <ForecastBadge t={t} />
    </div>
  );
  if (!live) {
    return (
      <section className={shell} data-river-forecast="live-only">
        {head}
        <p className="text-[11px] text-[var(--color-fg-muted)]">{t("north.forecast.liveOnly")}</p>
      </section>
    );
  }
  const since = errorSince ? formatDateTime(lang, errorSince) : "";
  return (
    <section className={`${shell} ${error && data ? "opacity-80" : ""}`} data-river-forecast="live">
      {head}
      <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">
        {t("north.forecast.source")}{" "}
        <a
          href={SOURCES["hii-fews"].homepageUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-accent)] hover:underline"
        >
          {SOURCES["hii-fews"].homepageUrl.replace(/^https?:\/\//, "")}
        </a>
      </p>
      {error ? (
        <p className="rounded-md bg-[var(--color-danger)]/10 px-2 py-1.5 text-[11px] text-[var(--color-danger)]">
          {t(data ? "north.forecast.apiFailedKept" : "north.forecast.apiFailed", { time: since })}
        </p>
      ) : null}
      {data === null ? (
        error ? null : (
          <p className="text-[11px] text-[var(--color-fg-muted)]">{t("north.forecast.loading")}</p>
        )
      ) : data.source.lastSuccessAt === null ? (
        <p className="text-[11px] text-[var(--color-fg-muted)]">
          {t("north.forecast.neverFetched")}
          {data.source.lastError ? ` — ${t("north.forecast.sourceError", { error: data.source.lastError })}` : ""}
        </p>
      ) : (
        <>
          <p className="text-[11px] leading-snug text-[var(--color-fg-muted)]">{t("north.forecast.intro")}</p>
          {data.source.lastError ? (
            <p className="text-[10px] text-[var(--color-risk-medium)]">{t("north.forecast.sourceError", { error: data.source.lastError })}</p>
          ) : null}
          {data.stations.map((s) => {
            const entry = entries.get(s.code);
            return entry ? (
              <StationForecast
                key={s.code}
                entry={entry}
                history={histories.get(s.code)}
                staleAfterH={data.layer.staleAfterSeconds != null ? data.layer.staleAfterSeconds / 3600 : null}
                nowMs={nowMs}
                lang={lang}
                t={t}
              />
            ) : null;
          })}
          <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">{t("north.forecast.thresholdsNote")}</p>
        </>
      )}
    </section>
  );
}
