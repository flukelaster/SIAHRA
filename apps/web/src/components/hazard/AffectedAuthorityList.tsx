import type { LocalAuthorityImpactResponse } from "@siahra/shared-types";
import { useLang } from "../../i18n/context";

interface AffectedAuthorityListProps {
  impacts: readonly LocalAuthorityImpactResponse[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function AffectedAuthorityList({
  impacts,
  selectedId,
  onSelect,
}: AffectedAuthorityListProps) {
  const { lang } = useLang();

  if (impacts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs font-semibold text-zinc-400 px-1">
        <span>{lang === "th" ? "อันดับ อปท. ที่ได้รับผลกระทบ" : "Affected Local Authorities"}</span>
        <span className="text-[10px] font-mono text-zinc-500">{impacts.length} อปท.</span>
      </div>

      <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
        {impacts.map((item) => {
          const isSelected = item.localAuthority.id === selectedId;
          const name = lang === "th" ? item.localAuthority.nameTh : item.localAuthority.nameEn;

          const badgeColor = {
            severe: "bg-rose-500/20 text-rose-300 border-rose-500/40",
            high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
            elevated: "bg-amber-500/20 text-amber-300 border-amber-500/40",
            low: "bg-zinc-800 text-zinc-400 border-zinc-700",
          }[item.severity];

          return (
            <button
              key={item.localAuthority.id}
              onClick={() => onSelect(item.localAuthority.id)}
              className={`flex items-center justify-between gap-2 p-2 rounded-lg text-left text-xs transition-colors border ${
                isSelected
                  ? "bg-zinc-800 border-cyan-500/60 text-white"
                  : "bg-zinc-900/60 border-zinc-800/80 text-zinc-300 hover:bg-zinc-800/60"
              }`}
            >
              <div className="flex flex-col min-w-0">
                <span className="font-semibold truncate">{name}</span>
                <span className="text-[10px] text-zinc-500">
                  {item.exposure.populationExposed.toLocaleString()} {lang === "th" ? "คน" : "people"}
                </span>
              </div>

              <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border shrink-0 ${badgeColor}`}>
                {item.severity}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
