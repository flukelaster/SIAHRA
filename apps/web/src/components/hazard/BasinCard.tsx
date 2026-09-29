import { Info, Waypoints } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { BasinDam, BasinStation, HealthResponse, SituationLevel } from "@siahra/shared-types";
import type { BasinsState } from "../../hooks/useBasins";
import { useNow } from "../../hooks/useNow";
import { useLang } from "../../i18n/context";
import type { Lang, MessageKey, TFunction } from "../../i18n";
import { PROVINCES } from "../../data/provinces";
import {
  BASIN_FREEBOARD_NEAR_M,
  BASIN_MAX_READING_AGE_MS,
  bucketFor,
  damsFreshness,
  pickerRows,
  provinceRows,
  rankStations,
  sameSelection,
  sortDams,
  summarizeStations,
  BASIN_DAMS_STALE_MS,
  basinAgeMs,
  isBasinsStale,
  knownProvinceCode,
  type BasinSelection,
  type BasinTone,
  type EvaluatedStation,
  type PickerRow,
  type ProvinceRow,
  type StationStatus,
} from "../../lib/basinView";
import { damDisplayName } from "../../lib/damName";
import { resolveError } from "../../lib/errorMessage";
import { EPISTEMIC_BADGE } from "../../lib/layerFreshness";
import { formatNumber } from "../../lib/number";
import { formatAge, formatDateTime, formatFetchedAt } from "../../lib/time";
import { healthMeta, statusLabel } from "../layout/sourceStatusText";
import type { StationFocus } from "../layout/panelViews";
import { Panel } from "../ui/Panel";

/**
 * แผง "ลุ่มน้ำ" — สถานีวัดระดับน้ำและเขื่อนจัดกลุ่มตามป้ายลุ่มน้ำของ ThaiWater (`GET /api/v1/basins`, ระดับประเทศ ไม่ขึ้นกับจังหวัดที่เลือก)
 *
 * กฎความซื่อสัตย์ที่การ์ดนี้ถือ:
 * - ป้าย "ตรวจวัดจริง" (observed) + เวลาที่ API ดึง ThaiWater (`fetchedAt`, null = ยังไม่เคย ไม่ใช่ "ตอนนี้") + เวลาตรวจวัดใหม่สุดของกลุ่ม
 * - สามสถานะที่แยกกัน: API ยังไม่เคยดึงระดับน้ำ (`fetchedAt` null) / ถาม API ไม่ได้ (คำขอของเว็บพลาด / `/health` ตอบไม่ได้) / ข้อมูลค้าง
 *   — สองแบบหลังหรี่ข้อมูลไว้ ไม่ซ่อน
 * - เขื่อนมี `damsFetchedAt` ของตัวเอง (ถูกดึงแบบ lazy จึงเก่ากว่า/ไม่มีได้): ไม่เคยดึง ≠ ไม่มีเขื่อน, เก่า = หรี่ + บอกเวลา
 * - เกณฑ์ที่ต้นทางประกาศเท่านั้น (`lib/basinView.ts`), ไม่มีสีเขียว (ไม่เกินเกณฑ์เป็นเทากลาง), ค่าค้าง/ไม่มีเวลา/จัดไม่ได้นับแยกให้เห็น
 * - ไม่มีลำดับต้นน้ำ→ปลายน้ำ ไม่มีเวลาที่น้ำจะมาถึง ไม่มีค่าล่วงหน้า; ดูได้เฉพาะปัจจุบัน (`atIso` ตั้ง = บอกและไม่แสดงค่า)
 * - ไม่ยิงคำขอเอง: ข้อมูลมาจาก hook ตัวเดียวใน App.tsx (`useBasins`) และไม่มีคำขอรายสถานี/ประวัติ
 */

/** จำนวนสถานีที่แสดงก่อนกด "แสดงทั้งหมด" */
const STATIONS_COLLAPSED = 10;

type ChipShape = "square" | "triangle" | "circle";

const TONE_KEY: Record<BasinTone, MessageKey> = {
  severe: "basin.tone.severe",
  high: "basin.tone.high",
  none: "basin.tone.none",
  "no-data": "basin.tone.noData",
};
/** `none` เป็นเทากลาง ไม่ใช่สีเขียว — ไม่มีสถานีเกินเกณฑ์ ไม่ได้แปลว่าปลอดภัย */
const TONE_COLOR: Record<BasinTone, string> = {
  severe: "var(--color-risk-extreme)",
  high: "var(--color-risk-high)",
  none: "var(--color-fg-subtle)",
  "no-data": "var(--color-fg-subtle)",
};
const TONE_SHAPE: Record<BasinTone, ChipShape> = { severe: "square", high: "triangle", none: "circle", "no-data": "circle" };

const SITUATION_KEY: Record<SituationLevel, MessageKey> = {
  1: "situation.1",
  2: "situation.2",
  3: "situation.3",
  4: "situation.4",
  5: "situation.5",
};

const HOURS = Math.round(BASIN_MAX_READING_AGE_MS / 3_600_000);
const DAMS_HOURS = Math.round(BASIN_DAMS_STALE_MS / 3_600_000);

/** ชิป = รูปทรง + สี + ข้อความเสมอ (ไม่พึ่งสีอย่างเดียว); `hollow` = ไม่มีค่า/ไม่ได้นับ */
function Chip({
  shape,
  color,
  label,
  hollow = false,
  dashed = false,
}: {
  shape: ChipShape;
  color: string;
  label: string;
  hollow?: boolean;
  dashed?: boolean;
}) {
  const fill = hollow ? "transparent" : color;
  return (
    <span
      className="inline-flex w-fit max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-snug text-[var(--color-fg)]"
      style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }}
    >
      <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" aria-hidden="true">
        {shape === "square" ? (
          <rect x={2} y={2} width={8} height={8} rx={1} fill={fill} stroke={color} strokeWidth={1.5} />
        ) : shape === "triangle" ? (
          <polygon points="6,1.5 11,10.5 1,10.5" fill={fill} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        ) : (
          <circle cx={6} cy={6} r={4} fill={fill} stroke={color} strokeWidth={1.5} />
        )}
      </svg>
      <span className="min-w-0 break-words">{label}</span>
    </span>
  );
}

function ToneChip({ tone, t }: { tone: BasinTone; t: TFunction }) {
  return (
    <Chip
      shape={TONE_SHAPE[tone]}
      color={TONE_COLOR[tone]}
      hollow={tone === "none" || tone === "no-data"}
      dashed={tone === "no-data"}
      label={t(TONE_KEY[tone])}
    />
  );
}

/** สถานะของสถานีหนึ่ง → ชิป: ที่นับได้ใช้ชิปของระดับ ส่วนที่นับไม่ได้ (ค้าง/ไม่มีเวลา/จัดไม่ได้) เป็นชิปกลวงเส้นประ */
function StatusChip({ status, t }: { status: StationStatus; t: TFunction }) {
  if (status === "severe" || status === "high" || status === "none") return <ToneChip tone={status} t={t} />;
  const label =
    status === "stale"
      ? t("basin.station.stale", { h: HOURS })
      : status === "undated"
        ? t("basin.station.undated")
        : t("basin.station.unclassified");
  return <Chip shape="circle" color="var(--color-fg-subtle)" hollow dashed label={label} />;
}

function provinceLabel(code: string | null, lang: Lang, t: TFunction): string {
  // รหัสที่ไม่ใช่จังหวัดจริง (เช่น "10499" ของสถานีนอกประเทศ) = ไม่ระบุจังหวัด — ไม่พิมพ์รหัสดิบ
  const known = knownProvinceCode(code);
  if (known === null) return t("basin.noProvince");
  const p = PROVINCES.find((x) => x.code === known);
  return p ? (lang === "th" ? p.nameTh : p.nameEn) : t("basin.noProvince");
}

/** `freeboardM` < 0 = น้ำอยู่ **เหนือ** ตลิ่ง — ไม่พิมพ์ตัวเลขติดลบใต้คำว่า "ต่ำกว่าตลิ่ง" */
function freeboardText(freeboardM: number | null, lang: Lang, t: TFunction): string | null {
  if (freeboardM === null || !Number.isFinite(freeboardM)) return null;
  if (freeboardM < 0) return t("water.aboveBank", { n: formatNumber(lang, Math.abs(freeboardM), 2), unit: t("unit.m") });
  if (freeboardM === 0) return t("basin.station.atBank");
  return t("basin.station.freeboard", { n: formatNumber(lang, freeboardM, 2) });
}

function stationName(s: BasinStation, t: TFunction): string {
  return s.nameTh ?? t("basin.station.unnamed", { id: s.id });
}

/** สถานีที่เปิดบนแผนที่ได้ต้องมีจังหวัดจริงใน 77 จังหวัด — ไม่ระบุ หรือรหัสที่ไม่ใช่จังหวัด (เช่นนอกประเทศ "10499") อยู่นอกฉากของจังหวัดใดที่เราโหลดได้ */
function focusOf(s: BasinStation): StationFocus | null {
  const provinceCode = knownProvinceCode(s.provinceCode);
  return provinceCode === null ? null : { stationId: s.id, provinceCode, lat: s.lat, lon: s.lon };
}

function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warn" | "bad" }) {
  const cls =
    tone === "bad"
      ? "bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
      : tone === "warn"
        ? "bg-[var(--color-risk-medium)]/10 text-[var(--color-risk-medium)]"
        : "bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)]";
  return <p className={`rounded-lg px-2.5 py-2 text-[11px] leading-snug ${cls}`}>{children}</p>;
}

function Picker({
  rows,
  others,
  selection,
  filter,
  onFilter,
  onSelect,
  lang,
  t,
}: {
  rows: readonly PickerRow[];
  others: readonly PickerRow[];
  selection: BasinSelection | null;
  filter: string;
  onFilter: (q: string) => void;
  onSelect: (s: BasinSelection) => void;
  lang: Lang;
  t: TFunction;
}) {
  const label = (r: PickerRow): string =>
    r.selection.kind === "outside" ? t("basin.outside") : r.selection.kind === "unassigned" ? t("basin.unassigned") : (r.nameTh ?? "");
  const item = (r: PickerRow) => {
    const active = sameSelection(selection, r.selection);
    return (
      <li key={r.selection.kind === "basin" ? `b:${r.selection.key}` : r.selection.kind} className="border-t border-[var(--color-border)] first:border-t-0">
        <button
          type="button"
          aria-current={active ? "true" : undefined}
          onClick={() => onSelect(r.selection)}
          className={`flex min-h-11 w-full cursor-pointer flex-col items-start justify-center gap-0.5 rounded-md px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
            active ? "bg-white/10" : "hover:bg-white/5"
          }`}
        >
          <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-xs leading-thai text-[var(--color-fg)]">{label(r)}</span>
            <ToneChip tone={r.tone} t={t} />
          </span>
          <span className="text-[10px] text-[var(--color-fg-subtle)] tabular-nums">
            {t("basin.picker.counts", { stations: formatNumber(lang, r.stationCount), dams: formatNumber(lang, r.damCount) })}
          </span>
        </button>
      </li>
    );
  };
  return (
    <section className="flex flex-col gap-1.5" aria-label={t("basin.picker.title")}>
      <h3 className="text-[11px] font-semibold text-[var(--color-fg)]">{t("basin.picker.title")}</h3>
      <input
        type="search"
        value={filter}
        onChange={(e) => onFilter(e.target.value)}
        aria-label={t("basin.picker.filter")}
        placeholder={t("basin.picker.filterPlaceholder")}
        className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-black/25 px-2.5 text-xs text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      />
      <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">{t("basin.picker.order")}</p>
      {rows.length === 0 ? (
        <p className="px-1 text-[11px] text-[var(--color-fg-muted)]">{t("basin.picker.none")}</p>
      ) : (
        <ul className="max-h-56 overflow-y-auto pr-0.5">{rows.map(item)}</ul>
      )}
      {others.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <h4 className="text-[10px] font-semibold text-[var(--color-fg-subtle)]">{t("basin.picker.notBasins")}</h4>
          <ul>{others.map(item)}</ul>
        </div>
      ) : null}
    </section>
  );
}

function ProvinceList({
  rows,
  lang,
  t,
  onFocus,
}: {
  rows: readonly ProvinceRow[];
  lang: Lang;
  t: TFunction;
  onFocus: (target: StationFocus) => void;
}) {
  return (
    <section className="flex flex-col gap-1" data-basin-provinces>
      <h3 className="text-[11px] font-semibold text-[var(--color-fg)]">{t("basin.provinces.title")}</h3>
      <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">{t("basin.provinces.note")}</p>
      <ul>
        {rows.map((row) => {
          const focus = focusOf(row.focus);
          const excluded = [
            row.summary.stale > 0 ? t("basin.province.n.stale", { n: String(row.summary.stale) }) : null,
            row.summary.undated > 0 ? t("basin.province.n.undated", { n: String(row.summary.undated) }) : null,
            row.summary.unclassified > 0 ? t("basin.province.n.unclassified", { n: String(row.summary.unclassified) }) : null,
          ].filter((x): x is string => x !== null);
          return (
            <li key={row.provinceCode ?? "none"} className="border-t border-[var(--color-border)] first:border-t-0">
              <button
                type="button"
                disabled={!focus}
                title={focus ? t("basin.open", { name: stationName(row.focus, t) }) : t("basin.station.noProvince")}
                onClick={() => (focus ? onFocus(focus) : undefined)}
                className="flex min-h-11 w-full cursor-pointer flex-col items-start justify-center gap-0.5 py-1.5 text-left disabled:cursor-default"
              >
                <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-xs leading-thai text-[var(--color-fg)]">{provinceLabel(row.provinceCode, lang, t)}</span>
                  <ToneChip tone={row.tone} t={t} />
                </span>
                {row.worst ? (
                  <span className="text-[11px] text-[var(--color-fg-muted)]">
                    {t("basin.province.worst", {
                      name: stationName(row.worst.station, t),
                      rule: t(row.worst.rule === "bank" ? "basin.rule.bank" : "basin.rule.situation"),
                    })}
                  </span>
                ) : null}
                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                  {t("basin.province.basis", { counted: String(row.summary.counted), total: String(row.summary.stationCount) })}
                  {excluded.length > 0 ? ` · ${t("basin.province.excluded", { list: excluded.join(", ") })}` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StationRow({
  e,
  lang,
  t,
  onFocus,
}: {
  e: EvaluatedStation;
  lang: Lang;
  t: TFunction;
  onFocus: (target: StationFocus) => void;
}) {
  const s = e.station;
  const focus = focusOf(s);
  const values = [
    s.waterlevelMsl !== null ? t("basin.station.level", { n: formatNumber(lang, s.waterlevelMsl, 2) }) : null,
    freeboardText(s.freeboardM, lang, t),
    s.dischargeM3s !== null ? t("water.discharge", { n: formatNumber(lang, s.dischargeM3s, 1), unit: t("unit.m3s") }) : null,
  ].filter((x): x is string => x !== null);
  const counted = e.status === "severe" || e.status === "high" || e.status === "none";
  return (
    <li className={`border-t border-[var(--color-border)] first:border-t-0 ${counted ? "" : "opacity-60"}`} data-station={s.id}>
      <button
        type="button"
        disabled={!focus}
        title={focus ? t("basin.open", { name: stationName(s, t) }) : t("basin.station.noProvince")}
        onClick={() => (focus ? onFocus(focus) : undefined)}
        className="flex min-h-11 w-full cursor-pointer flex-col items-start justify-center gap-0.5 py-1.5 text-left disabled:cursor-default"
      >
        <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-xs leading-thai text-[var(--color-fg)]">{stationName(s, t)}</span>
          <span className="text-[10px] text-[var(--color-fg-subtle)]">{provinceLabel(s.provinceCode, lang, t)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1">
          <StatusChip status={e.status} t={t} />
          {s.situationLevel !== null ? (
            <span className="text-[10px] text-[var(--color-fg-muted)]">{t(SITUATION_KEY[s.situationLevel])}</span>
          ) : null}
        </span>
        <span className="text-[11px] text-[var(--color-fg-muted)] tabular-nums">
          {values.length > 0 ? values.join(" · ") : "—"}
          {s.observedAt ? ` · ${formatDateTime(lang, s.observedAt)}` : ` · ${t("basin.station.undated")}`}
        </span>
      </button>
    </li>
  );
}

function DamRow({ d, dim, lang, t }: { d: BasinDam; dim: boolean; lang: Lang; t: TFunction }) {
  return (
    <li className={`flex items-center gap-2.5 border-t border-[var(--color-border)] py-1.5 first:border-t-0 ${dim ? "opacity-60" : ""}`} data-dam={d.id}>
      <span className="w-14 shrink-0 text-right text-sm font-bold tabular-nums text-[var(--color-fg)]">
        {d.storagePercent !== null ? `${formatNumber(lang, d.storagePercent, 0)}%` : "—"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="leading-thai text-xs text-[var(--color-fg)]">{damDisplayName(d, lang, t)}</p>
        <p className="leading-thai text-[11px] text-[var(--color-fg-subtle)]">
          {d.storageMcm !== null ? `${formatNumber(lang, d.storageMcm)} ${t("unit.mcm")}` : ""}
          {d.observedAt ? `${d.storageMcm !== null ? " · " : ""}${formatDateTime(lang, d.observedAt)}` : ""}
          {d.provinceCode ? ` · ${provinceLabel(d.provinceCode, lang, t)}` : ""}
        </p>
      </div>
    </li>
  );
}

export function BasinCard({
  state,
  selection,
  onSelect,
  atIso,
  health,
  apiDown,
  onFocusStation,
}: {
  /** hook ตัวเดียวใน App.tsx (`useBasins`) — การ์ดไม่ยิงคำขอเอง */
  state: BasinsState;
  /** กลุ่มที่เลือกอยู่ — อยู่ใน state ของ App (รอดการสลับแท็บย่อย) ไม่อยู่ใน permalink */
  selection: BasinSelection | null;
  onSelect: (s: BasinSelection | null) => void;
  atIso: string | null;
  health: HealthResponse | null;
  /** `/api/v1/health` ตอบไม่ได้ — ต่างจาก "แหล่ง ThaiWater ไม่ปกติ" */
  apiDown: boolean;
  onFocusStation: (target: StationFocus) => void;
}) {
  const { lang, t } = useLang();
  const nowMs = useNow();
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const { data } = state;
  const live = atIso === null;

  const picker = useMemo(() => (data && live ? pickerRows(data, filter, nowMs) : null), [data, live, filter, nowMs]);
  const selected = useMemo(() => (data && selection ? bucketFor(data, selection) : null), [data, selection]);
  const summary = useMemo(() => (selected ? summarizeStations(selected.bucket.stations, nowMs) : null), [selected, nowMs]);
  const provinces = useMemo(() => (selected ? provinceRows(selected.bucket.stations, nowMs) : []), [selected, nowMs]);
  const ranked = useMemo(() => (selected ? rankStations(selected.bucket.stations, nowMs) : []), [selected, nowMs]);
  const dams = useMemo(() => (selected ? sortDams(selected.bucket.dams) : []), [selected]);

  // ── สถานะความสด: ยังไม่เคยดึง / ถามไม่ได้ / ค้าง — แยกกัน ──
  const fetchedAt = data?.fetchedAt ?? null;
  // ไม่มีเวลาดึง = ไม่มีแถวให้แสดง (ไม่แสดงตัวเลือก) — แต่สาเหตุมีสองอย่างที่ห้ามปนกัน: API ไม่เคยได้ระดับน้ำจาก ThaiWater เลย
  // (`buildError` ว่าง) กับ API ถือข้อมูลอยู่แล้วแต่สร้างมุมมองรายลุ่มน้ำไม่ได้ (`buildError` มีเหตุ) — อย่างหลังห้ามพูดว่า "ยังไม่เคยดึง"
  const noRow = data !== null && fetchedAt === null;
  const notBuilt = noRow && Boolean(data?.buildError);
  const neverFetched = noRow && !notBuilt;
  // เกณฑ์ค้าง = staleAfterSeconds + แคชขอบ + รอบถามของเว็บ (`basinStaleLimitMs`) — ท่อที่ดีให้อายุบนจอได้ถึงราว 30 นาที
  const ageMs = basinAgeMs(fetchedAt, nowMs);
  const stale = data !== null && isBasinsStale(fetchedAt, data.layer.staleAfterSeconds ?? 900, nowMs);
  const thaiwater = health?.sources.find((s) => s.id === "thaiwater") ?? null;
  const sourceBad = thaiwater !== null && thaiwater.health !== "ok";
  const requestFailed = state.error !== null;
  const dim = stale || requestFailed || sourceBad || apiDown;
  const damsState = data ? damsFreshness(data.damsFetchedAt, nowMs) : "never";
  const badge = EPISTEMIC_BADGE.observed;

  const errorText = resolveError(t, state.error) ?? "";

  return (
    <Panel
      title={t("basin.title")}
      icon={<Waypoints size={16} className="text-[var(--color-accent)]" aria-hidden="true" />}
      headerAction={
        <span className="text-[10px] text-[var(--color-fg-muted)]" title={data && !notBuilt ? t("basin.fetchedAt", { time: formatFetchedAt(lang, fetchedAt) }) : undefined}>
          {/* notBuilt: fetchedAt เป็น null เพราะ "ไม่มีแถว" ไม่ใช่ "ไม่เคยดึง" — ห้ามพิมพ์ "ยังไม่เคยได้รับข้อมูล" ทั้งที่ API ถือข้อมูลอยู่ (โน้ตด้านล่างบอกเหตุแทน) */}
          {data && !notBuilt ? formatAge(lang, fetchedAt, nowMs) : state.loading && live ? t("common.loading") : ""}
        </span>
      }
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex w-fit items-center rounded-md px-1.5 py-0.5 text-[10px] leading-none ring-1 ${badge.className}`}
            title={t(badge.titleKey)}
          >
            {t(badge.labelKey)}
          </span>
          {/* ยังไม่มีคำตอบจาก API (กำลังโหลด / คำขอพลาด / ไม่ได้ถาม) = ไม่มีอะไรจะบอก — null ที่นี่คือ "ไม่ได้ถาม/ถามไม่ได้" ไม่ใช่ "ไม่เคยได้ข้อมูล" */}
          {data !== null && !notBuilt ? (
            <span className="text-[10px] text-[var(--color-fg-muted)]">{t("basin.fetchedAt", { time: formatFetchedAt(lang, fetchedAt) })}</span>
          ) : null}
        </div>
        <p className="text-[11px] text-[var(--color-fg-muted)]">{t("basin.subtitle")}</p>
        <p className="text-[11px] text-[var(--color-fg-muted)]">{t("basin.notGiven")}</p>

        {!live ? (
          <div className="flex flex-col gap-1 rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-2">
            <span className="w-fit rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] leading-none text-[var(--color-fg)]">
              {t("basin.liveOnly")}
            </span>
            <p className="text-[11px] text-[var(--color-fg-muted)]">{t("basin.liveOnlyNote")}</p>
          </div>
        ) : (
          <>
            {data === null && requestFailed ? <Note tone="bad">{t("basin.error.noData", { error: errorText })}</Note> : null}
            {data === null && !requestFailed ? <div className="h-32 animate-pulse rounded-xl bg-white/5" role="status" aria-label={t("basin.loading")} /> : null}
            {neverFetched ? <Note tone="warn">{t("basin.neverFetched")}</Note> : null}
            {notBuilt && data?.buildError ? <Note tone="warn">{t("basin.notBuilt", { error: data.buildError })}</Note> : null}
            {!noRow && data?.buildError ? <Note tone="warn">{t("basin.buildError", { error: data.buildError })}</Note> : null}
            {data !== null && requestFailed ? (
              <Note tone="bad">
                {t("basin.error.refresh", {
                  error: errorText,
                  time: state.errorSince ? formatDateTime(lang, state.errorSince) : "—",
                })}
              </Note>
            ) : null}
            {stale ? <Note tone="warn">{t("basin.stale", { n: Math.floor((ageMs ?? 0) / 60_000), time: formatDateTime(lang, fetchedAt ?? "") })}</Note> : null}
            {apiDown ? <Note tone="warn">{t("basin.healthUnreachable")}</Note> : null}
            {!apiDown && sourceBad && thaiwater ? (
              <Note tone="warn">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${healthMeta(thaiwater.health).dot}`} aria-hidden="true" />
                  {t("basin.health", { status: statusLabel(thaiwater, lang, t) })}
                </span>
              </Note>
            ) : null}

            {data && !noRow && picker ? (
              <div className={`flex flex-col gap-2.5 ${dim ? "opacity-60" : ""}`}>
                <Picker
                  rows={picker.basins}
                  others={picker.others}
                  selection={selection}
                  filter={filter}
                  onFilter={setFilter}
                  onSelect={(s) => {
                    setShowAll(false);
                    onSelect(s);
                  }}
                  lang={lang}
                  t={t}
                />

                {selection === null ? <p className="px-1 text-[11px] text-[var(--color-fg-muted)]">{t("basin.select")}</p> : null}
                {selection !== null && selected === null ? <Note tone="warn">{t("basin.gone")}</Note> : null}

                {selected && summary ? (
                  <div className="flex flex-col gap-2.5" data-basin-detail>
                    <div className="flex flex-col gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2.5">
                      <h3 className="text-sm font-semibold text-[var(--color-fg)]">
                        {selection?.kind === "outside" ? t("basin.outside") : selection?.kind === "unassigned" ? t("basin.unassigned") : selected.nameTh}
                      </h3>
                      {selection?.kind === "outside" ? <p className="text-[11px] text-[var(--color-fg-muted)]">{t("basin.outside.note")}</p> : null}
                      {selection?.kind === "unassigned" ? <p className="text-[11px] text-[var(--color-fg-muted)]">{t("basin.unassigned.note")}</p> : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <ToneChip tone={summary.tone} t={t} />
                        <span className="text-xs font-semibold text-[var(--color-fg)]">
                          {summary.tone === "no-data"
                            ? t("basin.summary.headline.noData")
                            : summary.level5 + summary.level4 + summary.atBank + summary.nearBank > 0
                              ? t("basin.summary.headline.count", { n: summary.level5 + summary.level4 + summary.atBank + summary.nearBank })
                              : t("basin.summary.headline.none")}
                        </span>
                      </div>
                      {summary.level5 + summary.level4 > 0 ? (
                        <p className="text-[11px] text-[var(--color-fg-muted)]">
                          {t("basin.summary.byLevel", { l5: t("situation.5"), n5: summary.level5, l4: t("situation.4"), n4: summary.level4 })}
                        </p>
                      ) : null}
                      {summary.atBank + summary.nearBank > 0 ? (
                        <p className="text-[11px] text-[var(--color-fg-muted)]">
                          {t("basin.summary.byBank", { a: summary.atBank, km: BASIN_FREEBOARD_NEAR_M, b: summary.nearBank })}
                        </p>
                      ) : null}
                      <p className="text-[11px] text-[var(--color-fg-muted)]">
                        {t("basin.summary.counted", { counted: summary.counted, total: summary.stationCount, h: HOURS })}
                      </p>
                      {summary.stale > 0 ? <p className="text-[11px] text-[var(--color-risk-medium)]">{t("basin.summary.stale", { n: summary.stale, h: HOURS })}</p> : null}
                      {summary.undated > 0 ? <p className="text-[11px] text-[var(--color-risk-medium)]">{t("basin.summary.undated", { n: summary.undated })}</p> : null}
                      {summary.unclassified > 0 ? <p className="text-[11px] text-[var(--color-fg-muted)]">{t("basin.summary.unclassified", { n: summary.unclassified })}</p> : null}
                      <p className="text-[10px] text-[var(--color-fg-subtle)] tabular-nums">
                        {summary.latestObservedAt
                          ? t("basin.latest", { time: formatDateTime(lang, summary.latestObservedAt) })
                          : t("basin.latestNone")}
                      </p>
                    </div>

                    {provinces.length > 0 ? <ProvinceList rows={provinces} lang={lang} t={t} onFocus={onFocusStation} /> : null}

                    {ranked.length > 0 ? (
                      <section className="flex flex-col gap-1" data-basin-stations>
                        <h3 className="text-[11px] font-semibold text-[var(--color-fg)]">{t("basin.stations.title", { n: ranked.length })}</h3>
                        <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">{t("basin.stations.note")}</p>
                        <ul className={showAll ? "max-h-96 overflow-y-auto pr-0.5" : ""}>
                          {(showAll ? ranked : ranked.slice(0, STATIONS_COLLAPSED)).map((e) => (
                            <StationRow key={e.station.id} e={e} lang={lang} t={t} onFocus={onFocusStation} />
                          ))}
                        </ul>
                        {ranked.length > STATIONS_COLLAPSED ? (
                          <button
                            type="button"
                            onClick={() => setShowAll((v) => !v)}
                            className="min-h-11 w-fit cursor-pointer rounded-md px-2 text-[11px] text-[var(--color-accent)] hover:bg-white/5"
                          >
                            {showAll ? t("basin.stations.less") : t("basin.stations.more", { n: ranked.length })}
                          </button>
                        ) : null}
                      </section>
                    ) : null}

                    <section className="flex flex-col gap-1" data-basin-dams>
                      <h3 className="text-[11px] font-semibold text-[var(--color-fg)]">{t("basin.dams.title", { n: dams.length })}</h3>
                      {damsState === "never" ? (
                        <Note tone="warn">{t("basin.dams.never")}</Note>
                      ) : damsState === "stale" ? (
                        <Note tone="warn">{t("basin.dams.stale", { time: formatDateTime(lang, data.damsFetchedAt ?? ""), h: DAMS_HOURS })}</Note>
                      ) : (
                        <p className="text-[10px] text-[var(--color-fg-subtle)]">{t("basin.dams.fetched", { time: formatFetchedAt(lang, data.damsFetchedAt) })}</p>
                      )}
                      {dams.length > 0 ? (
                        <ul>
                          {dams.map((d) => (
                            <DamRow key={d.id} d={d} dim={damsState !== "ok"} lang={lang} t={t} />
                          ))}
                        </ul>
                      ) : damsState === "never" ? null : (
                        <p className="text-[11px] text-[var(--color-fg-muted)]">{t("basin.dams.none")}</p>
                      )}
                    </section>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-2 text-[11px] text-[var(--color-fg-muted)]">
          <Info size={13} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
          <span>{t("basin.note")}</span>
        </p>
      </div>
    </Panel>
  );
}
