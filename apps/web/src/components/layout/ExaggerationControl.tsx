import { Segmented } from "../ui/Segmented";
import { useT } from "../../i18n/context";

const EXAGGERATION_STEPS = [1, 2, 4, 8];

/**
 * Vertical exaggeration picker. Always on screen next to the map so an
 * exaggerated view is never mistaken for real elevation.
 */
export function ExaggerationControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (factor: number) => void;
}) {
  const t = useT();
  return (
    <div className="glass-soft flex h-8 shrink-0 items-center gap-2 rounded-xl pr-1 pl-3">
      <span className="text-[11px] whitespace-nowrap text-[var(--color-fg-muted)]">{t("exaggeration.label")}</span>
      <Segmented
        label={t("exaggeration.label")}
        value={value}
        onChange={onChange}
        options={EXAGGERATION_STEPS.map((f) => ({
          value: f,
          label: `${f}×`,
          title: f === 1 ? t("exaggeration.real") : t("exaggeration.factor", { n: f }),
        }))}
      />
    </div>
  );
}
