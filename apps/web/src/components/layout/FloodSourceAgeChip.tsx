import { Satellite } from "lucide-react";
import { useNow } from "../../hooks/useNow";
import { useLang } from "../../i18n/context";
import { floodSourceAgeParts, type ChipTone, type FloodSourceAgeInput } from "../../lib/floodSourceAge";

const TONE_DOT: Record<ChipTone, string> = {
  ok: "bg-emerald-400",
  warn: "bg-[var(--color-risk-medium)]",
  bad: "bg-[var(--color-risk-extreme)]",
  muted: "bg-white/40",
};

/**
 * ชิปอายุของแหล่งน้ำท่วมจากดาวเทียม (E16 B-1) — ข้างชื่อจังหวัด/StatPills บนแผนที่ และใน
 * แผ่นเลื่อนบนมือถือ: บอกว่า GISTDA ติดต่อได้ไหม/อัปเดตเมื่อไหร่ และ Sentinel-1 ผ่านล่าสุดกี่วันก่อน
 * ข้อความทั้งหมดมาจาก `lib/floodSourceAge.ts` (เทสได้) — อายุคำนวณตอนเรนเดอร์ด้วย `useNow`
 */
export function FloodSourceAgeChip({ input, compact = false }: { input: FloodSourceAgeInput; compact?: boolean }) {
  const { lang, t } = useLang();
  const nowMs = useNow();
  const parts = floodSourceAgeParts(input, lang, nowMs);
  return (
    <p
      // ขึ้นบรรทัดใหม่ได้ (ข้อความสองแหล่งยาวบนจอแคบ) — มุมโค้งแบบกล่องแทนแคปซูล
      className={`inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl bg-black/70 text-white/85 backdrop-blur-sm ${
        compact ? "px-2 py-1 text-[10px] leading-4" : "px-2.5 py-0.5 text-[11px] leading-5"
      }`}
      title={t("floodAge.title")}
      aria-label={`${t("floodAge.title")}: ${parts.map((p) => `${p.label} ${p.value}`).join(" · ")}`}
    >
      <Satellite size={compact ? 10 : 12} className="shrink-0 text-white/70" aria-hidden="true" />
      {parts.map((p, i) => (
        <span key={p.key} className="inline-flex items-center gap-1">
          {i > 0 ? <span className="text-white/35" aria-hidden="true">·</span> : null}
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[p.tone]}`} aria-hidden="true" />
          <span className="text-white/60">{p.label}:</span>
          <span>{p.value}</span>
        </span>
      ))}
    </p>
  );
}
