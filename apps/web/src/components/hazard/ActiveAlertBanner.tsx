import type { AlertEvent } from "@siahra/shared-types";
import { useLang } from "../../i18n/context";

interface ActiveAlertBannerProps {
  alerts: readonly AlertEvent[];
  onSelectLocalAuthority?: (laoId: string) => void;
}

export function ActiveAlertBanner({ alerts, onSelectLocalAuthority }: ActiveAlertBannerProps) {
  const { lang } = useLang();

  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 w-full max-w-2xl mx-auto mb-2 pointer-events-auto">
      {alerts.map((alert) => {
        const isSevere = alert.severity === "severe";
        const reason = lang === "th" ? alert.reasonTh : alert.reasonEn;

        return (
          <div
            key={alert.id}
            onClick={() => onSelectLocalAuthority?.(alert.localAuthorityId)}
            className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border backdrop-blur-md shadow-lg cursor-pointer transition-transform hover:scale-[1.01] ${
              isSevere
                ? "bg-rose-950/85 border-rose-500/60 text-rose-100"
                : "bg-amber-950/85 border-amber-500/60 text-amber-100"
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className={`w-2.5 h-2.5 rounded-full animate-ping ${isSevere ? "bg-rose-400" : "bg-amber-400"}`} />
              <span className="text-xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/40">
                {alert.severity}
              </span>
              <p className="text-xs font-medium truncate">{reason}</p>
            </div>
            <span className="text-[10px] text-zinc-400 shrink-0 font-mono">
              {new Date(alert.triggeredAt).toLocaleTimeString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
