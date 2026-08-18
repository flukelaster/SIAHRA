import { Info, Satellite } from "lucide-react";
import type { FloodExtentState } from "../../hooks/useFloodExtent";
import { Panel } from "../ui/Panel";

function ago(iso: string | null): string {
  if (!iso) return "—";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} ชม.ที่แล้ว` : `${Math.floor(h / 24)} วันที่แล้ว`;
}

function dateTh(iso: string): string {
  return new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Satellite-observed flood extent for the selected province. Everything shown
 * is what GISTDA's latest interpreted scene contains — with when *we* fetched
 * it and when each polygon first appeared, because the scene itself carries
 * no timestamp.
 */
export function FloodExtentCard({ state }: { state: FloodExtentState }) {
  const { data, loading, error } = state;
  const features = data?.features ?? [];
  const totalRai = features.reduce((a, f) => a + (f.properties.floodAreaRai ?? 0), 0);
  const houses = features.reduce((a, f) => a + (f.properties.houses ?? 0), 0);
  const ranked = [...features].sort(
    (a, b) => (b.properties.floodAreaRai ?? 0) - (a.properties.floodAreaRai ?? 0),
  );
  const earliest = features.reduce<string | null>(
    (acc, f) => (acc === null || f.properties.firstSeenAt < acc ? f.properties.firstSeenAt : acc),
    null,
  );

  return (
    <Panel
      title="น้ำท่วมจากภาพดาวเทียม"
      icon={<Satellite size={16} className="text-[var(--color-accent)]" aria-hidden="true" />}
      headerAction={
        <span className="rounded bg-[var(--color-success)]/15 px-1.5 text-[10px] text-[var(--color-success)]">
          สังเกตการณ์จริง
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {loading && !data ? (
          <div className="h-10 animate-pulse rounded bg-white/8" />
        ) : error && !data ? (
          <p className="rounded-lg bg-[var(--color-danger)]/10 px-2.5 py-2 text-xs text-[var(--color-danger)]">
            โหลดชั้นน้ำท่วมไม่ได้: {error}
          </p>
        ) : features.length === 0 && !data?.retrievedAt ? (
          // ไม่เคยดึงสำเร็จ ≠ ไม่มีน้ำท่วม — ห้ามให้ช่องว่างถูกอ่านว่า "ปลอดภัย"
          <p className="rounded-lg bg-[var(--color-risk-medium)]/10 px-2.5 py-3 text-center text-xs text-[var(--color-risk-medium)]">
            ยังดึงภาพชุดล่าสุดจาก GISTDA ไม่ได้ (ต้นทางไม่ตอบสนอง) — ไม่ได้แปลว่าไม่มีน้ำท่วม
          </p>
        ) : features.length === 0 ? (
          <p className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-3 text-center text-xs text-[var(--color-fg-muted)]">
            ไม่พบพื้นที่น้ำท่วมในจังหวัดนี้จากภาพชุดล่าสุด
            {data?.retrievedAt ? ` (ดึงเมื่อ ${ago(data.retrievedAt)})` : ""}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className="text-[11px] text-[var(--color-fg-muted)]">ตำบลที่ท่วม</p>
                <p className="text-xl font-bold tabular-nums text-[var(--color-fg)]">{features.length}</p>
              </div>
              <div>
                <p className="text-[11px] text-[var(--color-fg-muted)]">พื้นที่ (ไร่)</p>
                <p className="text-xl font-bold tabular-nums text-[#4d94b8]">
                  {Math.round(totalRai).toLocaleString("th-TH")}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[var(--color-fg-muted)]">บ้านเรือน</p>
                <p className="text-xl font-bold tabular-nums text-[var(--color-fg)]">
                  {houses.toLocaleString("th-TH")}
                </p>
              </div>
            </div>
            <ul className="max-h-48 overflow-y-auto pr-0.5">
              {ranked.slice(0, 20).map((f) => (
                <li
                  key={f.id}
                  className="flex items-center gap-2 border-t border-white/8 py-1.5 first:border-t-0"
                >
                  <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-[#4d94b8]">
                    {Math.round(f.properties.floodAreaRai ?? 0).toLocaleString("th-TH")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-[var(--color-fg)]">
                      {f.properties.tambonTh ?? "ไม่ระบุตำบล"}
                    </p>
                    <p className="truncate text-[11px] text-[var(--color-fg-subtle)]">
                      {f.properties.amphoeTh ?? ""} · พบครั้งแรก {dateTh(f.properties.firstSeenAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-2 text-[11px] text-[var(--color-fg-muted)]">
          <Info size={13} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
          ขอบเขตน้ำท่วมแปลจากภาพดาวเทียมโดย GISTDA (ชุดข้อมูล flooding_vis) — เป็นสิ่งที่ตรวจพบแล้ว
          ไม่ใช่การพยากรณ์ · ภาพชุดนี้ไม่ระบุวันที่ถ่าย ระบบจึงแสดงเวลาที่ดึงข้อมูล
          {data?.retrievedAt ? ` (${ago(data.retrievedAt)})` : ""}
          {earliest ? ` และเวลาที่พบพื้นที่แต่ละแห่งครั้งแรก (เก่าสุด ${dateTh(earliest)})` : ""}
        </p>
      </div>
    </Panel>
  );
}
