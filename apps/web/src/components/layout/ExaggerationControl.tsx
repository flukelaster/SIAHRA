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
  compact = false,
}: {
  value: number;
  onChange: (factor: number) => void;
  /** มือถือ: ซ่อนป้ายข้อความ เหลือปุ่ม 1×/2×/4×/8× (ป้ายอยู่ใน aria-label/title ของกลุ่ม) */
  compact?: boolean;
}) {
  const t = useT();
  return (
    <div
      className={`glass-soft flex h-8 shrink-0 items-center rounded-xl pr-1 ${compact ? "gap-1 pl-1" : "gap-2 pl-3"}`}
      title={t("exaggeration.label")}
    >
      {compact ? null : (
        <span className="text-[11px] whitespace-nowrap text-[var(--color-fg-muted)]">{t("exaggeration.label")}</span>
      )}
      <Segmented
        label={t("exaggeration.label")}
        value={value}
        onChange={onChange}
        size={compact ? "sm" : "md"}
        options={EXAGGERATION_STEPS.map((f) => ({
          value: f,
          label: `${f}×`,
          title: f === 1 ? t("exaggeration.real") : t("exaggeration.factor", { n: f }),
        }))}
      />
    </div>
  );
}
