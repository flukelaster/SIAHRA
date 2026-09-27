import type { ReactNode } from "react";
import {
  TMD_RAIN_24H_BANDS,
  SOURCES,
  type HealthResponse,
  type SituationLevel,
  type SourceStatus,
} from "@siahra/shared-types";
import type { Lang, MessageKey, TFunction } from "../../i18n";
import { useLang } from "../../i18n/context";
import type { ObservationsState } from "../../hooks/useObservations";
import { useNow } from "../../hooks/useNow";
import { resolveError } from "../../lib/errorMessage";
import { formatNumber } from "../../lib/number";
import {
  FREEBOARD_NEAR_M,
  OVERVIEW_MAX_READING_AGE_MS,
  summarizeOverview,
  type OverviewTone,
  type WatchRow,
} from "../../lib/overviewSummary";
import { formatDateTime, formatTime } from "../../lib/time";
import { ageLabel, healthMeta, sourceLabel, statusLabel } from "../layout/sourceStatusText";
import type { StationFocus } from "../layout/panelViews";

/**
 * ส่วนบนของหัวข้อ "ภาพรวม" (redesign PR 2) — การ์ดสถานะ + รายการ "ควรดูก่อน"
 *
 * อ่านทุกอย่างจาก `ctx` ที่ App.tsx ถืออยู่แล้ว (observations / atIso) — **ไม่มีการดึงข้อมูลเอง**
 * ตรรกะการนับ/เรียงอยู่ใน `lib/overviewSummary.ts` ที่นี่แค่แปลงเป็นข้อความและเลย์เอาต์
 * กดแถว = `focusStation` (ทางเดียวกับแผงเส้นทางน้ำเหนือ: บินไปแล้วเปิด popup ของสถานีนั้น)
 */

const HOURS = Math.round(OVERVIEW_MAX_READING_AGE_MS / 3_600_000);
/** ขอบบนของแถบ high/severe ใน `TMD_RAIN_24H_BANDS` — ข้อความอ่านตัวเลขจากตารางเดียวกับที่นับ */
const RAIN_SEVERE_MM = TMD_RAIN_24H_BANDS.find((b) => b.level === "severe")?.above ?? 90;
const RAIN_HIGH_MM = TMD_RAIN_24H_BANDS.find((b) => b.level === "high")?.above ?? 35;

/** กล่องหัวข้อมีสีตามระดับสูงสุดที่พบ — `none` เป็นสีกลาง ไม่ใช่สีเขียว (ไม่มีเกินเกณฑ์ ≠ ปลอดภัย) */
const TONE_BOX: Record<OverviewTone, string> = {
  severe: "border-[var(--color-risk-extreme)]/50 bg-[var(--color-risk-extreme)]/12",
  high: "border-[var(--color-risk-high)]/50 bg-[var(--color-risk-high)]/12",
  none: "border-[var(--color-border)] bg-[var(--color-bg-elevated)]",
};
const TONE_TEXT: Record<OverviewTone, string> = {
  severe: "text-[var(--color-risk-extreme)]",
  high: "text-[var(--color-risk-high)]",
  none: "text-[var(--color-fg)]",
};
const TONE_DOT: Record<Exclude<OverviewTone, "none">, string> = {
  severe: "bg-[var(--color-risk-extreme)]",
  high: "bg-[var(--color-risk-high)]",
};

/** ชื่อระดับสถานการณ์ของ ThaiWater เอง — คีย์เดียวกับ popup/แผงระดับน้ำ */
const SITUATION_KEY: Record<SituationLevel, MessageKey> = {
  1: "situation.1",
  2: "situation.2",
  3: "situation.3",
  4: "situation.4",
  5: "situation.5",
};

const at = (lang: Lang, iso: string) => formatDateTime(lang, iso);

/** ชื่อสถานีตามที่ต้นทางให้มา — เลือกฟิลด์ตามภาษา (แบบเดียวกับ WaterLevelCard) */
function stationName(s: { nameTh: string | null; nameEn: string | null; id: number }, lang: Lang, t: TFunction) {
  const name = lang === "th" ? (s.nameTh ?? s.nameEn) : (s.nameEn ?? s.nameTh);
  return name ?? t("water.stationFallback", { id: s.id });
}

function rowValue(row: WatchRow, lang: Lang, t: TFunction): string {
  if (row.kind === "rainfall") return t("overview.rain24h", { n: formatNumber(lang, row.obs.rain24h, 1) });
  const o = row.obs;
  const parts: string[] = [];
  if (o.situationLevel !== null) parts.push(t(SITUATION_KEY[o.situationLevel]));
  if (o.freeboardM !== null) {
    parts.push(
      o.freeboardM <= 0
        // ทศนิยม 2 ตำแหน่งเสมอ เหมือนป้ายบนแผนที่และแผงระดับน้ำ ("0.00" ไม่ใช่ "0")
        ? t("water.aboveBank", { n: Math.abs(o.freeboardM).toFixed(2), unit: t("unit.m") })
        : t("water.belowBank", { n: o.freeboardM.toFixed(2), unit: t("unit.m") }),
    );
  }
  return parts.join(" · ");
}

function WatchButton({ row, onFocus }: { row: WatchRow; onFocus: (target: StationFocus) => void }) {
  const { lang, t } = useLang();
  const s = row.obs.station;
  const name = stationName(s, lang, t);
  const place = [s.amphoeNameTh, s.basinNameTh].filter(Boolean).join(" · ");
  const observedAt = row.obs.observedAt;
  return (
    <li>
      <button
        type="button"
        // เฉพาะตอนกดเท่านั้น — ไม่มีการโฟกัส/ดึงอะไรตอนเรนเดอร์หรือ hover
        onClick={() =>
          onFocus({ kind: row.kind, stationId: s.id, provinceCode: s.provinceCode, lat: s.lat, lon: s.lon })
        }
        // ไม่ใส่ aria-label: ข้อความที่เห็น (ชื่อ ค่า ที่ตั้ง เวลา) คือชื่อของปุ่ม — label จะกลบค่าทิ้ง
        title={t("north.open", { code: name })}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[row.tone]}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate leading-thai text-xs text-[var(--color-fg)]">{name}</span>
          {/* ค่าที่วัดได้มาก่อนและห้ามถูกตัด — ชื่ออำเภอ/ลุ่มน้ำตามหลังได้ */}
          <span className="block text-[11px] text-[var(--color-fg-subtle)]">
            <span className="tabular-nums text-[var(--color-fg-muted)]">{rowValue(row, lang, t)}</span>
            {place ? ` · ${place}` : null}
          </span>
        </span>
        <span
          className="shrink-0 text-[11px] tabular-nums text-[var(--color-fg-muted)]"
          title={observedAt ? at(lang, observedAt) : undefined}
        >
          {observedAt ? formatTime(lang, observedAt) : "—"}
        </span>
      </button>
    </li>
  );
}

export function OverviewSummary({
  observations,
  atIso,
  onFocusStation,
}: {
  observations: ObservationsState;
  atIso: string | null;
  onFocusStation: (target: StationFocus) => void;
}) {
  const { lang, t } = useLang();
  const nowMs = useNow();
  const s = summarizeOverview({ ...observations, atIso, nowMs });

  const note = (text: string, tone: "muted" | "warn" | "bad" = "muted") => (
    <p
      className={`text-[11px] ${
        tone === "bad"
          ? "text-[var(--color-danger)]"
          : tone === "warn"
            ? "text-[var(--color-risk-medium)]"
            : "text-[var(--color-fg-subtle)]"
      }`}
    >
      {text}
    </p>
  );

  let box: { tone: OverviewTone; headline: string; body: ReactNode; asOf: string | null };
  if (s.state === "loading") {
    return (
      <section className="glass rounded-2xl p-3.5" aria-busy="true">
        <p className="sr-only">{t("common.loading")}</p>
        <div className="h-4 w-1/2 animate-pulse rounded bg-white/8" />
        <div className="mt-2 h-14 animate-pulse rounded-xl bg-white/8" />
      </section>
    );
  } else if (s.state === "error") {
    box = { tone: "none", headline: t("overview.error", { error: resolveError(t, s.error) ?? "" }), body: null, asOf: null };
  } else if (s.state === "never-fetched") {
    box = { tone: "none", headline: t("overview.neverFetched"), body: null, asOf: null };
  } else if (s.state === "no-stations") {
    box = { tone: "none", headline: t("overview.noStations"), body: null, asOf: t("overview.asOfLive", { time: at(lang, s.fetchedAt) }) };
  } else if (s.state === "no-values-at-time") {
    box = { tone: "none", headline: t("overview.noValuesAtTime", { time: at(lang, s.atIso) }), body: null, asOf: null };
  } else {
    const { water, rain } = s;
    const time = at(lang, s.describedAt);
    const stale = water.stale + rain.stale;
    const undated = water.undated + rain.undated;
    box = {
      tone: s.tone,
      headline: s.tone === "none" ? t("overview.headline.none", { time }) : t("overview.headline.count", { n: s.watchTotal }),
      asOf: t(s.historical ? "overview.asOfHistorical" : "overview.asOfLive", { time }),
      body: (
        <>
          {/* กลุ่มตามกฎต่อสถานี (ไม่ใช่ตามโหมด): สถานีที่มีระดับของ ThaiWater ในค่าย้อนหลังก็ยังต้องเห็น */}
          {water.level5 + water.level4 > 0 || (!s.historical && water.current > 0)
            ? note(
                t("overview.water.byLevel", {
                  l5: t("situation.5"),
                  n5: water.level5,
                  l4: t("situation.4"),
                  n4: water.level4,
                }),
              )
            : null}
          {s.historical || water.atBank + water.nearBank > 0
            ? note(
                t("overview.water.byBank", {
                  atBank: t("north.legend.atBank"),
                  a: water.atBank,
                  nearBank: t("north.legend.nearBank", { n: formatNumber(lang, FREEBOARD_NEAR_M, 0), unit: t("unit.m") }),
                  b: water.nearBank,
                }),
              )
            : null}
          {s.historical && water.atBank + water.nearBank > 0 ? note(t("overview.water.historicalNote")) : null}
          {water.unclassified > 0 ? note(t("overview.water.unclassified", { n: water.unclassified })) : null}
          {note(t("overview.water.counted", { n: water.current, h: HOURS }))}
          {s.rainMissing
            ? note(s.historical ? t("overview.rain.notHeld") : t("rain.none"), s.historical ? "warn" : "muted")
            : note(
                t("overview.rain.bands", {
                  severeMm: RAIN_SEVERE_MM,
                  severe: rain.severe,
                  highMm: RAIN_HIGH_MM,
                  high: rain.high,
                  n: rain.current,
                }),
              )}
          {rain.noValue > 0 ? note(t("overview.rain.noValue", { n: rain.noValue })) : null}
          {stale > 0 ? note(t("overview.stale", { n: stale, h: HOURS }), "warn") : null}
          {undated > 0 ? note(t("overview.undated", { n: undated }), "warn") : null}
        </>
      ),
    };
  }

  const bad = s.state === "error";
  return (
    <section className="glass flex flex-col gap-3 rounded-2xl p-3.5" aria-label={t("overview.title")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <h3 className="text-sm font-semibold text-[var(--color-fg)]">{t("overview.title")}</h3>
        <span className="text-[10px] text-[var(--color-fg-subtle)]">{t("overview.measuredNote")}</span>
      </div>
      <div
        className={`flex flex-col gap-1 rounded-xl border px-3 py-2.5 ${
          bad ? "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10" : TONE_BOX[box.tone]
        }`}
      >
        <p className={`text-sm font-semibold ${bad ? "text-[var(--color-danger)]" : TONE_TEXT[box.tone]}`}>
          {box.headline}
        </p>
        {box.asOf ? <p className="text-[11px] text-[var(--color-fg-muted)]">{box.asOf}</p> : null}
        {box.body}
      </div>
      {/* ข้อมูลเดิมยังอยู่แต่รอบล่าสุดโหลดไม่สำเร็จ — ต้องบอก ไม่ใช่ปล่อยให้ค่าเดิมดูเป็นค่าปัจจุบัน */}
      {s.state !== "error" && observations.error
        ? note(t("overview.error", { error: resolveError(t, observations.error) ?? "" }), "bad")
        : null}
      {s.state === "ready" && s.watch.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold text-[var(--color-fg)]">{t("overview.watch.title")}</h4>
          {note(t("overview.watch.rule", { h: HOURS }))}
          <ul className="-mx-2 flex flex-col">
            {s.watch.map((row) => (
              <WatchButton key={`${row.kind}:${row.obs.station.id}`} row={row} onFocus={onFocusStation} />
            ))}
          </ul>
          {s.watchTotal > s.watch.length ? note(t("overview.watch.more", { n: s.watchTotal - s.watch.length })) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * ข้อความของแถวแหล่งข้อมูล — กฎเดียวกับ `SourceStatusBar` (`statusLabel` + "ล่าสุด {age}") ต่างแค่
 * `down` ที่เคยได้ข้อมูลพูดว่า "ไม่ได้ข้อมูลตั้งแต่ {time}" (ข้อความของชิปอายุแหล่งน้ำท่วม) และ
 * `down` ที่ไม่เคยได้เลยใช้ `health.downNeverFetched` ผ่าน `statusLabel` — ไม่มีกฎใหม่
 */
function sourceLine(s: SourceStatus, lang: Lang, t: TFunction): string {
  if (s.health === "ok") return t("status.updated", { age: ageLabel(lang, s.fetchedAt) });
  if (s.health === "down" && s.fetchedAt) return t("floodAge.downSince", { time: at(lang, s.fetchedAt) });
  const label = statusLabel(s, lang, t);
  if (s.health === "delayed" || s.health === "down") return label;
  return s.fetchedAt
    ? `${label}${t("status.lastSuccess", { age: ageLabel(lang, s.fetchedAt) })}`
    : `${label} · ${t("time.neverReceived")}`;
}

/**
 * ส่วน "แหล่งข้อมูล" ท้ายหัวข้อภาพรวม — อ่าน `/api/v1/health` ที่ App.tsx poll อยู่แล้ว (ไม่ poll เอง)
 * แหล่งที่ไม่ ok หรี่ลงแต่ยังอยู่; ถาม /health ไม่ได้ = บอกว่าถามไม่ได้ ไม่ใช่ "แหล่งล่ม";
 * แหล่งชนิด `browser` (กล้อง CCTV) และ `community` (รายงานจากประชาชน ที่ api เก็บเอง ไม่มีต้นทางให้ probe)
 * /health ไม่ได้อ้างสถานะให้ จึงไม่แสดง — ถ้าวันหนึ่งโผล่มาในคำตอบก็ไม่ถือเป็นสถานะของแหล่งนั้น
 */
export function OverviewSources({ health, apiDown }: { health: HealthResponse | null; apiDown: boolean }) {
  const { lang, t } = useLang();
  // เดินนาฬิกาให้ "อัปเดต N นาทีที่แล้ว" ไม่ค้างอยู่ที่ค่าตอนเรนเดอร์ครั้งแรก
  useNow();
  const sources = (health?.sources ?? []).filter((s) => {
    const kind = SOURCES[s.id]?.kind;
    return kind !== "browser" && kind !== "community";
  });
  return (
    <section className="glass flex flex-col gap-1.5 rounded-2xl p-3.5" aria-label={t("status.sources")}>
      <h3 className="text-sm font-semibold text-[var(--color-fg)]">{t("status.sources")}</h3>
      {apiDown ? (
        <p className="text-[11px] text-[var(--color-danger)]">
          {t("floodAge.healthUnreachable")}
          {sources.length > 0 ? ` — ${t("notifications.health.apiUnreachableCached")}` : ""}
        </p>
      ) : null}
      {!apiDown && sources.length === 0 ? (
        <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("health.unknown")}</p>
      ) : null}
      {sources.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {sources.map((s) => {
            const ok = s.health === "ok" && !apiDown;
            return (
              <li key={s.id} className={`flex items-start gap-2 text-[11px] ${ok ? "" : "opacity-60"}`}>
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${healthMeta(s.health).dot}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="text-[var(--color-fg)]">{sourceLabel(s, lang)}</span>
                  <span className="text-[var(--color-fg-subtle)]"> · {sourceLine(s, lang, t)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
