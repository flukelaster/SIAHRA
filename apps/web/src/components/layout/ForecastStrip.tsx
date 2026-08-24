import { X } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { ForecastStep } from "@siahra/shared-types";
import type { ProvinceForecastState } from "../../hooks/useProvinceForecast";
import { EPISTEMIC_BADGE } from "../../lib/layerFreshness";
import { resolveError } from "../../lib/errorMessage";
import { formatDateTime } from "../../lib/time";
import { formatNumber } from "../../lib/number";
import { useLang } from "../../i18n/context";
import { useNow } from "../../hooks/useNow";

/** ค่าคงที่ตัวเดียว — กัน `batch?.hourly ?? []` สร้าง array ใหม่ทุกเรนเดอร์
 *  จนทำให้ `useMemo(..., [steps])` ด้านล่าง invalidate ทุกครั้งโดยไม่จำเป็น */
const EMPTY_STEPS: ForecastStep[] = [];

/**
 * เหมือน `isStale` ใน `ForecastCard.tsx` เป๊ะ — คัดลอกสั้น ๆ แทนการ export
 * (เหตุผลเดียวกับที่การ์ดนั้นเขียนไว้: ไม่คุ้มที่จะแก้ไฟล์นั้นเพื่อ export
 * ฟังก์ชันสี่บรรทัดออกมาใช้อีกที่หนึ่ง)
 */
function isStale(fetchedAt: string | null, staleAfterSeconds: number | undefined, nowMs: number): boolean {
  if (!fetchedAt) return true;
  if (!staleAfterSeconds) return false;
  const ms = Date.parse(fetchedAt);
  if (Number.isNaN(ms)) return false;
  return nowMs - ms > staleAfterSeconds * 1000;
}

/**
 * แถบเลื่อนดูพยากรณ์รายชั่วโมงของ TMD (E12.4a) — คู่กับ `TimelineBar.tsx` แต่
 * เลื่อน "ไปข้างหน้า" ผ่านขั้นพยากรณ์ ไม่ใช่ย้อนหลังผ่านค่าตรวจวัดจริง
 *
 * งานนี้คือ state + UI เท่านั้น: การเลือกขั้นที่นี่ไม่มีผลต่อแผนที่ 3 มิติเลย
 * (นั่นเป็นงานแยกต่างหากที่ยังไม่ได้ตัดสินใจเรื่องการออกแบบ) จึงไม่มี prop ไหน
 * เชื่อมไปยัง scene/**
 *
 * ภาษาภาพ: ใช้โทเคนสีเดียวกับ `EPISTEMIC_BADGE.forecast` (`--color-accent` /
 * `#9dc0ff`) เพราะเป็นสีที่ผูกกับ "ชั้นพยากรณ์" อยู่แล้วทั้งระบบ — สิ่งที่ทำให้
 * แถบนี้ไม่ถูกอ่านว่าเป็นส่วนต่อของ `TimelineBar` (ซึ่งพื้นทึบเหมือนกัน) คือ
 * "ลาย" ไม่ใช่ "สี": รางเป็นลายเส้นทแยงกับกรอบเส้นประตลอดทั้งแถบ (ดู index.css
 * `.range-slider-forecast`) ตามภาษาเดียวกับที่ `lib/illustrativeStyle.ts` ใช้
 * แยกชั้น "คำนวณ/แบบจำลอง" ออกจากชั้น "ตรวจวัดจริง" ด้วยลายเส้นแทนสี
 *
 * ไม่มีการไล่สีตามระดับปริมาณฝนเลย (ต่างจาก sparkline ของระดับน้ำ) — ไม่มีเกณฑ์
 * ที่ต้นทางรับรองสำหรับฝนรายชั่วโมง มีแต่เกณฑ์ 24 ชม.ที่อ้างอิง TMD ได้ (ดู
 * `apps/api/src/exposure/compute.ts` บรรทัด ~68-84) ตัวเลขที่นี่จึงแสดงดิบ ๆ
 */
export function ForecastStrip({
  state,
  forecastAtIso,
  onChange,
  variant = "full",
}: {
  state: ProvinceForecastState;
  /** ขั้นที่กำลังเลือกอยู่ (ตรงกับ `validAt` ของขั้นใดขั้นหนึ่ง) หรือ null = ยังไม่เลือก */
  forecastAtIso: string | null;
  onChange: (forecastAtIso: string | null) => void;
  /**
   * `full` = แถบเดิมพร้อมขีดเวลาและค่า ฝน/อุณหภูมิ/รหัสสภาพอากาศ (dock บนมือถือ)
   * `dense` = บรรทัดเดียวสำหรับ dock ล่างบนจอกว้าง: ล้าง · ป้ายชนิดความรู้ · หมายเหตุ
   *           ค้าง/ข้อผิดพลาด · slider · เวลาที่เลือก + ค่าฝน (อุณหภูมิ/รหัสอยู่ในแผง TMD)
   */
  variant?: "full" | "dense";
}) {
  const { lang, t } = useLang();
  const nowMs = useNow();
  const { data, loading, error } = state;
  const batch = data?.batch ?? null;
  const steps = batch?.hourly ?? EMPTY_STEPS;
  const n = steps.length;
  const hourlyDescriptor = data?.layers.hourly ?? null;
  const stale = hourlyDescriptor
    ? isStale(hourlyDescriptor.fetchedAt, hourlyDescriptor.staleAfterSeconds, nowMs)
    : false;
  const badge = EPISTEMIC_BADGE.forecast;

  const selectedIndex = useMemo(() => {
    if (!forecastAtIso) return -1;
    return steps.findIndex((s) => s.validAt === forecastAtIso);
  }, [forecastAtIso, steps]);
  const selected = selectedIndex >= 0 ? steps[selectedIndex] : null;

  // ขั้นเดียว (n===1): min===max บน <input type="range"> ทำให้ลากหรือกดลูกศร
  // ไม่ยิง onChange เลย — ขั้นนั้นเลยกลายเป็นเลือกไม่ได้ทั้งที่มีข้อมูลจริงอยู่
  // เลือกให้อัตโนมัติแทนการรอผู้ใช้ลากตัวควบคุมที่ลากไม่ได้จริง ๆ
  useEffect(() => {
    if (n === 1 && forecastAtIso !== steps[0].validAt) onChange(steps[0].validAt);
  }, [n, steps, forecastAtIso, onChange]);

  // จุดกำกับบนราง: ไม่เกิน 5 จุด กระจายตามจำนวนขั้นจริง (ต้นทางอาจส่งมาสั้นกว่า
  // 48 ชม. เสมอ ห้าม hard-code จำนวนขั้น) — ป้ายเป็นชั่วโมงที่ห่างจากขั้นแรก
  // ไม่ใช่ "ตอนนี้" เพราะขั้นแรกที่ TMD ส่งมาอาจไม่ตรงกับเวลาปัจจุบันเป๊ะ
  const tickIdxs = useMemo(() => {
    if (n === 0) return [];
    const count = Math.min(5, n);
    const idxs = new Set<number>();
    for (let i = 0; i < count; i++) idxs.add(Math.round((i * (n - 1)) / Math.max(1, count - 1)));
    return [...idxs].sort((a, b) => a - b);
  }, [n]);

  // ไม่มีขั้นให้เลื่อนเลย: แสดงเป็นสถานะปิด/หรี่ที่มองเห็นได้ ไม่ใช่ตัวควบคุมที่
  // กดได้แต่ไม่มีอะไรให้เลื่อน — แยกข้อความตามข้อเท็จจริงที่ต่างกันสามแบบ (ลอก
  // ตรรกะเดียวกับ ForecastCard.tsx): คำขอของเราเองล้มเหลว / กำลังโหลด / backend
  // ตอบสำเร็จแต่ไม่เคยดึงจาก TMD สำเร็จเลย / TMD ส่งขั้นรายชั่วโมงมาว่างเปล่า
  if (n === 0) {
    const message =
      error && !data
        ? resolveError(t, error)
        : loading && !data
          ? t("common.loading")
          : data && !batch
            ? t("forecast.none")
            : t("forecast.strip.noSteps");
    return (
      <div className="glass flex items-center gap-3 rounded-2xl py-2 pr-4 pl-2.5 opacity-50">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none ring-1 ring-inset ${badge.className}`}
          title={t(badge.titleKey)}
        >
          {t(badge.labelKey)}
        </span>
        <p className="min-w-0 flex-1 truncate text-xs text-[var(--color-fg-subtle)]">{message}</p>
      </div>
    );
  }

  const progress = selected ? (selectedIndex / Math.max(1, n - 1)) * 100 : 0;

  if (variant === "dense") {
    // ค่าดิบของขั้นที่เลือก — กติกาเดียวกับแบบเต็ม: null ต้องขึ้นข้อความว่า TMD
    // ไม่ได้ส่งค่านี้มา ห้ามเว้นว่างหรือแสดงเป็น 0 เงียบ ๆ
    const rainText = selected
      ? selected.rainMm !== null
        ? `${formatNumber(lang, selected.rainMm, 1)} ${t("forecast.hourly.unit")}`
        : t("forecast.strip.notSent")
      : null;
    return (
      <div
        className={`glass flex h-10 min-w-0 items-center gap-2 overflow-hidden rounded-2xl py-1 pr-3 pl-1.5 ${stale ? "opacity-60" : ""}`}
        title={t("forecast.headerCount", { n })}
      >
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={!selected}
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--color-fg-muted)] transition-colors hover:bg-white/8 hover:text-white disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
          aria-label={t("forecast.strip.clear")}
          title={t("forecast.strip.clear")}
        >
          <X size={13} />
        </button>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none ring-1 ring-inset ${badge.className}`}
          title={t(badge.titleKey)}
        >
          {t(badge.labelKey)}
        </span>
        {/* หมายเหตุค้าง/ข้อผิดพลาดย่อได้ (ข้อความเต็มอยู่ใน title) — ห้ามล้นออกนอกกล่อง */}
        {error ? (
          <span className="min-w-0 truncate text-[10px] text-[var(--color-danger)]" title={resolveError(t, error) ?? undefined}>
            {resolveError(t, error)}
          </span>
        ) : stale ? (
          <span
            className="min-w-0 truncate rounded-md bg-[var(--color-risk-medium)]/15 px-1.5 py-0.5 text-[10px] leading-none text-[var(--color-risk-medium)]"
            title={t("forecast.staleNote")}
          >
            {t("forecast.staleNote")}
          </span>
        ) : null}
        <input
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={selected ? selectedIndex : 0}
          onChange={(e) => onChange(steps[Number(e.target.value)].validAt)}
          aria-label={t("forecast.strip.slider")}
          aria-valuetext={selected ? formatDateTime(lang, selected.validAt) : t("forecast.strip.notSelected")}
          className="range-slider-forecast min-w-16 flex-1"
          style={{ "--range-progress": `${progress}%` } as React.CSSProperties}
        />
        <span
          className="min-w-0 truncate text-[11px] tabular-nums text-[#9dc0ff]"
          title={selected ? formatDateTime(lang, selected.validAt) : t("forecast.strip.notSelected")}
        >
          {selected ? formatDateTime(lang, selected.validAt) : t("forecast.strip.notSelected")}
        </span>
        {rainText !== null ? (
          <span className="shrink-0 text-[11px] whitespace-nowrap tabular-nums text-[var(--color-fg)]">
            <span className="text-[var(--color-fg-subtle)]">{t("forecast.strip.rain")} </span>
            {rainText}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`glass flex items-center gap-3 rounded-2xl py-2 pr-4 pl-2.5 ${stale ? "opacity-60" : ""}`}>
      <button
        type="button"
        onClick={() => onChange(null)}
        disabled={!selected}
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--color-fg-muted)] transition-colors hover:bg-white/8 hover:text-white disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
        aria-label={t("forecast.strip.clear")}
        title={t("forecast.strip.clear")}
      >
        <X size={15} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none ring-1 ring-inset ${badge.className}`}
              title={t(badge.titleKey)}
            >
              {t(badge.labelKey)}
            </span>
            <span className="hidden truncate text-[11px] text-[var(--color-fg-subtle)] @2xl:inline">
              {t("forecast.headerCount", { n })}
            </span>
            {error ? (
              <span className="shrink-0 truncate text-[10px] text-[var(--color-danger)]">
                {resolveError(t, error)}
              </span>
            ) : stale ? (
              <span className="shrink-0 rounded-md bg-[var(--color-risk-medium)]/15 px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap text-[var(--color-risk-medium)]">
                {t("forecast.staleNote")}
              </span>
            ) : null}
          </div>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums text-[#9dc0ff]">
            {selected ? formatDateTime(lang, selected.validAt) : t("forecast.strip.notSelected")}
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={selected ? selectedIndex : 0}
          onChange={(e) => onChange(steps[Number(e.target.value)].validAt)}
          aria-label={t("forecast.strip.slider")}
          aria-valuetext={selected ? formatDateTime(lang, selected.validAt) : t("forecast.strip.notSelected")}
          className="range-slider-forecast mt-2 w-full"
          style={{ "--range-progress": `${progress}%` } as React.CSSProperties}
        />

        {/* จุดกำกับวางตามตำแหน่งจริงบนราง เหมือน TimelineBar ไม่ใช่กระจายเท่า ๆ กัน */}
        <div className="relative mt-0.5 h-3.5 text-[10px] leading-none text-[var(--color-fg-subtle)]">
          {tickIdxs.map((idx, i) => {
            const pct = n <= 1 ? 0 : (idx / (n - 1)) * 100;
            const hoursAhead = Math.round((Date.parse(steps[idx].validAt) - Date.parse(steps[0].validAt)) / 3600000);
            const last = i === tickIdxs.length - 1;
            return (
              <span
                key={idx}
                className="absolute top-0 whitespace-nowrap tabular-nums"
                style={{
                  left: `${pct}%`,
                  transform: i === 0 ? "none" : last ? "translateX(-100%)" : "translateX(-50%)",
                }}
              >
                {t("forecast.strip.tickHours", { n: hoursAhead })}
              </span>
            );
          })}
        </div>

        {/* ค่าดิบของขั้นที่เลือก — ห้ามไล่สีตามแบนด์ปริมาณฝน (ไม่มีเกณฑ์ทางการ
            สำหรับความละเอียดรายชั่วโมง) และ null ต้องขึ้นข้อความชัดเจนว่า TMD
            ไม่ได้ส่งค่านี้มา ห้ามเว้นว่างหรือแสดงเป็น 0 เงียบ ๆ */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-fg)]">
          {selected ? (
            <>
              <span>
                <span className="text-[var(--color-fg-subtle)]">{t("forecast.strip.rain")} </span>
                {selected.rainMm !== null
                  ? `${formatNumber(lang, selected.rainMm, 1)} ${t("forecast.hourly.unit")}`
                  : t("forecast.strip.notSent")}
              </span>
              <span>
                <span className="text-[var(--color-fg-subtle)]">{t("forecast.strip.temp")} </span>
                {selected.tempC !== null ? `${formatNumber(lang, selected.tempC, 1)}°C` : t("forecast.strip.notSent")}
              </span>
              <span>
                <span className="text-[var(--color-fg-subtle)]">{t("forecast.strip.cond")} </span>
                {selected.cond !== null ? String(selected.cond) : t("forecast.strip.notSent")}
              </span>
            </>
          ) : (
            <span className="text-[var(--color-fg-subtle)]">{t("forecast.strip.prompt")}</span>
          )}
        </div>
      </div>
    </div>
  );
}
