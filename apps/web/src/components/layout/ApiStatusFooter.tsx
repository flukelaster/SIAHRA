import { formatFetchedAt } from "../../lib/time";

const STALE_AFTER_MS = 15 * 60 * 1000;

export function ApiStatusFooter({
  fetchedAt,
  attribution,
}: {
  fetchedAt: string | null;
  attribution: string | null;
}) {
  const ageMs = fetchedAt ? Date.now() - Date.parse(fetchedAt) : null;
  const stale = ageMs !== null && ageMs > STALE_AFTER_MS;
  const connected = fetchedAt !== null;

  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${
              !connected
                ? "bg-[var(--color-fg-subtle)]"
                : stale
                  ? "bg-[var(--color-risk-high)]"
                  : "bg-[var(--color-success)] shadow-[0_0_8px_rgba(34,197,94,0.8)]"
            }`}
            aria-hidden="true"
          />
          <span className="font-medium text-[var(--color-fg)]">สถานะข้อมูล</span>
          <span className="text-[var(--color-fg-muted)]">
            {!connected ? "ยังไม่เชื่อมต่อ" : stale ? "ข้อมูลค้าง" : "ปกติ"}
          </span>
        </div>
        {/* fetchedAt = null คือ "ยังไม่เคยดึงสำเร็จ" — ต้องเห็นข้อความนั้น ไม่ใช่หายไปเฉย ๆ */}
        <span className="tabular-nums text-[var(--color-fg-subtle)]">{formatFetchedAt(fetchedAt)}</span>
      </div>
      {attribution ? (
        <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">{attribution}</p>
      ) : null}
    </div>
  );
}
