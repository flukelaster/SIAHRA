import { Camera, Check, Database, Link2, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { BRAND } from "../../branding";
import { BrandMark } from "./BrandMark";
import { GithubMark } from "./GithubMark";
import { LanguageToggle } from "./LanguageToggle";
import { ProvinceChip } from "./ProvinceChip";
import type { Province } from "../../data/types";
import { useLang } from "../../i18n/context";
import type { MessageKey } from "../../i18n";
import type { Tier } from "../../lib/shellLayout";
import { TOPBAR_H } from "../../lib/shellLayout";
import type { SearchPlace } from "../../lib/searchIndex";

export type { SearchPlace };

const ICON_BUTTON =
  "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/10 text-[var(--color-fg-muted)] transition-colors hover:border-white/25 hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]";

/**
 * Floating header bar over the map (48 px): brand, province chip, search
 * (province/amphoe/station/dam), share, snapshot, source repo, sources link.
 *
 * ชื่อแบรนด์เต็ม + แท็กไลน์โผล่เฉพาะ `wide`; ปุ่มทั้งหมดเป็นไอคอนล้วน (ข้อความ
 * เดิมย้ายไป tooltip/aria-label เดียวกับที่ใช้อยู่แล้ว) เพื่อให้ช่องค้นหาและชิป
 * จังหวัดมีที่พอบน tablet/phone
 */
export function TopBar({
  tier,
  provinces,
  selectedProvince,
  places,
  onSelectProvince,
  onSelectPlace,
  onShare,
  onSnapshot,
}: {
  tier: Tier;
  provinces: Province[];
  selectedProvince: Province;
  places: SearchPlace[];
  onSelectProvince: (code: string) => void;
  onSelectPlace: (place: SearchPlace) => void;
  onShare: () => Promise<boolean>;
  onSnapshot: () => void;
}) {
  const { lang, t } = useLang();
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<number | null>(null);
  const phone = tier === "phone";

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
      className="glass absolute top-3 right-3 left-3 z-20 flex items-center gap-2 rounded-2xl px-2.5 @container"
      style={{ height: TOPBAR_H }}
    >
      <div className="flex shrink-0 items-center gap-2.5">
        <BrandMark size={28} className="shrink-0" />
        {tier === "wide" ? (
          <div className="leading-tight">
            <h1
              className="text-[15px] font-bold tracking-[0.14em] text-[var(--color-fg)]"
              title={BRAND.expansion}
            >
              {BRAND.name}
            </h1>
            <p className="text-[10px] text-[var(--color-fg-muted)]">{t("brand.tagline")}</p>
          </div>
        ) : null}
      </div>

      <ProvinceChip provinces={provinces} selected={selectedProvince} onSelect={onSelectProvince} />

      <div className="relative mx-auto min-w-0 w-full max-w-xl">
        <label className="relative block">
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--color-fg-subtle)]"
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
            className="h-8 w-full rounded-lg border border-white/10 bg-white/5 pr-2.5 pl-8 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
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
          title={copied ? t("topbar.copied") : t("topbar.shareTitle")}
          aria-label={copied ? t("topbar.copied") : t("topbar.shareTitle")}
          className={ICON_BUTTON}
        >
          {copied ? <Check size={14} className="text-[var(--color-success)]" /> : <Link2 size={14} />}
        </button>
        <button
          type="button"
          onClick={onSnapshot}
          title={t("topbar.snapshotTitle")}
          aria-label={t("topbar.snapshotTitle")}
          className={ICON_BUTTON}
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
          className={ICON_BUTTON}
        >
          <GithubMark size={15} />
        </a>
        {/* ลิงก์ไปต้นทาง ThaiWater — บนมือถือไม่มีที่พอ (เครดิตเต็มยังอยู่ในบรรทัด
            attribution ของ dock ตลอดเวลาอยู่แล้ว) */}
        {!phone ? (
          <a
            href="https://www.thaiwater.net/"
            target="_blank"
            rel="noreferrer noopener"
            title={t("topbar.sources")}
            aria-label={t("topbar.sources")}
            className={ICON_BUTTON}
          >
            <Database size={14} />
          </a>
        ) : null}
      </div>

      <LanguageToggle compact={tier !== "wide"} />
    </header>
  );
}
