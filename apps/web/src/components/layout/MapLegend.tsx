import { ExternalLink, Gauge, Layers } from "lucide-react";
import type { QualityLevel, QualityMode } from "../../scene/quality";
import type { MapLayers } from "./Map3DCanvas";
import type { LayerDescriptors } from "../../hooks/useLayerDescriptors";
import { useNow } from "../../hooks/useNow";
import { describeLayerFreshness } from "../../lib/layerFreshness";
import {
  ILLUSTRATIVE_HATCH_ANGLE_DEG,
  ILLUSTRATIVE_HATCH_DUTY,
  ILLUSTRATIVE_HATCH_PERIOD_PX,
  ILLUSTRATIVE_RIM_WIDTH_PX,
  illustrativeCss,
} from "../../lib/illustrativeStyle";

const SITUATION_LEVELS = [
  { label: "ปกติ", color: "#22c55e" },
  { label: "น้ำมาก", color: "#f97316" },
  { label: "ล้นตลิ่ง", color: "#ef4444" },
  { label: "น้ำน้อย", color: "#fcd34d" },
];

const RAIN_BANDS = [
  { label: "< 10 มม.", color: "#38bdf8" },
  { label: "10–35 มม.", color: "#eab308" },
  { label: "35–90 มม.", color: "#f97316" },
  { label: "> 90 มม.", color: "#ef4444" },
];

/**
 * สัญลักษณ์ของชั้น "ภาพประกอบ" — ลายเส้นทแยงชุดเดียวกับที่ shader วาดลงบน
 * ภูมิประเทศ (สี มุม และสัดส่วนเส้นมาจาก `lib/illustrativeStyle.ts` ที่ทั้งสองฝั่ง
 * อ่านร่วมกัน) เพื่อให้สัญลักษณ์ตรงกับสิ่งที่เห็นบนแผนที่จริง ๆ
 */
function IllustrativeSwatch() {
  // viewBox 20×12 บนกล่องขนาด 20×12 CSS px → 1 หน่วย = 1 px พอดี ระยะห่างลายจึง
  // เท่ากับที่ shader วาดบนแผนที่จริง (ค่าเดียวกัน คูณ pixelRatio ฝั่ง GPU)
  //
  // ห้ามใส่ preserveAspectRatio="none" ที่นี่: มันจะยืด pattern ตามกล่องเงียบ ๆ
  // ถ้าวันหน้าขนาดกล่องเปลี่ยน คาบลายบน swatch จะเลิกตรงกับที่ shader วาด ทั้งที่
  // ทั้งคู่ยังอ่านค่าคงที่ตัวเดียวกันอยู่ — คือ drift แบบที่ illustrativeStyle.ts
  // เตือนไว้ในหัวไฟล์พอดี ค่า default (`xMidYMid meet`) รักษาสัดส่วนไว้ให้เอง
  const period = ILLUSTRATIVE_HATCH_PERIOD_PX;
  const stroke = period * ILLUSTRATIVE_HATCH_DUTY;
  const rim = ILLUSTRATIVE_RIM_WIDTH_PX;
  return (
    <svg className="h-3 w-5 rounded-sm" viewBox="0 0 20 12" aria-hidden="true">
      <defs>
        <pattern
          id="siahra-illustrative-hatch"
          width={period}
          height={period}
          patternUnits="userSpaceOnUse"
          patternTransform={`rotate(${ILLUSTRATIVE_HATCH_ANGLE_DEG})`}
        >
          <rect width={period} height={period} fill={illustrativeCss("dark")} />
          <rect width={stroke} height={period} fill={illustrativeCss("light")} />
        </pattern>
      </defs>
      <rect width="20" height="12" fill="url(#siahra-illustrative-hatch)" />
      {/* เส้นขอบเข้ม = สัญญาณเดียวกับที่ shader วาดรอบแปลง (แปลงเล็กจะเหลือแค่ขอบ) */}
      <rect
        x={rim / 2}
        y={rim / 2}
        width={20 - rim}
        height={12 - rim}
        fill="none"
        stroke={illustrativeCss("rim")}
        strokeWidth={rim}
      />
    </svg>
  );
}

const LAYER_ROWS: {
  key: keyof MapLayers;
  label: string;
  note: string;
  swatch: React.ReactNode;
}[] = [
  {
    key: "imagery",
    label: "ภาพดาวเทียม",
    note: "พื้นผิวจริงจากภาพถ่ายดาวเทียม",
    swatch: (
      <span
        className="h-3 w-5 rounded-sm"
        style={{ background: "linear-gradient(135deg,#365a3a,#7a6d4a 60%,#9aa5b1)" }}
      />
    ),
  },
  {
    key: "radar",
    label: "เรดาร์ฝน (กรมอุตุนิยมวิทยา)",
    note: "ภาพสะท้อนเรดาร์ 3 ชม. ล่าสุด เล่นวนซ้ำ · ตรวจวัดจริง",
    swatch: (
      <span
        className="h-3 w-5 rounded-sm"
        style={{ background: "linear-gradient(90deg,#22c55e,#eab308,#ef4444)" }}
      />
    ),
  },
  {
    key: "floodExtent",
    label: "น้ำท่วมจากภาพดาวเทียม (GISTDA)",
    note: "ตรวจพบจากภาพถ่ายดาวเทียมชุดล่าสุด · ไม่ใช่การพยากรณ์",
    swatch: (
      <span
        className="h-3 w-5 rounded-sm"
        style={{ background: "linear-gradient(90deg,#1a5680,#4d94b8 70%,#d9edf7)" }}
      />
    ),
  },
  {
    key: "lowland",
    label: "พื้นที่ลุ่มต่ำ",
    note: "ประมาณจากความสูงภูมิประเทศ ไม่ใช่การพยากรณ์น้ำท่วม",
    swatch: <IllustrativeSwatch />,
  },
  {
    key: "hazard",
    label: "บริเวณสถานีเตือนภัย",
    note: "รัศมีรอบสถานีที่ตรวจพบฝนหนัก/น้ำมาก (ตรวจวัดจริง)",
    swatch: (
      <span
        className="h-3 w-5 rounded-sm"
        style={{ background: "radial-gradient(circle,#ef4444 0%,#f97316 55%,transparent 100%)" }}
      />
    ),
  },
  {
    key: "stations",
    label: "สถานีตรวจวัด",
    note: "จุดกลม = ระดับน้ำ · ข้าวหลามตัด = น้ำฝน",
    swatch: (
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-full border border-white/80 bg-[#22c55e]" />
        <span className="h-2.5 w-2.5 rotate-45 border border-white/80 bg-[#38bdf8]" />
      </span>
    ),
  },
  {
    key: "water",
    label: "แม่น้ำ / คลอง / แหล่งน้ำ (OSM)",
    note: "ผิวน้ำ 3 มิติ วางตามระดับภูมิประเทศ",
    swatch: (
      <span
        className="h-3 w-5 rounded-sm"
        style={{ background: "linear-gradient(90deg,#1e5b93,#3d8fd0)" }}
      />
    ),
  },
  {
    key: "roads",
    label: "ถนนสายหลัก (OSM)",
    note: "มอเตอร์เวย์ / ทางหลวง / ถนนสายรอง",
    swatch: (
      <span
        className="h-3 w-5 rounded-sm"
        style={{ background: "linear-gradient(90deg,#f29e38,#eedc9a)" }}
      />
    ),
  },
  {
    key: "dams",
    label: "เขื่อน / อ่างเก็บน้ำ",
    note: "% ความจุที่รายงาน (ThaiWater)",
    swatch: <span className="h-3 w-3 rounded-sm border border-white/80 bg-[#38bdf8]" />,
  },
  {
    key: "sunlight",
    label: "แสงอาทิตย์ตามเวลาจริง",
    note: "ตำแหน่งดวงอาทิตย์/ท้องฟ้าตามเวลาปัจจุบันหรือเวลาบนไทม์ไลน์",
    swatch: (
      <span
        className="h-3 w-5 rounded-sm"
        style={{ background: "linear-gradient(90deg,#1e2a44,#f6c453,#9fc5f8)" }}
      />
    ),
  },
  {
    key: "trees",
    label: "ต้นไม้ (ESA WorldCover)",
    note: "ป่า/สวนจากแผนที่สิ่งปกคลุมดิน 10 ม. แสดงเมื่อซูมใกล้",
    swatch: <span className="h-3 w-5 rounded-sm" style={{ background: "linear-gradient(90deg,#2c4f1f,#6f9a3c)" }} />,
  },
  {
    key: "buildings",
    label: "อาคาร 3 มิติ (OSM)",
    note: "ทั้งจังหวัด · มองไกลแสดงเฉพาะอาคารใหญ่/สูง",
    swatch: <span className="h-3 w-5 rounded-sm bg-[#d6d9de]" />,
  },
];

function LegendRow({ label, color, shape = "circle" }: { label: string; color: string; shape?: "circle" | "diamond" }) {
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
      <span
        className={`h-2.5 w-2.5 shrink-0 border border-white/70 ${shape === "circle" ? "rounded-full" : "rotate-45"}`}
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {label}
    </div>
  );
}

const QUALITY_LABEL: Record<QualityLevel, string> = { high: "สูง", balanced: "สมดุล", low: "ประหยัด" };

/**
 * ป้ายชนิดความรู้ + บรรทัดเวลาของชั้นข้อมูลหนึ่งแถว
 *
 * อายุข้อมูลคำนวณจาก `nowMs` ที่ส่งเข้ามา (นาฬิกาเดินจาก `useNow`) ทุกครั้งที่
 * เรนเดอร์ ไม่ได้เก็บไว้ที่ไหนและไม่ได้มาจาก API — และ `fetchedAt: null` จะถูกแปลง
 * เป็นข้อความตามชนิดของชั้น ไม่ใช่เวลาปัจจุบัน (ดู `lib/layerFreshness.ts`)
 */
function LayerMeta({ entry, nowMs }: { entry: NonNullable<LayerDescriptors[keyof MapLayers]>; nowMs: number }) {
  const { descriptor } = entry;
  const f = describeLayerFreshness(descriptor, entry.health, nowMs);
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span
        className={`rounded px-1 py-px text-[9px] leading-[1.35] ring-1 ring-inset ${f.badge.className}`}
        title={f.badge.title}
      >
        {f.badge.label}
      </span>
      <span
        className={`text-[10px] ${f.amber ? "text-[var(--color-risk-medium)]" : "text-[var(--color-fg-subtle)]"}`}
      >
        {f.timeText}
        {f.statusText ? ` · ${f.statusText}` : ""}
      </span>
      {descriptor.methodologyUrl ? (
        <a
          href={descriptor.methodologyUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-accent)] hover:underline"
        >
          วิธีคำนวณ
          <ExternalLink size={9} aria-hidden="true" />
        </a>
      ) : null}
    </span>
  );
}

export function MapLegend({
  layers,
  onToggle,
  descriptors,
  quality,
  qualityLevel,
  onQualityChange,
}: {
  layers: MapLayers;
  onToggle: (key: keyof MapLayers, value: boolean) => void;
  /** `HazardLayerDescriptor` ต่อชั้น (useLayerDescriptors) — ไม่มี = ไม่ใช่ข้อมูล */
  descriptors: LayerDescriptors;
  quality: QualityMode;
  qualityLevel: QualityLevel;
  onQualityChange: (q: QualityMode) => void;
}) {
  const nowMs = useNow();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Layers size={14} className="text-[var(--color-accent)]" aria-hidden="true" />
        <p className="text-xs font-semibold text-[var(--color-fg)]">ชั้นข้อมูลและสัญลักษณ์</p>
      </div>

      <ul className="flex flex-col gap-1">
        {LAYER_ROWS.map((row) => {
          const entry = descriptors[row.key];
          return (
          <li key={row.key}>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-white/5">
              <input
                type="checkbox"
                checked={layers[row.key]}
                onChange={(e) => onToggle(row.key, e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--color-accent)]"
              />
              <span className="mt-0.5 flex w-6 shrink-0 items-center" aria-hidden="true">
                {row.swatch}
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block text-xs text-[var(--color-fg)]">{row.label}</span>
                <span className="block text-[10px] text-[var(--color-fg-subtle)]">{row.note}</span>
                {entry ? <LayerMeta entry={entry} nowMs={nowMs} /> : null}
              </span>
            </label>
          </li>
          );
        })}
      </ul>

      <div className="h-px bg-white/8" />

      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-fg-subtle)]">
          <Gauge size={12} aria-hidden="true" /> คุณภาพภาพ
          <span className="text-[var(--color-fg-muted)]">
            {quality === "auto" ? `(อัตโนมัติ: ${QUALITY_LABEL[qualityLevel]})` : ""}
          </span>
        </span>
        <div className="flex rounded-md bg-white/5 p-0.5">
          {(["auto", "high", "low"] as QualityMode[]).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onQualityChange(q)}
              aria-pressed={quality === q}
              className={`cursor-pointer rounded px-2 py-0.5 text-[10px] transition-colors ${
                quality === q ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
              }`}
            >
              {q === "auto" ? "อัตโนมัติ" : q === "high" ? "สูง" : "ประหยัด"}
            </button>
          ))}
        </div>
      </div>

      <div className="h-px bg-white/8" />

      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-medium text-[var(--color-fg-subtle)]">
          สถานีวัดระดับน้ำ (เกณฑ์ ThaiWater)
        </p>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          {SITUATION_LEVELS.map((l) => (
            <LegendRow key={l.label} {...l} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-medium text-[var(--color-fg-subtle)]">ฝนสะสม 24 ชม.</p>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          {RAIN_BANDS.map((l) => (
            <LegendRow key={l.label} {...l} shape="diamond" />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
          <span className="h-0.5 w-5 rounded bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]" aria-hidden="true" />
          ขอบเขตจังหวัด
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
          <span
            className="h-3 w-3 rounded-full border-2 border-red-400/80 shadow-[0_0_0_2px_rgba(239,68,68,0.25)]"
            aria-hidden="true"
          />
          แผ่นดินไหวที่ตรวจพบ (30 วัน)
        </div>
      </div>
    </div>
  );
}
