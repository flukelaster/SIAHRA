import { SOURCES, type SourceId } from "@siahra/shared-types";
import { BRAND } from "../../branding";
import type { MapInfo } from "./Map3DCanvas";
import { formatNumber } from "../../lib/number";
import { useLang } from "../../i18n/context";

/**
 * ลำดับเครดิตบนแผนที่: ต้นทางที่วัดจริง (live) มาก่อน แล้วค่อยข้อมูลฐานที่นิ่ง
 * ชื่อ ลิงก์ และสัญญาอนุญาตทั้งหมดอ่านจากทะเบียนกลาง (`SOURCES`) ไม่ใช่ข้อความ
 * ที่พิมพ์ไว้ตรงนี้ — เพิ่ม/แก้แหล่งข้อมูลที่เดียวแล้วแผงนี้ตามทันที
 */
const CREDIT_ORDER: SourceId[] = [
  "thaiwater",
  "tmd-radar",
  "gistda-flood",
  "earthquakes",
  "copernicus-dem",
  "osm",
  "osm-admin",
  "worldcover",
];

/**
 * Terrain/imagery provenance + copyright, one quiet block under the dock.
 * The vertical-scale note stays here so an exaggerated view is never
 * mistaken for real relief.
 *
 * เงื่อนไขการใช้ข้อมูลของกรมอุตุนิยมวิทยากำหนดให้เครดิตมีลิงก์กลับไปยังต้นทาง
 * และห้ามสื่อว่าต้นทางรับรองโครงการนี้ — ทุกชื่อจึงเป็นลิงก์ และมีบรรทัดปฏิเสธ
 * การรับรองกำกับไว้เสมอ
 *
 * ชื่อแหล่งข้อมูลสลับตามภาษา (`nameTh`/`nameEn` ในทะเบียนกลาง) แต่ `attributionText`
 * และ `licenseName` **ไม่แปล** โดยตั้งใจ: เป็นข้อความเครดิตตามเงื่อนไขของต้นทาง
 * การเขียนใหม่เป็นภาษาอังกฤษคือการแก้ถ้อยคำที่เจ้าของข้อมูลกำหนดไว้
 */
export function MapAttribution({ info, exaggeration }: { info: MapInfo | null; exaggeration: number }) {
  const { lang, t } = useLang();
  const parts: string[] = [];
  if (info) {
    parts.push(
      t("attribution.terrain", {
        demType: info.demType,
        cell: info.nativeCellSizeM
          ? t("attribution.cellLod", { m: info.nativeCellSizeM })
          : t("attribution.cell", { m: info.cellSizeM }),
      }),
    );
    parts.push(
      t("attribution.verticalScale", {
        scale:
          exaggeration === 1
            ? t("attribution.scaleReal")
            : t("attribution.scaleExaggerated", { n: exaggeration }),
      }),
    );
    parts.push(
      t("attribution.buildings", {
        n: formatNumber(lang, info.buildingCount),
        urban: info.coverage === "urban-core" ? t("attribution.urbanCore") : "",
      }),
    );
    if (info.stationCount > 0) {
      parts.push(t("attribution.stations", { n: formatNumber(lang, info.stationCount) }));
    }
    // เงื่อนไขของผู้ให้ภาพ (Esri ToU / CC BY-NC-SA ของ EOX) บังคับให้ข้อความเครดิต
    // ฉบับเต็ม "มองเห็นได้" ไม่ใช่ซ่อนใน tooltip — ข้อความมาจากทะเบียนกลาง และ
    // แสดงตามที่ต้นทางกำหนด ไม่แปล
    if (info.imagery) {
      parts.push(
        t("attribution.imagery", { text: SOURCES[info.imagery.sourceId].attributionText }),
      );
    }
    // วันที่ build ของชุดข้อมูล ETL (E9.1) — มาจาก `manifest.provenance` เท่านั้น
    // manifest รุ่นก่อนหน้าไม่มีฟิลด์นี้ ก็ไม่แสดงอะไร ดีกว่าเดาจาก `version`
    // ที่ถูกเขียนทับทุกครั้งที่ rebuild ชั้นใดชั้นหนึ่ง
    if (info.provenance) {
      parts.push(t("attribution.dataset", { version: info.provenance.datasetVersion }));
    }
  }
  // ผู้ให้ภาพดาวเทียมที่กำลังใช้จริงเท่านั้น (id มาจากตัว provider ไม่ใช่การจับคู่ข้อความ)
  const credits: SourceId[] = info?.imagery ? [...CREDIT_ORDER, info.imagery.sourceId] : CREDIT_ORDER;
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-black/70 px-2.5 py-1 text-[10px] leading-snug text-white/55 backdrop-blur-sm">
      {parts.length > 0 ? <p>{parts.join(" · ")}</p> : null}
      <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
        <span className="text-white/45">{t("attribution.sources")}</span>
        {credits.map((id, i) => {
          const src = SOURCES[id];
          return (
            <span key={id} className="flex items-center gap-x-1">
              <a
                href={src.homepageUrl}
                target="_blank"
                rel="noreferrer noopener"
                title={`${src.attributionText} · ${src.licenseName}`}
                className="underline decoration-white/25 underline-offset-2 hover:text-white/90"
              >
                {lang === "th" ? src.nameTh : src.nameEn}
              </a>
              {i < credits.length - 1 ? <span className="text-white/25">·</span> : null}
            </span>
          );
        })}
      </p>
      <p className="text-white/45">
        © {BRAND.copyrightYear} {BRAND.name} · {t("attribution.noEndorsement")}
      </p>
    </div>
  );
}
