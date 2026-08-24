import { CloudSun } from "lucide-react";
import type { ForecastStep, HealthResponse } from "@siahra/shared-types";
import type { ProvinceForecastState } from "../../hooks/useProvinceForecast";
import { worstHealth } from "../../hooks/useLayerDescriptors";
import { Panel } from "../ui/Panel";
import { FreshnessMeta } from "../ui/FreshnessMeta";
import { formatNumber } from "../../lib/number";
import { formatDateTime, formatTime, formatWeekday } from "../../lib/time";
import { useLang } from "../../i18n/context";
import type { Lang, TFunction } from "../../i18n";
import { resolveError } from "../../lib/errorMessage";
import { useNow } from "../../hooks/useNow";

/**
 * เส้น/พื้นที่ปริมาณฝนรายชั่วโมง (ไม่ใช่ `Sparkline.tsx` — ตัวนั้นผูกตายกับรูปร่าง
 * `WaterLevelHistoryPoint` และเส้นตลิ่งอ้างอิงของระดับน้ำ ไม่เข้ากับ `ForecastStep`)
 * `rainMm: null` (ต้นทางไม่ได้ส่งค่า) ถูกวาดเป็น "ช่องว่าง" ในเส้น ไม่ใช่ลากผ่าน 0 —
 * การลากผ่านจะทำให้ "ไม่มีค่า" อ่านเหมือน "ฝน 0 มม." ซึ่งเป็นคนละข้อเท็จจริง
 */
function HourlyRainChart({ steps, lang, t }: { steps: ForecastStep[]; lang: Lang; t: TFunction }) {
  const width = 300;
  const pad = 4;
  // แถบบน (ป้ายค่าสูงสุด) กับแถบล่าง (ป้ายเวลาเริ่ม/จบ) กันพื้นที่ของตัวเองไว้
  // แยกจากพื้นที่วาดเส้น — ไม่งั้นข้อความจะทับเส้นฐาน (baseline) พอดี อ่านไม่ออก
  const topMargin = 14;
  const bottomMargin = 12;
  const plotHeight = 34;
  const height = topMargin + plotHeight + bottomMargin;
  const values = steps.map((s) => s.rainMm).filter((v): v is number => v !== null);
  if (values.length === 0) {
    return <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("forecast.hourly.none")}</p>;
  }
  const times = steps.map((s) => Date.parse(s.validAt));
  const t0 = times[0];
  const t1 = times[times.length - 1];
  const max = Math.max(0.5, ...values);
  const x = (ms: number) => pad + ((ms - t0) / Math.max(1, t1 - t0)) * (width - pad * 2);
  const y = (v: number) => topMargin + plotHeight - (v / max) * plotHeight;

  // ตัดเส้นเป็นช่วง ๆ ที่จุดซึ่ง rainMm เป็น null แทนที่จะลากผ่านเป็นเส้นเดียว
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  steps.forEach((s, i) => {
    if (s.rainMm === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: x(times[i]), y: y(s.rainMm) });
  });
  if (current.length > 0) segments.push(current);

  const baseline = topMargin + plotHeight;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} role="img" aria-label={t("forecast.hourly.chartAria")}>
      {segments.map((seg, i) =>
        seg.length > 1 ? (
          <g key={i}>
            <path
              d={`${seg.map((p, j) => `${j === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} L${seg[
                seg.length - 1
              ].x.toFixed(1)},${baseline} L${seg[0].x.toFixed(1)},${baseline} Z`}
              fill="#38bdf8"
              fillOpacity={0.18}
              stroke="none"
            />
            <path
              d={seg.map((p, j) => `${j === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
              fill="none"
              stroke="#38bdf8"
              strokeWidth={1.6}
            />
          </g>
        ) : (
          <circle key={i} cx={seg[0].x} cy={seg[0].y} r={1.5} fill="#38bdf8" />
        ),
      )}
      <text x={pad} y={10} fontSize={9} fill="#94a3b8">
        {formatNumber(lang, max, 1)} {t("forecast.hourly.unit")}
      </text>
      {/* จุดเริ่ม/จุดจบของแกนเวลา — ไม่งั้นเส้นนี้บอกได้แค่ "ปริมาณฝนสูงสุดเท่าไร"
          ไม่บอกว่า "พีคนั้นอยู่ที่เวลาไหน" ซึ่งเป็นข้อมูลหลักของกราฟพยากรณ์รายชั่วโมง */}
      <text x={pad} y={height - 2} fontSize={9} fill="#64748b">
        {formatTime(lang, steps[0].validAt)}
      </text>
      <text x={width - pad} y={height - 2} fontSize={9} fill="#64748b" textAnchor="end">
        {formatTime(lang, steps[steps.length - 1].validAt)}
      </text>
    </svg>
  );
}

/** แท่งฝนรายวัน 7 วัน — ความละเอียดต่ำพอที่แท่งอ่านง่ายกว่าเส้น (ตามที่ระบุใน task) */
function DailyRainBars({ steps, lang, t }: { steps: ForecastStep[]; lang: Lang; t: TFunction }) {
  const values = steps.map((s) => s.rainMm).filter((v): v is number => v !== null);
  if (values.length === 0) {
    return <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("forecast.daily.none")}</p>;
  }
  const max = Math.max(0.5, ...values);
  return (
    <div className="flex flex-col gap-1">
      {/* แต่ละแท่งต้อง `h-full` ชัดเจน ไม่ใช่พึ่ง `items-end` เฉย ๆ — ความสูงเป็น %
          ของลูกในนั้นคำนวณจากกล่องที่มีความสูงจริงเท่านั้น ถ้าปล่อยให้ align มา
          กำหนดความสูงของ wrapper (auto/content-based) เปอร์เซ็นต์จะไม่มีฐานอ้างอิง
          แล้วเรนเดอร์เป็น 0 เงียบ ๆ (บั๊กที่เจอจากการเช็คภาพจริง) */}
      <div className="flex h-14 gap-1">
        {steps.map((s, i) => {
          const v = s.rainMm;
          // `v === null` (ต้นทางไม่ได้ส่งค่า) ต้องแยกออกจาก `v === 0` (ฝน 0 มม. จริง)
          // ได้โดยไม่ต้องชี้เมาส์ค้าง — พื้นสูง 3% พอสำหรับแท่งจริงที่ค่าน้อยมาก แต่
          // เส้นประของ null ที่สูงเท่ากันจะแนบชิดเส้นฐานจนเกือบมองไม่เห็นลาย ประ
          // (สังเกตได้จาก QA รอบแรก) จึงให้พื้นของ null สูงกว่า (10%) เพื่อให้ลาย
          // เส้นประลอยพ้นเส้นฐานชัดเจน ไม่ต้องพึ่งสีต่างเพียงอย่างเดียวในการแยกสองค่านี้
          const pct = v === null ? 10 : Math.max(3, (v / max) * 100);
          return (
            <div
              key={i}
              className="flex h-full flex-1 flex-col justify-end"
              title={`${formatDateTime(lang, s.validAt)} · ${
                v === null ? t("forecast.daily.none") : `${formatNumber(lang, v, 1)} ${t("forecast.daily.unit")}`
              }`}
            >
              <div
                className={`w-full rounded-t ${v === null ? "border-t border-dashed border-white/25 bg-transparent" : "bg-[var(--color-accent)]/70"}`}
                style={{ height: `${pct}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1">
        {steps.map((s, i) => (
          <span key={i} className="flex-1 text-center text-[9px] text-[var(--color-fg-subtle)]">
            {formatWeekday(lang, s.validAt)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** ข้อมูลนานเกิน `staleAfterSeconds` = ยังแสดงตัวเลขเดิมอยู่ แต่หรี่ลง (AGENTS.md:
 *  ห้ามซ่อนข้อมูลเก่า) — ลอกตรรกะเดียวกับ `isStale` ใน `lib/layerFreshness.ts`
 *  (ไม่ได้ export จากที่นั่น จึงเขียนซ้ำสั้น ๆ ที่นี่แทนการแก้ไฟล์นั้นเพื่อ export
 *  ฟังก์ชันสี่บรรทัดออกมาใช้ที่เดียว) */
function isStale(fetchedAt: string | null, staleAfterSeconds: number | undefined, nowMs: number): boolean {
  if (!fetchedAt) return true;
  if (!staleAfterSeconds) return false;
  const ms = Date.parse(fetchedAt);
  if (Number.isNaN(ms)) return false;
  return nowMs - ms > staleAfterSeconds * 1000;
}

/**
 * พยากรณ์ตัวเลขเชิงเวลา (NWP) ของ TMD สำหรับจังหวัดที่เลือกอยู่ — E12.3
 *
 * การ์ดนี้ไม่แตะ `useLayerDescriptors.ts`/`MapLegend.tsx` (เหมือน
 * `ImpactSummaryCard.tsx`): ไม่มีชั้นบนแผนที่ 3 มิติให้ผูก descriptor ด้วย
 * `hourly`/`daily` ใช้แหล่งข้อมูลเดียวกัน (`sourceIds: ["tmd-nwp"]`) และดึงมาพร้อม
 * กันในคำขอเดียว จึงมีเวลาเดียวกันเป๊ะ — แสดง `FreshnessMeta` ครั้งเดียวที่หัวการ์ด
 * พอ ไม่ต้องซ้ำสองรอบต่อหนึ่งชุดข้อมูล
 */
export function ForecastCard({ state, health }: { state: ProvinceForecastState; health: HealthResponse | null }) {
  const { lang, t } = useLang();
  const nowMs = useNow();
  const { data, loading, error } = state;
  const batch = data?.batch ?? null;
  const hourlyDescriptor = data?.layers.hourly ?? null;
  // `hourly`/`daily` ผูกกับแหล่งข้อมูลเดียวกัน (`tmd-nwp`) — ใช้ผลจาก descriptor
  // ตัวใดตัวหนึ่งได้เท่ากัน (ดูหมายเหตุเหนือคอมโพเนนต์)
  const layerHealth = hourlyDescriptor ? worstHealth(hourlyDescriptor.sourceIds, health) : null;
  const stale = hourlyDescriptor ? isStale(hourlyDescriptor.fetchedAt, hourlyDescriptor.staleAfterSeconds, nowMs) : false;

  return (
    <Panel
      title={t("forecast.title")}
      icon={<CloudSun size={16} className="text-[var(--color-accent)]" aria-hidden="true" />}
      headerAction={
        <span className="text-[11px] text-[var(--color-fg-muted)]">
          {loading && !data ? t("common.loading") : batch ? t("forecast.headerCount", { n: batch.hourly.length }) : null}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {hourlyDescriptor ? <FreshnessMeta descriptor={hourlyDescriptor} health={layerHealth} /> : null}

        {error ? (
          <p className="rounded-lg bg-[var(--color-danger)]/10 px-2.5 py-2 text-xs text-[var(--color-danger)]">
            {resolveError(t, error)}
          </p>
        ) : null}

        {loading && !data ? (
          <div className="flex flex-col gap-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-white/8" />
            <div className="h-14 animate-pulse rounded bg-white/8" />
            <div className="h-14 animate-pulse rounded bg-white/8" />
          </div>
        ) : data && !batch ? (
          // `data` มาแล้ว (คำขอสำเร็จ 200) แต่ `batch` เป็น null = backend เอง
          // ยังไม่เคยดึงจาก TMD สำเร็จเลย — ข้อความนี้พูดถึง "TMD" ได้เพราะเรา
          // "ถามแล้วจริง ๆ" และได้คำตอบว่ายังไม่มี ต่างจากกรณี `!data` ด้านล่าง
          // ที่คำขอของฝั่งเว็บเองไปไม่ถึง จึงไม่มีสิทธิ์พูดถึงสถานะของ TMD เลย
          // (AGENTS.md: "เราถามไม่ได้" ≠ "ต้นทางเงียบ" — สอง fact คนละเรื่องกัน)
          <p className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-3 text-center text-xs text-[var(--color-fg-muted)]">
            {t("forecast.none")}
          </p>
        ) : !batch ? (
          // ไม่มีทั้ง `data` และไม่ได้กำลังโหลด — คำขอของเราเองล้มเหลว (`error`
          // ด้านบนพูดข้อเท็จจริงเดียวที่เรามีแล้ว) ไม่มีอะไรให้พูดเพิ่มเกี่ยวกับ TMD
          null
        ) : (
          <>
            {stale ? (
              <p className="rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-2 text-xs text-[var(--color-risk-medium)]">
                {t("forecast.staleNote")}
              </p>
            ) : null}

            <div className={`flex flex-col gap-3 ${stale ? "opacity-60" : ""}`}>
              <section className="flex flex-col gap-1.5">
                <p className="text-[11px] font-semibold text-[var(--color-fg-muted)]">{t("forecast.hourly.title")}</p>
                <HourlyRainChart steps={batch.hourly} lang={lang} t={t} />
              </section>

              <section className="flex flex-col gap-1.5">
                <p className="text-[11px] font-semibold text-[var(--color-fg-muted)]">{t("forecast.daily.title")}</p>
                <DailyRainBars steps={batch.daily} lang={lang} t={t} />
              </section>
            </div>
          </>
        )}

        <p className="text-[10px] text-[var(--color-fg-subtle)]">{t("forecast.note")}</p>
      </div>
    </Panel>
  );
}
