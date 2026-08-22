import type { LocalAuthorityImpactResponse } from "@siahra/shared-types";
import { useLang } from "../../i18n/context";
import { exportIncidentGeoJson, exportSituationReport } from "../../lib/exportBriefing";

interface ImpactSummaryCardProps {
  impact: LocalAuthorityImpactResponse | null;
  onClose?: () => void;
}

export function ImpactSummaryCard({ impact, onClose }: ImpactSummaryCardProps) {
  const { lang } = useLang();

  if (!impact) return null;

  const { localAuthority, exposure, severity, layer } = impact;
  const name = lang === "th" ? localAuthority.nameTh : localAuthority.nameEn;

  const severityColor = {
    severe: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
    elevated: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    low: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  }[severity];

  const inundationPct =
    exposure.populationTotal > 0
      ? Math.round((exposure.populationExposed / exposure.populationTotal) * 100)
      : 0;

  const economicLossThb = exposure.buildingDamage?.estimatedEconomicLossThb ?? 0;

  return (
    <div className="bg-zinc-900/90 border border-zinc-700/60 rounded-xl p-4 shadow-xl backdrop-blur-md text-zinc-100 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-zinc-800 pb-2.5">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded border ${severityColor}`}>
              {severity}
            </span>
            <span className="text-[11px] text-zinc-400 font-mono">DLA {localAuthority.dlaCode}</span>
          </div>
          <h3 className="text-base font-bold mt-1 text-white">{name}</h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 text-lg leading-none p-1"
            title="Close"
          >
            ×
          </button>
        )}
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-2 gap-2.5 text-xs">
        <div className="bg-zinc-800/60 p-2.5 rounded-lg border border-zinc-700/40">
          <span className="text-zinc-400 block text-[11px]">
            {lang === "th" ? "ประชากรที่ได้รับผลกระทบ" : "Exposed Population"}
          </span>
          <span className="text-lg font-bold text-rose-400">
            {exposure.populationExposed.toLocaleString()}
          </span>
          <span className="text-[10px] text-zinc-500 block">
            / {exposure.populationTotal.toLocaleString()} ({inundationPct}%)
          </span>
        </div>

        <div className="bg-zinc-800/60 p-2.5 rounded-lg border border-zinc-700/40">
          <span className="text-zinc-400 block text-[11px]">
            {lang === "th" ? "อาคารที่อยู่ในพื้นที่น้ำท่วม" : "Exposed Buildings"}
          </span>
          <span className="text-lg font-bold text-amber-400">
            {exposure.buildingsExposed.toLocaleString()}
          </span>
          <span className="text-[10px] text-zinc-500 block">
            / {exposure.buildingsTotal.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Economic Damage & Agriculture */}
      {economicLossThb > 0 ? (
        <div className="bg-rose-950/30 border border-rose-800/40 p-2.5 rounded-lg text-xs flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400 text-[11px]">
              {lang === "th" ? "ประเมินความเสียหายทางเศรษฐกิจ" : "Est. Economic Damage"}
            </span>
            <span className="font-bold text-rose-300">
              ฿{economicLossThb.toLocaleString()} THB
            </span>
          </div>
        </div>
      ) : null}

      {/* Critical Facilities & Infrastructure */}
      <div className="bg-zinc-800/40 p-2.5 rounded-lg border border-zinc-800 text-xs flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-zinc-300">
          {lang === "th" ? "สถานบริการและโครงสร้างพื้นฐานวิกฤต" : "Critical Facilities"}
        </span>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-300">
          <div className="flex items-center justify-between">
            <span>{lang === "th" ? "โรงพยาบาล/รพ.สต." : "Hospitals"}:</span>
            <span className={exposure.criticalFacilities.hospitals > 0 ? "font-bold text-rose-400" : "text-zinc-500"}>
              {exposure.criticalFacilities.hospitals}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>{lang === "th" ? "สถานศึกษา" : "Schools"}:</span>
            <span className={exposure.criticalFacilities.schools > 0 ? "font-bold text-amber-400" : "text-zinc-500"}>
              {exposure.criticalFacilities.schools}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>{lang === "th" ? "ถนนที่ท่วม (กม.)" : "Roads (km)"}:</span>
            <span className="font-semibold text-zinc-200">{exposure.roadKmExposed} km</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{lang === "th" ? "พื้นที่เกษตร (ไร่)" : "Agri (ha)"}:</span>
            <span className="font-semibold text-zinc-200">{exposure.agriculturalHaExposed ?? 0} ha</span>
          </div>
        </div>
      </div>

      {/* Action Buttons for Incident Commander / Officers */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          onClick={() => exportSituationReport(impact, lang)}
          className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 border border-zinc-700 transition-colors text-center"
        >
          {lang === "th" ? "📄 สรุปรายงาน (Brief)" : "📄 Export Brief"}
        </button>
        <button
          onClick={() => exportIncidentGeoJson(impact)}
          className="px-2.5 py-1.5 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/80 text-xs font-semibold text-cyan-200 border border-cyan-700/60 transition-colors text-center"
        >
          {lang === "th" ? "🗺️ โหลด GeoJSON" : "🗺️ Export GeoJSON"}
        </button>
      </div>

      {/* Epistemic / Data Honesty Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-zinc-800/80 text-[10px] text-zinc-400">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="font-mono uppercase">{layer.epistemicClass}</span>
          <span>(GISTDA + WorldPop + OSM)</span>
        </div>
        {layer.fetchedAt && (
          <span className="font-mono text-zinc-500">
            {new Date(layer.fetchedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}
