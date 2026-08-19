import { ChevronDown, ChevronUp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useT } from "../../i18n/context";

export interface SheetTab {
  key: string;
  label: string;
  content: ReactNode;
}

/**
 * Compact-screen replacement for the side docks: a bottom sheet with tabs.
 * Collapsed it shows only the tab strip so the map keeps most of the screen.
 */
export function MobileSheet({
  tabs,
  open,
  onOpenChange,
  height,
}: {
  tabs: SheetTab[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  height: number;
}) {
  const t = useT();
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  return (
    <div
      className="glass absolute right-2 bottom-2 left-2 z-20 flex flex-col overflow-hidden rounded-2xl"
      style={{ height: open ? height : 44 }}
    >
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto px-2 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setActive(t.key);
              if (!open) onOpenChange(true);
            }}
            className={`shrink-0 cursor-pointer rounded-lg px-2.5 py-1 text-xs transition-colors ${
              current?.key === t.key && open
                ? "bg-[var(--color-accent)]/25 text-white"
                : "text-[var(--color-fg-muted)] hover:bg-white/8"
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-label={open ? t("sheet.collapse") : t("sheet.expand")}
          className="ml-auto flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-white/8"
        >
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
      {open ? <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">{current?.content}</div> : null}
    </div>
  );
}
