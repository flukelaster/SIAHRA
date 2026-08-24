/** Small pill-style segmented control (range picker, exaggeration steps). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  className = "",
  size = "md",
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible group name. */
  label: string;
  className?: string;
  /** `sm` = ปุ่มเตี้ย/แคบกว่า (dock ของมือถือ) */
  size?: "md" | "sm";
}) {
  const dims = size === "sm" ? "h-5 px-1.5 text-[10px]" : "h-6 px-2 text-[11px]";
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex items-center gap-0.5 rounded-lg bg-white/6 p-0.5 ring-1 ring-white/8 ring-inset ${className}`}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            title={o.title}
            className={`${dims} cursor-pointer rounded-md leading-none whitespace-nowrap tabular-nums transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] ${
              active
                ? "bg-[var(--color-accent)] text-white shadow-[0_1px_6px_rgba(59,130,246,0.45)]"
                : "text-[var(--color-fg-muted)] hover:bg-white/8 hover:text-[var(--color-fg)]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
