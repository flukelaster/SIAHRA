import { Layers, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { useT } from "../../i18n/context";
import { GUTTER, RAIL_W, TOOLS_W, type ShellSafeArea } from "../../lib/shellLayout";
import { ChunkBoundary } from "../ui/ChunkBoundary";
import type { MapInfo } from "./Map3DCanvas";
import { MapAttribution } from "./MapAttribution";
import { LAYERS_VIEW, type PanelContext } from "./panelRegistry";

/** id ของ popover/แผ่นล่าง — ปุ่มชั้นข้อมูลบนแผนที่ชี้มาที่นี่ด้วย `aria-controls` */
export const LAYERS_DIALOG_ID = "siahra-layers";
const TITLE_ID = `${LAYERS_DIALOG_ID}-title`;

/** ระยะห่างระหว่าง popover กับคอลัมน์เครื่องมือ */
const POPOVER_GAP = 8;
const POPOVER_W = 360;

/**
 * เนื้อของชั้นข้อมูล = `LayersPanel` (การ์ดชุดของหัวข้อ + MapLegend จัดเป็นสามกลุ่ม + สถานะการดึงของ
 * ThaiWater) — ทุกบรรทัด error/ความสด/ป้าย "ภาพประกอบ" ของแต่ละชั้นยังอยู่ครบ (redesign PR 3 แค่จัดกลุ่ม)
 * โหลดเป็น chunk แยกผ่าน `LAYERS_VIEW` ใต้ `ChunkBoundary` (วงหมุน/กล่องลองใหม่)
 */
function LayersBody({ ctx }: { ctx: PanelContext }) {
  const View = LAYERS_VIEW;
  return (
    <ChunkBoundary>
      <View ctx={ctx} />
    </ChunkBoundary>
  );
}

function Title() {
  const t = useT();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Layers size={16} className="shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
      <h2 id={TITLE_ID} className="min-w-0 truncate text-sm font-semibold text-[var(--color-fg)]">
        {t("panel.layers")}
      </h2>
    </div>
  );
}

/**
 * ≥ tablet: popover ชิดซ้ายของคอลัมน์เครื่องมือ บนสุดเสมอแนวกับปุ่มชั้นข้อมูล (`safeArea.top + 8`)
 * ไม่ลอดใต้ TopBar และก้นไม่ลงไปทับ dock (`safeArea.bottom + 8`) — อยู่ร่วมกับ drawer ที่เปิด
 * อยู่ได้: บน tablet แคบ ๆ มันทับ drawer บางส่วน (z-30 เหนือ drawer) แต่ไม่มีวันทับ rail หัวข้อ
 * (`maxWidth` เว้น GUTTER + RAIL_W ไว้เสมอ)
 *
 * ไม่ใช่ modal: ปิดด้วย X / Escape / คลิกนอกกรอบ — คลิกบนปุ่มชั้นข้อมูลเองไม่นับ (ไม่งั้น
 * mousedown ปิดแล้ว click เปิดซ้ำทันที) Escape ถูกรับใน capture phase แล้ว `preventDefault()`
 * เพื่อไม่ให้ `useShellState` ปิด drawer ซ้ำ (แบบเดียวกับ `NotificationCenter`) X / Escape คืน
 * โฟกัสให้ปุ่ม
 */
export function LayersPopover({
  ctx,
  safeArea,
  buttonRef,
  onClose,
}: {
  ctx: PanelContext;
  safeArea: ShellSafeArea;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
      buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose, buttonRef]);

  const right = GUTTER + TOOLS_W + POPOVER_GAP;
  const top = safeArea.top + 8;
  const bottom = safeArea.bottom + 8;
  return (
    <div
      ref={panelRef}
      id={LAYERS_DIALOG_ID}
      role="dialog"
      aria-modal="false"
      aria-labelledby={TITLE_ID}
      tabIndex={-1}
      className="glass absolute z-30 flex flex-col rounded-2xl outline-none"
      style={{
        top,
        right,
        width: POPOVER_W,
        maxWidth: `calc(100vw - ${right + GUTTER + RAIL_W + GUTTER}px)`,
        maxHeight: `calc(100dvh - ${top + bottom}px)`,
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-white/8 px-3.5 py-2.5">
        <Title />
        <button
          type="button"
          onClick={() => {
            onClose();
            buttonRef.current?.focus();
          }}
          aria-label={t("layers.close")}
          title={t("layers.close")}
          className="ml-auto flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--color-fg-muted)] transition-colors hover:bg-white/8 hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          <X size={15} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        <LayersBody ctx={ctx} />
      </div>
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * phone: แผ่นล่างแบบ modal เหนือทุกอย่าง (scrim + ปุ่ม "เสร็จ") — Escape / แตะ scrim / เสร็จ
 * ปิด; Tab วนอยู่ในแผ่น; ปิดแล้วโฟกัสกลับไปที่ปุ่มชั้นข้อมูลเสมอ (modal ต้องคืนโฟกัสทุกทาง)
 *
 * แผ่นนี้บังส่วน peek ของแผ่นเลื่อน (รวมบรรทัดเครดิต) ระหว่างที่เปิด แต่แผนที่ยังมองเห็นผ่าน
 * scrim — เครดิตภาพดาวเทียม (Esri ToU / EOX CC BY-NC-SA) จึงต้องมองเห็นได้ต่อ: ท้ายแผ่นมี
 * `MapAttribution` แบบย่อของตัวเอง
 */
export function LayersSheet({
  ctx,
  mapInfo,
  exaggeration,
  buttonRef,
  onClose,
}: {
  ctx: PanelContext;
  mapInfo: MapInfo | null;
  exaggeration: number;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const t = useT();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const doneRef = useRef<HTMLButtonElement | null>(null);
  const [attributionExpanded, setAttributionExpanded] = useState(false);

  useEffect(() => {
    doneRef.current?.focus();
    const button = buttonRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // modal: ทุกทางที่ปิด (เสร็จ / scrim / Escape / ชั้นเปลี่ยน tier) คืนโฟกัสให้ปุ่ม
      button?.focus();
    };
  }, [onClose, buttonRef]);

  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const nodes = sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="absolute inset-0 z-40">
      {/* scrim — แตะเพื่อปิด (ไม่ใช่ปุ่มในลำดับ Tab: ทางปิดของคีย์บอร์ดคือ "เสร็จ" / Escape) */}
      <div className="absolute inset-0 bg-black/55" aria-hidden="true" onClick={onClose} />
      <div
        ref={sheetRef}
        id={LAYERS_DIALOG_ID}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        onKeyDown={trapTab}
        className="glass absolute right-0 bottom-0 left-0 flex flex-col rounded-t-2xl"
        style={{ maxHeight: "88dvh", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-white/8 px-3.5 py-2">
          <Title />
          <button
            ref={doneRef}
            type="button"
            onClick={onClose}
            className="ml-auto flex h-11 min-w-16 shrink-0 cursor-pointer items-center justify-center rounded-lg px-3 text-sm font-semibold text-[var(--color-accent)] transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            {t("layers.done")}
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          <LayersBody ctx={ctx} />
        </div>
        <div className="shrink-0 border-t border-white/8 px-2 py-1.5">
          <MapAttribution
            info={mapInfo}
            exaggeration={exaggeration}
            expanded={attributionExpanded}
            onToggle={() => setAttributionExpanded((v) => !v)}
            compact
          />
        </div>
      </div>
    </div>
  );
}
