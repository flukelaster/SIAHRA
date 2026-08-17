import { Activity, AlertTriangle, Waves } from "lucide-react";
import type { EarthquakeEvent } from "@siahra/shared-types";
import type { EarthquakeFeedState, FeedStatus } from "../../hooks/useEarthquakeFeed";
import { Panel } from "../ui/Panel";

const STATUS_META: Record<FeedStatus, { label: string; dot: string; text: string }> = {
  connecting: { label: "กำลังเชื่อมต่อ", dot: "bg-slate-400", text: "text-[var(--color-fg-muted)]" },
  live: { label: "เรียลไทม์", dot: "bg-[var(--color-success)]", text: "text-[var(--color-success)]" },
  polling: { label: "ดึงข้อมูลเป็นช่วง", dot: "bg-amber-400", text: "text-amber-400" },
  error: { label: "เชื่อมต่อไม่ได้", dot: "bg-[var(--color-danger)]", text: "text-[var(--color-danger)]" },
};

function magnitudeColor(mag: number | null): string {
  if (mag === null) return "text-[var(--color-fg-muted)]";
  if (mag >= 6) return "text-[var(--color-risk-extreme)]";
  if (mag >= 5) return "text-[var(--color-risk-high)]";
  if (mag >= 4) return "text-[var(--color-risk-medium)]";
  return "text-[var(--color-risk-low)]";
}

function timeAgo(iso: string): string {
  const diffMin = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (diffMin < 1) return "เมื่อสักครู่";
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  return `${Math.floor(h / 24)} วันที่แล้ว`;
}

function EventRow({ event }: { event: EarthquakeEvent }) {
  return (
    <li className="flex items-start gap-2.5 border-t border-[var(--color-border)] py-2 first:border-t-0">
      <span
        className={`w-11 shrink-0 text-right text-base font-bold tabular-nums ${magnitudeColor(event.mag)}`}
      >
        {event.mag?.toFixed(1) ?? "—"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-[var(--color-fg)]" title={event.place ?? undefined}>
          {event.place ?? "ไม่ระบุตำแหน่ง"}
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-[var(--color-fg-subtle)]">
          <span>{event.magType ?? "ไม่ระบุมาตรา"}</span>
          <span aria-hidden="true">·</span>
          <span>ลึก {event.depthKm?.toFixed(0) ?? "—"} กม.</span>
          <span aria-hidden="true">·</span>
          <span>{timeAgo(event.time)}</span>
          {/* Automatic detections are unreviewed — must not look identical
              to human-reviewed solutions (see docs/ui-copy-rules.md). */}
          {event.status === "automatic" ? (
            <span className="rounded bg-amber-500/15 px-1 text-amber-400">ยังไม่ตรวจสอบ</span>
          ) : (
            <span className="rounded bg-[var(--color-success)]/15 px-1 text-[var(--color-success)]">
              ตรวจสอบแล้ว
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
  const { events, status, asOf, error } = feed;
  const meta = STATUS_META[status];
  const strongest = events.reduce<EarthquakeEvent | null>(
    (acc, e) => ((e.mag ?? -Infinity) > (acc?.mag ?? -Infinity) ? e : acc),
    null,
  );

  return (
    <Panel
      title="แผ่นดินไหวที่ตรวจวัดได้"
      icon={<Waves size={16} className="text-[var(--color-accent)]" aria-hidden="true" />}
      headerAction={
        <span className={`flex items-center gap-1.5 text-[11px] ${meta.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
          {meta.label}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div>
            {/* Backfill + retention window is 30 days (see EarthquakeFeedDO). */}
            <p className="text-xs text-[var(--color-fg-muted)]">เหตุการณ์ 30 วันล่าสุด</p>
            <p className="text-2xl font-bold tabular-nums text-[var(--color-fg)]">{events.length}</p>
          </div>
          {strongest ? (
            <div className="border-l border-[var(--color-border)] pl-3">
              <p className="text-xs text-[var(--color-fg-muted)]">ขนาดสูงสุด</p>
              <p className={`text-2xl font-bold tabular-nums ${magnitudeColor(strongest.mag)}`}>
                {strongest.mag?.toFixed(1) ?? "—"}
              </p>
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-danger)]/10 px-2.5 py-2 text-xs text-[var(--color-danger)]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}

        {events.length > 0 ? (
          <ul className="max-h-72 overflow-y-auto pr-0.5">
            {events.slice(0, 25).map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </ul>
        ) : (
          !error && (
            <p className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-3 text-center text-xs text-[var(--color-fg-muted)]">
              ไม่พบเหตุการณ์ในพื้นที่เฝ้าระวังช่วงเวลานี้
            </p>
          )
        )}

        <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-2 text-[11px] text-[var(--color-fg-muted)]">
          <Activity size={13} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
          ข้อมูลตรวจวัดจริงจาก USGS และ EMSC — เป็นเหตุการณ์ที่ตรวจพบแล้ว ไม่ใช่การพยากรณ์
          {asOf ? ` · อัปเดต ${new Date(asOf).toLocaleTimeString("th-TH")}` : ""}
        </p>
      </div>
    </Panel>
  );
}
