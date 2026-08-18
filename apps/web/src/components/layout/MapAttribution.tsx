import { BRAND, DATA_ATTRIBUTION_TH } from "../../branding";
import type { MapInfo } from "./Map3DCanvas";
import { formatNumber } from "../../lib/number";

/**
 * Terrain/imagery provenance + copyright, one quiet block under the dock.
 * The vertical-scale note stays here so an exaggerated view is never
 * mistaken for real relief.
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
    if (info.imagery) parts.push(`ภาพดาวเทียม © ${info.imagery.attribution}`);
  }
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-black/70 px-2.5 py-1 text-[10px] leading-snug text-white/55 backdrop-blur-sm">
      {parts.length > 0 ? <p>{parts.join(" · ")}</p> : null}
      <p className="text-white/45">
        © {BRAND.copyrightYear} {BRAND.name} · {DATA_ATTRIBUTION_TH}
      </p>
    </div>
  );
}
