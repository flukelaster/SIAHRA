import type { ComponentProps, ReactNode } from "react";
import { GUTTER, TOPBAR_H } from "../../lib/shellLayout";
import { ChunkBoundary } from "../ui/ChunkBoundary";
import { lazyView } from "../ui/lazyView";
import type { NotificationCenter as NotificationCenterType } from "./NotificationCenter";

/**
 * ศูนย์การแจ้งเตือนเป็น chunk แยก — โหลดตอนกดกระดิ่งครั้งแรก ส่วนที่ต้องมีตั้งแต่แรก
 * (นับรายการที่ยังไม่อ่านให้ป้ายบนกระดิ่ง) อยู่ใน `lib/notifications.ts` ในบันเดิลหลัก
 * เหมือนเดิม วงหมุน/กล่องลองใหม่อยู่ตำแหน่งเดียวกับป๊อปโอเวอร์จริง (ใต้กระดิ่ง ≥ tablet,
 * เต็มความกว้างบนมือถือ)
 */
const NotificationCenterView = lazyView(() => import("./NotificationCenter").then((m) => m.NotificationCenter));

export function LazyNotificationCenter(props: ComponentProps<typeof NotificationCenterType>) {
  const top = GUTTER + TOPBAR_H + 8;
  const frame = (content: ReactNode) => (
    <div
      className="glass absolute z-30 rounded-2xl px-3 py-3"
      style={props.tier === "phone" ? { top, left: GUTTER, right: GUTTER } : { top, right: GUTTER, width: 420, maxWidth: `calc(100vw - ${GUTTER * 2}px)` }}
    >
      {content}
    </div>
  );
  return (
    <ChunkBoundary frame={frame}>
      <NotificationCenterView {...props} />
    </ChunkBoundary>
  );
}
