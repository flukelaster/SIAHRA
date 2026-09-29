import { formatFetchedAt } from "../../lib/time";
import { useLang } from "../../i18n/context";
import { THAIWATER_STALE_AFTER_SECONDS } from "../../lib/thaiwaterFreshness";

/**
 * ค้าง = อายุของ `fetchedAt` เกินงบที่ **descriptor ของ API ประกาศ** (`layer.staleAfterSeconds`, 30 นาที) — ไม่ใช่ตัวเลขที่ฝัง
 * ในเว็บ: เดิมฝัง 15 นาทีไว้คู่กับ TTL 5 นาที พอ API เปลี่ยนรอบเป็น 10 นาที ท่อที่ปกติดีจะโชว์ "ข้อมูลค้าง" เอง
 * (อายุบนจอ = API ≤ 10 + แคชขอบ 2 + เบราว์เซอร์ 1 + รอบถามของเว็บ 5 นาที)
 */
export function isApiDataStale(fetchedAt: string | null, staleAfterSeconds: number | null | undefined, nowMs: number): boolean {
  if (fetchedAt === null) return false;
  const fetchedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedMs)) return false;
  return nowMs - fetchedMs > (staleAfterSeconds ?? THAIWATER_STALE_AFTER_SECONDS) * 1000;
}

export function ApiStatusFooter({
  fetchedAt,
  attribution,
  staleAfterSeconds,
}: {
  fetchedAt: string | null;
  attribution: string | null;
  /** `obs.layer.staleAfterSeconds` — null/ไม่มี = ใช้งบตั้งต้น 30 นาที */
  staleAfterSeconds?: number | null;
}) {
  const { lang, t } = useLang();
  const stale = isApiDataStale(fetchedAt, staleAfterSeconds, Date.now());
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
          <span className="font-medium text-[var(--color-fg)]">{t("footer.dataStatus")}</span>
          <span className="text-[var(--color-fg-muted)]">
            {!connected ? t("footer.notConnected") : stale ? t("footer.stale") : t("footer.ok")}
          </span>
        </div>
        {/* fetchedAt = null คือ "ยังไม่เคยดึงสำเร็จ" — ต้องเห็นข้อความนั้น ไม่ใช่หายไปเฉย ๆ */}
        <span className="tabular-nums text-[var(--color-fg-subtle)]">{formatFetchedAt(lang, fetchedAt)}</span>
      </div>
      {attribution ? (
        <p className="text-[10px] leading-snug text-[var(--color-fg-subtle)]">{attribution}</p>
      ) : null}
    </div>
  );
}
