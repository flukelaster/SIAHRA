import type { ObservationsResponse } from "@siahra/shared-types";
import type { Province } from "../../data/types";
import { ApiStatusFooter } from "./ApiStatusFooter";
import type { MapLayers } from "./Map3DCanvas";
import type { LayerDescriptors } from "../../hooks/useLayerDescriptors";
import type { QualityLevel, QualityMode } from "../../scene/quality";
import { MapLegend, type ExposureLegendState, type ForecastLegendState } from "./MapLegend";
import type { TerrainIntegrity } from "../../scene/loadAoiManifest";
import { ProvinceSelector } from "./ProvinceSelector";

/** Left dock: floating province picker + legend/layer toggles over the map. */
export function Sidebar({
  provinces,
  selected,
  onSelect,
  observations,
  layers,
  onToggleLayer,
  descriptors,
  quality,
  qualityLevel,
  onQualityChange,
  terrainIntegrity,
  buildingsError,
  exposure,
  forecast,
  width,
  top,
}: {
  provinces: Province[];
  selected: Province;
  onSelect: (p: Province) => void;
  observations: ObservationsResponse | null;
  layers: MapLayers;
  onToggleLayer: (key: keyof MapLayers, value: boolean) => void;
  descriptors: LayerDescriptors;
  quality: QualityMode;
  qualityLevel: QualityLevel;
  onQualityChange: (q: QualityMode) => void;
  /** ผลตรวจ sha256 ของ terrain.bin — ส่งต่อให้ legend บอกว่าชั้นไหนถูกปิดและทำไม */
  terrainIntegrity?: TerrainIntegrity;
  /** ชั้นอาคารแบบเก่า (E8.3) โหลด/แปลงไม่สำเร็จ — null = โหลดสำเร็จ/ไม่เกี่ยวข้อง */
  buildingsError?: string | null;
  /** run ล่าสุดของชั้นการเผชิญน้ำ + สถานะการดึง (E10.4) */
  exposure?: ExposureLegendState;
  /** แถบฝนพยากรณ์รายวัน (TMD) ของขั้นที่กำลังเลือกอยู่ (E12.4b) */
  forecast?: ForecastLegendState;
  width: number;
  top: number;
}) {
  return (
    <aside
      className="absolute bottom-3 left-3 flex flex-col gap-3 overflow-y-auto pr-0.5"
      style={{ width, top }}
    >
      <div className="glass shrink-0 rounded-2xl p-3.5">
        <ProvinceSelector provinces={provinces} selected={selected} onSelect={onSelect} />
      </div>

      <div className="glass shrink-0 rounded-2xl p-3.5">
        <MapLegend
          layers={layers}
          onToggle={onToggleLayer}
          descriptors={descriptors}
          quality={quality}
          qualityLevel={qualityLevel}
          onQualityChange={onQualityChange}
          terrainIntegrity={terrainIntegrity}
          buildingsError={buildingsError}
          exposure={exposure}
          forecast={forecast}
        />
      </div>

      <div className="glass-soft mt-auto shrink-0 rounded-2xl px-3.5 py-2.5">
        <ApiStatusFooter
          fetchedAt={observations?.summary.fetchedAt ?? null}
          attribution={observations?.summary.sourceAttribution ?? null}
        />
      </div>
    </aside>
  );
}
