import { Activity, AlertTriangle, ExternalLink, Waves } from "lucide-react";
import type { EarthquakeEvent } from "@siahra/shared-types";
import type { EarthquakeFeedState, FeedStatus } from "../../hooks/useEarthquakeFeed";
import { neverReceived, formatAge, formatFetchedAt } from "../../lib/time";
import { nearestProvinceLabel } from "../../lib/nearestProvince";
import { Panel } from "../ui/Panel";
import { useLang } from "../../i18n/context";
import type { Lang, MessageKey, TFunction } from "../../i18n";
import { resolveError } from "../../lib/errorMessage";

const STATUS_META: Record<FeedStatus, { labelKey: MessageKey; dot: string; text: string }> = {
  connecting: { labelKey: "quake.conn.connecting", dot: "bg-slate-400", text: "text-[var(--color-fg-muted)]" },
  live: { labelKey: "quake.conn.live", dot: "bg-[var(--color-success)]", text: "text-[var(--color-success)]" },
  polling: { labelKey: "quake.conn.polling", dot: "bg-amber-400", text: "text-amber-400" },
  reconnecting: {
    labelKey: "quake.conn.reconnecting",
    dot: "bg-amber-400 animate-pulse",
    text: "text-amber-400",
  },
  error: { labelKey: "quake.conn.error", dot: "bg-[var(--color-danger)]", text: "text-[var(--color-danger)]" },
};

function magnitudeColor(mag: number | null): string {
  if (mag === null) return "text-[var(--color-fg-muted)]";
  if (mag >= 6) return "text-[var(--color-risk-extreme)]";
  if (mag >= 5) return "text-[var(--color-risk-high)]";
  if (mag >= 4) return "text-[var(--color-risk-medium)]";
  return "text-[var(--color-risk-low)]";
}

function EventRow({ event, lang, t }: { event: EarthquakeEvent; lang: Lang; t: TFunction }) {
  /**
   * ระยะถึง **ขอบเขตจังหวัด** ที่ฝั่ง API คิดไว้ตอน ingest — 0 เมื่ออยู่ในเขต
   * เหตุการณ์ที่ยังไม่มีค่านี้ (ระเบียนก่อน E10.6) จะไม่มีบรรทัดนี้เลย ดีกว่า
   * เดาชื่อจังหวัดจากข้อความ `place` ของต้นทาง
   */
  const nearest = nearestProvinceLabel(t, lang, event.nearest?.[0]);
  return (
    <li className="flex items-start gap-2.5 border-t border-[var(--color-border)] py-2 first:border-t-0">
      <span
        className={`w-11 shrink-0 text-right text-base font-bold tabular-nums ${magnitudeColor(event.mag)}`}
      >
        {event.mag?.toFixed(1) ?? "—"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-[var(--color-fg)]" title={event.place ?? undefined}>
          {event.place ?? t("quake.unknownPlace")}
        </p>
        {/*
          ลิงก์ต้นทางต้องอยู่นอกเงื่อนไข `nearest` — แถวที่มีมาก่อน E10.6 และยังไม่ถูก
          backfill จะไม่มี `nearest` แต่ยังมี `url` อยู่ ถ้าซ้อนไว้ข้างในผู้ใช้จะเข้าถึง
          หน้าเหตุการณ์ต้นทางไม่ได้เลยด้วยเหตุผลที่ไม่เกี่ยวกันเลย
        */}
        {nearest || event.url ? (
          <p className="flex items-center gap-1 text-[11px] text-[var(--color-fg-muted)]">
            {nearest ? <span className="truncate">{nearest}</span> : null}
            {event.url ? (
              <a
                href={event.url}
                target="_blank"
                rel="noreferrer noopener"
                title={t("quake.eventPage")}
                aria-label={t("quake.eventPage")}
                className="shrink-0 text-[var(--color-fg-subtle)] hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                <ExternalLink size={11} aria-hidden="true" />
              </a>
            ) : null}
          </p>
        ) : null}
        <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-[var(--color-fg-subtle)]">
          <span>{event.magType ?? t("quake.unknownMagType")}</span>
          <span aria-hidden="true">·</span>
          <span>{t("quake.depth", { n: event.depthKm?.toFixed(0) ?? "—", unit: t("unit.km") })}</span>
          <span aria-hidden="true">·</span>
          <span>{formatAge(lang, event.time)}</span>
          {/* Automatic detections are unreviewed — must not look identical
              to human-reviewed solutions (see docs/ui-copy-rules.md). */}
          {event.status === "automatic" ? (
            <span className="rounded bg-amber-500/15 px-1 text-amber-400">{t("quake.unreviewed")}</span>
          ) : (
            <span className="rounded bg-[var(--color-success)]/15 px-1 text-[var(--color-success)]">
              {t("quake.reviewed")}
            </span>
          )}
        </p>
      </div>
      <span className="shrink-0 text-[10px] text-[var(--color-fg-subtle)] uppercase">
        {event.sources.join("/")}
      </span>
    </li>
  );
}

export function EarthquakeLiveCard({ feed }: { feed: EarthquakeFeedState }) {
  const { lang, t } = useLang();
  const { events, status, asOf, error, parseErrors } = feed;
  const meta = STATUS_META[status];
  const strongest = events.reduce<EarthquakeEvent | null>(
    (acc, e) => ((e.mag ?? -Infinity) > (acc?.mag ?? -Infinity) ? e : acc),
    null,
  );

  return (
    <Panel
      title={t("quake.title")}
      icon={<Waves size={16} className="text-[var(--color-accent)]" aria-hidden="true" />}
      headerAction={
        <span className={`flex items-center gap-1.5 text-[11px] ${meta.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
          {t(meta.labelKey)}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div>
            {/* Backfill + retention window is 30 days (see EarthquakeFeedDO). */}
            <p className="text-xs text-[var(--color-fg-muted)]">{t("quake.events30d")}</p>
            <p className="text-2xl font-bold tabular-nums text-[var(--color-fg)]">{events.length}</p>
          </div>
          {strongest ? (
            <div className="border-l border-[var(--color-border)] pl-3">
              <p className="text-xs text-[var(--color-fg-muted)]">{t("quake.maxMag")}</p>
              <p className={`text-2xl font-bold tabular-nums ${magnitudeColor(strongest.mag)}`}>
                {strongest.mag?.toFixed(1) ?? "—"}
              </p>
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-danger)]/10 px-2.5 py-2 text-xs text-[var(--color-danger)]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {resolveError(t, error)}
          </p>
        ) : null}

        {parseErrors > 0 ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-400">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t("quake.parseErrors", { n: parseErrors })}
          </p>
        ) : null}

        {events.length > 0 ? (
          <ul className="max-h-72 overflow-y-auto pr-0.5">
            {events.slice(0, 25).map((e) => (
              <EventRow key={e.id} event={e} lang={lang} t={t} />
            ))}
          </ul>
        ) : (
          !error && (
            <p className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-3 text-center text-xs text-[var(--color-fg-muted)]">
              {t("quake.none")}
            </p>
          )
        )}

        <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-2 text-[11px] text-[var(--color-fg-muted)]">
          <Activity size={13} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
          {t("quake.note")}
          {/*
            คำอธิบายว่าระยะทางนี้คืออะไร ต้องเป็นข้อความที่ "มองเห็นได้" ไม่ใช่ tooltip:
            บนมือถือไม่มี hover และคนที่ไม่เอาเมาส์ไปวางก็ไม่เคยเห็นเลย เนื้อหาที่บอกว่า
            ตัวเลขนี้ไม่ใช่แบบจำลองแรงสั่นสะเทือน คือสิ่งที่กันไม่ให้อ่านผิดตั้งแต่แรก
          */}
          {events.some((e) => e.nearest && e.nearest.length > 0) ? ` ${t("quake.nearest.note")}` : ""}
          {/* ความซื่อสัตย์ต่อข้อมูล: asOf มาจากต้นทางเท่านั้น ตอนสายหลุดจึงยังเป็น
              เวลาเดิม + อายุที่เพิ่มขึ้น ไม่ใช่ "เมื่อสักครู่" ของนาฬิกาเครื่องผู้ใช้ */}
          {t("quake.asOf", {
            time: asOf
              ? t("quake.asOfWithAge", {
                  time: formatFetchedAt(lang, asOf),
                  age: formatAge(lang, asOf),
                })
              : neverReceived(lang),
          })}
        </p>
      </div>
    </Panel>
  );
}
