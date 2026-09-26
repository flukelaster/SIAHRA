import { useMemo } from "react";
import { Info, Satellite } from "lucide-react";
import type { FloodExtentState } from "../../hooks/useFloodExtent";
import { Panel } from "../ui/Panel";
import { formatNumber } from "../../lib/number";
import { neverReceived, formatAge, formatDateTime } from "../../lib/time";
import { useLang } from "../../i18n/context";
import { resolveError } from "../../lib/errorMessage";
import { gistdaExtentState, groupByTambon, m2ToRai, responseAcquisitions, sensorLabel } from "../../lib/gistdaFlood";

/** ชิปหัวการ์ด: "ค่าย้อนหลัง" เมื่อเลือกเวลาเอง ไม่งั้น "สังเกตการณ์จริง" — ใช้ร่วมกับ FloodScenesCard */
export function FloodObservedChip({ historical }: { historical: boolean }) {
  const { t } = useLang();
  return historical ? (
    // ป้ายเดียวกับ WaterLevelCard ตอนดูย้อนหลัง — ของที่เห็นคือฉากที่ครอบเวลานั้น ไม่ใช่ล่าสุด
    <span className="shrink-0 text-[10px] text-[var(--color-fg-subtle)]">{t("water.historicalChip")}</span>
  ) : (
    <span className="rounded bg-[var(--color-success)]/15 px-1.5 text-[10px] text-[var(--color-success)]">
      {t("flood.observedChip")}
    </span>
  );
}

/**
 * เนื้อการ์ด GISTDA (ไม่มีกรอบ Panel) — E14.F5 ฝังไว้เป็นส่วนล่างของ `FloodScenesCard`
 * ตรรกะทั้งหมดอยู่ที่นี่ที่เดียว `FloodExtentCard` ด้านล่างเป็นแค่กรอบ
 *
 * E16.PR0: ต้นทางส่งเป็นเซลล์ H3 (~0.1 ตร.กม.) พร้อมภาพดาวเทียมที่ใช้ต่อเซลล์ — การ์ดจึง
 * รวมเป็นรายตำบล และแสดงเวลาภาพจริงของจังหวัดนี้ (ไม่ใช่แค่เวลาที่เราดึง)
 */
export function FloodExtentBody({ state, atIso = null }: { state: FloodExtentState; atIso?: string | null }) {
  const { lang, t } = useLang();
  const { data, loading, error } = state;
  const historical = atIso !== null;
  const rawFeatures = data?.features;
  const features = useMemo(() => rawFeatures ?? [], [rawFeatures]);
  const extentState = gistdaExtentState(data);
  const legacy = data?.granularity === "tambon";
  const totalM2 = features.reduce((a, f) => a + (f.properties.floodAreaM2 ?? 0), 0);
  const tambons = useMemo(() => groupByTambon(features), [features]);
  const acquisitions = responseAcquisitions(data);
  const cellCount = data?.matched ?? features.length;
  // firstSeenAt เป็น null เมื่อฉากมาจาก WFS เดิม (archive ไม่ได้บันทึก) — ข้ามไป
  const earliest = tambons.reduce<string | null>(
    (acc, g) => (g.firstSeenAt !== null && (acc === null || g.firstSeenAt < acc) ? g.firstSeenAt : acc),
    null,
  );

  return (
    <div className="flex flex-col gap-3">
      {historical && data?.retrievedAt ? (
        <p className="rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-2 text-xs text-[var(--color-risk-medium)]">
          {t("flood.historicalScene", { time: formatDateTime(lang, data.retrievedAt) })}
          {legacy ? ` ${t("flood.legacyScene")}` : ""}
        </p>
      ) : null}
      {loading && !data ? (
        <div className="h-10 animate-pulse rounded bg-white/8" />
      ) : error && !data ? (
        <p className="rounded-lg bg-[var(--color-danger)]/10 px-2.5 py-2 text-xs text-[var(--color-danger)]">
          {t("flood.loadError", { error: resolveError(t, error) ?? "" })}
        </p>
      ) : extentState === "no-archived-scene" ? (
        // ย้อนหลังไปก่อนที่ระบบเริ่มเก็บฉาก — ไม่มีการสังเกต ณ เวลานั้น ห้ามอ่านเป็น "ไม่ท่วม"
        <p className="rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-3 text-center text-xs text-[var(--color-risk-medium)]">
          {t("flood.noArchivedScene", { time: atIso ? formatDateTime(lang, atIso) : "" })}
        </p>
      ) : extentState === "never-fetched" ? (
        // ยังไม่มี retrievedAt = ยังดึงรอบแรกไม่สำเร็จ "หรือกำลังดึงอยู่" จึงยังฟันธงไม่ได้ว่า
        // ต้นทางล่ม (แถบสถานะด้านล่างเป็นตัวบอก) แต่ต้องไม่ให้ช่องว่างถูกอ่านว่า "ปลอดภัย"
        <p className="rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-3 text-center text-xs text-[var(--color-risk-medium)]">
          {t("flood.noScene")}
        </p>
      ) : extentState === "none-detected" ? (
        // ต้นทางถูกถามจริงและตอบว่า 0 เซลล์ — พูดตามนั้น ไม่ใช่ "ไม่มีน้ำท่วม"
        <p className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-3 text-center text-xs text-[var(--color-fg-muted)]">
          {/* อายุของการดึงอยู่ในหมายเหตุด้านล่างแล้ว (แสดงทุกสถานะ) — ไม่ย้ำซ้ำตรงนี้ */}
          {historical ? t("flood.noneHistorical") : t("flood.noneDetected")}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-[11px] text-[var(--color-fg-muted)]">
                {legacy ? t("flood.tambonCount") : t("flood.cellCount")}
              </p>
              <p className="text-xl font-bold tabular-nums text-[var(--color-fg)]">
                {formatNumber(lang, legacy ? features.length : cellCount)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[var(--color-fg-muted)]">{t("flood.areaRai")}</p>
              <p className="text-xl font-bold tabular-nums text-[#4d94b8]">
                {formatNumber(lang, Math.round(m2ToRai(totalM2)))}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[var(--color-fg-muted)]">{t("flood.tambonCount")}</p>
              <p className="text-xl font-bold tabular-nums text-[var(--color-fg)]">
                {formatNumber(lang, tambons.length)}
              </p>
            </div>
          </div>
          {legacy ? null : (
            <div className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-2">
              <p className="text-[11px] text-[var(--color-fg-muted)]">{t("flood.acquisitions")}</p>
              {acquisitions.length === 0 ? (
                <p className="text-xs text-[var(--color-fg-subtle)]">{t("flood.acquisitionsNone")}</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {acquisitions.map((a) => (
                    <li
                      key={`${a.sensor}|${a.acquiredAt}`}
                      className="flex justify-between gap-2 text-xs tabular-nums text-[var(--color-fg)]"
                    >
                      <span>{sensorLabel(a.sensor)}</span>
                      <span className="text-[var(--color-fg-muted)]">{formatDateTime(lang, a.acquiredAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <ul className="max-h-48 overflow-y-auto pr-0.5">
            {tambons.slice(0, 20).map((g) => (
              <li
                key={g.key}
                className="flex items-center gap-2 border-t border-white/8 py-1.5 first:border-t-0"
              >
                <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-[#4d94b8]">
                  {formatNumber(lang, Math.round(m2ToRai(g.areaM2)))}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-[var(--color-fg)]">
                    {g.tambonTh ?? t("flood.unknownTambon")}
                  </p>
                  <p className="truncate text-[11px] text-[var(--color-fg-subtle)]">
                    {g.amphoeTh ?? ""}
                    {legacy ? "" : ` · ${t("flood.tambonCells", { n: formatNumber(lang, g.cells) })}`}
                    {g.observedAt !== null
                      ? ` · ${t("flood.imageTime", { time: formatDateTime(lang, g.observedAt) })}`
                      : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-2 text-[11px] text-[var(--color-fg-muted)]">
        <Info size={13} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
        <span>
          {t("flood.note")}
          {/* retrievedAt = null คือยังไม่เคยดึงสำเร็จ (หรือไม่มีฉากที่เก็บไว้ ณ เวลานั้น) ห้ามแสดงเป็นเวลาใด ๆ */}
          {/* ย้อนหลังแล้วไม่มีฉาก: กล่องด้านบนอธิบายแล้ว ไม่ต้องย้ำ "ยังไม่เคยได้รับ" ซึ่งฟังเหมือนพูดถึงทั้งระบบ */}
          {data?.retrievedAt
            ? ` (${historical ? formatDateTime(lang, data.retrievedAt) : formatAge(lang, data.retrievedAt)})`
            : historical
              ? ""
              : ` (${neverReceived(lang)})`}
          {earliest ? t("flood.noteEarliest", { time: formatDateTime(lang, earliest) }) : ""}
        </span>
      </p>
    </div>
  );
}

/**
 * Satellite-observed flood extent for the selected province. Everything shown
 * is what GISTDA's latest interpreted imagery contains — with the acquisition
 * time of each satellite image, when *we* fetched it, and when our system
 * first saw each cell.
 *
 * ตั้งแต่ E14.F5 แผง `flood` ใช้ `FloodScenesCard` (ซึ่งฝัง `FloodExtentBody` ไว้เป็น
 * ส่วนล่าง) — กรอบนี้คงไว้ให้ที่อื่นที่ต้องการการ์ด GISTDA เดี่ยว ๆ
 */
export function FloodExtentCard({ state, atIso = null }: { state: FloodExtentState; atIso?: string | null }) {
  const { t } = useLang();
  return (
    <Panel
      title={t("flood.title")}
      icon={<Satellite size={16} className="text-[var(--color-accent)]" aria-hidden="true" />}
      headerAction={<FloodObservedChip historical={atIso !== null} />}
    >
      <FloodExtentBody state={state} atIso={atIso} />
    </Panel>
  );
}
