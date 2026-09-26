import { Bell, Camera, Check, Database, Link2, Search } from "lucide-react";
import { useMemo, useRef, useState, type RefObject } from "react";
import { BRAND } from "../../branding";
import { BrandMark } from "./BrandMark";
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
 * (province/amphoe/station/dam), share, snapshot, notifications bell, sources link.
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
  unreadCount,
  notificationsOpen,
  onToggleNotifications,
  bellRef,
}: {
  tier: Tier;
  provinces: Province[];
  selectedProvince: Province;
  places: SearchPlace[];
  onSelectProvince: (code: string) => void;
  onSelectPlace: (place: SearchPlace) => void;
  onShare: () => Promise<boolean>;
  onSnapshot: () => void;
  /** จำนวนรายการที่ยังไม่อ่านในศูนย์การแจ้งเตือน (`lib/notifications.ts`) */
  unreadCount: number;
  notificationsOpen: boolean;
  onToggleNotifications: () => void;
  bellRef: RefObject<HTMLButtonElement | null>;
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

      <ProvinceChip provinces={provinces} selected={selectedProvince} onSelect={onSelectProvince} compact={phone} />

      <div className="relative mx-auto min-w-0 w-full max-w-xl">
        {/* `overflow-hidden` บน label (ไม่ใช่ตัวห่อนอก — นั่นจะบังรายการค้นหาที่ลอย
            ใต้ช่องด้วย): `input` มี padding ซ้าย-ขวารวม ~42px (ที่ว่างให้ไอคอนแว่น
            ขยาย) ที่เบราว์เซอร์ไม่ยอมหดต่ำกว่านั้นแม้ตัวห่อ (`min-w-0`) จะถูกบีบ
            เหลือไม่กี่ px บนจอแคบมาก — ถ้าไม่ตัด มันจะล้นทับปุ่มแชร์ที่อยู่ถัดไปพอดี
            (บั๊กที่เห็นจริงบน iPhone: แว่นขยาย + ไอคอนแชร์ซ้อนกัน) */}
        <label className="relative block overflow-hidden">
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
        {/* ปุ่มบันทึกภาพซ่อนบนมือถือ (แบบเดียวกับปุ่มเต็มจอ/หมุน-เลื่อนที่เปลือกตัดทิ้งบน
            tier นี้): กระดิ่งแจ้งเตือนมาแทนช่องของปุ่ม GitHub และแสดงทุก tier — ถ้ายังมี
            ปุ่มกล้องอยู่ ช่องค้นหาบนจอ 390 ถูกบีบเหลือ 44px (เหลือที่พิมพ์ ~2px หลังหัก
            padding ~42px) คืน 38px ให้ช่องค้นหาแทน */}
        {!phone ? (
          <button
            type="button"
            onClick={onSnapshot}
            title={t("topbar.snapshotTitle")}
            aria-label={t("topbar.snapshotTitle")}
            className={ICON_BUTTON}
          >
            <Camera size={14} />
          </button>
        ) : null}
        {/* กระดิ่งศูนย์การแจ้งเตือน — แทนที่ปุ่ม GitHub เดิม (ลิงก์ซอร์สโค้ดย้ายไปอยู่ใน
            บรรทัดเครดิตของ MapAttribution ที่ mount เสมอ) และแสดง **ทุก tier รวมมือถือ**
            ปุ่มแชร์/ภาพ/กระดิ่ง = 3 × 32px + ช่องว่าง เท่ากับตอนที่ปุ่ม GitHub ยังโชว์บน
            tablet ขึ้นไป — บนมือถือช่องค้นหาถูกบีบลงอีก 38px แต่ label ที่ `overflow-hidden`
            ด้านบนคือสิ่งที่กันแว่นขยายล้นทับปุ่มถัดไป (บั๊กเดิมบน iPhone) จึงยังคุมได้ */}
        <button
          ref={bellRef}
          type="button"
          onClick={onToggleNotifications}
          aria-haspopup="dialog"
          aria-expanded={notificationsOpen}
          aria-label={t("notifications.bell.aria", { n: unreadCount })}
          title={t("notifications.bell.aria", { n: unreadCount })}
          className={`${ICON_BUTTON} relative ${notificationsOpen ? "border-white/25 text-[var(--color-fg)]" : ""}`}
        >
          <Bell size={14} aria-hidden="true" />
          {unreadCount > 0 ? (
            <span
              aria-hidden="true"
              className="tabular-nums absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-risk-high)] px-1 text-[9px] leading-none font-semibold text-white"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </button>
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
