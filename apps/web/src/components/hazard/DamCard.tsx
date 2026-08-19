import { Database, Info } from "lucide-react";
import type { DamsState } from "../../hooks/useDams";
import { Panel } from "../ui/Panel";
import { formatNumber } from "../../lib/number";
import { formatDateTime } from "../../lib/time";
import { useLang } from "../../i18n/context";
import { resolveError } from "../../lib/errorMessage";
import { damDisplayName } from "../../lib/damName";

function pctClass(p: number | null): string {
  if (p === null) return "text-[var(--color-fg-muted)]";
  if (p >= 100) return "text-[var(--color-risk-extreme)]";
  if (p >= 80) return "text-[var(--color-risk-high)]";
  if (p < 30) return "text-amber-300";
  return "text-[var(--color-risk-low)]";
}

/** Reservoir storage in the selected province — ThaiWater's published values, verbatim. */
export function DamCard({ state }: { state: DamsState }) {
  const { lang, t } = useLang();
  const { data, loading, error } = state;
  const dams = [...(data?.dams ?? [])].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "large" ? -1 : 1;
    return (b.storagePercent ?? -1) - (a.storagePercent ?? -1);
  });
  return (
    <Panel
      title={t("dam.title")}
      icon={<Database size={16} className="text-[var(--color-accent)]" aria-hidden="true" />}
      headerAction={
        <span className="text-[11px] text-[var(--color-fg-muted)]">
          {loading && !data ? t("common.loading") : t("dam.count", { n: dams.length })}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {error && !data ? (
          <p className="rounded-lg bg-[var(--color-danger)]/10 px-2.5 py-2 text-xs text-[var(--color-danger)]">{resolveError(t, error)}</p>
        ) : dams.length === 0 && !loading ? (
          <p className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-3 text-center text-xs text-[var(--color-fg-muted)]">
            {t("dam.none")}
          </p>
        ) : (
          <ul className="max-h-56 overflow-y-auto pr-0.5">
            {dams.slice(0, 25).map((d) => (
              <li key={d.id} className="flex items-center gap-2.5 border-t border-white/8 py-1.5 first:border-t-0">
                <span className={`w-14 shrink-0 text-right text-sm font-bold tabular-nums ${pctClass(d.storagePercent)}`}>
                  {d.storagePercent !== null ? `${d.storagePercent.toFixed(0)}%` : "—"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-[var(--color-fg)]">{damDisplayName(d, lang, t)}</p>
                  <p className="truncate text-[11px] text-[var(--color-fg-subtle)]">
                    {d.storageMcm !== null ? `${formatNumber(lang, d.storageMcm)} ${t("unit.mcm")}` : ""}
                    {d.maxStorageMcm !== null ? ` / ${formatNumber(lang, d.maxStorageMcm)}` : ""}
                    {d.inflowMcm !== null ? t("dam.inflow", { n: d.inflowMcm.toFixed(1) }) : ""}
                    {d.releasedMcm !== null ? t("dam.released", { n: d.releasedMcm.toFixed(1) }) : ""}
                    {d.observedAt ? ` · ${formatDateTime(lang, d.observedAt)}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-2 text-[11px] text-[var(--color-fg-muted)]">
          <Info size={13} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
          {t("dam.note")}
        </p>
      </div>
    </Panel>
  );
}
