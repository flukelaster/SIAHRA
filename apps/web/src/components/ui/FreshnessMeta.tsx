import { ExternalLink } from "lucide-react";
import type { HazardLayerDescriptor, SourceHealth } from "@siahra/shared-types";
import { describeLayerFreshness } from "../../lib/layerFreshness";
import { useLang } from "../../i18n/context";
import type { Lang } from "../../i18n";
import { useNow } from "../../hooks/useNow";

/**
 * ลิงก์ไปหน้า `/methodology/...` พร้อม `?lang=` ปัจจุบัน — คัดลอกมาจาก
 * `MapLegend.tsx`'s ตัวเดียวกัน (ไม่ได้ export) หน้านั้นเป็นคนละ route ที่ไม่ได้
 * mount `usePermalinkSync` จึงอ่านภาษาได้จาก query string เท่านั้น
 */
function methodologyHref(url: string, lang: Lang): string {
  if (lang === "th" || url.includes("lang=")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}lang=${lang}`;
}

/**
 * ป้ายชนิดความรู้ + บรรทัดเวลาของ `HazardLayerDescriptor` หนึ่งตัว — เวอร์ชันใช้
 * นอก `MapLegend` (การ์ดข้อมูล อปท. มีหลาย descriptor ต่อการ์ดหนึ่งใบ ต่างจาก
 * legend ที่มีหนึ่งต่อชั้น) เป็นตัวเดียวกับ `MapLegend.tsx`'s `LayerMeta` ทุก
 * ประการ (ยืม `describeLayerFreshness` ตัวเดียวกัน) แต่ตัวนั้นไม่ได้ export —
 * ไม่คุ้มที่จะแก้ MapLegend.tsx เพื่อ export ฟังก์ชัน 20 บรรทัดออกมาใช้ที่เดียว
 * ในงานนี้ จึงประกอบใหม่จาก building block เดียวกัน
 */
export function FreshnessMeta({
  descriptor,
  health,
}: {
  descriptor: HazardLayerDescriptor;
  health: SourceHealth | null;
}) {
  const { lang, t } = useLang();
  const nowMs = useNow();
  const f = describeLayerFreshness(descriptor, health, nowMs, lang, t);
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span
        className={`rounded px-1 py-px text-[9px] leading-[1.35] ring-1 ring-inset ${f.badge.className}`}
        title={f.badge.title}
      >
        {f.badge.label}
      </span>
      <span
        className={`text-[10px] ${f.amber ? "text-[var(--color-risk-medium)]" : "text-[var(--color-fg-subtle)]"}`}
      >
        {f.timeText}
        {f.statusText ? ` · ${f.statusText}` : ""}
      </span>
      {descriptor.methodologyUrl ? (
        <a
          href={methodologyHref(descriptor.methodologyUrl, lang)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-accent)] hover:underline"
        >
          {t("freshness.methodology")}
          <ExternalLink size={9} aria-hidden="true" />
        </a>
      ) : null}
    </span>
  );
}
