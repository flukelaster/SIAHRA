import { ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { FloodFieldClass } from "@siahra/shared-types";
import { gfmConfidence } from "../../scene/floodField";
import type { FloodCellPick, PickResult } from "../../scene/picking";
import { useStationHistory } from "../../hooks/useStationHistory";
import { Sparkline } from "../hazard/Sparkline";
import { floodDepthMaxLabel } from "../../lib/floodStyle";
import { formatNumber } from "../../lib/number";
import { formatDateTime, formatFullDateTime } from "../../lib/time";
import { damDisplayName } from "../../lib/damName";
import { nearestProvinceLabel } from "../../lib/nearestProvince";
import { useLang } from "../../i18n/context";
import type { Lang, MessageKey, TFunction } from "../../i18n";

function fmtTime(lang: Lang, iso: string | null | undefined): string {
  return iso ? formatDateTime(lang, iso) : "—";
}

const SITUATION: Record<number, MessageKey> = {
  1: "situation.1",
  2: "situation.2",
  3: "situation.3",
  4: "situation.4",
  5: "situation.5",
};

/** ชื่อสถานี/เขื่อนมาจากต้นทาง — เลือกฟิลด์ตามภาษา ไม่ได้แปลเอง */
function pickName(nameTh: string | null, nameEn: string | null, lang: Lang): string | null {
  return (lang === "th" ? (nameTh ?? nameEn) : (nameEn ?? nameTh)) ?? null;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 text-[11px]">
      <span className="text-[var(--color-fg-subtle)]">{k}</span>
      <span className="tabular-nums text-[var(--color-fg)]">{v}</span>
    </div>
  );
}

/** หน้าวิธีคำนวณของความลึก FwDET — พาภาษาไปด้วยเหมือน MapLegend (หน้านั้นอ่านภาษาจาก query เท่านั้น) */
function floodDepthMethodologyHref(lang: Lang): string {
  return lang === "th" ? "/methodology/flood-depth" : `/methodology/flood-depth?lang=${lang}`;
}

/**
 * บรรทัดคลาสของเซลล์ Copernicus GFM (E14.F5) — หกคลาส หกประโยค ห้ามพับรวมกัน:
 * "ไม่มีภาพ" ≠ "ไม่มีการจำแนก" ≠ "แห้ง" และ "ไม่ได้ประมาณความลึก" ≠ 0 ม.
 * ความลึกเป็นภาพประกอบ (FwDET) ทศนิยมหนึ่งตำแหน่ง; likelihood คือความเชื่อมั่นของ
 * การจำแนกภาพ — ไม่ใช่เปอร์เซ็นต์ของอะไรที่ยังไม่เกิด
 */
function gfmClassLine(cell: FloodCellPick, lang: Lang, t: TFunction): string {
  switch (cell.cls) {
    case FloodFieldClass.FLOODED:
      return cell.depthCm !== null
        ? t("popup.gfm.flooded", { m: floodDepthMaxLabel(lang, cell.depthCm) })
        : t("popup.gfm.floodedNoDepth");
    case FloodFieldClass.FLOODED_DEPTH_NOT_ESTIMATED:
      return t("popup.gfm.notEstimated");
    case FloodFieldClass.REFERENCE_WATER:
      return t("popup.gfm.referenceWater");
    case FloodFieldClass.EXCLUDED:
      return t("popup.gfm.excluded");
    case FloodFieldClass.NO_OBSERVATION:
      return t("popup.gfm.noObservation");
    case FloodFieldClass.DRY:
      return t("popup.gfm.dry");
    default:
      return t("popup.gfm.unknownClass", { cls: cell.cls });
  }
}

/** export เพื่อให้เทสเรนเดอร์บล็อกนี้ตรง ๆ ได้ (popup ทั้งก้อนต้องมี PickResult + hooks) */
export function GfmCellBlock({ cell, lang, t }: { cell: FloodCellPick; lang: Lang; t: TFunction }) {
  const flooded = cell.cls === FloodFieldClass.FLOODED || cell.cls === FloodFieldClass.FLOODED_DEPTH_NOT_ESTIMATED;
  // บรรทัดความเชื่อมั่นเฉพาะเซลล์ที่ GFM จำแนกจริง — EXCLUDED/NO_OBSERVATION ไม่มี (scene/floodField.ts)
  const confidence = gfmConfidence(cell);
  return (
    <div className="mt-2 border-t border-white/10 pt-1.5" data-gfm-class={cell.cls}>
      <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("popup.gfm.title")}</p>
      <p className={`mt-0.5 text-[11px] ${flooded ? "text-[#7fc4ef]" : "text-[var(--color-fg)]"}`}>{gfmClassLine(cell, lang, t)}</p>
      {confidence !== null ? (
        <p className="text-[11px] text-[var(--color-fg-muted)]">{t("popup.gfm.confidence", { n: confidence })}</p>
      ) : null}
      <p className="mt-0.5 text-[10px] text-[var(--color-fg-subtle)]">
        {t("popup.gfm.acquired", { time: formatFullDateTime(lang, cell.observedAt), id: cell.sceneId })}
      </p>
      <a
        href={floodDepthMethodologyHref(lang)}
        target="_blank"
        rel="noreferrer"
        className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-[var(--color-accent)] hover:underline"
      >
        <ExternalLink size={10} aria-hidden="true" />
        {t("freshness.methodology")}
      </a>
    </div>
  );
}

const HISTORY_RANGES: { hours: number; labelKey: MessageKey }[] = [
  { hours: 72, labelKey: "timeline.range.72h" },
  { hours: 168, labelKey: "timeline.range.7d" },
  { hours: 720, labelKey: "timeline.range.30d" },
];

function WaterLevelBody({
  pick,
  lang,
  t,
}: {
  pick: Extract<PickResult, { kind: "waterlevel" }>;
  lang: Lang;
  t: TFunction;
}) {
  const { obs } = pick;
  const [hours, setHours] = useState(72);
  const history = useStationHistory(obs.station.id, true, hours);
  return (
    <>
      <p className="text-sm font-semibold text-white">
        {pickName(obs.station.nameTh, obs.station.nameEn, lang) ??
          t("water.stationFallback", { id: obs.station.id })}
      </p>
      <p className="text-[11px] text-[var(--color-fg-muted)]">
        {[obs.station.amphoeNameTh, obs.station.basinNameTh, obs.station.agencyShortTh].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-2 flex flex-col gap-0.5">
        {/* ค่าย้อนหลังไม่มี situationLevel จาก ThaiWater — ต้องบอกว่าไม่ระบุ ไม่ใช่เดาระดับให้ */}
        {obs.situationLevel ? (
          <Row k={t("popup.situationThaiwater")} v={t(SITUATION[obs.situationLevel])} />
        ) : (
          <Row k={t("popup.situation")} v={t("popup.situationHistorical")} />
        )}
        {obs.waterlevelMsl !== null ? (
          <Row k={t("popup.waterlevel")} v={`${obs.waterlevelMsl.toFixed(2)} ${t("unit.msl")}`} />
        ) : null}
        {obs.minBankMsl !== null ? (
          <Row k={t("popup.minBank")} v={`${obs.minBankMsl.toFixed(2)} ${t("unit.msl")}`} />
        ) : null}
        {obs.freeboardM !== null ? (
          <Row
            k={obs.freeboardM <= 0 ? t("popup.aboveBank") : t("popup.belowBank")}
            v={`${Math.abs(obs.freeboardM).toFixed(2)} ${t("unit.m")}`}
          />
        ) : null}
        <Row k={t("popup.observedAt")} v={fmtTime(lang, obs.observedAt)} />
      </div>
      <div className="mt-2 rounded-lg bg-black/30 px-2 py-1.5">
        {history.loading ? (
          <div className="h-16 animate-pulse rounded bg-white/8" />
        ) : history.data ? (
          <>
            <Sparkline points={history.data.points} bankMsl={history.data.datum === "msl" ? obs.minBankMsl : null} />
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-[var(--color-fg-subtle)]">
                {t("popup.realObserved")}
                {history.data.fromArchive ? t("popup.partlyArchive") : ""}
              </p>
              <span className="flex rounded bg-white/5 p-0.5">
                {HISTORY_RANGES.map((r) => (
                  <button
                    key={r.hours}
                    type="button"
                    onClick={() => setHours(r.hours)}
                    className={`cursor-pointer rounded px-1.5 text-[10px] ${hours === r.hours ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-fg-muted)]"}`}
                  >
                    {t(r.labelKey)}
                  </button>
                ))}
              </span>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("popup.noHistory")}</p>
        )}
      </div>
    </>
  );
}

export function InfoPopup({ pick, onClose }: { pick: PickResult; onClose: () => void }) {
  const { lang, t } = useLang();
  return (
    <div className="glass pointer-events-auto relative w-72 rounded-xl px-3 py-2.5 shadow-2xl">
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        className="absolute top-1.5 right-1.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-white/10 hover:text-white"
      >
        <X size={13} />
      </button>
      {pick.kind === "waterlevel" ? <WaterLevelBody pick={pick} lang={lang} t={t} /> : null}
      {pick.kind === "rainfall" ? (
        <>
          <p className="text-sm font-semibold text-white">
            {pickName(pick.obs.station.nameTh, pick.obs.station.nameEn, lang) ??
              t("water.stationFallback", { id: pick.obs.station.id })}
          </p>
          <p className="text-[11px] text-[var(--color-fg-muted)]">
            {[pick.obs.station.amphoeNameTh, pick.obs.station.agencyShortTh].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex flex-col gap-0.5">
            <Row
              k={t("popup.rain24h")}
              v={pick.obs.rain24h !== null ? `${pick.obs.rain24h.toFixed(1)} ${t("unit.mm")}` : "—"}
            />
            <Row
              k={t("popup.rain1h")}
              v={pick.obs.rain1h !== null ? `${pick.obs.rain1h.toFixed(1)} ${t("unit.mm")}` : "—"}
            />
            <Row k={t("popup.observedAt")} v={fmtTime(lang, pick.obs.observedAt)} />
          </div>
        </>
      ) : null}
      {pick.kind === "dam" ? (
        <>
          <p className="text-sm font-semibold text-white">
            {damDisplayName(pick.dam, lang, t)}
          </p>
          <p className="text-[11px] text-[var(--color-fg-muted)]">
            {[pick.dam.basinNameTh, pick.dam.agencyShortTh].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex flex-col gap-0.5">
            <Row
              k={t("popup.damStorage")}
              v={pick.dam.storagePercent !== null ? `${pick.dam.storagePercent.toFixed(1)} ${t("unit.percent")}` : "—"}
            />
            <Row
              k={t("popup.damVolume")}
              v={pick.dam.storageMcm !== null ? `${formatNumber(lang, pick.dam.storageMcm, 1)} ${t("unit.mcm")}` : "—"}
            />
            {pick.dam.maxStorageMcm !== null ? (
              <Row k={t("popup.damMax")} v={`${formatNumber(lang, pick.dam.maxStorageMcm)} ${t("unit.mcm")}`} />
            ) : null}
            {pick.dam.inflowMcm !== null ? (
              <Row k={t("popup.damInflow")} v={`${pick.dam.inflowMcm.toFixed(2)} ${t("unit.mcmPerDay")}`} />
            ) : null}
            {pick.dam.releasedMcm !== null ? (
              <Row k={t("popup.damReleased")} v={`${pick.dam.releasedMcm.toFixed(2)} ${t("unit.mcmPerDay")}`} />
            ) : null}
            <Row k={t("popup.reportedAt")} v={fmtTime(lang, pick.dam.observedAt)} />
          </div>
        </>
      ) : null}
      {pick.kind === "quake" ? (
        <>
          <p className="text-sm font-semibold text-white">
            {t("popup.quakeTitle", { mag: pick.event.mag?.toFixed(1) ?? "—" })}
          </p>
          <p className="text-[11px] text-[var(--color-fg-muted)]">
            {pick.event.place ?? t("quake.unknownPlace")}
          </p>
          <div className="mt-2 flex flex-col gap-0.5">
            <Row
              k={t("popup.depth")}
              v={pick.event.depthKm !== null ? `${pick.event.depthKm.toFixed(0)} ${t("unit.km")}` : "—"}
            />
            <Row k={t("popup.localTime")} v={fmtTime(lang, pick.event.time)} />
            <Row k={t("popup.source")} v={pick.event.sources.join(" / ").toUpperCase()} />
            <Row
              k={t("popup.status")}
              v={pick.event.status === "automatic" ? t("popup.statusAutomatic") : t("popup.statusReviewed")}
            />
          </div>
          {/* จังหวัดใกล้เคียงมาจากระยะถึงขอบเขตจังหวัดที่คิดไว้ตอน ingest —
              ระเบียนที่ยังไม่มีค่านี้ต้องบอกตรง ๆ ว่ายังไม่ได้คำนวณ ไม่ใช่เงียบ */}
          <div className="mt-2 border-t border-white/10 pt-1.5">
            <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("popup.nearestProvinces")}</p>
            {pick.event.nearest && pick.event.nearest.length > 0 ? (
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {pick.event.nearest.map((n) => (
                  <li key={n.provinceCode} className="text-[11px] text-[var(--color-fg)]">
                    {nearestProvinceLabel(t, lang, n)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-[11px] text-[var(--color-fg-muted)]">
                {t("quake.nearest.unknown")}
              </p>
            )}
            <p className="mt-1 text-[10px] text-[var(--color-fg-subtle)]">{t("quake.nearest.note")}</p>
          </div>
          {pick.event.url ? (
            <a
              href={pick.event.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[var(--color-accent)] hover:underline"
            >
              <ExternalLink size={11} aria-hidden="true" />
              {t("quake.eventPage")}
            </a>
          ) : null}
        </>
      ) : null}
      {pick.kind === "ground" ? (
        <>
          <p className="text-sm font-semibold text-white">
            {pick.flood
              ? t("popup.floodTitle", { tambon: pick.flood.properties.tambonTh ?? "" })
              : t("popup.mapPoint")}
          </p>
          <div className="mt-2 flex flex-col gap-0.5">
            <Row k={t("popup.coords")} v={`${pick.lat.toFixed(5)}, ${pick.lon.toFixed(5)}`} />
            <Row k={t("popup.elevation")} v={`${pick.elevationM.toFixed(0)} ${t("unit.m")}`} />
            {pick.flood ? (
              <>
                <Row k={t("popup.amphoe")} v={pick.flood.properties.amphoeTh ?? "—"} />
                <Row
                  k={t("popup.floodArea")}
                  v={
                    pick.flood.properties.floodAreaRai !== null
                      ? `${formatNumber(lang, Math.round(pick.flood.properties.floodAreaRai))} ${t("unit.rai")}`
                      : "—"
                  }
                />
                <Row k={t("popup.firstSeen")} v={fmtTime(lang, pick.flood.properties.firstSeenAt)} />
                <Row k={t("popup.lastSeen")} v={fmtTime(lang, pick.flood.properties.lastSeenAt)} />
              </>
            ) : null}
          </div>
          {pick.flood ? (
            <p className="mt-1.5 text-[10px] text-[var(--color-fg-subtle)]">{t("popup.floodNote")}</p>
          ) : null}
          {/* เซลล์ GFM ใต้จุดนี้ (E14.F5) — null = ไม่มีฉากที่วาดอยู่ จึงไม่พูดถึงเลย ไม่ใช่ "แห้ง" */}
          {pick.floodCell ? <GfmCellBlock cell={pick.floodCell} lang={lang} t={t} /> : null}
        </>
      ) : null}
    </div>
  );
}
