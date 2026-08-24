import type { ReactNode, Ref } from "react";

/** Floating glass card used for every panel that sits over the map. */
export function Panel({
  title,
  icon,
  children,
  className = "",
  headerAction,
  bodyClassName = "p-3.5",
}: {
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className={`glass rounded-2xl ${className}`}>
      {title ? (
        <header className="flex items-center justify-between gap-2 border-b border-white/8 px-3.5 py-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
            {icon}
            <span>{title}</span>
          </div>
          {headerAction}
        </header>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function IconButton({
  children,
  active = false,
  onClick,
  label,
  size = "md",
  controls,
  ref,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  label: string;
  size?: "md" | "lg";
  /** id ของแผงที่ปุ่มนี้เปิด/ปิด (`aria-controls`) — ใช้โดย SideRail */
  controls?: string;
  /** React 19: ref เป็น prop ธรรมดา — SideDrawer ใช้คืนโฟกัสให้ปุ่มบน rail ตอนปิด */
  ref?: Ref<HTMLButtonElement>;
}) {
  const dims = size === "lg" ? "h-10 w-10" : "h-9 w-9";
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      aria-controls={controls}
      title={label}
      className={`flex ${dims} cursor-pointer items-center justify-center rounded-lg border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
        active
          ? "border-[var(--color-accent)]/70 bg-[var(--color-accent)]/25 text-white"
          : "border-white/8 bg-white/4 text-[var(--color-fg-muted)] hover:border-white/20 hover:bg-white/8 hover:text-[var(--color-fg)]"
      }`}
    >
      {children}
    </button>
  );
}
