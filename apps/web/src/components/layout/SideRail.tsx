import type { RefObject } from "react";
import { useT } from "../../i18n/context";
import type { PanelKey } from "../../lib/shellPrefs";
import { IconButton } from "../ui/Panel";
import { PanelBadge } from "./PanelBadge";
import { PANELS, type PanelContext } from "./panelRegistry";

export const DRAWER_ID = "siahra-drawer";

/** แถบไอคอน 48 px ซ้ายสุด — ปุ่มละแผง กดซ้ำที่แผงที่เปิดอยู่ = ปิด drawer */
export function SideRail({
  ctx,
  panel,
  drawerOpen,
  onToggle,
  buttonRefs,
}: {
  ctx: PanelContext;
  panel: PanelKey;
  drawerOpen: boolean;
  onToggle: (key: PanelKey) => void;
  /** SideDrawer คืนโฟกัสให้ปุ่มของแผงที่เพิ่งปิด */
  buttonRefs: RefObject<Partial<Record<PanelKey, HTMLButtonElement | null>>>;
}) {
  const t = useT();
  return (
    <nav
      aria-label={t("rail.aria")}
      className="flex w-12 shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-r border-white/8 py-1.5"
    >
      {PANELS.map((p) => {
        const Icon = p.icon;
        const badge = p.badge?.(ctx) ?? null;
        return (
          <div key={p.key} className="relative shrink-0">
            <IconButton
              ref={(el) => {
                buttonRefs.current[p.key] = el;
              }}
              label={t(p.labelKey)}
              active={drawerOpen && panel === p.key}
              controls={DRAWER_ID}
              onClick={() => onToggle(p.key)}
            >
              <Icon size={17} aria-hidden="true" />
            </IconButton>
            <PanelBadge badge={badge} />
          </div>
        );
      })}
    </nav>
  );
}
