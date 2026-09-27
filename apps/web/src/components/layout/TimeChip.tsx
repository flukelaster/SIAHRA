import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import type { RefObject } from "react";
import { useLang } from "../../i18n/context";
import { EPISTEMIC_BADGE } from "../../lib/layerFreshness";
import { formatDateTime, neverReceived } from "../../lib/time";
import { offersBackToLive, timeChipState, type TimeChipObservations, type TimeChipState } from "../../lib/timeChip";
import type { Lang, TFunction } from "../../i18n";

/**
 * ชิปเวลา (E18.4) — บอก "กำลังดูเวลาไหน" ในที่เดียว: TopBar (≥ tablet) / แถวใน peek ของแผ่นเลื่อน
 * (มือถือ แทนแถบเวลา dense เดิม) กดแล้วกาง `TimelineBar` ตัวเต็มเป็นแผงลอย (`TimelinePanel`)
 *
 * สถานะมาจาก props ล้วน ๆ ผ่าน `lib/timeChip.ts` — ไฟล์นี้ไม่ดึงข้อมูล ไม่เปิด socket และไม่ import
 * hook ของ `hooks/` (devops C3) การกดชิป/กางแผงไม่เปลี่ยน `atIso`/`forecastAtIso` (C6) — ตัวที่
 * เปลี่ยนได้มีแค่ปุ่ม "กลับไปเวลาปัจจุบัน" ข้างชิป ซึ่งเป็นการกระทำที่ผู้ใช้ตั้งใจ
 *
 * สามสถานะต้องแยกกันด้วยตาเปล่า:
 *   - live       — จุดเขียว + "ปัจจุบัน · {เวลาตรวจวัดล่าสุด}" (ไม่มีเวลา = บอกเหตุผล ไม่ใช่เวลาปัจจุบัน)
 *   - historical — ถ้อยคำ/สีเดียวกับป้าย "ดูย้อนหลัง" (`viewport.historical`, --color-risk-medium)
 *   - forecast   — ชิปสีของ `EPISTEMIC_BADGE.forecast` + "พยากรณ์ TMD · {validAt}" — แบบจำลองเชิงกำหนด
 *                  ของ TMD ไม่มีตัวเลขความน่าจะเป็นใด ๆ
 * ในสองสถานะหลัง ปุ่ม "กลับไปเวลาปัจจุบัน" คือทางออกที่มองเห็นได้เสมอ (แถบพยากรณ์อาจไม่อยู่บนจอ
 * เพราะอยู่ในมุมมองพยากรณ์ของหัวข้อฝนและพายุ)
 */
export function TimeChip({
  atIso,
  forecastAtIso,
  observations,
  expanded,
  panelId,
  onToggle,
  onClearAt,
  onClearForecast,
  chipRef,
  variant,
}: {
  atIso: string | null;
  forecastAtIso: string | null;
  observations: TimeChipObservations;
  /** แผงแถบเวลากางอยู่ */
  expanded: boolean;
  /** id ของแผงแถบเวลา — `aria-controls` ชี้ไปเฉพาะตอนที่แผง mount อยู่ */
  panelId: string;
  onToggle: () => void;
  onClearAt: () => void;
  onClearForecast: () => void;
  /** ปุ่มชิป — แผงคืนโฟกัสให้ตอนปิด */
  chipRef: RefObject<HTMLButtonElement | null>;
  /** `bar` = TopBar (ปุ่มกลับเป็นไอคอน, ข้อความเฉพาะจอกว้าง) · `sheet` = peek มือถือ (เต็มแถว) */
  variant: "bar" | "sheet";
}) {
  const { lang, t } = useLang();
  const state = timeChipState(atIso, forecastAtIso, observations);
  const parts = chipParts(state, lang, t);
  const label = `${parts.prefix}${parts.value}${parts.suffix}`;
  const tone = TONE[toneOf(state)];
  const sheet = variant === "sheet";
  const back = offersBackToLive(state);
  const forecastBadge = EPISTEMIC_BADGE.forecast;

  return (
    // TopBar: ไม่ยอมหด — ช่องค้นหาเป็นตัวที่หดแทน (ชิปที่ถูกตัดเหลือ "ปัจจุ…" บอกเวลาไม่ได้)
    <div className={`flex items-center gap-1 ${sheet ? "w-full min-w-0" : "shrink-0"}`}>
      <button
        ref={chipRef}
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        aria-label={expanded ? `${label} — ${t("timeChip.close")}` : t("timeChip.open", { label })}
        title={state.kind === "forecast" ? `${label} · ${t(forecastBadge.titleKey)}` : label}
        data-time-state={state.kind === "live" ? `live-${state.status}` : state.kind}
        className={`flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[11px] tabular-nums ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
          sheet ? "h-9 flex-1" : "h-8"
        } ${tone.chip}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
        {/* คำนำหน้ายอมถูกตัด (`truncate`) ส่วนค่า (เวลา) ห้ามหด — ข้อความเต็มอยู่ใน title/aria-label */}
        <span className="flex min-w-0 items-center whitespace-nowrap">
          <span className={sheet ? "min-w-0 truncate whitespace-pre leading-thai" : "whitespace-pre"}>{parts.prefix}</span>
          <span className="shrink-0">
            {parts.value}
            {parts.suffix}
          </span>
        </span>
        {expanded ? (
          <ChevronUp size={12} className="shrink-0 opacity-70" aria-hidden="true" />
        ) : (
          <ChevronDown size={12} className="shrink-0 opacity-70" aria-hidden="true" />
        )}
      </button>
      {back ? (
        <button
          type="button"
          onClick={() => {
            if (state.kind === "historical") onClearAt();
            else onClearForecast();
            // ปุ่มนี้หายไปเมื่อกลับเป็นค่าปัจจุบัน — ส่งโฟกัสให้ชิปแทนการปล่อยหล่นไปที่ body
            chipRef.current?.focus();
          }}
          aria-label={t("timeline.backToLive")}
          title={t("timeline.backToLive")}
          className={`flex shrink-0 cursor-pointer items-center justify-center gap-1 rounded-full text-[11px] whitespace-nowrap text-[var(--color-fg-muted)] ring-1 ring-white/15 ring-inset transition-colors hover:bg-white/8 hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
            sheet ? "h-9 px-2.5" : "h-8 w-8"
          }`}
        >
          <RotateCcw size={12} aria-hidden="true" />
          {sheet ? <span aria-hidden="true">{t("timeline.backToLive")}</span> : null}
        </button>
      ) : null}
    </div>
  );
}

type Tone = "live" | "liveUnknown" | "liveFailed" | "historical" | "forecast";

function toneOf(state: TimeChipState): Tone {
  if (state.kind !== "live") return state.kind;
  if (state.status === "time") return "live";
  return state.status === "failed" ? "liveFailed" : "liveUnknown";
}

const TONE: Record<Tone, { chip: string; dot: string }> = {
  live: {
    chip: "bg-white/5 text-[var(--color-success)] ring-[var(--color-success)]/35 hover:bg-white/8",
    dot: "bg-[var(--color-success)] shadow-[0_0_6px_rgba(34,197,94,0.9)]",
  },
  // ไม่มีเวลาตรวจวัดให้บอก — ไม่ใช้จุดเขียว (เขียว = มีค่าล่าสุดจริง)
  liveUnknown: {
    chip: "bg-white/5 text-[var(--color-fg-muted)] ring-white/15 hover:bg-white/8",
    dot: "bg-[var(--color-fg-subtle)]",
  },
  liveFailed: {
    chip: "bg-white/5 text-[var(--color-danger)] ring-[var(--color-danger)]/40 hover:bg-white/8",
    dot: "bg-[var(--color-danger)]",
  },
  // ชุดสีเดียวกับป้าย "ดูย้อนหลัง" ข้างชื่อจังหวัด (MapViewport) — อ่านเป็นค่าสดไม่ได้
  historical: {
    chip: "bg-[var(--color-risk-medium)]/20 text-[var(--color-risk-medium)] ring-[var(--color-risk-medium)]/50 hover:bg-[var(--color-risk-medium)]/25",
    dot: "bg-[var(--color-risk-medium)]",
  },
  // ชุดสีของชั้นพยากรณ์ทั้งระบบ (`EPISTEMIC_BADGE.forecast`) + ขอบเส้นประแบบเดียวกับรางของแถบพยากรณ์
  forecast: {
    chip: `${EPISTEMIC_BADGE.forecast.className} border border-dashed border-[var(--color-accent)]/60 hover:bg-[var(--color-accent)]/25`,
    dot: "bg-[#9dc0ff]",
  },
};

/**
 * ป้ายของชิปเป็นสามท่อน: คำนำหน้า ("ดูย้อนหลัง " / "Historical view ") · ค่า (เวลา หรือเหตุผลที่ไม่มีเวลา)
 * · คำตามหลัง (ถ้าภาษาใดวางค่าไว้กลางประโยค) — แยกเพื่อให้ชิปแคบ ๆ บนมือถือตัด **คำนำหน้า** ก่อน
 * เวลาต้องไม่ถูกตัด ("…17:…" อ่านเป็นเวลาไม่ได้) แยกด้วยตัวคั่นที่ไม่มีทางอยู่ในข้อความแปล
 * จึงไม่ขึ้นกับตำแหน่งของ `{time}` ในแต่ละภาษา
 */
const SPLIT = "\u0000";
function chipParts(state: TimeChipState, lang: Lang, t: TFunction): { prefix: string; value: string; suffix: string } {
  let template: string;
  let value: string;
  switch (state.kind) {
    case "historical":
      template = t("viewport.historical", { time: SPLIT });
      value = formatDateTime(lang, state.iso);
      break;
    case "forecast":
      template = t("forecast.chip.label", { time: SPLIT });
      value = formatDateTime(lang, state.iso);
      break;
    case "live":
      template = t("timeChip.live", { detail: SPLIT });
      value = liveDetail(state, lang, t);
      break;
  }
  const at = template.indexOf(SPLIT);
  if (at < 0) return { prefix: template, value: "", suffix: "" };
  return { prefix: template.slice(0, at), value, suffix: template.slice(at + SPLIT.length) };
}

function liveDetail(state: Extract<TimeChipState, { kind: "live" }>, lang: Lang, t: TFunction): string {
  switch (state.status) {
    case "time":
      return formatDateTime(lang, state.iso);
    case "loading":
      return t("common.loading");
    case "failed":
      return t("timeChip.failed");
    case "never":
      // fetchedAt: null — ไม่เคยดึงสำเร็จ ห้ามแสดงเป็นเวลาใด ๆ
      return neverReceived(lang);
    case "noObservationTime":
      return t("timeChip.noObservationTime");
  }
}
