import { SOURCES, type SourceId } from "@siahra/shared-types";
import { BRAND } from "../../branding";
import type { MapInfo } from "./Map3DCanvas";
import { formatNumber } from "../../lib/number";

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
 */
export function MapAttribution({ info, exaggeration }: { info: MapInfo | null; exaggeration: number }) {
  const parts: string[] = [];
  if (info) {
    parts.push(
      `ภูมิประเทศ Copernicus GLO-30 (${info.demType}) · ${
        info.nativeCellSizeM ? `${info.nativeCellSizeM} ม./เซลล์ (LOD ตามระยะกล้อง)` : `${info.cellSizeM} ม./เซลล์`
      }`,
    );
    parts.push(`มาตราส่วนแนวดิ่ง ${exaggeration === 1 ? "1:1 (จริง)" : `${exaggeration}:1 (ขยายแนวดิ่ง)`}`);
    parts.push(
      `อาคาร OSM ${formatNumber(info.buildingCount)} หลัง${info.coverage === "urban-core" ? " (เฉพาะเขตเมือง)" : ""}`,
    );
    if (info.stationCount > 0) parts.push(`สถานีตรวจวัด ${formatNumber(info.stationCount)} สถานี`);
    // เงื่อนไขของผู้ให้ภาพ (Esri ToU / CC BY-NC-SA ของ EOX) บังคับให้ข้อความเครดิต
    // ฉบับเต็ม "มองเห็นได้" ไม่ใช่ซ่อนใน tooltip — ข้อความมาจากทะเบียนกลาง
    if (info.imagery) parts.push(`ภาพดาวเทียม © ${SOURCES[info.imagery.sourceId].attributionText}`);
  }
  // ผู้ให้ภาพดาวเทียมที่กำลังใช้จริงเท่านั้น (id มาจากตัว provider ไม่ใช่การจับคู่ข้อความ)
  const credits: SourceId[] = info?.imagery ? [...CREDIT_ORDER, info.imagery.sourceId] : CREDIT_ORDER;
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-black/70 px-2.5 py-1 text-[10px] leading-snug text-white/55 backdrop-blur-sm">
      {parts.length > 0 ? <p>{parts.join(" · ")}</p> : null}
      <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
        <span className="text-white/45">แหล่งข้อมูล:</span>
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
                {src.nameTh}
              </a>
              {i < credits.length - 1 ? <span className="text-white/25">·</span> : null}
            </span>
          );
        })}
      </p>
      <p className="text-white/45">
        © {BRAND.copyrightYear} {BRAND.name} · หน่วยงานข้างต้นเป็นผู้เผยแพร่ข้อมูล ไม่ได้รับรองโครงการนี้
      </p>
    </div>
  );
}
