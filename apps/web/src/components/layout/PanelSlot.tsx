import { ChunkBoundary } from "../ui/ChunkBoundary";
import type { PanelContext, PanelDef } from "./panelRegistry";

/**
 * ที่วางเนื้อแผงที่เปิดอยู่ — ใช้ร่วมกันโดย `SideDrawer` และ `MobileSheet` เนื้อแผงเป็น
 * chunk แยก (`PanelDef.view`) ระหว่างโหลดจึงเห็นวงหมุน "กำลังโหลด..." ในกรอบสูงขั้นต่ำ
 * (ไม่ใช่กล่องว่างที่อ่านได้ว่าไม่มีข้อมูล) และโหลดพลาดได้กล่องลองใหม่ ไม่ใช่จอขาว
 *
 * `key={def.key}`: สลับแผง = boundary ใหม่ — error ของแผงหนึ่งไม่ค้างไปบังอีกแผง
 */
export function PanelSlot({ def, ctx }: { def: PanelDef; ctx: PanelContext }) {
  const View = def.view;
  return (
    <ChunkBoundary key={def.key}>
      <View ctx={ctx} />
    </ChunkBoundary>
  );
}
