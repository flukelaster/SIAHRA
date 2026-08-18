import { X } from "lucide-react";
import { useState } from "react";
import type { PickResult } from "../../scene/picking";
import { useStationHistory } from "../../hooks/useStationHistory";
import { Sparkline } from "../hazard/Sparkline";
import { formatNumber } from "../../lib/number";
import { formatDateTime } from "../../lib/time";

function fmtTime(iso: string | null | undefined): string {
  return iso ? formatDateTime(iso) : "—";
}

const SITUATION: Record<number, string> = { 1: "น้ำน้อยวิกฤต", 2: "น้ำน้อย", 3: "ปกติ", 4: "น้ำมาก", 5: "ล้นตลิ่ง" };

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 text-[11px]">
      <span className="text-[var(--color-fg-subtle)]">{k}</span>
      <span className="tabular-nums text-[var(--color-fg)]">{v}</span>
    </div>
  );
}

const HISTORY_RANGES = [
  { hours: 72, label: "72 ชม." },
  { hours: 168, label: "7 วัน" },
  { hours: 720, label: "30 วัน" },
];

function WaterLevelBody({ pick }: { pick: Extract<PickResult, { kind: "waterlevel" }> }) {
  const { obs } = pick;
  const [hours, setHours] = useState(72);
  const history = useStationHistory(obs.station.id, true, hours);
  return (
    <>
      <p className="text-sm font-semibold text-white">{obs.station.nameTh ?? `สถานี ${obs.station.id}`}</p>
      <p className="text-[11px] text-[var(--color-fg-muted)]">
        {[obs.station.amphoeNameTh, obs.station.basinNameTh, obs.station.agencyShortTh].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-2 flex flex-col gap-0.5">
        {obs.situationLevel ? <Row k="สถานการณ์ (ThaiWater)" v={SITUATION[obs.situationLevel]} /> : <Row k="สถานการณ์" v="ค่าย้อนหลัง — ไม่ระบุ" />}
        {obs.waterlevelMsl !== null ? <Row k="ระดับน้ำ" v={`${obs.waterlevelMsl.toFixed(2)} ม.รทก.`} /> : null}
        {obs.minBankMsl !== null ? <Row k="ตลิ่งต่ำสุด" v={`${obs.minBankMsl.toFixed(2)} ม.รทก.`} /> : null}
        {obs.freeboardM !== null ? (
          <Row k={obs.freeboardM <= 0 ? "สูงกว่าตลิ่ง" : "ต่ำกว่าตลิ่ง"} v={`${Math.abs(obs.freeboardM).toFixed(2)} ม.`} />
        ) : null}
        <Row k="เวลาตรวจวัด" v={fmtTime(obs.observedAt)} />
      </div>
      <div className="mt-2 rounded-lg bg-black/30 px-2 py-1.5">
        {history.loading ? (
          <div className="h-16 animate-pulse rounded bg-white/8" />
        ) : history.data ? (
          <>
            <Sparkline points={history.data.points} bankMsl={history.data.datum === "msl" ? obs.minBankMsl : null} />
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-[var(--color-fg-subtle)]">
                ค่าตรวจวัดจริง{history.data.fromArchive ? " · บางส่วนจากคลังถาวร" : ""}
              </p>
              <span className="flex rounded bg-white/5 p-0.5">
                {HISTORY_RANGES.map((r) => (
                  <button
                    key={r.hours}
                    type="button"
                    onClick={() => setHours(r.hours)}
                    className={`cursor-pointer rounded px-1.5 text-[10px] ${hours === r.hours ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-fg-muted)]"}`}
                  >
                    {r.label}
                  </button>
                ))}
              </span>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-[var(--color-fg-subtle)]">ไม่มีข้อมูลย้อนหลัง</p>
        )}
      </div>
    </>
  );
}

export function InfoPopup({ pick, onClose }: { pick: PickResult; onClose: () => void }) {
  return (
    <div className="glass pointer-events-auto relative w-72 rounded-xl px-3 py-2.5 shadow-2xl">
      <button
        type="button"
        onClick={onClose}
        aria-label="ปิด"
        className="absolute top-1.5 right-1.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-white/10 hover:text-white"
      >
        <X size={13} />
      </button>
      {pick.kind === "waterlevel" ? <WaterLevelBody pick={pick} /> : null}
      {pick.kind === "rainfall" ? (
        <>
          <p className="text-sm font-semibold text-white">{pick.obs.station.nameTh ?? `สถานี ${pick.obs.station.id}`}</p>
          <p className="text-[11px] text-[var(--color-fg-muted)]">
            {[pick.obs.station.amphoeNameTh, pick.obs.station.agencyShortTh].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex flex-col gap-0.5">
            <Row k="ฝนสะสม 24 ชม." v={pick.obs.rain24h !== null ? `${pick.obs.rain24h.toFixed(1)} มม.` : "—"} />
            <Row k="ฝน 1 ชม." v={pick.obs.rain1h !== null ? `${pick.obs.rain1h.toFixed(1)} มม.` : "—"} />
            <Row k="เวลาตรวจวัด" v={fmtTime(pick.obs.observedAt)} />
          </div>
        </>
      ) : null}
      {pick.kind === "dam" ? (
        <>
          <p className="text-sm font-semibold text-white">
            {pick.dam.kind === "large" ? "เขื่อน" : ""}
            {pick.dam.nameTh ?? pick.dam.nameEn ?? `#${pick.dam.id}`}
          </p>
          <p className="text-[11px] text-[var(--color-fg-muted)]">
            {[pick.dam.basinNameTh, pick.dam.agencyShortTh].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex flex-col gap-0.5">
            <Row k="ความจุที่เก็บกัก" v={pick.dam.storagePercent !== null ? `${pick.dam.storagePercent.toFixed(1)} %` : "—"} />
            <Row k="ปริมาณน้ำ" v={pick.dam.storageMcm !== null ? `${formatNumber(pick.dam.storageMcm, 1)} ล้าน ลบ.ม.` : "—"} />
            {pick.dam.maxStorageMcm !== null ? <Row k="ความจุสูงสุด" v={`${formatNumber(pick.dam.maxStorageMcm)} ล้าน ลบ.ม.`} /> : null}
            {pick.dam.inflowMcm !== null ? <Row k="น้ำไหลเข้า" v={`${pick.dam.inflowMcm.toFixed(2)} ล้าน ลบ.ม./วัน`} /> : null}
            {pick.dam.releasedMcm !== null ? <Row k="ระบายออก" v={`${pick.dam.releasedMcm.toFixed(2)} ล้าน ลบ.ม./วัน`} /> : null}
            <Row k="รายงานเมื่อ" v={fmtTime(pick.dam.observedAt)} />
          </div>
        </>
      ) : null}
      {pick.kind === "quake" ? (
        <>
          <p className="text-sm font-semibold text-white">แผ่นดินไหว M{pick.event.mag?.toFixed(1) ?? "—"}</p>
          <p className="text-[11px] text-[var(--color-fg-muted)]">{pick.event.place ?? "ไม่ระบุตำแหน่ง"}</p>
          <div className="mt-2 flex flex-col gap-0.5">
            <Row k="ความลึก" v={pick.event.depthKm !== null ? `${pick.event.depthKm.toFixed(0)} กม.` : "—"} />
            <Row k="เวลา (ท้องถิ่น)" v={fmtTime(pick.event.time)} />
            <Row k="แหล่งข้อมูล" v={pick.event.sources.join(" / ").toUpperCase()} />
            <Row k="สถานะ" v={pick.event.status === "automatic" ? "ตรวจพบอัตโนมัติ ยังไม่ตรวจสอบ" : "ตรวจสอบแล้ว"} />
          </div>
        </>
      ) : null}
      {pick.kind === "ground" ? (
        <>
          <p className="text-sm font-semibold text-white">{pick.flood ? `ต.${pick.flood.properties.tambonTh ?? ""} — พื้นที่น้ำท่วม` : "ตำแหน่งบนแผนที่"}</p>
          <div className="mt-2 flex flex-col gap-0.5">
            <Row k="พิกัด" v={`${pick.lat.toFixed(5)}, ${pick.lon.toFixed(5)}`} />
            <Row k="ความสูงภูมิประเทศ (DSM)" v={`${pick.elevationM.toFixed(0)} ม.`} />
            {pick.flood ? (
              <>
                <Row k="อำเภอ" v={pick.flood.properties.amphoeTh ?? "—"} />
                <Row k="พื้นที่น้ำท่วม" v={pick.flood.properties.floodAreaRai !== null ? `${formatNumber(Math.round(pick.flood.properties.floodAreaRai))} ไร่` : "—"} />
                <Row k="พบครั้งแรก" v={fmtTime(pick.flood.properties.firstSeenAt)} />
                <Row k="พบล่าสุด" v={fmtTime(pick.flood.properties.lastSeenAt)} />
              </>
            ) : null}
          </div>
          {pick.flood ? (
            <p className="mt-1.5 text-[10px] text-[var(--color-fg-subtle)]">แปลจากภาพดาวเทียม (GISTDA) — สิ่งที่ตรวจพบแล้ว ไม่ใช่การพยากรณ์</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
