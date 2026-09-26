import { useCallback, useState, type ReactNode } from "react";
import { ExternalLink, Tornado } from "lucide-react";
import {
  SOURCES,
  type HazardLayerDescriptor,
  type SourceHealth,
  type StormSourceId,
  type StormTrack,
} from "@siahra/shared-types";
import { stormLayerDescriptors, type LayerDescriptorEntry } from "../../hooks/useLayerDescriptors";
import { useNow } from "../../hooks/useNow";
import { useLang } from "../../i18n/context";
import type { Lang, MessageKey, TFunction } from "../../i18n";
import { resolveError } from "../../lib/errorMessage";
import { EPISTEMIC_BADGE, healthStatusKey, UNKNOWN_BADGE } from "../../lib/layerFreshness";
import { stormColor } from "../../lib/stormMap";
import {
  fixAgeMs,
  isOldFix,
  isPastValidTime,
  latestFix,
  latestFixTime,
  stormDistanceKm,
  stormSourceConditions,
  summarizeStorms,
  type StormSourceCondition,
} from "../../lib/storms";
import { formatAge, formatDateTime, formatFetchedAtWithAge, formatFullDateTime } from "../../lib/time";
import type { PanelContext } from "../layout/panelViews";
import { Panel } from "../ui/Panel";
import { StormMap } from "./StormMap";

/** หน้าประกาศเตือนภัยพายุทางการของกรมอุตุนิยมวิทยา — แผงนี้ไม่ใช่คำเตือนทางการ */
const TMD_WARNINGS_URL = "https://www.tmd.go.th/warning-and-events/warning-storm";

const sourceName = (id: StormSourceId, lang: Lang) => (lang === "th" ? SOURCES[id].nameTh : SOURCES[id].nameEn);
/** ชื่อสั้นของแหล่งในประโยคสถานะ */
const SHORT_NAME: Record<StormSourceId, string> = { "jma-typhoon": "JMA", "gdacs-tc": "GDACS" };

const dash = "—";
const num = (v: number | null) => (v === null ? dash : String(v));
const latLon = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(1)}°${lat < 0 ? "S" : "N"} ${Math.abs(lon).toFixed(1)}°${lon < 0 ? "W" : "E"}`;

/**
 * แผงพายุหมุนเขตร้อน (ชั้นพายุ v1) — แผนที่ภูมิภาค 2 มิติ + การ์ดต่อพายุ + ที่มาของข้อมูล
 *
 * ความซื่อสัตย์ต่อข้อมูล:
 *   - ทุกสถานะว่างแยกกัน และไม่มีอันไหนอ่านเป็น "ปลอดภัย" (`lib/storms.ts` `summarizeStorms`)
 *   - ป้ายชนิดความรู้ใช้สีของ `EPISTEMIC_BADGE` แต่ข้อความของแผงนี้เอง — `badge.forecast`
 *     ("พยากรณ์จากแบบจำลอง TMD") ผิดสำหรับเส้นทางของ JMA/JTWC จึงห้ามใช้ที่นี่
 *   - เวลาทุกจุดเป็นของจุดนั้นเอง; จุดที่ต้นทางไม่ให้เวลาแสดง "—" ไม่ประมาณค่า
 *   - ค่าที่ต้นทางไม่ส่ง (null) แสดง "—" ไม่ใช่ 0
 */
export function StormPanel({ ctx }: { ctx: PanelContext }) {
  const { lang, t } = useLang();
  const nowMs = useNow();
  const { data, error } = ctx.storms;
  const summary = summarizeStorms(ctx.storms);
  const conds = stormSourceConditions(data);
  const descs = stormLayerDescriptors(data, ctx.apiHealth);
  const storms = data?.storms ?? [];
  // คำขอรอบล่าสุดของเว็บพลาดแต่ยังถือคำตอบเดิมอยู่ → หรี่ทั้งแผง + บอก
  const heldResponse = error !== null && data !== null;
  const [notes, setNotes] = useState({ beyondBasemap: false, outlineFailed: false, provinceFailed: false });
  const onNotes = useCallback(
    (n: typeof notes) =>
      setNotes((prev) =>
        prev.beyondBasemap === n.beyondBasemap &&
        prev.outlineFailed === n.outlineFailed &&
        prev.provinceFailed === n.provinceFailed
          ? prev
          : n,
      ),
    [],
  );
  const shownSources = new Set(storms.map((s) => s.source));
  const anyCircle = storms.some((s) => s.forecast.some((f) => f.circleRadiusKm !== null));
  const anyCone = storms.some((s) => !!s.gdacsCone);

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title={t("storm.title")}
        icon={<Tornado size={16} className="text-[var(--color-accent)]" aria-hidden="true" />}
        headerAction={
          <span className="text-[11px] text-[var(--color-fg-muted)]">
            {summary.kind === "loading" ? t("common.loading") : summary.kind === "storms" ? t("storm.badge.count", { n: summary.n }) : null}
          </span>
        }
      >
        <div className="flex flex-col gap-2.5">
          <p className="text-[11px] leading-relaxed text-[var(--color-fg-muted)]">{t("storm.intro")}</p>

          {/* ติดต่อ API ไม่ได้เลย (ไม่มีอะไรค้าง) = SummaryLine พูดเอง; กล่องนี้สำหรับกรณีที่ยังถือคำตอบเดิมอยู่ */}
          {error && heldResponse ? (
            <p className="rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-2 text-xs text-[var(--color-risk-medium)]">
              {t("storm.state.held")}
              <span className="text-[var(--color-fg-subtle)]"> · {resolveError(t, error)}</span>
            </p>
          ) : null}

          <SummaryLine summary={summary} detail={resolveError(t, error)} t={t} />

          {data ? <SourceLines conds={conds} storms={storms} lang={lang} t={t} /> : null}

          {data ? (
            <div className={heldResponse ? "opacity-60" : ""}>
              <StormMap
                storms={storms}
                provinceCode={ctx.province.code}
                provinceName={ctx.provinceName}
                nowMs={nowMs}
                lang={lang}
                t={t}
                onNotes={onNotes}
              />
              <div className="mt-1 flex flex-col gap-0.5 text-[10px] text-[var(--color-fg-subtle)]">
                {notes.beyondBasemap ? <span>{t("storm.map.beyondBasemap")}</span> : null}
                {notes.outlineFailed ? <span className="text-[var(--color-risk-medium)]">{t("storm.map.outlineFailed")}</span> : null}
                {notes.provinceFailed ? (
                  <span className="text-[var(--color-risk-medium)]">
                    {t("storm.map.provinceFailed", { province: ctx.provinceName })}
                  </span>
                ) : null}
                <span>{t("storm.map.basemapCredit")}</span>
              </div>
            </div>
          ) : null}

          {descs ? (
            <StormLegend
              descs={descs}
              provinceName={ctx.provinceName}
              showCircle={anyCircle}
              showCone={anyCone}
              nowMs={nowMs}
              lang={lang}
              t={t}
            />
          ) : null}
        </div>
      </Panel>

      {storms.map((s, i) => (
        <StormCard
          key={s.id}
          storm={s}
          color={stormColor(i)}
          cond={conds.find((c) => c.id === s.source) ?? null}
          held={heldResponse}
          provinceCode={ctx.province.code}
          provinceName={ctx.provinceName}
          nowMs={nowMs}
          lang={lang}
          t={t}
        />
      ))}

      <Panel bodyClassName="p-3 flex flex-col gap-2 text-[10px] leading-relaxed text-[var(--color-fg-subtle)]">
        {shownSources.has("jma-typhoon") ? (
          <p>
            {SOURCES["jma-typhoon"].attributionText}{" "}
            <a
              href={SOURCES["jma-typhoon"].licenseUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-accent)] hover:underline"
            >
              {t("storm.footer.terms")}
            </a>
          </p>
        ) : null}
        {shownSources.has("gdacs-tc") ? (
          <p>
            {SOURCES["gdacs-tc"].attributionText}. {SOURCES["gdacs-tc"].disclaimerText}{" "}
            <a
              href={SOURCES["gdacs-tc"].licenseUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-accent)] hover:underline"
            >
              {t("storm.footer.terms")}
            </a>
          </p>
        ) : null}
        <p className="text-[11px] text-[var(--color-fg-muted)]">
          {t("storm.footer.notOfficial")}{" "}
          <a
            href={TMD_WARNINGS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-[var(--color-accent)] hover:underline"
          >
            {t("storm.footer.tmdLink")}
            <ExternalLink size={10} aria-hidden="true" />
          </a>
        </p>
      </Panel>
    </div>
  );
}

/** ข้อความสรุปเมื่อไม่มีรายการ — แต่ละกรณีคนละประโยค ไม่มีประโยคไหนเป็น "ปลอดภัย" */
function SummaryLine({
  summary,
  detail,
  t,
}: {
  summary: ReturnType<typeof summarizeStorms>;
  /** ข้อความผิดพลาดของคำขอ (ไม่แปล) ต่อท้ายกรณีติดต่อ API ไม่ได้ */
  detail: string | null;
  t: TFunction;
}) {
  const box = (text: string, tone: "muted" | "warn" | "danger") => (
    <p
      className={`rounded-lg px-2.5 py-2 text-xs ${
        tone === "danger"
          ? "bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
          : tone === "warn"
            ? "bg-[var(--color-risk-medium)]/10 text-[var(--color-risk-medium)]"
            : "bg-white/5 text-[var(--color-fg-muted)]"
      }`}
    >
      {text}
    </p>
  );
  switch (summary.kind) {
    case "loading":
      return <div className="h-4 w-2/3 animate-pulse rounded bg-white/8" />;
    case "api-unreachable":
      return box(`${t("storm.state.apiUnreachable")}${detail ? ` · ${detail}` : ""}`, "danger");
    case "never":
      return box(t("storm.state.never"), "muted");
    case "unchecked":
      return box(t("storm.state.unchecked"), "warn");
    case "none-reported":
      return box(
        t("storm.state.noneReported", { sources: summary.reachable.map((id) => SHORT_NAME[id]).join(", ") }) +
          " " +
          t("storm.state.notAllClear"),
        "muted",
      );
    case "storms":
      return null;
  }
}

/** หนึ่งบรรทัดต่อแหล่ง — แหล่งที่ตายยังอยู่ (หรี่ + เหตุผล) ไม่หายเงียบ */
function SourceLines({
  conds,
  storms,
  lang,
  t,
}: {
  conds: StormSourceCondition[];
  storms: readonly StormTrack[];
  lang: Lang;
  t: TFunction;
}) {
  return (
    <ul className="flex flex-col gap-1 text-[11px]">
      {conds.map((c) => {
        const name = SHORT_NAME[c.id];
        const n = storms.filter((s) => s.source === c.id).length;
        let text: string;
        let tone: string;
        if (c.kind === "ok") {
          text = t("storm.source.ok", { source: name, time: formatDateTime(lang, c.lastSuccessAt), n });
          tone = "text-[var(--color-fg-muted)]";
        } else if (c.kind === "partial") {
          text = t("storm.source.partial", { source: name, time: formatDateTime(lang, c.lastSuccessAt), n });
          tone = "text-[var(--color-risk-medium)]";
        } else if (c.kind === "failing") {
          text = t("storm.source.failing", {
            source: name,
            time: formatDateTime(lang, c.lastSuccessAt),
            attempt: c.lastAttemptAt ? formatDateTime(lang, c.lastAttemptAt) : dash,
          });
          tone = "text-[var(--color-risk-medium)]";
        } else {
          text = c.lastAttemptAt
            ? t("storm.source.neverAttempted", { source: name, attempt: formatDateTime(lang, c.lastAttemptAt) })
            : t("storm.source.never", { source: name });
          tone = "text-[var(--color-fg-subtle)]";
        }
        const err = c.kind === "ok" ? null : c.lastError;
        return (
          <li key={c.id} className={`flex items-start gap-1.5 ${tone}`} title={sourceName(c.id, lang)}>
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                c.kind === "ok"
                  ? "bg-[var(--color-success)]"
                  : c.kind === "failing" || c.kind === "partial"
                    ? "bg-[var(--color-risk-medium)]"
                    : "bg-[var(--color-fg-subtle)]"
              }`}
              aria-hidden="true"
            />
            <span>
              {text}
              {/* lastError มาจากระบบจริง ไม่แปล (กติกาเดียวกับแถบสถานะ) */}
              {err ? <span className="text-[var(--color-fg-subtle)]"> · {err}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** ป้ายชนิดความรู้ + เวลาดึง ของ descriptor หนึ่งตัว — ข้อความของแผงพายุเอง (ดูหัวไฟล์) */
function StormLayerMeta({
  entry,
  labelKey,
  titleKey,
  nowMs,
  lang,
  t,
}: {
  entry: LayerDescriptorEntry;
  labelKey: MessageKey;
  titleKey: MessageKey;
  nowMs: number;
  lang: Lang;
  t: TFunction;
}) {
  const d: HazardLayerDescriptor = entry.descriptor;
  const badge = EPISTEMIC_BADGE[d.epistemicClass] ?? UNKNOWN_BADGE;
  const stale = isStaleDescriptor(d, nowMs);
  const health: SourceHealth | null = entry.health;
  const statusKey = healthStatusKey(health);
  const amber = stale || (health !== null && health !== "ok");
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span
        className={`rounded px-1 py-px text-[9px] leading-[1.35] ring-1 ring-inset ${badge.className}`}
        title={t(titleKey)}
      >
        {t(labelKey)}
      </span>
      <span className={`text-[10px] ${amber ? "text-[var(--color-risk-medium)]" : "text-[var(--color-fg-subtle)]"}`}>
        {d.fetchedAt ? t("freshness.fetchedAt", { age: formatAge(lang, d.fetchedAt, nowMs) }) : t("storm.state.neverShort")}
        {statusKey ? ` · ${t(statusKey)}` : ""}
      </span>
    </span>
  );
}

function isStaleDescriptor(d: HazardLayerDescriptor, nowMs: number): boolean {
  if (!d.fetchedAt) return true;
  if (!d.staleAfterSeconds) return false;
  const ms = Date.parse(d.fetchedAt);
  return !Number.isNaN(ms) && nowMs - ms > d.staleAfterSeconds * 1000;
}

function StormLegend({
  descs,
  provinceName,
  showCircle,
  showCone,
  nowMs,
  lang,
  t,
}: {
  descs: NonNullable<ReturnType<typeof stormLayerDescriptors>>;
  provinceName: string;
  showCircle: boolean;
  showCone: boolean;
  nowMs: number;
  lang: Lang;
  t: TFunction;
}) {
  const row = (swatch: ReactNode, label: string, meta?: ReactNode) => (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 flex h-3 w-6 shrink-0 items-center justify-center">{swatch}</span>
      <span className="flex min-w-0 flex-col text-[11px] text-[var(--color-fg)]">
        {label}
        {meta}
      </span>
    </li>
  );
  return (
    <ul className="flex flex-col gap-1.5 border-t border-white/8 pt-2">
      {row(
        <svg width="24" height="8" aria-hidden="true">
          <line x1="1" y1="4" x2="23" y2="4" stroke="#e2e8f0" strokeWidth="1.6" />
        </svg>,
        t("storm.legend.past"),
        <StormLayerMeta entry={descs.past} labelKey="storm.badge.past" titleKey="storm.badge.past.title" nowMs={nowMs} lang={lang} t={t} />,
      )}
      {row(
        <svg width="24" height="8" aria-hidden="true">
          <line x1="1" y1="4" x2="23" y2="4" stroke="#e2e8f0" strokeWidth="1.3" strokeDasharray="4 3" />
        </svg>,
        t("storm.legend.track"),
        <StormLayerMeta entry={descs.track} labelKey="storm.badge.track" titleKey="storm.badge.track.title" nowMs={nowMs} lang={lang} t={t} />,
      )}
      {showCircle
        ? row(
            <svg width="24" height="12" aria-hidden="true">
              <ellipse cx="12" cy="6" rx="10" ry="5" fill="#e2e8f0" fillOpacity="0.12" stroke="#e2e8f0" strokeOpacity="0.5" />
            </svg>,
            t("storm.circle.legend"),
            <StormLayerMeta entry={descs.circle} labelKey="storm.circle.badge" titleKey="storm.circle.badge.title" nowMs={nowMs} lang={lang} t={t} />,
          )
        : null}
      {showCone
        ? row(
            <svg width="24" height="12" aria-hidden="true">
              <path d="M1 6 L23 1 L23 11 Z" fill="#e2e8f0" fillOpacity="0.14" stroke="#e2e8f0" strokeOpacity="0.6" strokeDasharray="2 2" />
            </svg>,
            t("storm.legend.cone"),
          )
        : null}
      {row(
        <span className="h-2.5 w-2.5 rounded-full border border-[#fbbf24] bg-[#fbbf24]/35" />,
        t("storm.legend.province", { province: provinceName }),
      )}
    </ul>
  );
}

function StormCard({
  storm,
  color,
  cond,
  held,
  provinceCode,
  provinceName,
  nowMs,
  lang,
  t,
}: {
  storm: StormTrack;
  color: string;
  cond: StormSourceCondition | null;
  held: boolean;
  provinceCode: string;
  provinceName: string;
  nowMs: number;
  lang: Lang;
  t: TFunction;
}) {
  const name = storm.name ?? t("storm.unnamed");
  const last = latestFix(storm);
  const lastAt = latestFixTime(storm);
  const age = fixAgeMs(storm, nowMs);
  const old = isOldFix(storm, nowMs);
  const sourceFailing = cond !== null && cond.kind !== "ok";
  const dim = held || sourceFailing || old;
  const km = stormDistanceKm(storm, provinceCode);
  const hasCircle = storm.forecast.some((f) => f.circleRadiusKm !== null);
  const untimedPast = storm.past.filter((p) => p.observedAt === null).length;
  const wind =
    storm.windAveraging === "10-min"
      ? t("storm.wind.10min")
      : storm.windAveraging === "1-min"
        ? t("storm.wind.1min")
        : t("storm.wind.none");

  return (
    <section className={`glass rounded-2xl p-3.5 ${dim ? "opacity-70" : ""}`}>
      <header className="flex items-start gap-2">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--color-fg)]">
            {name}
            {storm.category ? " " : null}
            {storm.category ? <span className="ml-1 text-xs font-normal text-[var(--color-fg-muted)]">{storm.category}</span> : null}
          </h3>
          <p className="text-[10px] text-[var(--color-fg-subtle)]">
            {sourceName(storm.source, lang)} · {t(storm.basin === "WNP" ? "storm.basin.wnp" : "storm.basin.nio")}
          </p>
        </div>
      </header>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        <dt className="text-[var(--color-fg-subtle)]">{t("storm.card.issued")}</dt>
        <dd className="text-[var(--color-fg)]">
          {storm.advisoryIssuedAt ? formatFullDateTime(lang, storm.advisoryIssuedAt) : t("storm.card.noIssueTime")}
        </dd>
        <dt className="text-[var(--color-fg-subtle)]">{t("storm.card.fetched")}</dt>
        <dd className="text-[var(--color-fg)]">{formatFetchedAtWithAge(lang, storm.fetchedAt, nowMs)}</dd>
        <dt className="text-[var(--color-fg-subtle)]">{t("storm.card.lastFix")}</dt>
        <dd className={old ? "text-[var(--color-risk-medium)]" : "text-[var(--color-fg)]"}>
          {lastAt ? `${formatFullDateTime(lang, lastAt)} · ${formatAge(lang, lastAt, nowMs)}` : t("storm.card.noFixTime")}
        </dd>
        <dt className="text-[var(--color-fg-subtle)]">{t("storm.card.distance", { province: provinceName })}</dt>
        <dd className="text-[var(--color-fg)]">
          {km === null ? dash : t("storm.card.km", { km })}
          <span className="block text-[10px] text-[var(--color-fg-subtle)]">
            {t("storm.card.distanceBasis")}
            {hasCircle ? ` ${t("storm.circle.distanceBasis")}` : ""}
          </span>
        </dd>
      </dl>

      {old && age !== null ? (
        <p className="mt-2 rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-1.5 text-[11px] text-[var(--color-risk-medium)]">
          {t("storm.card.oldFix", { age: formatAge(lang, lastAt, nowMs) })}
        </p>
      ) : null}
      {sourceFailing && cond ? (
        <p className="mt-2 rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-1.5 text-[11px] text-[var(--color-risk-medium)]">
          {cond.kind === "failing"
            ? t("storm.card.sourceFailing", { source: SHORT_NAME[storm.source], time: formatDateTime(lang, cond.lastSuccessAt) })
            : cond.kind === "partial"
              ? t("storm.card.sourcePartial", { source: SHORT_NAME[storm.source] })
              : t("storm.source.never", { source: SHORT_NAME[storm.source] })}
        </p>
      ) : null}

      {storm.gdacs ? (
        <div className="mt-2 text-[11px] text-[var(--color-fg-muted)]">
          {storm.gdacs.alertLevel ? (
            <p>
              {t("storm.gdacs.alert", { level: storm.gdacs.alertLevel })}
              <span className="block text-[10px] text-[var(--color-fg-subtle)]">{t("storm.gdacs.alertNote")}</span>
            </p>
          ) : null}
          {storm.gdacs.severityText ? <p className="mt-0.5">“{storm.gdacs.severityText}” — GDACS</p> : null}
          {storm.gdacs.reportUrl ? (
            <a
              href={storm.gdacs.reportUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] text-[var(--color-accent)] hover:underline"
            >
              {t("storm.gdacs.report")}
              <ExternalLink size={9} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}

      <p className="mt-2 text-[10px] text-[var(--color-fg-subtle)]">{wind}</p>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[280px] text-[10px] tabular-nums">
          <thead className="text-[var(--color-fg-subtle)]">
            <tr className="text-left">
              <th className="py-0.5 pr-1 font-normal">#</th>
              <th className="py-0.5 pr-1 font-normal">{t("storm.table.time")}</th>
              <th className="py-0.5 pr-1 font-normal">{t("storm.table.position")}</th>
              <th className="py-0.5 pr-1 font-normal">{t("storm.table.category")}</th>
              <th className="py-0.5 pl-2 pr-1 text-right font-normal">{t("storm.table.wind")}</th>
              <th className="py-0.5 pl-2 pr-1 text-right font-normal">{t("storm.table.pressure")}</th>
              {hasCircle ? <th className="py-0.5 text-right font-normal">{t("storm.circle.column")}</th> : null}
            </tr>
          </thead>
          <tbody className="text-[var(--color-fg)]">
            {last ? (
              <tr className="border-t border-white/8">
                <td className="py-0.5 pr-1 text-[var(--color-fg-subtle)]">{t("storm.table.latest")}</td>
                <td className="py-0.5 pr-1">{last.observedAt ? formatDateTime(lang, last.observedAt) : dash}</td>
                <td className="py-0.5 pr-1">{latLon(last.lat, last.lon)}</td>
                <td className="py-0.5 pr-1">{storm.category ?? dash}</td>
                <td className="py-0.5 pl-2 pr-1 text-right">{num(last.windKt)}</td>
                <td className="py-0.5 pl-2 pr-1 text-right">{num(last.pressureHpa)}</td>
                {hasCircle ? <td className="py-0.5 text-right">{dash}</td> : null}
              </tr>
            ) : null}
            {storm.forecast.map((f, i) => {
              const passed = isPastValidTime(f.validAt, nowMs);
              return (
                <tr key={f.validAt + i} className={`border-t border-white/8 ${passed ? "text-[var(--color-fg-subtle)]" : ""}`}>
                  <td className="py-0.5 pr-1">{i + 1}</td>
                  <td className="py-0.5 pr-1">
                    {formatDateTime(lang, f.validAt)}
                    {passed ? <span className="block text-[9px] text-[var(--color-risk-medium)]">{t("storm.table.passed")}</span> : null}
                  </td>
                  <td className="py-0.5 pr-1">{latLon(f.lat, f.lon)}</td>
                  <td className="py-0.5 pr-1">{f.category ?? dash}</td>
                  <td className="py-0.5 pl-2 pr-1 text-right">{num(f.windKt)}</td>
                  <td className="py-0.5 pl-2 pr-1 text-right">{num(f.pressureHpa)}</td>
                  {hasCircle ? <td className="py-0.5 text-right">{num(f.circleRadiusKm)}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-[var(--color-fg-subtle)]">{t("storm.table.note")}</p>

      {storm.past.length > 1 ? (
        <details className="mt-2 text-[10px]">
          <summary className="cursor-pointer text-[var(--color-fg-muted)]">
            {t("storm.past.summary", { n: storm.past.length })}
          </summary>
          {untimedPast > 0 ? (
            <p className="mt-1 text-[var(--color-fg-subtle)]">{t("storm.past.untimed", { n: untimedPast })}</p>
          ) : null}
          <table className="mt-1 w-full text-[10px] tabular-nums">
            <thead className="text-[var(--color-fg-subtle)]">
              <tr className="text-left">
                <th className="py-0.5 pr-1 font-normal">{t("storm.table.time")}</th>
                <th className="py-0.5 pr-1 font-normal">{t("storm.table.position")}</th>
                <th className="py-0.5 pl-2 pr-1 text-right font-normal">{t("storm.table.wind")}</th>
                <th className="py-0.5 text-right font-normal">{t("storm.table.pressure")}</th>
              </tr>
            </thead>
            <tbody className="text-[var(--color-fg-muted)]">
              {[...storm.past].reverse().map((p, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="py-0.5 pr-1">{p.observedAt ? formatDateTime(lang, p.observedAt) : dash}</td>
                  <td className="py-0.5 pr-1">{latLon(p.lat, p.lon)}</td>
                  <td className="py-0.5 pl-2 pr-1 text-right">{num(p.windKt)}</td>
                  <td className="py-0.5 text-right">{num(p.pressureHpa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </section>
  );
}
