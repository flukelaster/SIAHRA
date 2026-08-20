import { Camera, Check, Link2, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { BRAND } from "../../branding";
import { BrandMark } from "./BrandMark";
import { GithubMark } from "./GithubMark";
import { LanguageToggle } from "./LanguageToggle";
import type { Province } from "../../data/types";
import { useLang } from "../../i18n/context";
import type { MessageKey } from "../../i18n";

/** Something the search box can jump to besides a province. */
export interface SearchPlace {
  key: string;
  label: string;
  sub: string;
  kind: "amphoe" | "station" | "dam";
  lon: number;
  lat: number;
}

/** Floating header bar over the map: brand, search (province/amphoe/station/dam), share, snapshot, source repo. */
export function TopBar({
  provinces,
  places,
  onSelectProvince,
  onSelectPlace,
  onShare,
  onSnapshot,
  height,
  compact = false,
}: {
  compact?: boolean;
  provinces: Province[];
  places: SearchPlace[];
  onSelectProvince: (code: string) => void;
  onSelectPlace: (place: SearchPlace) => void;
  onShare: () => Promise<boolean>;
  onSnapshot: () => void;
  height: number;
}) {
  const { lang, t } = useLang();
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<number | null>(null);

  type Match = { key: string; label: string; sub: string; run: () => void };
  const matches = useMemo<Match[]>(() => {
    const raw = query.trim();
    const q = raw.toLowerCase();
    if (!q) return [];
    const prov: Match[] = provinces
      .filter((p) => p.nameTh.includes(raw) || p.nameEn.toLowerCase().includes(q))
      .slice(0, 5)
      .map((p) => ({
        key: `p:${p.code}`,
        // ชื่อจังหวัดมาจาก data/provinces.ts ที่มีทั้ง nameTh/nameEn อยู่แล้ว
        label: lang === "th" ? p.nameTh : p.nameEn,
        sub: `${t("topbar.kind.province")} · ${lang === "th" ? p.nameEn : p.nameTh}`,
        run: () => onSelectProvince(p.code),
      }));
    const KIND: Record<SearchPlace["kind"], MessageKey> = {
      amphoe: "topbar.kind.amphoe",
      station: "topbar.kind.station",
      dam: "topbar.kind.dam",
    };
    const pl: Match[] = places
      .filter((pl) => pl.label.includes(raw) || pl.sub.includes(raw))
      .slice(0, 8)
      .map((pl) => ({ key: pl.key, label: pl.label, sub: `${t(KIND[pl.kind])} · ${pl.sub}`, run: () => onSelectPlace(pl) }));
    return [...prov, ...pl].slice(0, 10);
  }, [query, provinces, places, onSelectProvince, onSelectPlace, lang, t]);

  const choose = (m: Match) => {
    m.run();
    setQuery("");
    setOpen(false);
  };

  return (
    <header
      className="glass absolute top-3 right-3 left-3 z-20 flex items-center gap-4 rounded-2xl px-4"
      style={{ height }}
    >
      <div className="flex items-center gap-3">
        <BrandMark size={36} className="shrink-0" />
        <div className={`leading-tight ${compact ? "hidden" : ""}`}>
          <h1
            className="text-[16px] font-bold tracking-[0.14em] text-[var(--color-fg)]"
            title={BRAND.expansion}
          >
            {BRAND.name}
          </h1>
          <p className="text-[11px] text-[var(--color-fg-muted)]">{t("brand.tagline")}</p>
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-xl">
        <label className="relative block">
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--color-fg-subtle)]"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              blurTimer.current = window.setTimeout(() => setOpen(false), 150);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches.length > 0) choose(matches[0]);
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder={t("topbar.searchPlaceholder")}
            aria-label={t("topbar.searchAria")}
            className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pr-3 pl-9 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          />
        </label>

        {open && matches.length > 0 ? (
          <ul className="glass absolute top-full right-0 left-0 z-50 mt-1.5 overflow-hidden rounded-xl">
            {matches.map((m) => (
              <li key={m.key}>
                <button
                  type="button"
                  onMouseDown={() => {
                    if (blurTimer.current) window.clearTimeout(blurTimer.current);
                  }}
                  onClick={() => choose(m)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm text-[var(--color-fg-muted)] transition-colors duration-150 hover:bg-white/8 hover:text-[var(--color-fg)]"
                >
                  <span className="truncate">{m.label}</span>
                  <span className="shrink-0 text-xs text-[var(--color-fg-subtle)]">{m.sub}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={async () => {
            const ok = await onShare();
            setCopied(ok);
            window.setTimeout(() => setCopied(false), 1800);
          }}
          title={t("topbar.shareTitle")}
          aria-label={t("topbar.shareTitle")}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-xs text-[var(--color-fg-muted)] transition-colors hover:border-white/25 hover:text-[var(--color-fg)]"
        >
          {copied ? <Check size={14} className="text-[var(--color-success)]" /> : <Link2 size={14} />}
          {copied ? t("topbar.copied") : t("topbar.share")}
        </button>
        <button
          type="button"
          onClick={onSnapshot}
          title={t("topbar.snapshotTitle")}
          aria-label={t("topbar.snapshotTitle")}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-[var(--color-fg-muted)] transition-colors hover:border-white/25 hover:text-[var(--color-fg)]"
        >
          <Camera size={14} />
        </button>
        {/* ทางเข้าซอร์สโค้ด — โครงการเป็นโอเพนซอร์ส ลิงก์จึงอยู่ในแถบบนตลอด
            รวมถึงจอแคบ (ปุ่มไอคอนล้วน กินที่เท่าปุ่มบันทึกภาพ) */}
        <a
          href={BRAND.repoUrl}
          target="_blank"
          rel="noreferrer noopener"
          title={t("topbar.repoTitle")}
          aria-label={t("topbar.repoTitle")}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-[var(--color-fg-muted)] transition-colors hover:border-white/25 hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          <GithubMark size={15} />
        </a>
      </div>

      <LanguageToggle compact={compact} />

      <a
        href="https://www.thaiwater.net/"
        target="_blank"
        rel="noreferrer noopener"
        className={`shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-[var(--color-fg-muted)] transition-colors duration-150 hover:border-white/25 hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${compact ? "hidden" : ""}`}
      >
        {t("topbar.sources")}
      </a>
    </header>
  );
}
