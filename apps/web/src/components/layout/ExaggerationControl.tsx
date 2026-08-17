import { Segmented } from "../ui/Segmented";

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
  return (
    <div className="glass-soft flex h-8 shrink-0 items-center gap-2 rounded-xl pr-1 pl-3">
      <span className="text-[11px] whitespace-nowrap text-[var(--color-fg-muted)]">ขยายแนวดิ่ง</span>
      <Segmented
        label="ขยายแนวดิ่ง"
        value={value}
        onChange={onChange}
        options={EXAGGERATION_STEPS.map((f) => ({
          value: f,
          label: `${f}×`,
          title: f === 1 ? "ความสูงจริง 1:1" : `ขยายความสูง ${f} เท่า (ไม่ใช่สัดส่วนจริง)`,
        }))}
      />
    </div>
  );
}
