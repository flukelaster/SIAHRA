import { RotateCcw } from "lucide-react";
import type { MessageKey } from "../../i18n";
import { useT } from "../../i18n/context";
import { layerPresetStatus, type LayerPresetStatus } from "../../lib/layerPresetStatus";
import { topicByKey, type TopicKey } from "../../lib/topics";
import type { MapLayers } from "./Map3DCanvas";

const STATUS_KEY: Record<LayerPresetStatus, MessageKey> = {
  following: "layers.preset.following",
  pending: "layers.preset.pending",
  custom: "layers.preset.custom",
};

const DOT_CLASS: Record<LayerPresetStatus, string> = {
  following: "bg-[var(--color-success)]",
  pending: "bg-[var(--color-fg-subtle)]",
  custom: "bg-[var(--color-risk-medium)]",
};

/**
 * หัวรายการชั้นข้อมูล (redesign PR 3): ชุดของหัวข้อที่เลือกอยู่ และชั้นตอนนี้ "เดินตามหัวข้อ" / "ยังเป็น
 * ชุดเริ่มต้น" (หลังเปิดหน้าบนหัวข้อที่ไม่ใช่ภาพรวม — เปิดหน้าไม่ใช้ชุดของหัวข้อ) / "ปรับเองแล้ว"
 * ปุ่มคืนค่าซ่อนเมื่อเดินตามและตรงกับชุดอยู่แล้ว (กดไปก็ไม่มีอะไรเปลี่ยน)
 *
 * อยู่ใน chunk ของ `panelViews` (lazy) — ไม่อยู่บนเส้นทางของ entry
 */
export function LayerPresetCard({
  topic,
  layers,
  following,
  loadError = null,
  onReset,
}: {
  topic: TopicKey;
  layers: MapLayers;
  following: boolean;
  /** โหลดกฎของชุดหัวข้อไม่สำเร็จตอนเปลี่ยนหัวข้อ — บรรทัดแดง "ใช้ชุดไม่สำเร็จ ชั้นยังเหมือนเดิม" */
  loadError?: string | null;
  /** ตั้งชุดของหัวข้อปัจจุบันแล้วกลับไปเดินตามหัวข้อ (`resetToTopic`) */
  onReset: () => void;
}) {
  const t = useT();
  const status = layerPresetStatus({ layers, following }, topic);
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-white/10 ring-inset" data-layer-preset={status}>
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[status]}`} aria-hidden="true" />
        <div className="min-w-0 leading-tight">
          <p className="text-xs font-semibold text-[var(--color-fg)]">
            {t("layers.preset.title", { topic: t(topicByKey(topic).labelKey) })}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--color-fg-muted)]" aria-live="polite">
            {t(STATUS_KEY[status])}
          </p>
        </div>
      </div>
      {loadError !== null ? (
        <p className="text-[11px] text-[var(--color-risk-extreme)]" role="status">
          {t("layers.preset.loadFailed", { error: loadError })}
        </p>
      ) : null}
      {status === "following" ? null : (
        <button
          type="button"
          onClick={onReset}
          className="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 self-start rounded-lg px-3 text-xs font-medium text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/40 transition-colors ring-inset hover:bg-[var(--color-accent)]/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] md:min-h-8"
        >
          <RotateCcw size={13} aria-hidden="true" />
          {t("layers.preset.reset")}
        </button>
      )}
    </div>
  );
}
