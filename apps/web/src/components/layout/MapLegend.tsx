import type { ReactNode } from "react";
import { ExternalLink, Gauge, Layers } from "lucide-react";
import type { FloodSceneIndexEntry, ProvinceExposureResponse } from "@siahra/shared-types";
import { DETAIL_TILE_ALTITUDE_GATE_M } from "../../scene/lod";
import type { QualityLevel, QualityMode } from "../../scene/quality";
import type { MapLayers } from "./Map3DCanvas";
import type { LayerDescriptors } from "../../hooks/useLayerDescriptors";
import { useNow } from "../../hooks/useNow";
import { useLang } from "../../i18n/context";
import type { Lang, MessageKey, TFunction } from "../../i18n";
import { describeLayerFreshness } from "../../lib/layerFreshness";
import type { TerrainIntegrity } from "../../scene/loadAoiManifest";
import {
  ILLUSTRATIVE_HATCH_ANGLE_DEG,
  ILLUSTRATIVE_HATCH_DUTY,
  ILLUSTRATIVE_HATCH_PERIOD_PX,
  ILLUSTRATIVE_RIM_WIDTH_PX,
  illustrativeCss,
} from "../../lib/illustrativeStyle";
import {
  countExposureClasses,
  exposureCss,
  type ExposureRenderClass,
} from "../../lib/exposureStyle";
import { forecastCss, type ForecastBandLevel, type ForecastBandStatus } from "../../lib/forecastStyle";
import {
  FLOOD_STIPPLE_DOT_FRAC,
  floodCss,
  floodDepthLegendRamp,
  floodDepthMaxLabel,
  floodDepthStopLabel,
} from "../../lib/floodStyle";
import { FLOOD_SCENE_MAX_AGE_MS, type FloodSceneReason } from "../../lib/floodScenes";
import type { ErrorMessage } from "../../lib/errorMessage";
import { resolveError } from "../../lib/errorMessage";
import { formatNumber } from "../../lib/number";
import { formatAge, formatFullDateTime, formatWeekday } from "../../lib/time";
import type { ExposureUnavailableReason } from "../../hooks/useFloodExposure";
import type { FloodFieldSummary } from "../../scene/floodField";

const SITUATION_LEVELS: { key: MessageKey; color: string }[] = [
  { key: "situation.3", color: "#22c55e" },
  { key: "situation.4", color: "#f97316" },
  { key: "situation.5", color: "#ef4444" },
  { key: "situation.2", color: "#fcd34d" },
];

const RAIN_BANDS: { key: MessageKey; color: string }[] = [
  { key: "legend.rain.band1", color: "#38bdf8" },
  { key: "legend.rain.band2", color: "#eab308" },
  { key: "legend.rain.band3", color: "#f97316" },
  { key: "legend.rain.band4", color: "#ef4444" },
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

/**
 * สัญลักษณ์ของชั้น "ระดับการเผชิญน้ำ (ภาพประกอบ)" — ลายตาราง
 *
 * ลายทแยงชุดล่างคือลายเดียวกับพื้นที่ลุ่มต่ำ (ชั้นนี้วางทับอยู่บนนั้น) และลายทแยง
 * กลับด้านชุดบนคือสิ่งที่ shader เพิ่มเข้ามา ค่าคาบ/สัดส่วนเส้นจึงอ่านจาก
 * `illustrativeStyle.ts` ตัวเดียวกัน และสีจาก `exposureStyle.ts` ตัวเดียวกัน
 */
function ExposureSwatch() {
  const period = ILLUSTRATIVE_HATCH_PERIOD_PX;
  const stroke = period * ILLUSTRATIVE_HATCH_DUTY;
  return (
    <svg className="h-3 w-5 rounded-sm" viewBox="0 0 20 12" aria-hidden="true">
      <defs>
        <pattern
          id="siahra-exposure-hatch-base"
          width={period}
          height={period}
          patternUnits="userSpaceOnUse"
          patternTransform={`rotate(${ILLUSTRATIVE_HATCH_ANGLE_DEG})`}
        >
          <rect width={period} height={period} fill={illustrativeCss("dark")} />
          <rect width={stroke} height={period} fill={illustrativeCss("light")} />
        </pattern>
        <pattern
          id="siahra-exposure-hatch-cross"
          width={period}
          height={period}
          patternUnits="userSpaceOnUse"
          patternTransform={`rotate(${-ILLUSTRATIVE_HATCH_ANGLE_DEG})`}
        >
          <rect width={stroke} height={period} fill={exposureCss("high")} />
        </pattern>
      </defs>
      <rect width="20" height="12" fill="url(#siahra-exposure-hatch-base)" />
      <rect width="20" height="12" fill="url(#siahra-exposure-hatch-cross)" />
    </svg>
  );
}

/**
 * สัญลักษณ์ของ "ความลึกน้ำโดยประมาณ (ภาพประกอบ)" (E14.F4) — แถบสีตื้น → ลึกจาก
 * `floodDepthLegendRamp()` ซึ่งคำนวณด้วย `depthToMix` ตัวเดียวกับที่ shader ใช้
 * (`lib/floodStyle.ts`) ไม่มีสีที่เลือกแยกไว้ที่นี่
 */
function FloodDepthSwatch() {
  const ramp = floodDepthLegendRamp();
  const stops = ramp.map((s, i) => `${s.css} ${((i / (ramp.length - 1)) * 100).toFixed(0)}%`).join(", ");
  return <span className="h-3 w-5 rounded-sm" style={{ background: `linear-gradient(90deg, ${stops})` }} />;
}

/**
 * ชิป "ไม่ได้ประมาณ" — จุดสีน้ำลึกบนพื้นสีน้ำตื้น คาบเท่าลายเส้นของชั้นภาพประกอบ
 * (ค่าเดียวกับ shader: `uHatchPx` × `FLOOD_STIPPLE_DOT_FRAC`) — ต้องอ่านเป็น *ลาย*
 * ไม่ใช่ปลายตื้นของแถบสีข้างบน เพราะ "ไม่ได้ประมาณ" ≠ 0 ม.
 */
function FloodStippleSwatch() {
  const period = ILLUSTRATIVE_HATCH_PERIOD_PX;
  const r = period * FLOOD_STIPPLE_DOT_FRAC;
  return (
    <svg className="h-3 w-5 rounded-sm" viewBox="0 0 20 12" aria-hidden="true">
      <defs>
        <pattern id="siahra-flood-stipple" width={period} height={period} patternUnits="userSpaceOnUse">
          <rect width={period} height={period} fill={floodCss("shallow")} />
          <circle cx={period / 2} cy={period / 2} r={r} fill={floodCss("deep")} />
        </pattern>
      </defs>
      <rect width="20" height="12" fill="url(#siahra-flood-stipple)" />
    </svg>
  );
}

/** สิ่งที่ legend ต้องรู้เกี่ยวกับฉาก Copernicus GFM ที่กำลังแสดง (E14.F4) — ประกอบใน App.tsx */
export interface FloodGfmLegendState {
  /** ฉากที่วาดอยู่ — null เมื่อไม่มีฉากในหน้าต่าง / ยังไม่มีดัชนี */
  scene: FloodSceneIndexEntry | null;
  /** ฉากใหม่สุดก่อนเวลาที่เลือก โดยไม่สนหน้าต่าง 14 วัน */
  latestBefore: FloodSceneIndexEntry | null;
  reason: FloodSceneReason | null;
  /** true = index.json ตอบ 404: จังหวัดนี้ยังไม่มีฉากในระบบ (ข้อเท็จจริง ไม่ใช่ error) */
  missing: boolean;
  loading: boolean;
  /** ดึงดัชนีไม่ได้ ("ถามไม่ได้" — ห้ามอ่านเป็น "ไม่มีฉาก") */
  indexError: ErrorMessage | null;
  /** ดึง/ถอด field.bin ของฉากไม่ได้ */
  fieldError: ErrorMessage | null;
  /** ตัวเลขจากฟิลด์ที่ถอดแล้ว (`summarizeFloodField`) — null ระหว่างโหลด */
  summary: FloodFieldSummary | null;
  /** true = แหล่งค้าง/ไม่ปกติ → แถวหรี่ (แผนที่หรี่ด้วย `uFloodFieldDim` เหมือนกัน) */
  dimmed: boolean;
}

const FLOOD_SCENE_WINDOW_DAYS = Math.round(FLOOD_SCENE_MAX_AGE_MS / 86_400_000);

/**
 * รายละเอียดใต้แถว "น้ำท่วมจากภาพ Sentinel-1" — สี่สถานะที่ต้องเป็นคนละประโยคเสมอ
 * (AGENTS.md: "ถามไม่ได้" ≠ "ต้นทางบอกว่าไม่มี" ≠ "ไม่มีภาพ" ≠ "ภาพบอกว่าแห้ง"):
 *   - ดึงดัชนีไม่ได้            → บอกว่าถามไม่ได้ ไม่พูดถึงสถานะของฉาก
 *   - 404                        → จังหวัดนี้ยังไม่มีฉากในระบบ (ไม่ได้แปลว่าไม่มีน้ำท่วม)
 *   - ไม่มีฉากในหน้าต่าง 14 วัน → "ไม่มีภาพ" + ภาพล่าสุดก่อนหน้านั้นคือเมื่อไหร่
 *   - มีฉาก                      → sceneId + เวลาบันทึกภาพ + พื้นที่ท่วม หรือ "ฉากนี้แห้ง"
 *     (ฉากแห้งคือข้อมูล ไม่ใช่ความเงียบ)
 */
function FloodGfmDetails({ state, lang, t }: { state: FloodGfmLegendState; lang: Lang; t: TFunction }) {
  let body: ReactNode;
  if (state.indexError) {
    body = (
      <span className="text-[10px] text-[var(--color-risk-medium)]">
        {t("legend.floodGfm.indexError", { error: resolveError(t, state.indexError) ?? "" })}
      </span>
    );
  } else if (state.missing) {
    body = <span className="text-[10px] text-[var(--color-fg-muted)]">{t("legend.floodGfm.noScenesForProvince")}</span>;
  } else if (state.reason === "no-scene-in-window") {
    body = (
      <>
        <span className="text-[10px] text-[var(--color-risk-medium)]">
          {t("legend.floodGfm.noSceneInWindow", { days: FLOOD_SCENE_WINDOW_DAYS })}
        </span>
        {state.latestBefore ? (
          <span className="text-[10px] text-[var(--color-fg-subtle)]">
            {t("legend.floodGfm.latestBefore", { time: formatFullDateTime(lang, state.latestBefore.observedAt) })}
          </span>
        ) : null}
      </>
    );
  } else if (state.scene) {
    const s = state.scene;
    body = (
      <>
        <span className="text-[10px] text-[var(--color-fg-subtle)]">
          {t("legend.floodGfm.scene", { id: s.sceneId, time: formatFullDateTime(lang, s.observedAt) })}
        </span>
        <span className="text-[10px] text-[var(--color-fg-subtle)]">
          {s.floodedCells > 0
            ? t("legend.floodGfm.area", { km2: formatNumber(lang, Math.round(s.floodedAreaKm2)) })
            : t("legend.floodGfm.dry")}
        </span>
        {state.fieldError ? (
          <span className="text-[10px] text-[var(--color-risk-medium)]">
            {t("legend.floodGfm.fieldError", { error: resolveError(t, state.fieldError) ?? "" })}
          </span>
        ) : state.loading && !state.summary ? (
          <span className="text-[10px] text-[var(--color-fg-subtle)]">{t("legend.floodGfm.loading")}</span>
        ) : null}
      </>
    );
  } else if (state.loading) {
    body = <span className="text-[10px] text-[var(--color-fg-subtle)]">{t("legend.floodGfm.loading")}</span>;
  } else {
    return null;
  }
  return <div className="mt-1 ml-7 flex flex-col gap-0.5 border-l border-white/8 pl-2">{body}</div>;
}

/**
 * รายละเอียดใต้แถว "ความลึกน้ำโดยประมาณ (ภาพประกอบ)" — สเกล 0 · 0.5 · 1 · 2 · ≥3 ม.
 * จาก ramp เดียวกับ shader + ชิป "ไม่ได้ประมาณ" ที่ต้องอยู่เสมอ (ไม่ใช่ 0 ม.)
 */
function FloodDepthDetails({
  state,
  gfmEnabled,
  lang,
  t,
}: {
  state: FloodGfmLegendState | undefined;
  gfmEnabled: boolean;
  lang: Lang;
  t: TFunction;
}) {
  const ramp = floodDepthLegendRamp();
  const summary = state?.summary ?? null;
  return (
    <div className="mt-1 ml-7 flex flex-col gap-1 border-l border-white/8 pl-2">
      {!gfmEnabled ? (
        <span className="text-[10px] text-[var(--color-fg-subtle)]">{t("legend.floodDepth.needsExtent")}</span>
      ) : null}
      <span className="text-[10px] font-medium text-[var(--color-fg-subtle)]">{t("legend.floodDepth.scale")}</span>
      <div className="flex items-center gap-1">
        {ramp.map((s) => (
          <span key={s.depthM} className="flex flex-col items-center gap-0.5">
            <span className="h-2.5 w-5 rounded-sm border border-white/15" style={{ backgroundColor: s.css }} aria-hidden="true" />
            <span className="text-[9px] tabular-nums text-[var(--color-fg-muted)]">{floodDepthStopLabel(lang, s)}</span>
          </span>
        ))}
      </div>
      <div className="flex items-start gap-1.5 text-[10px] text-[var(--color-fg-muted)]">
        <span className="mt-[2px] flex w-6 shrink-0 items-center" aria-hidden="true">
          <FloodStippleSwatch />
        </span>
        <span className="min-w-0">
          {t("legend.floodDepth.notEstimated")}
          <span className="block text-[var(--color-fg-subtle)]">{t("legend.floodDepth.notEstimated.why")}</span>
        </span>
      </div>
      {summary && summary.floodedCells > 0 ? (
        <span className="text-[10px] text-[var(--color-fg-subtle)]">
          {summary.maxDepthCm === null
            ? t("legend.floodDepth.noneEstimated")
            : t("legend.floodDepth.estimated", {
                pct: Math.round((summary.depthEstimatedCells / summary.floodedCells) * 100),
                max: floodDepthMaxLabel(lang, summary.maxDepthCm),
              })}
        </span>
      ) : null}
    </div>
  );
}

/** สเกลของชั้นการเผชิญน้ำ เรียงจากหนักไปเบา แล้วปิดท้ายด้วยสถานะ "ไม่มีข้อมูล" */
const EXPOSURE_SCALE: { cls: ExposureRenderClass; key: MessageKey }[] = [
  { cls: "severe", key: "legend.exposure.level.severe" },
  { cls: "high", key: "legend.exposure.level.high" },
  { cls: "elevated", key: "legend.exposure.level.elevated" },
  { cls: "low", key: "legend.exposure.level.low" },
  { cls: "no-data", key: "legend.exposure.level.noData" },
];

/** สิ่งที่ legend ต้องรู้เกี่ยวกับ run ล่าสุด (มาจาก `hooks/useFloodExposure.ts`) */
export interface ExposureLegendState {
  run: ProvinceExposureResponse | null;
  /**
   * true = ไม่มีผลคำนวณรอบใหม่ "ของตัวมันเอง" — ทั้งกรณีดึงไม่สำเร็จ และกรณีที่
   * `/api/v1/health` บอกว่า `exposure-illustrative` ไม่ปกติ (E10.3 ตั้งเป็น `delayed`
   * เมื่อไม่มี run เกิน 30 นาที) ชั้นถูกวาดแบบหรี่ และ legend ต้องบอกว่า "ไม่มีตั้งแต่
   * เมื่อไหร่"
   *
   * **ไม่รวม** `inputsDegraded` — ตั้งใจแยกไว้เพราะทั้งสองเกิดพร้อมกันได้จริง (ThaiWater
   * ล่มทั้งหมด → ทั้งไม่มี run ใหม่ และ ThaiWater เองก็ผิดปกติพร้อมกัน) `noNewRun` ที่นี่
   * เป็นข้อเท็จจริงที่ "หนักกว่า" และต้องขึ้นก่อนเสมอเมื่อเป็นจริง ไม่ถูก `inputsDegraded`
   * บังไว้ (ดู `ExposureDetails` — ลำดับ apiUnreachable → run===null → noNewRun →
   * inputsDegraded → ปกติ)
   */
  noNewRun: boolean;
  /**
   * true = เรียก API ไม่สำเร็จ (ทั้งก้อน หรือเฉพาะ endpoint ของชั้นนี้) ต้องแยกจาก
   * `noNewRun` เพราะ "ถามไม่ได้" กับ "ถามแล้วเซิร์ฟเวอร์บอกว่าไม่มีรอบใหม่" เป็นคนละ
   * เรื่อง อย่างหลังเป็นข้อเท็จจริงที่ตรวจมาแล้ว อย่างแรกคือไม่รู้อะไรเลย
   * (ชั้นยังถูกหรี่เหมือนกันทั้งสองกรณี — ต่างกันแค่ข้อความ)
   */
  apiUnreachable: boolean;
  /**
   * true = ThaiWater เอง (แหล่งอินพุตเดียวของ run นี้ — ดู `sourceIds: ["thaiwater"]`
   * ใน apps/api/src/exposure/compute.ts) ไม่ปกติ **ในขณะนี้** ซึ่งแยกจาก `noNewRun`
   * ได้: endpoint ของ exposure เองตอบว่า "ok" และเผยแพร่ run ใหม่ได้อยู่ ทั้งที่
   * ครึ่งหนึ่งของอินพุตที่ใช้คำนวณ run นั้นเป็นค่าเก่า/บางส่วน (sub-feed หนึ่งของ
   * ThaiWater ล่ม แต่อีก sub-feed สำเร็จ) — run จึงอาจ "ใหม่" แต่คำนวณจากอินพุตที่
   * ไม่ครบ ต่างจาก `noNewRun` ที่พูดถึง run ว่าเก่าหรือใหม่เท่านั้น
   *
   * `noNewRun` กับ `inputsDegraded` เป็นจริงพร้อมกันได้ (ดูหมายเหตุใน `noNewRun`) —
   * `ExposureDetails` ให้ `noNewRun` ขึ้นก่อนเสมอในกรณีนั้น ไม่ใช่ `inputsDegraded`
   */
  inputsDegraded?: boolean;
  /**
   * เหตุผลของ 503 ล่าสุดจาก `/exposure/latest` เมื่อ `run === null` (ไม่เคยมีอะไร
   * ให้วาดในเครื่องเลย) — มาจาก field `reason` ที่ api ใส่ในบอดี้ 503 ตรง ๆ
   * (`apps/api/src/routes/exposure.ts`, ดูรายละเอียดที่ `useFloodExposure.ts`):
   *
   *   - `"never-published"` (หรือ `undefined`/`null`) → "ยังไม่เคยได้รับผลคำนวณสักรอบ"
   *     (`noRunEver`) — ข้อความเดิม เป็นค่าเริ่มต้นที่ปลอดภัยเมื่อยังไม่รู้เหตุผล
   *   - `"missing"` / `"error"` → เซิร์ฟเวอร์ **เคยเผยแพร่จริง** (หรือไม่รู้ว่าเคยไหม)
   *     แต่ตอบค่าที่ขอไม่ได้ตอนนี้ — พูดว่า "ยังไม่เคยมี run" ไม่ได้ (เป็นเท็จสำหรับ
   *     `"missing"` แน่ ๆ) และพูดว่า "ติดต่อ API ไม่ได้" ก็ไม่ได้เหมือนกัน (เซิร์ฟเวอร์
   *     ตอบมาแล้วจริง ๆ — ไปอยู่ในกิ่ง `apiUnreachable` แทนถ้าเป็นกรณีนั้น) จึงต้องมี
   *     ข้อความของตัวเอง (`runUnavailable`)
   *
   * ตั้งใจให้เป็น field บังคับ (ไม่ใช่ `?:`) ต่างจาก `inputsDegraded` — App.tsx เป็น
   * จุดสร้างเดียวของ state นี้และส่งมาครบทุกครั้งอยู่แล้ว การทำให้บังคับหมายความว่า
   * จุดสร้างใหม่ในอนาคตที่ลืมใส่ฟิลด์นี้จะเป็น compile error แทนที่จะตกไปที่
   * `noRunEver` แบบเงียบ ๆ (คือบั๊กเดิมที่ Codex เจอ เกิดซ้ำที่จุดสร้างอื่นได้ถ้าปล่อย
   * เป็น optional)
   */
  noRunReason: ExposureUnavailableReason | null;
}

/**
 * รายละเอียดใต้แถว "ระดับการเผชิญน้ำ (ภาพประกอบ)" (E10.4)
 *
 * สามอย่างที่ต้องอยู่ครบเสมอ:
 *   1. รายการอินพุตที่ใช้จริง — ผู้อ่านต้องตรวจย้อนได้ว่ามาจากค่าตรวจวัดอะไรบ้าง
 *   2. เวลาที่คำนวณรอบล่าสุด คิดตอนเรนเดอร์จาก `nowMs` ไม่ได้เก็บเป็นฟิลด์ไว้ที่ไหน
 *      และถ้าไม่มีรอบใหม่ ต้องบอกว่า "ไม่มีตั้งแต่เมื่อไหร่" ไม่ใช่ปล่อยให้เงียบ
 *   3. **ทั้งสองความหมายของคำว่า `low`** — แถบต่ำสุดที่วัดได้ กับสถานีที่ไม่มีปัจจัย
 *      ใดวัดได้เลย ซึ่งไม่ใช่สถานีที่ปลอดภัย
 */
function ExposureDetails({
  exposure,
  enabled,
  nowMs,
  lang,
  t,
  terrainIntegrity,
}: {
  exposure: ExposureLegendState | undefined;
  /** สวิตช์ของชั้น — ปิดอยู่ = `useFloodExposure` ไม่เคยยิงคำขอเลย */
  enabled: boolean;
  nowMs: number;
  lang: Lang;
  t: TFunction;
  terrainIntegrity: TerrainIntegrity;
}) {
  const run = exposure?.run ?? null;
  const noNewRun = exposure?.noNewRun ?? false;
  const apiUnreachable = exposure?.apiUnreachable ?? false;
  const inputsDegraded = exposure?.inputsDegraded ?? false;
  const noRunReason = exposure?.noRunReason ?? null;
  const counts = run ? countExposureClasses(run.stations) : null;

  /**
   * บรรทัดสถานะของ run — พูดถึงแหล่งข้อมูลได้เฉพาะสิ่งที่ "ถามไปแล้ว" เท่านั้น
   *
   *   - ชั้นปิดอยู่            → บอกว่าปิดอยู่ ไม่ใช่บอกว่า "ไม่เคยได้รับผลคำนวณ"
   *     เพราะ `useFloodExposure` ไม่ยิงคำขอเลยเมื่อชั้นถูกปิด (และปิดคือค่าเริ่มต้น)
   *     การเขียนว่าไม่เคยได้รับ = การกล่าวถึงสถานะของแหล่งข้อมูลที่ไม่มีใครตรวจ
   *   - เปิดอยู่ ยังไม่มี run และยังไม่มีสัญญาณว่าล้มเหลว → คำขอยังไม่กลับมา จึงเงียบ
   *   - เปิดอยู่ ไม่มี run และ 503 บอกว่า "ยังไม่เคยเผยแพร่"    → "ยังไม่เคยได้รับผลคำนวณ"
   *   - เปิดอยู่ ไม่มี run แต่ 503 บอกเหตุผลอื่น (เผยแพร่แล้วแต่หาย/อ่านพัง) →
   *     "ตอนนี้ดึงมาแสดงไม่ได้" (`runUnavailable`) — พูดว่า "ไม่เคยมี run" ไม่ได้
   *     เพราะเป็นเท็จ และไม่ใช่ apiUnreachable เพราะเซิร์ฟเวอร์ตอบมาแล้วจริง ๆ
   *   - มี run เก่าอยู่ แต่ไม่มีรอบใหม่ "ของตัวมันเอง"     → "ไม่มีรอบใหม่ตั้งแต่เมื่อไหร่"
   *     (ขึ้นก่อนกรณีถัดไปเสมอ — สองอย่างนี้เป็นจริงพร้อมกันได้จริงเมื่อ ThaiWater ล่ม
   *     ทั้งหมด และ "ไม่มีรอบใหม่" เป็นข้อเท็จจริงที่หนักกว่า ต้องไม่ถูกกลบ)
   *   - มี run อยู่ ไม่มีรอบใหม่ของตัวมันเอง แต่ ThaiWater (อินพุตเดียวของ run) ไม่ปกติ
   *     ตอนนี้ → "อินพุตอาจไม่ครบ" (run นี้ **อาจใหม่ก็ได้** เพียงแต่คำนวณจากข้อมูล
   *     บางส่วน — ดูที่มาใน App.tsx `exposureInputsDegraded`)
   */
  let status: ReactNode = null;
  if (!enabled) {
    status = (
      <span className="text-[10px] text-[var(--color-fg-subtle)]">
        {t("legend.exposure.layerOff")}
      </span>
    );
  } else if (apiUnreachable) {
    // ถามไม่ได้ ≠ ไม่มีรอบใหม่ — พูดได้แค่ว่าติดต่อไม่ได้ และรอบที่เห็นเป็นของเมื่อไหร่
    status = (
      <span className="text-[10px] text-[var(--color-risk-medium)]">
        {run === null
          ? t("legend.exposure.apiDownNoRun")
          : t("legend.exposure.apiDownSince", {
              time: formatFullDateTime(lang, run.computedAt),
            })}
      </span>
    );
  } else if (run === null) {
    // `noRunReason` แยกกันเฉพาะตอน `noNewRun` เป็นจริง (มี 503 มาให้อ่านแล้ว) —
    // "noRunEver" ("ยังไม่เคยได้รับผลคำนวณ") ต้องขึ้นเฉพาะตอนที่ reason เป็น
    // "never-published" **เป๊ะ** เท่านั้น ทุกกรณีอื่น ("missing"/"error" หรือ `null`
    // ซึ่งแปลว่าไม่รู้เหตุผลเลย เช่น 429 rate-limit ที่ไม่มี field `reason` ให้อ่าน —
    // ดู apps/api/src/router.ts) ต้องขึ้น "runUnavailable" เพราะเราไม่รู้จริง ๆ ว่า
    // run เคยมีอยู่ไหม การเดาว่า "never-published" ในกรณีที่ไม่รู้เหตุผลเป็นการอ้าง
    // ข้อเท็จจริงที่เจาะจงเกินกว่าที่รู้จริง ไม่ใช่ค่าเริ่มต้นที่ปลอดภัย
    status = !noNewRun ? null : noRunReason === "never-published" ? (
      <span className="text-[10px] text-[var(--color-fg-muted)]">
        {t("legend.exposure.noRunEver")}
      </span>
    ) : (
      <span className="text-[10px] text-[var(--color-risk-medium)]">
        {t("legend.exposure.runUnavailable")}
      </span>
    );
  } else if (noNewRun) {
    // เหตุผล "ของตัวมันเอง" (ดึงไม่สำเร็จ หรือ exposure-illustrative เองไม่ปกติ) ต้อง
    // ขึ้นก่อน inputsDegraded เสมอ — สองอย่างนี้เป็นจริงพร้อมกันได้ (ThaiWater ล่มทั้งหมด
    // → ทั้งไม่มี run ใหม่ และ ThaiWater เองก็ผิดปกติพร้อมกัน) และ "ไม่มีรอบใหม่" เป็น
    // ข้อเท็จจริงที่หนักกว่า ต้องไม่ถูก "อินพุตอาจไม่ครบ" กลบไป
    status = (
      <span className="text-[10px] text-[var(--color-risk-medium)]">
        {t("legend.exposure.noRunSince", { time: formatFullDateTime(lang, run.computedAt) })}
      </span>
    );
  } else if (inputsDegraded) {
    // ต่างจาก noNewRun: run นี้อาจเพิ่งคำนวณไปหมาด ๆ (endpoint ของ exposure เองตอบ
    // "ok" และไม่มีสัญญาณว่า run ใหม่ขาดหาย) แต่ ThaiWater ซึ่งเป็นอินพุตเดียวของมัน
    // ผิดปกติอยู่ ณ ตอนนี้ — "ไม่มีรอบใหม่ตั้งแต่ X" จะเป็นข้อความที่ผิดข้อเท็จจริง
    status = (
      <span className="text-[10px] text-[var(--color-risk-medium)]">
        {t("legend.exposure.staleInputs", { time: formatFullDateTime(lang, run.computedAt) })}
      </span>
    );
  } else {
    status = (
      <span className="text-[10px] text-[var(--color-fg-subtle)]">
        {t("legend.exposure.computedAt", { age: formatAge(lang, run.computedAt, nowMs) })}
      </span>
    );
  }

  return (
    <div className="mt-1 ml-7 flex flex-col gap-1 border-l border-white/8 pl-2">
      {terrainIntegrity === "mismatch" ? (
        <span className="text-[10px] text-[var(--color-danger)]">
          {t("legend.exposure.integrity.mismatch")}
        </span>
      ) : null}

      <span className="text-[10px] text-[var(--color-fg-subtle)]">
        {t("legend.layer.exposure.inputs")}
      </span>
      {run ? (
        <span className="text-[10px] text-[var(--color-fg-subtle)]">
          {t("legend.exposure.historyWindow", { h: run.inputs.historyWindowH })}
        </span>
      ) : null}

      {/* บรรทัดสถานะของ run — ห้ามเงียบเมื่อมี run เก่าค้างอยู่แล้วไม่มีรอบใหม่ */}
      {status}

      <span className="mt-0.5 text-[10px] font-medium text-[var(--color-fg-subtle)]">
        {t("legend.exposure.scale")}
      </span>
      <ul className="flex flex-col gap-0.5">
        {EXPOSURE_SCALE.map((row) => (
          <li key={row.cls} className="flex items-start gap-1.5 text-[10px] text-[var(--color-fg-muted)]">
            {/* สถานะ "ไม่มีข้อมูล" ใช้รูปวงแหวนกลวงเส้นประ = รูปเดียวกับหมุดบนแผนที่
                ไม่ใช่จุดทึบสีของแถบใดแถบหนึ่ง */}
            <span
              className={`mt-[3px] h-2.5 w-2.5 shrink-0 rounded-full ${
                row.cls === "no-data" ? "border-2 border-dashed" : "border border-white/70"
              }`}
              style={
                row.cls === "no-data"
                  ? { borderColor: exposureCss("no-data") }
                  : { backgroundColor: exposureCss(row.cls) }
              }
              aria-hidden="true"
            />
            <span className="min-w-0">
              {t(row.key)}
              {counts ? (
                <span className="text-[var(--color-fg-subtle)]">
                  {" · "}
                  {/* หนึ่งสถานีมีคีย์ของตัวเอง ไม่งั้นฝั่งอังกฤษอ่านว่า "1 stations" */}
                  {counts[row.cls] === 1
                    ? t("legend.exposure.stationCount.one")
                    : t("legend.exposure.stationCount", { n: counts[row.cls] })}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * สิ่งที่ legend ต้องรู้เกี่ยวกับ "แถบฝนพยากรณ์รายวัน (TMD)" (E12.4b) — คำนวณ
 * ครั้งเดียวใน `App.tsx` (`computeForecastBandStatus`) แล้วส่งผลสำเร็จรูปมาที่นี่
 */
export interface ForecastLegendState {
  /** ขั้นรายชั่วโมงที่กำลังเลือกอยู่ใน ForecastStrip — null = ยังไม่ได้เลือก
   *  → ไม่แสดงแถวนี้เลย (เหมือนตอนที่ยังไม่มีชั้นนี้อยู่ในระบบ) */
  atIso: string | null;
  /** ขั้นรายชั่วโมงตัวแรกของ batch ปัจจุบัน — ใช้คำนวณ "+N ชม." ด้วยสูตรเดียวกับ
   *  ป้ายกำกับของ `ForecastStrip.tsx` (นับจากขั้นแรกที่ TMD ส่งมา ไม่ใช่ "ตอนนี้") */
  firstHourlyIso: string | null;
  /** null เฉพาะตอน `atIso` เองเป็น null (ไม่ใช่ค่าอิสระจากกัน) */
  status: ForecastBandStatus | null;
}

/**
 * สัญลักษณ์ของ "แถบฝนพยากรณ์รายวัน (TMD)" — ลายเส้น**แนวตั้งล้วน** (ไม่หมุน)
 * ต่างจาก `IllustrativeSwatch`/`ExposureSwatch` ที่เป็นลายทแยงทั้งคู่ — ตรงกับลาย
 * ที่ shader วาดจริงใน `scene/terrainMaterial.ts` (`gl_FragCoord.x` อย่างเดียว)
 * สีมาจาก `forecastCss` (`lib/forecastStyle.ts`) ไฟล์เดียวกับที่ shader อ่าน
 */
function ForecastSwatch({ level }: { level: ForecastBandLevel }) {
  const period = ILLUSTRATIVE_HATCH_PERIOD_PX;
  const stroke = period * ILLUSTRATIVE_HATCH_DUTY;
  const css = forecastCss(level);
  return (
    <svg className="h-3 w-5 rounded-sm" viewBox="0 0 20 12" aria-hidden="true">
      <rect width="20" height="12" fill={css} opacity={0.22} />
      <defs>
        <pattern id={`siahra-forecast-hatch-${level}`} width={period} height={period} patternUnits="userSpaceOnUse">
          <rect width={stroke} height={period} fill={css} />
        </pattern>
      </defs>
      <rect width="20" height="12" fill={`url(#siahra-forecast-hatch-${level})`} />
    </svg>
  );
}

/**
 * แถวของ "แถบฝนพยากรณ์รายวัน (TMD)" — แสดงเฉพาะตอนมีขั้นถูกเลือกอยู่ (`atIso`
 * ไม่ null) ไม่ใช่ checkbox ของ `MapLayers` (ไม่มีสวิตช์ให้กด — ปรากฏเองตามการ
 * เลื่อน ForecastStrip) จึงอยู่นอก `LAYER_ROWS`/`<ul>` ข้างล่าง เป็นบล็อกของตัวเอง
 *
 * สามสถานะที่ต้องขึ้นข้อความคนละประโยคเสมอ (AGENTS.md: "ไม่มีอะไรใหม่" ≠
 * "แหล่งข้อมูลบอกว่าสงบ"):
 *   - `"band"`   → สัญลักษณ์ + ป้าย "วัน +N ชม." (แถบจริงกำลังวาดอยู่บนภูมิประเทศ)
 *   - `"low"`    → TMD **ส่งค่ามาจริง** และต่ำกว่าเกณฑ์ที่ต้องเน้น (ข้อเท็จจริง
 *     ที่แบบจำลองยืนยัน ไม่ใช่ความเงียบ)
 *   - `"no-value"` → ไม่มีค่าให้อ่านเลย ไม่ว่าเพราะไม่มีขั้นของวันนี้หรือ TMD ส่ง
 *     `rainMm` มาเป็น null — ทั้งสองอ่านเหมือนกันจากมุมของผู้ใช้ (เราไม่รู้)
 */
function ForecastBandLegendRow({
  forecast,
  lang,
  t,
}: {
  forecast: ForecastLegendState;
  lang: Lang;
  t: TFunction;
}) {
  if (forecast.atIso === null) return null;
  const day = formatWeekday(lang, forecast.atIso);
  const hoursAhead = forecast.firstHourlyIso
    ? Math.round((Date.parse(forecast.atIso) - Date.parse(forecast.firstHourlyIso)) / 3600000)
    : null;
  const dayLabel = hoursAhead === null ? day : `${day} ${t("forecast.strip.tickHours", { n: hoursAhead })}`;
  const status = forecast.status;

  return (
    <div className="flex flex-col gap-1 rounded-lg px-1.5 py-1">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex w-6 shrink-0 items-center" aria-hidden="true">
          {status?.kind === "band" ? <ForecastSwatch level={status.level} /> : <span className="h-3 w-5" />}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block text-xs text-[var(--color-fg)]">{t("forecast.band.label")}</span>
          <span className="block text-[10px] text-[var(--color-fg-subtle)]">{dayLabel}</span>
        </span>
      </div>
      <div className="ml-7">
        {status?.kind === "band" ? null : status?.kind === "low" ? (
          <span className="text-[10px] text-[var(--color-fg-subtle)]">{t("forecast.band.belowThreshold")}</span>
        ) : (
          <span className="text-[10px] text-[var(--color-fg-subtle)]">{t("forecast.band.noValue")}</span>
        )}
      </div>
    </div>
  );
}

const LAYER_ROWS: {
  key: keyof MapLayers;
  labelKey: MessageKey;
  noteKey: MessageKey;
  swatch: React.ReactNode;
}[] = [
  {
    key: "imagery",
    labelKey: "legend.layer.imagery",
    noteKey: "legend.layer.imagery.note",
    swatch: (
      <span
        className="h-3 w-5 rounded-sm"
        style={{ background: "linear-gradient(135deg,#365a3a,#7a6d4a 60%,#9aa5b1)" }}
      />
    ),
  },
  {
    key: "radar",
    labelKey: "legend.layer.radar",
    noteKey: "legend.layer.radar.note",
    swatch: (
      <span
        className="h-3 w-5 rounded-sm"
        style={{ background: "linear-gradient(90deg,#22c55e,#eab308,#ef4444)" }}
      />
    ),
  },
  {
    key: "floodExtent",
    labelKey: "legend.layer.floodExtent",
    noteKey: "legend.layer.floodExtent.note",
    swatch: (
      <span
        className="h-3 w-5 rounded-sm"
        style={{ background: "linear-gradient(90deg,#1a5680,#4d94b8 70%,#d9edf7)" }}
      />
    ),
  },
  {
    // E14.F4 — สีเดียว "พื้นที่ที่ดาวเทียมเห็นน้ำ" (สิ่งที่วาดเมื่อปิดชั้นความลึก)
    key: "floodGfm",
    labelKey: "legend.layer.floodGfm",
    noteKey: "legend.layer.floodGfm.note",
    swatch: <span className="h-3 w-5 rounded-sm" style={{ background: floodCss("extent") }} />,
  },
  {
    key: "floodDepth",
    labelKey: "legend.layer.floodDepth",
    noteKey: "legend.layer.floodDepth.note",
    swatch: <FloodDepthSwatch />,
  },
  {
    key: "lowland",
    labelKey: "legend.layer.lowland",
    noteKey: "legend.layer.lowland.note",
    swatch: <IllustrativeSwatch />,
  },
  {
    key: "exposure",
    labelKey: "legend.layer.exposure",
    noteKey: "legend.layer.exposure.note",
    swatch: <ExposureSwatch />,
  },
  {
    key: "hazard",
    labelKey: "legend.layer.hazard",
    noteKey: "legend.layer.hazard.note",
    swatch: (
      <span
        className="h-3 w-5 rounded-sm"
        style={{ background: "radial-gradient(circle,#ef4444 0%,#f97316 55%,transparent 100%)" }}
      />
    ),
  },
  {
    key: "stations",
    labelKey: "legend.layer.stations",
    noteKey: "legend.layer.stations.note",
    swatch: (
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-full border border-white/80 bg-[#22c55e]" />
        <span className="h-2.5 w-2.5 rotate-45 border border-white/80 bg-[#38bdf8]" />
      </span>
    ),
  },
  {
    key: "water",
    labelKey: "legend.layer.water",
    noteKey: "legend.layer.water.note",
    swatch: (
      <span
        className="h-3 w-5 rounded-sm"
        style={{ background: "linear-gradient(90deg,#1e5b93,#3d8fd0)" }}
      />
    ),
  },
  {
    key: "roads",
    labelKey: "legend.layer.roads",
    noteKey: "legend.layer.roads.note",
    swatch: (
      <span
        className="h-3 w-5 rounded-sm"
        style={{ background: "linear-gradient(90deg,#f29e38,#eedc9a)" }}
      />
    ),
  },
  {
    key: "dams",
    labelKey: "legend.layer.dams",
    noteKey: "legend.layer.dams.note",
    swatch: <span className="h-3 w-3 rounded-sm border border-white/80 bg-[#38bdf8]" />,
  },
  {
    key: "sunlight",
    labelKey: "legend.layer.sunlight",
    noteKey: "legend.layer.sunlight.note",
    swatch: (
      <span
        className="h-3 w-5 rounded-sm"
        style={{ background: "linear-gradient(90deg,#1e2a44,#f6c453,#9fc5f8)" }}
      />
    ),
  },
  {
    key: "trees",
    labelKey: "legend.layer.trees",
    noteKey: "legend.layer.trees.note",
    swatch: <span className="h-3 w-5 rounded-sm" style={{ background: "linear-gradient(90deg,#2c4f1f,#6f9a3c)" }} />,
  },
  {
    key: "buildings",
    labelKey: "legend.layer.buildings",
    noteKey: "legend.layer.buildings.note",
    swatch: <span className="h-3 w-5 rounded-sm bg-[#d6d9de]" />,
  },
  {
    key: "localAuthorities",
    labelKey: "legend.layer.localAuthorities",
    noteKey: "legend.layer.localAuthorities.note",
    swatch: (
      <span
        className="h-3 w-5 rounded-sm border border-[#f59e0b]/70"
        style={{ background: "linear-gradient(90deg,#f59e0b,#fb923c)" }}
      />
    ),
  },
];

/**
 * ลิงก์ไปหน้า `/methodology/...` พร้อม `?lang=` ปัจจุบัน — หน้านั้นเป็นคนละ route
 * ที่ไม่ได้ mount `usePermalinkSync` จึงอ่านภาษาได้จาก query string เท่านั้น
 * (หรือจาก localStorage ถ้าผู้ใช้เคยกดสลับเอง)
 */
function methodologyHref(url: string, lang: Lang): string {
  if (lang === "th" || url.includes("lang=")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}lang=${lang}`;
}

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

/**
 * ข้อความผลตรวจลายเซ็นของ `terrain.bin` (E9.1) — `verified` ไม่ต้องพูดอะไร
 *
 * แถวที่ได้ข้อความนี้คือแถวเดียวที่ถูกกระทบจริง (พื้นที่ลุ่มต่ำ ซึ่งคำนวณจาก DEM
 * ก้อนนั้น) ส่วนฮาโลจากค่าตรวจวัดจริง มาสก์ขอบเขต และภาพน้ำท่วมจาก GISTDA
 * ไม่ได้มาจาก DEM จึงยังวาดตามปกติและไม่มีป้ายนี้
 */
const INTEGRITY_NOTE: Record<TerrainIntegrity, MessageKey | null> = {
  verified: null,
  mismatch: "legend.integrity.mismatch",
  unknown: "legend.integrity.unknown",
};

const QUALITY_LABEL: Record<QualityLevel, MessageKey> = {
  high: "quality.high",
  balanced: "quality.balanced",
  low: "quality.low",
};

/**
 * ป้ายชนิดความรู้ + บรรทัดเวลาของชั้นข้อมูลหนึ่งแถว
 *
 * อายุข้อมูลคำนวณจาก `nowMs` ที่ส่งเข้ามา (นาฬิกาเดินจาก `useNow`) ทุกครั้งที่
 * เรนเดอร์ ไม่ได้เก็บไว้ที่ไหนและไม่ได้มาจาก API — และ `fetchedAt: null` จะถูกแปลง
 * เป็นข้อความตามชนิดของชั้น ไม่ใช่เวลาปัจจุบัน (ดู `lib/layerFreshness.ts`)
 */
function LayerMeta({
  entry,
  nowMs,
  lang,
  t,
}: {
  entry: NonNullable<LayerDescriptors[keyof MapLayers]>;
  nowMs: number;
  lang: Lang;
  t: TFunction;
}) {
  const { descriptor } = entry;
  const f = describeLayerFreshness(descriptor, entry.health, nowMs, lang, t);
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
          // พาภาษาปัจจุบันไปด้วย ไม่งั้นคนที่มาด้วย ?lang=en แต่ไม่เคยกดปุ่มสลับ
          // (จึงไม่มีค่าใน localStorage) จะไปเจอหน้าเอกสารเป็นภาษาไทย
          href={methodologyHref(descriptor.methodologyUrl, lang)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-accent)] hover:underline"
        >
          {t("freshness.methodology")}
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
  terrainIntegrity = "unknown",
  buildingsError = null,
  exposure,
  forecast,
  floodGfm,
}: {
  layers: MapLayers;
  onToggle: (key: keyof MapLayers, value: boolean) => void;
  /** `HazardLayerDescriptor` ต่อชั้น (useLayerDescriptors) — ไม่มี = ไม่ใช่ข้อมูล */
  descriptors: LayerDescriptors;
  /** run ล่าสุดของชั้นการเผชิญน้ำ + สถานะการดึง (E10.4) */
  exposure?: ExposureLegendState;
  /** แถบฝนพยากรณ์รายวัน (TMD) ของขั้นที่กำลังเลือกอยู่ (E12.4b) */
  forecast?: ForecastLegendState;
  /** ฉาก Copernicus GFM ที่กำลังแสดง + เหตุผลเมื่อไม่มี (E14.F4) */
  floodGfm?: FloodGfmLegendState;
  quality: QualityMode;
  qualityLevel: QualityLevel;
  onQualityChange: (q: QualityMode) => void;
  /** ผลตรวจ sha256 ของ terrain.bin — ยังไม่โหลดฉาก = "unknown" */
  terrainIntegrity?: TerrainIntegrity;
  /**
   * ชั้นอาคารแบบเก่า (E8.3, เฉพาะ AOI สาธิตที่ไม่มี tile pyramid) โหลด/แปลงไม่
   * สำเร็จ — `null` = โหลดสำเร็จ, ไม่มีข้อมูลอาคารสำหรับ AOI นี้อยู่แล้ว, หรือ AOI
   * นี้ใช้ tile pyramid (ไม่ผ่านเส้นทางนี้เลย) ดูรายละเอียดที่ `BuildingLayer.ts`
   */
  buildingsError?: string | null;
}) {
  const nowMs = useNow();
  const { lang, t } = useLang();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Layers size={14} className="text-[var(--color-accent)]" aria-hidden="true" />
        <p className="text-xs font-semibold text-[var(--color-fg)]">{t("legend.title")}</p>
      </div>

      <ul className="flex flex-col gap-1">
        {LAYER_ROWS.map((row) => {
          const entry = descriptors[row.key];
          // ชั้นพื้นที่ลุ่มต่ำเป็นอนุพันธ์ของ terrain.bin โดยตรง จึงเป็นแถวเดียว
          // ที่ต้องบอกผลตรวจลายเซ็น และเป็นแถวเดียวที่ถูกปิดเมื่อไม่ผ่าน
          const integrityKey = row.key === "lowland" ? INTEGRITY_NOTE[terrainIntegrity] : null;
          // ชั้นอาคารแบบเก่า (E8.3) โหลดพลาด = ไม่มีอาคารบนแผนที่ทั้งที่สวิตช์ยัง
          // เปิดอยู่ — ต้องบอกเหตุผล ไม่ใช่ปล่อยให้ผู้ใช้เดาว่า AOI นี้ไม่มีอาคารเลย
          const showBuildingsError = row.key === "buildings" && buildingsError !== null;
          // สองแถว GFM หรี่ลง (ไม่หายไป) เมื่อไม่มีฉากในหน้าต่าง / จังหวัดไม่มีฉาก /
          // แหล่งค้าง — เหตุผลอยู่ใน FloodGfmDetails ข้างล่างเสมอ
          const isGfmRow = row.key === "floodGfm" || row.key === "floodDepth";
          const dimmed =
            isGfmRow &&
            floodGfm !== undefined &&
            (floodGfm.dimmed || floodGfm.missing || floodGfm.reason === "no-scene-in-window");
          return (
          <li key={row.key}>
            <label
              className={`flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-white/5 ${
                dimmed ? "opacity-60" : ""
              }`}
            >
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
                <span className="block text-xs text-[var(--color-fg)]">{t(row.labelKey)}</span>
                <span className="block text-[10px] text-[var(--color-fg-subtle)]">
                  {t(row.noteKey, { km: DETAIL_TILE_ALTITUDE_GATE_M / 1000 })}
                </span>
                {integrityKey ? (
                  <span
                    className={`mt-0.5 block text-[10px] ${
                      terrainIntegrity === "mismatch"
                        ? "text-[var(--color-risk-extreme)]"
                        : "text-[var(--color-fg-subtle)]"
                    }`}
                  >
                    {t(integrityKey)}
                  </span>
                ) : null}
                {showBuildingsError ? (
                  <span className="mt-0.5 block text-[10px] text-[var(--color-risk-extreme)]">
                    {t("legend.layer.buildings.error")}
                  </span>
                ) : null}
                {entry ? <LayerMeta entry={entry} nowMs={nowMs} lang={lang} t={t} /> : null}
              </span>
            </label>
            {/* รายละเอียดของชั้นการเผชิญน้ำอยู่นอก <label> โดยตั้งใจ — ไม่งั้นการกด
                อ่านสเกลจะไปสลับสวิตช์ของชั้นเข้าให้ */}
            {row.key === "exposure" ? (
              <ExposureDetails
                exposure={exposure}
                enabled={layers.exposure}
                nowMs={nowMs}
                lang={lang}
                t={t}
                terrainIntegrity={terrainIntegrity}
              />
            ) : null}
            {row.key === "floodGfm" && floodGfm ? <FloodGfmDetails state={floodGfm} lang={lang} t={t} /> : null}
            {row.key === "floodDepth" ? (
              <FloodDepthDetails state={floodGfm} gfmEnabled={layers.floodGfm} lang={lang} t={t} />
            ) : null}
          </li>
          );
        })}
      </ul>

      {forecast?.atIso ? (
        <>
          <div className="h-px bg-white/8" />
          <ForecastBandLegendRow forecast={forecast} lang={lang} t={t} />
        </>
      ) : null}

      <div className="h-px bg-white/8" />

      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-fg-subtle)]">
          <Gauge size={12} aria-hidden="true" /> {t("quality.label")}
          <span className="text-[var(--color-fg-muted)]">
            {quality === "auto" ? t("quality.autoWith", { level: t(QUALITY_LABEL[qualityLevel]) }) : ""}
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
              {t(q === "auto" ? "quality.auto" : q === "high" ? "quality.high" : "quality.low")}
            </button>
          ))}
        </div>
      </div>

      <div className="h-px bg-white/8" />

      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-medium text-[var(--color-fg-subtle)]">
          {t("legend.waterlevelScale")}
        </p>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          {SITUATION_LEVELS.map((l) => (
            <LegendRow key={l.key} label={t(l.key)} color={l.color} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-medium text-[var(--color-fg-subtle)]">{t("legend.rainScale")}</p>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          {RAIN_BANDS.map((l) => (
            <LegendRow key={l.key} label={t(l.key)} color={l.color} shape="diamond" />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
          <span className="h-0.5 w-5 rounded bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]" aria-hidden="true" />
          {t("legend.provinceBoundary")}
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
          <span
            className="h-3 w-3 rounded-full border-2 border-red-400/80 shadow-[0_0_0_2px_rgba(239,68,68,0.25)]"
            aria-hidden="true"
          />
          {t("legend.earthquakes")}
        </div>
      </div>
    </div>
  );
}
