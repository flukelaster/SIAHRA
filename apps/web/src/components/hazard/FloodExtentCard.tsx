import { Info, Satellite } from "lucide-react";
import type { FloodExtentState } from "../../hooks/useFloodExtent";
import { Panel } from "../ui/Panel";
import { formatNumber } from "../../lib/number";
import { neverReceived, formatAge, formatDateTime } from "../../lib/time";
import { useLang } from "../../i18n/context";
import { resolveError } from "../../lib/errorMessage";

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
 */
export function FloodExtentBody({ state, atIso = null }: { state: FloodExtentState; atIso?: string | null }) {
  const { lang, t } = useLang();
  const { data, loading, error } = state;
  const historical = atIso !== null;
  const features = data?.features ?? [];
  const totalRai = features.reduce((a, f) => a + (f.properties.floodAreaRai ?? 0), 0);
  const houses = features.reduce((a, f) => a + (f.properties.houses ?? 0), 0);
  const ranked = [...features].sort(
    (a, b) => (b.properties.floodAreaRai ?? 0) - (a.properties.floodAreaRai ?? 0),
  );
  // firstSeenAt เป็น null เมื่อฉากมาจาก archive (ไม่รู้ช่วงที่เห็นแต่ละ polygon) — ข้ามไป
  const earliest = features.reduce<string | null>(
    (acc, f) =>
      f.properties.firstSeenAt !== null && (acc === null || f.properties.firstSeenAt < acc)
        ? f.properties.firstSeenAt
        : acc,
    null,
  );

  return (
    <div className="flex flex-col gap-3">
      {historical && data?.retrievedAt ? (
        <p className="rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-2 text-xs text-[var(--color-risk-medium)]">
          {t("flood.historicalScene", { time: formatDateTime(lang, data.retrievedAt) })}
        </p>
      ) : null}
      {loading && !data ? (
        <div className="h-10 animate-pulse rounded bg-white/8" />
      ) : error && !data ? (
        <p className="rounded-lg bg-[var(--color-danger)]/10 px-2.5 py-2 text-xs text-[var(--color-danger)]">
          {t("flood.loadError", { error: resolveError(t, error) ?? "" })}
        </p>
      ) : data?.reason === "no-archived-scene" ? (
        // ย้อนหลังไปก่อนที่ระบบเริ่มเก็บฉาก — ไม่มีการสังเกต ณ เวลานั้น ห้ามอ่านเป็น "ไม่ท่วม"
        <p className="rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-3 text-center text-xs text-[var(--color-risk-medium)]">
          {t("flood.noArchivedScene", { time: atIso ? formatDateTime(lang, atIso) : "" })}
        </p>
      ) : features.length === 0 && !data?.retrievedAt ? (
        // ยังไม่มี retrievedAt = ยังดึงฉากแรกไม่สำเร็จ "หรือกำลังดึงอยู่" จึงยัง
        // ฟันธงไม่ได้ว่าต้นทางล่ม (แถบสถานะด้านล่างเป็นตัวบอกว่าล่มจริงหรือไม่)
        // แต่ต้องไม่ให้ช่องว่างถูกอ่านว่า "ปลอดภัย"
        <p className="rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-3 text-center text-xs text-[var(--color-risk-medium)]">
          {t("flood.noScene")}
        </p>
      ) : features.length === 0 ? (
        <p className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-3 text-center text-xs text-[var(--color-fg-muted)]">
          {historical ? t("flood.noneHistorical") : t("flood.none")}
          {data?.retrievedAt && !historical
            ? t("flood.noneFetched", { age: formatAge(lang, data.retrievedAt) })
            : ""}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-[11px] text-[var(--color-fg-muted)]">{t("flood.tambonCount")}</p>
              <p className="text-xl font-bold tabular-nums text-[var(--color-fg)]">{features.length}</p>
            </div>
            <div>
              <p className="text-[11px] text-[var(--color-fg-muted)]">{t("flood.areaRai")}</p>
              <p className="text-xl font-bold tabular-nums text-[#4d94b8]">
                {formatNumber(lang, Math.round(totalRai))}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[var(--color-fg-muted)]">{t("flood.households")}</p>
              <p className="text-xl font-bold tabular-nums text-[var(--color-fg)]">
                {formatNumber(lang, houses)}
              </p>
            </div>
          </div>
          <ul className="max-h-48 overflow-y-auto pr-0.5">
            {ranked.slice(0, 20).map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-2 border-t border-white/8 py-1.5 first:border-t-0"
              >
                <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-[#4d94b8]">
                  {formatNumber(lang, Math.round(f.properties.floodAreaRai ?? 0))}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-[var(--color-fg)]">
                    {f.properties.tambonTh ?? t("flood.unknownTambon")}
                  </p>
                  <p className="truncate text-[11px] text-[var(--color-fg-subtle)]">
                    {f.properties.amphoeTh ?? ""}
                    {f.properties.firstSeenAt !== null
                      ? ` · ${t("flood.firstSeen", { time: formatDateTime(lang, f.properties.firstSeenAt) })}`
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
        {t("flood.note")}
        {/* retrievedAt = null คือยังไม่เคยดึงฉากไหนสำเร็จ (หรือไม่มีฉากที่เก็บไว้ ณ เวลานั้น) ห้ามแสดงเป็นเวลาใด ๆ */}
        {/* ย้อนหลังแล้วไม่มีฉาก: กล่องด้านบนอธิบายแล้ว ไม่ต้องย้ำ "ยังไม่เคยได้รับ" ซึ่งฟังเหมือนพูดถึงทั้งระบบ */}
        {data?.retrievedAt
          ? ` (${historical ? formatDateTime(lang, data.retrievedAt) : formatAge(lang, data.retrievedAt)})`
          : historical
            ? ""
            : ` (${neverReceived(lang)})`}
        {earliest ? t("flood.noteEarliest", { time: formatDateTime(lang, earliest) }) : ""}
      </p>
    </div>
  );
}

/**
 * Satellite-observed flood extent for the selected province. Everything shown
 * is what GISTDA's latest interpreted scene contains — with when *we* fetched
 * it and when each polygon first appeared, because the scene itself carries
 * no timestamp.
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
