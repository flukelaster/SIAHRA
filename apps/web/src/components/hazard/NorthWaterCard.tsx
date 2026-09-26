import { ChevronDown, ChevronUp, Info, MapPin, Route } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type {
  DamObservation,
  NorthReachId,
  NorthRouteStation,
  NorthRouteStationState,
  NorthRouteTopology,
} from "@siahra/shared-types";
import { useNorthRoute } from "../../hooks/useNorthRoute";
import { useNow } from "../../hooks/useNow";
import { useLang } from "../../i18n/context";
import type { Lang, MessageKey, TFunction } from "../../i18n";
import { damDisplayName } from "../../lib/damName";
import { resolveError } from "../../lib/errorMessage";
import {
  layoutSchematic,
  nodeColor,
  nodeReading,
  peaks48h,
  FLOW_DASH_PERIOD,
  FREEBOARD_NEAR_M,
  NODE_COLOR,
  routeView,
  segmentFlow,
  STALE_OBS_MS,
  type NodeReading,
  type RouteView,
} from "../../lib/northRoute";
import { formatNumber } from "../../lib/number";
import { formatAge, formatDateTime, formatFetchedAt } from "../../lib/time";
import type { StationFocus } from "../layout/panelViews";
import { Panel } from "../ui/Panel";
import { Sparkline } from "./Sparkline";

/**
 * แผงเส้นทางน้ำเหนือ (E16) — ระดับประเทศ ไม่ขึ้นกับจังหวัดที่เลือก
 *
 * ผัง SVG: ปิง(+วัง) และน่าน(+ยม) บรรจบที่นครสวรรค์ แล้วเจ้าพระยาไหลลง — โหนดวางตาม
 * chainage จริงจากผังคงที่ (`/rivers/north-route.json`) สีตามระดับสถานการณ์ของ ThaiWater (สด)
 * หรือระยะต่ำกว่าตลิ่ง (ย้อนหลัง) ใต้ผังคือรายการสถานีเรียงตามทางน้ำ: ระดับน้ำ, ระยะถึงตลิ่ง/
 * ระดับวิกฤต, อัตราการไหลและ % ของความจุลำน้ำ, แนวโน้ม 3 ชม., กราฟ 48 ชม. และเวลาของยอดสูงสุด
 * ที่ **เกิดขึ้นแล้ว** — ไม่มีเวลาที่น้ำจะมาถึงหรือค่าล่วงหน้าใด ๆ
 *
 * เดินตาม `atIso` ของ TimelineBar ด้วยประวัติที่ถืออยู่แล้ว (ไม่ยิงคำขอใหม่); เก่ากว่า 48 ชม.
 * = ชิป "อยู่นอกช่วง 48 ชม. ของแผงนี้" และไม่แสดงค่าของสถานีใด
 */

const REACH_WIDTH: Record<NorthReachId, number> = { "chao-phraya": 4, ping: 3, nan: 3, wang: 2, yom: 2 };

/** ป้ายของโหนดปลายทาง (สถานีท้ายสุดของเจ้าพระยา — เลือกจากข้อมูล ไม่ใช่รหัสตายตัว) */
function terminalLabel(s: NorthRouteStation, t: TFunction): string {
  if (s.ridCode === "C.12") return t("north.terminal.c12", { code: s.ridCode });
  if (s.provinceCode === "10") return t("north.terminal.bangkok", { code: s.ridCode });
  return s.ridCode;
}

/** ลำดับการอ่าน "ตามทางน้ำ": สาขาฝั่งตะวันตก → ตะวันออก → เจ้าพระยา */
const READING_ORDER: NorthReachId[] = ["ping", "wang", "nan", "yom", "chao-phraya"];

const SITUATION_KEY: Record<number, MessageKey> = {
  1: "situation.1",
  2: "situation.2",
  3: "situation.3",
  4: "situation.4",
  5: "situation.5",
};

function reachName(topology: NorthRouteTopology, id: NorthReachId, lang: Lang): string {
  const r = topology.reaches.find((x) => x.id === id);
  if (!r) return id;
  return lang === "th" ? r.nameTh : r.nameEn;
}

function stationLabel(s: NorthRouteStation, state: NorthRouteStationState | undefined, lang: Lang): string {
  const name =
    lang === "th"
      ? (state?.latest?.station.nameTh ?? s.nameTh ?? state?.latest?.station.nameEn)
      : (state?.latest?.station.nameEn ?? state?.latest?.station.nameTh ?? s.nameTh);
  return name ? `${s.ridCode} ${name}` : s.ridCode;
}

function trendText(r: NodeReading, lang: Lang, t: TFunction): string | null {
  if (r.trendMPerH === null) return null;
  // freeboard ลด = น้ำขึ้น — แสดงเป็นอัตราของระดับน้ำ (ค่าเดียวกัน กลับเครื่องหมาย)
  const rate = -r.trendMPerH;
  if (Math.abs(rate) < 0.005) return t("north.trend.steady");
  const n = formatNumber(lang, Math.abs(rate), 2);
  return t(rate > 0 ? "north.trend.rising" : "north.trend.falling", { n, unit: t("unit.m") });
}

function levelBits(r: NodeReading, lang: Lang, t: TFunction): string[] {
  const out: string[] = [];
  if (r.level !== null) {
    out.push(`${formatNumber(lang, r.level, 2)} ${r.levelDatum === "msl" ? t("unit.msl") : t("unit.m")}`);
  }
  if (r.freeboardM !== null) {
    out.push(
      r.freeboardM <= 0
        ? t("water.aboveBank", { n: formatNumber(lang, Math.abs(r.freeboardM), 2), unit: t("unit.m") })
        : t("water.belowBank", { n: formatNumber(lang, r.freeboardM, 2), unit: t("unit.m") }),
    );
  }
  if (r.criticalMarginM !== null) {
    out.push(
      r.criticalMarginM < 0
        ? t("north.aboveCritical", { n: formatNumber(lang, Math.abs(r.criticalMarginM), 2), unit: t("unit.m") })
        : t("north.belowCritical", { n: formatNumber(lang, r.criticalMarginM, 2), unit: t("unit.m") }),
    );
  }
  return out;
}

function flowBits(r: NodeReading, lang: Lang, t: TFunction): string[] {
  const out: string[] = [];
  if (r.dischargeM3s !== null) out.push(t("water.discharge", { n: formatNumber(lang, r.dischargeM3s), unit: t("unit.m3s") }));
  if (r.qmaxPct !== null) out.push(t("north.qmaxPct", { pct: formatNumber(lang, r.qmaxPct) }));
  return out;
}

function StationRow({
  station,
  state,
  reading,
  view,
  nowMs,
  lang,
  t,
  onFocus,
}: {
  station: NorthRouteStation;
  state: NorthRouteStationState | undefined;
  reading: NodeReading;
  view: RouteView;
  nowMs: number;
  lang: Lang;
  t: TFunction;
  onFocus: (target: StationFocus) => void;
}) {
  const [open, setOpen] = useState(false);
  const color = nodeColor(reading);
  const dim = reading.missing || reading.stale;
  const endMs = view.mode === "at" ? view.atMs : nowMs;
  const peaks = state ? peaks48h(state.history48h, endMs) : { level: null, discharge: null };
  const level = levelBits(reading, lang, t);
  const flow = flowBits(reading, lang, t);
  const trend = trendText(reading, lang, t);
  const bank = state?.latest?.minBankMsl ?? null;
  return (
    <li className="border-t border-[var(--color-border)] py-1.5 first:border-t-0" data-rid={station.ridCode}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex w-full cursor-pointer items-start gap-2 text-left ${dim ? "opacity-55" : ""}`}
      >
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-[var(--color-fg)]">{stationLabel(station, state, lang)}</span>
          <span className="block text-[11px] leading-snug text-[var(--color-fg-subtle)] tabular-nums">
            {reading.missing
              ? view.mode === "live" && !state?.latest
                ? t("north.notInFeed")
                : t("north.missing")
              : [...level, ...flow].join(" · ")}
          </span>
          {!reading.missing && (trend || reading.situationLevel) ? (
            <span className="block text-[11px] text-[var(--color-fg-muted)]">
              {[reading.situationLevel ? t(SITUATION_KEY[reading.situationLevel]) : null, trend].filter(Boolean).join(" · ")}
            </span>
          ) : null}
          {reading.observedAt ? (
            <span className="block text-[10px] text-[var(--color-fg-subtle)]">
              {t("north.readingAt", {
                time: formatDateTime(lang, reading.observedAt),
                age: formatAge(lang, reading.observedAt, nowMs),
              })}
              {reading.stale ? ` · ${t("north.stale")}` : ""}
            </span>
          ) : !reading.missing ? (
            // มีค่าแต่ไม่มีเวลาตรวจวัด — ต้องบอก ไม่ใช่ปล่อยให้ดูเหมือนค่าปัจจุบัน
            <span className="block text-[10px] text-[var(--color-risk-medium)]">{t("north.readingTimeUnknown")}</span>
          ) : null}
        </span>
        {open ? (
          <ChevronUp size={12} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
        ) : (
          <ChevronDown size={12} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
        )}
      </button>
      {open ? (
        <div className="mt-1.5 flex flex-col gap-1.5 rounded-lg bg-[var(--color-bg-elevated)] px-2 py-1.5">
          {state && state.history48h.length > 0 ? (
            <>
              <p className="text-[10px] text-[var(--color-fg-subtle)]">
                {t("north.spark.level", {
                  datum: t(state.datum === "msl" ? "water.datum.msl" : state.datum === "local" ? "water.datum.local" : "water.datum.unknown"),
                })}
              </p>
              <Sparkline
                points={state.history48h}
                bankMsl={state.datum === "msl" ? bank : null}
                cursorMs={view.mode === "at" ? view.atMs : null}
                className="h-12 w-full"
              />
              <p className="text-[10px] text-[var(--color-fg-subtle)]">{t("north.spark.discharge", { unit: t("unit.m3s") })}</p>
              <Sparkline
                points={state.history48h}
                bankMsl={null}
                series="discharge"
                cursorMs={view.mode === "at" ? view.atMs : null}
                className="h-12 w-full"
              />
              {peaks.level ? (
                <p className="text-[11px] text-[var(--color-fg-muted)] tabular-nums">
                  {t("north.peak.level", {
                    value: formatNumber(lang, peaks.level.value, 2),
                    time: formatDateTime(lang, peaks.level.t),
                  })}
                </p>
              ) : null}
              {peaks.discharge ? (
                <p className="text-[11px] text-[var(--color-fg-muted)] tabular-nums">
                  {t("north.peak.discharge", {
                    value: formatNumber(lang, peaks.discharge.value),
                    unit: t("unit.m3s"),
                    time: formatDateTime(lang, peaks.discharge.t),
                  })}
                </p>
              ) : null}
            </>
          ) : null}
          <p className="text-[10px] text-[var(--color-fg-subtle)]">
            {state?.historyFetchedAt
              ? t("north.historyFetched", { time: formatFetchedAt(lang, state.historyFetchedAt) })
              : t("north.historyNever")}
          </p>
          <button
            type="button"
            onClick={() =>
              onFocus({ stationId: station.thaiwaterId, provinceCode: station.provinceCode, lat: station.lat, lon: station.lon })
            }
            className="inline-flex w-fit cursor-pointer items-center gap-1 rounded-md bg-white/8 px-1.5 py-0.5 text-[11px] text-[var(--color-accent)] hover:bg-white/15"
          >
            <MapPin size={11} aria-hidden="true" />
            {t("north.open", { code: station.ridCode })}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function Schematic({
  topology,
  readings,
  lang,
  t,
  onFocus,
}: {
  topology: NorthRouteTopology;
  readings: Map<string, NodeReading>;
  lang: Lang;
  t: TFunction;
  onFocus: (target: StationFocus) => void;
}) {
  const layout = useMemo(() => layoutSchematic(topology), [topology]);
  const byCode = new Map(topology.stations.map((s) => [s.ridCode, s]));
  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="w-full"
      role="img"
      aria-label={`${t("north.title")} — ${t("north.subtitle")}`}
    >
      {layout.segments.map((seg) => {
        // ช่วงที่ไม่มีค่าการไหลที่วัดได้ (ทั้งสองปลาย) = เส้นนิ่งและหรี่ ไม่เดาการไหลให้
        const flow = segmentFlow(seg, readings);
        const width = REACH_WIDTH[seg.reachId];
        return (
          <g key={seg.key}>
            <path
              d={seg.d}
              fill="none"
              stroke="#38bdf8"
              strokeOpacity={flow ? 0.55 : 0.22}
              strokeWidth={width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {flow ? (
              // ทิศ = ทิศของ path (ต้นน้ำ → ท้ายน้ำ); CSS ล้วน ไม่มี JS ต่อเฟรม — ปิดเมื่อ prefers-reduced-motion
              <path
                d={seg.d}
                fill="none"
                stroke="#e0f2fe"
                strokeOpacity={flow.stale ? 0.35 : 0.85}
                strokeWidth={Math.max(1, width - 1.5)}
                strokeDasharray={`3 ${FLOW_DASH_PERIOD - 3}`}
                strokeLinecap="round"
                className="north-flow"
                style={{ animationDuration: `${flow.durationS}s` }}
              >
                <title>{t("north.flowFrom", { code: flow.fromCode })}</title>
              </path>
            ) : null}
          </g>
        );
      })}
      {layout.labels.map((l) => (
        <text key={l.reachId} x={l.x} y={l.y} textAnchor="middle" fontSize={9} fill="#cbd5e1">
          {reachName(topology, l.reachId, lang)}
        </text>
      ))}
      <circle cx={layout.confluence.x} cy={layout.confluence.y} r={3} fill="#e2e8f0" />
      {/* ฝั่งซ้าย-ล่างของจุดบรรจบ: ฝั่งขวาเป็นที่ของป้ายสถานีเจ้าพระยา (C.2 อยู่ใต้จุดบรรจบไม่กี่ กม.) */}
      <text x={layout.confluence.x - 8} y={layout.confluence.y + 14} textAnchor="end" fontSize={9} fill="#e2e8f0">
        {t("north.confluence")}
      </text>
      {layout.dams.map((d) => (
        <g key={d.nameTh}>
          {d.offLine ? (
            <line x1={d.lineX} x2={d.x} y1={d.y} y2={d.y} stroke="#94a3b8" strokeDasharray="2 2" strokeWidth={1} />
          ) : null}
          <rect
            x={d.x - 4}
            y={d.y - 4}
            width={8}
            height={8}
            transform={`rotate(45 ${d.x} ${d.y})`}
            fill="#0f172a"
            stroke="#94a3b8"
            strokeWidth={1.2}
          >
            <title>{d.nameTh}</title>
          </rect>
        </g>
      ))}
      {layout.nodes.map((n) => {
        const r = readings.get(n.ridCode);
        const s = byCode.get(n.ridCode);
        if (!r || !s) return null;
        const dim = r.missing || r.stale;
        const leftSide = n.reachId === "ping" || n.reachId === "wang";
        const terminal = n.ridCode === layout.terminalCode;
        return (
          <g
            key={n.ridCode}
            className="cursor-pointer"
            opacity={dim ? 0.45 : 1}
            onClick={() => onFocus({ stationId: s.thaiwaterId, provinceCode: s.provinceCode, lat: s.lat, lon: s.lon })}
          >
            <title>{t("north.open", { code: n.ridCode })}</title>
            <circle cx={n.x} cy={n.y} r={5} fill={r.missing ? "#0f172a" : nodeColor(r)} stroke={nodeColor(r)} strokeWidth={1.5} />
            <text
              x={leftSide ? n.x - 8 : n.x + 8}
              y={n.y + 3}
              textAnchor={leftSide ? "end" : "start"}
              fontSize={terminal ? 9 : 8.5}
              fontWeight={terminal ? 600 : undefined}
              fill="#e2e8f0"
            >
              {terminal ? terminalLabel(s, t) : n.ridCode}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** สวอตช์ของโหนด: วงกลมเต็ม / วงกลมกลวงสีเทา (ไม่มีค่า) / จาง (ค่าค้าง) — วาดแบบเดียวกับใน `Schematic` */
function NodeSwatch({ color, hollow = false, dim = false }: { color: string; hollow?: boolean; dim?: boolean }) {
  return (
    <svg viewBox="0 0 14 14" className="h-3 w-3 shrink-0" aria-hidden="true" opacity={dim ? 0.45 : 1}>
      <circle cx={7} cy={7} r={4.5} fill={hollow ? "#0f172a" : color} stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function LegendItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-1.5">
      <span className="mt-px flex w-[22px] shrink-0 items-center justify-center">{swatch}</span>
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}

/**
 * คำอธิบายสัญลักษณ์ของผัง — ทุกสีที่โหนดเป็นได้ (อ่านจาก `NODE_COLOR` / `FREEBOARD_NEAR_M` /
 * `STALE_OBS_MS` ตัวเดียวกับ `nodeColor` ไม่ใช่เกณฑ์ที่พิมพ์ซ้ำ) กลุ่มที่ใช้กับมุมมองตอนนี้เป็นตัวเข้ม
 */
function SchematicLegend({ view, t }: { view: RouteView; t: TFunction }) {
  const heading = (active: boolean) =>
    `mb-1 text-[10px] font-semibold ${active ? "text-[var(--color-fg)]" : "text-[var(--color-fg-subtle)]"}`;
  const m = t("unit.m");
  return (
    <div className="flex flex-col gap-2 px-1.5 text-[10px] leading-snug text-[var(--color-fg-muted)]">
      <div className="grid grid-cols-1 gap-x-3 gap-y-2 min-[300px]:grid-cols-2">
        <section>
          <h4 className={heading(view.mode === "live")}>{t("north.legend.live")}</h4>
          <ul className="flex flex-col gap-0.5">
            <LegendItem swatch={<NodeSwatch color={NODE_COLOR.red} />}>{t("situation.5")}</LegendItem>
            <LegendItem swatch={<NodeSwatch color={NODE_COLOR.orange} />}>{t("situation.4")}</LegendItem>
            <LegendItem swatch={<NodeSwatch color={NODE_COLOR.green} />}>{t("situation.3")}</LegendItem>
            <LegendItem swatch={<NodeSwatch color={NODE_COLOR.yellow} />}>
              {`${t("situation.2")} / ${t("situation.1")}`}
            </LegendItem>
          </ul>
        </section>
        <section>
          <h4 className={heading(view.mode === "at")}>{t("north.legend.hist")}</h4>
          <ul className="flex flex-col gap-0.5">
            <LegendItem swatch={<NodeSwatch color={NODE_COLOR.red} />}>{t("north.legend.atBank")}</LegendItem>
            <LegendItem swatch={<NodeSwatch color={NODE_COLOR.orange} />}>
              {t("north.legend.nearBank", { n: String(FREEBOARD_NEAR_M), unit: m })}
            </LegendItem>
            <LegendItem swatch={<NodeSwatch color={NODE_COLOR.blue} />}>
              {t("north.legend.farBank", { n: String(FREEBOARD_NEAR_M), unit: m })}
            </LegendItem>
            <LegendItem swatch={<NodeSwatch color={NODE_COLOR.grey} />}>{t("north.legend.noBank")}</LegendItem>
          </ul>
          <p className="mt-0.5 text-[var(--color-fg-subtle)]">{t("north.legend.histNote")}</p>
        </section>
        <section>
          <h4 className={heading(false)}>{t("north.legend.symbols")}</h4>
          <ul className="flex flex-col gap-0.5">
            <LegendItem swatch={<NodeSwatch color={NODE_COLOR.grey} hollow />}>{t("north.legend.noValue")}</LegendItem>
            <LegendItem swatch={<NodeSwatch color={NODE_COLOR.green} dim />}>
              {t("north.legend.stale", { h: String(STALE_OBS_MS / 3_600_000) })}
            </LegendItem>
            <LegendItem
              swatch={
                <svg viewBox="0 0 14 14" className="h-3 w-3" aria-hidden="true">
                  <circle cx={7} cy={7} r={3} fill="#e2e8f0" />
                </svg>
              }
            >
              {t("north.legend.confluence")}
            </LegendItem>
            <LegendItem
              swatch={
                <svg viewBox="0 0 14 14" className="h-3 w-3" aria-hidden="true">
                  <rect x={3.5} y={3.5} width={7} height={7} transform="rotate(45 7 7)" fill="#0f172a" stroke="#94a3b8" strokeWidth={1.2} />
                </svg>
              }
            >
              {t("north.legend.dam")}
            </LegendItem>
            <LegendItem
              swatch={
                <svg viewBox="0 0 22 14" className="h-3 w-[18px]" aria-hidden="true">
                  <line x1={1} x2={12} y1={7} y2={7} stroke="#94a3b8" strokeDasharray="2 2" strokeWidth={1} />
                  <rect x={12} y={3.5} width={7} height={7} transform="rotate(45 15.5 7)" fill="#0f172a" stroke="#94a3b8" strokeWidth={1.2} />
                </svg>
              }
            >
              {t("north.legend.damOff")}
            </LegendItem>
          </ul>
        </section>
        <section>
          <h4 className={heading(view.mode !== "outside")}>{t("north.legend.lines")}</h4>
          <ul className="flex flex-col gap-0.5">
            <LegendItem
              swatch={
                <svg viewBox="0 0 22 8" className="h-2 w-[22px]" aria-hidden="true">
                  <line x1={1} x2={21} y1={4} y2={4} stroke="#38bdf8" strokeOpacity={0.55} strokeWidth={3} strokeLinecap="round" />
                  <line
                    x1={1}
                    x2={21}
                    y1={4}
                    y2={4}
                    stroke="#e0f2fe"
                    strokeOpacity={0.85}
                    strokeWidth={1.5}
                    strokeDasharray={`3 ${FLOW_DASH_PERIOD - 3}`}
                    className="north-flow"
                    style={{ animationDuration: "1s" }}
                  />
                </svg>
              }
            >
              {t("north.legend.flowing")}
            </LegendItem>
            <LegendItem
              swatch={
                <svg viewBox="0 0 22 8" className="h-2 w-[22px]" aria-hidden="true">
                  <line x1={1} x2={21} y1={4} y2={4} stroke="#38bdf8" strokeOpacity={0.22} strokeWidth={3} strokeLinecap="round" />
                </svg>
              }
            >
              {t("north.legend.noFlow")}
            </LegendItem>
          </ul>
        </section>
      </div>
      <p className="text-[var(--color-fg-subtle)]">{t("north.flowLegend")}</p>
    </div>
  );
}

function damReport(ids: readonly number[], dams: readonly DamObservation[]): DamObservation | null {
  for (const id of ids) {
    const d = dams.find((x) => x.id === id);
    if (d) return d;
  }
  return null;
}

export function NorthWaterCard({
  atIso,
  onFocusStation,
}: {
  atIso: string | null;
  onFocusStation: (target: StationFocus) => void;
}) {
  const { lang, t } = useLang();
  const nowMs = useNow();
  const state = useNorthRoute();
  const { topology, route } = state;
  const view = routeView(atIso, nowMs);
  const byCode = useMemo(() => new Map((route?.stations ?? []).map((s) => [s.ridCode, s])), [route]);
  const readings = useMemo(() => {
    const out = new Map<string, NodeReading>();
    for (const s of topology?.stations ?? []) {
      const st = byCode.get(s.ridCode);
      out.set(
        s.ridCode,
        st
          ? nodeReading(st, view, nowMs)
          : nodeReading({ ridCode: s.ridCode, thaiwaterId: s.thaiwaterId, reachId: s.reachId, latest: null, datum: "unknown", history48h: [], historyFetchedAt: null }, view, nowMs),
      );
    }
    return out;
    // view เปลี่ยนตาม atIso/nowMs — คิดใหม่ทุกครั้งที่สองค่านั้นเปลี่ยน
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topology, byCode, atIso, nowMs]);
  const gapText = topology?.reaches
    .filter((r) => r.gaps.length > 0)
    .map((r) => `${lang === "th" ? r.nameTh : r.nameEn} ${r.gaps.map((g) => `${g.fromKm}–${g.toKm} ${t("unit.km")}`).join(", ")}`)
    .join("; ");

  return (
    <Panel
      title={t("north.title")}
      icon={<Route size={16} className="text-[var(--color-accent)]" aria-hidden="true" />}
      headerAction={
        <span className="text-[10px] text-[var(--color-fg-muted)]" title={t("north.fetchedAt", { time: formatFetchedAt(lang, route?.fetchedAt ?? null) })}>
          {route ? formatAge(lang, route.fetchedAt, nowMs) : state.loading ? t("common.loading") : ""}
        </span>
      }
    >
      <div className="flex flex-col gap-2.5">
        <p className="text-[11px] text-[var(--color-fg-muted)]">{t("north.subtitle")}</p>

        {view.mode === "outside" ? (
          <div className="flex flex-col gap-1 rounded-lg bg-white/5 px-2.5 py-2">
            <span className="w-fit rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] leading-none text-[var(--color-fg)]">
              {t("north.outOfWindow")}
            </span>
            <p className="text-[11px] text-[var(--color-fg-muted)]">{t("north.outOfWindowNote")}</p>
          </div>
        ) : view.mode === "at" ? (
          <p className="rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-2 text-[11px] text-[var(--color-risk-medium)]">
            {t("north.historical", { time: formatDateTime(lang, new Date(view.atMs).toISOString()) })}
          </p>
        ) : null}

        {state.topologyError ? (
          <p className="rounded-lg bg-[var(--color-danger)]/10 px-2.5 py-2 text-xs text-[var(--color-danger)]">
            {t("north.loadError.topology", { error: resolveError(t, state.topologyError) ?? "" })}
          </p>
        ) : null}
        {state.routeError ? (
          <p className="rounded-lg bg-[var(--color-danger)]/10 px-2.5 py-2 text-xs text-[var(--color-danger)]">
            {t("north.loadError.route", { error: resolveError(t, state.routeError) ?? "" })}
          </p>
        ) : null}

        {topology ? (
          <>
            <div className="flex flex-col gap-2 rounded-xl bg-black/25 px-1 pt-1.5 pb-2.5">
              <Schematic topology={topology} readings={readings} lang={lang} t={t} onFocus={onFocusStation} />
              <SchematicLegend view={view} t={t} />
            </div>

            {READING_ORDER.map((reachId) => {
              const stations = topology.stations.filter((s) => s.reachId === reachId);
              if (stations.length === 0) return null;
              return (
                <section key={reachId}>
                  <h3 className="text-[11px] font-semibold text-[var(--color-fg)]">{reachName(topology, reachId, lang)}</h3>
                  <ul>
                    {stations.map((s) => (
                      <StationRow
                        key={s.ridCode}
                        station={s}
                        state={byCode.get(s.ridCode)}
                        reading={readings.get(s.ridCode)!}
                        view={view}
                        nowMs={nowMs}
                        lang={lang}
                        t={t}
                        onFocus={onFocusStation}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}

            <section>
              <h3 className="text-[11px] font-semibold text-[var(--color-fg)]">{t("north.dams")}</h3>
              {state.damsError && !state.dams ? (
                <p className="text-[11px] text-[var(--color-danger)]">
                  {t("north.loadError.dams", { error: resolveError(t, state.damsError) ?? "" })}
                </p>
              ) : null}
              <ul>
                {topology.dams.map((d) => {
                  const rep = state.dams ? damReport(d.damIds, state.dams.dams) : null;
                  return (
                    <li key={d.nameTh} className="border-t border-[var(--color-border)] py-1 text-[11px] first:border-t-0">
                      <span className="text-[var(--color-fg)]">
                        {damDisplayName(rep ?? { nameTh: d.nameTh, nameEn: null, kind: "large" }, lang, t)}
                      </span>
                      <span className="text-[var(--color-fg-subtle)]">
                        {` · ${reachName(topology, d.reachId, lang)}`}
                        {d.offsetKm > 2 ? ` (${t("north.damOffLine")})` : ""}
                      </span>
                      <span className="block text-[var(--color-fg-muted)] tabular-nums">
                        {rep
                          ? // รูปแบบเดียวกับ DamCard: ตัวเลขตามที่ ThaiWater ส่ง + เวลาที่รายงาน
                            // เปอร์เซ็นต์ว่าง (ต้นทางส่ง 0 มาเป็นค่าว่าง → null) → แสดงปริมาณ ล้าน ลบ.ม. แทน ไม่คำนวณ % เอง
                            `${
                              rep.storagePercent !== null
                                ? `${formatNumber(lang, rep.storagePercent)}%`
                                : rep.storageMcm !== null
                                  ? `${formatNumber(lang, rep.storageMcm)} ${t("unit.mcm")}`
                                  : "—"
                            }${
                              rep.inflowMcm !== null ? t("dam.inflow", { n: formatNumber(lang, rep.inflowMcm, 2) }) : ""
                            }${rep.releasedMcm !== null ? t("dam.released", { n: formatNumber(lang, rep.releasedMcm, 2) }) : ""}${
                              rep.inflowMcm !== null || rep.releasedMcm !== null ? ` ${t("unit.mcm")}` : ""
                            }${rep.observedAt ? ` · ${formatDateTime(lang, rep.observedAt)}` : ""}`
                          : state.dams
                            ? t("north.damMissing")
                            : t("common.loading")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        ) : state.topologyError ? null : (
          <div className="h-40 animate-pulse rounded-xl bg-white/5" />
        )}

        <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-2 text-[11px] text-[var(--color-fg-muted)]">
          <Info size={13} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
          <span>
            {t("north.note")}
            <br />
            {t("north.fetchedAt", { time: formatFetchedAt(lang, route?.fetchedAt ?? null) })}
            {topology ? (
              <>
                <br />
                {t("north.topologyBuilt", { time: formatFetchedAt(lang, topology.builtAt) })}
              </>
            ) : null}
            {gapText ? (
              <>
                <br />
                {t("north.gaps", { list: gapText })}
              </>
            ) : null}
          </span>
        </p>
      </div>
    </Panel>
  );
}
