import { lazy, Suspense } from "react";
import App from "./App";
import { useT } from "./i18n/context";

/**
 * ตัวเลือกหน้าตาม path — แอปนี้มีสองหน้าเท่านั้น: แผนที่ กับ `/methodology`
 *
 * ไม่ได้ลง router library เพราะเส้นทางเดียวที่เพิ่มมาคือหน้าเอกสารสถิต และหน้า
 * แผนที่ใช้ query string (`hooks/usePermalink.ts`) เป็นสถานะที่แชร์ได้อยู่แล้ว
 * หน้า methodology โหลดแบบ lazy จึงไม่ไปเพิ่มขนาดบันเดิลของหน้าแผนที่
 */
const MethodologyPage = lazy(() => import("./pages/MethodologyPage"));

/** slug จาก path — `/methodology` เปล่า ๆ ให้ถือว่าเป็นเอกสารแรก */
function methodologySlug(pathname: string): string {
  const rest = pathname.replace(/^\/methodology\/?/, "").replace(/\/$/, "");
  return rest === "" ? "lowland" : rest;
}

export function Root() {
  const t = useT();
  const path = window.location.pathname;
  if (!path.startsWith("/methodology")) return <App />;
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[var(--color-fg-muted)]">{t("methodology.loading")}</div>}>
      <MethodologyPage slug={methodologySlug(path)} />
    </Suspense>
  );
}
