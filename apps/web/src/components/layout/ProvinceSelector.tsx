import { Check, Search } from "lucide-react";
import { useState } from "react";
import type { Province } from "../../data/types";

export function ProvinceSelector({
  provinces,
  selected,
  onSelect,
}: {
  provinces: Province[];
  selected: Province;
  onSelect: (p: Province) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim();
  const filtered = q
    ? provinces.filter(
        (p) => p.nameTh.includes(q) || p.nameEn.toLowerCase().includes(q.toLowerCase()),
      )
    : provinces;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium text-[var(--color-fg-muted)]">เลือกจังหวัด</p>
        <p className="text-[10px] text-[var(--color-fg-subtle)]">{provinces.length} จังหวัด</p>
      </div>

      <label className="relative block">
        <Search
          size={14}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--color-fg-subtle)]"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาจังหวัด..."
          aria-label="กรองรายชื่อจังหวัด"
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-1.5 pr-2.5 pl-8 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        />
      </label>

      <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto pr-0.5">
        {filtered.map((p) => {
          const isSelected = p.code === selected.code;
          return (
            <li key={p.code}>
              <button
                type="button"
                onClick={() => onSelect(p)}
                aria-current={isSelected ? "true" : undefined}
                className={`flex w-full cursor-pointer items-center justify-between gap-1.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
                  isSelected
                    ? "bg-[var(--color-accent)]/15 text-[var(--color-accent-fg)]"
                    : "text-[var(--color-fg-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-fg)]"
                }`}
              >
                <span className="truncate">{p.nameTh}</span>
                {isSelected ? <Check size={14} className="shrink-0" aria-hidden="true" /> : null}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 ? (
          <li className="px-2.5 py-3 text-center text-xs text-[var(--color-fg-subtle)]">
            ไม่พบจังหวัดที่ค้นหา
          </li>
        ) : null}
      </ul>
    </div>
  );
}
