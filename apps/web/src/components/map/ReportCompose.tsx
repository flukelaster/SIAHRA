import { ImagePlus, MapPinPlus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_MAX_DESCRIPTION,
  type CommunityCategory,
  type CommunityReport,
} from "@siahra/shared-types";
import { useLang } from "../../i18n/context";
import { useViewport } from "../../hooks/useViewport";
import type { MessageKey } from "../../i18n";
import { submitReport, type ReportFailure } from "../../lib/communityApi";
import { COMMUNITY_CATEGORY_COLOR } from "../../lib/communityReports";
import { readCommunityStore, withOwned, writeCommunityStore } from "../../lib/communityStore";
import { compressImage } from "../../lib/compressImage";
import type { CompressFailure, CompressMime } from "../../lib/imageCompress";
import { EPISTEMIC_BADGE } from "../../lib/layerFreshness";
import type { ShellSafeArea } from "../../lib/shellLayout";
import { getTurnstileToken, loadTurnstile, turnstileSiteKey, TurnstileError } from "../../lib/turnstile";
import { RightSheet, RightSheetHeader } from "./RightSheet";

const TITLE_ID = "report-compose-title";
/** ทศนิยม 5 ตำแหน่ง ≈ 1 ม. — พอให้ผู้ใช้เห็นว่าหมุดขยับ ไม่ได้อ้างความแม่นยำเกินปลายนิ้ว */
const COORD_SHOWN_DIGITS = 5;

const storage = () => window.localStorage;

type Photo =
  | { state: "none" }
  | { state: "compressing" }
  | {
      state: "ready";
      blob: Blob;
      url: string;
      width: number;
      height: number;
      mime: CompressMime;
      inputBytes: number;
    }
  | { state: "failed"; failure: CompressFailure };

type Phase = "idle" | "verifying" | "submitting";

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * ฟอร์มรายงานผลกระทบ (chunk แยก ผ่าน `lazyMapViews.tsx`) — เปิดในกรอบ `RightSheet` เมื่อผู้ใช้ปักหมุดในโหมดรายงาน
 * (มีได้ทีละแผงกับแผงกล้อง/แผงรายงาน) แตะแผนที่อีกครั้ง = ย้ายหมุด ฟอร์มคงค่าที่กรอกไว้
 *
 * ความซื่อสัตย์ต่อข้อมูล:
 * - ไม่มีคำไหนสื่อว่ารายงานถูกตรวจสอบ: หัวฟอร์มบอกว่าจะขึ้นแผนที่ทันทีพร้อมป้าย "ยังไม่ได้ตรวจสอบ" ป้ายเดียวกับหมุด
 * - จังหวัดของรายงานเป็นของ server (point-in-polygon) — ฟอร์มไม่เดา บอกหลังส่งในแผงรายงาน
 * - ผลของการส่งทุกแบบมีข้อความของตัวเอง (`community.compose.fail.*`) ไม่มีอะไรถูกพูดว่า "สำเร็จ" ถ้าไม่ได้ 201
 *
 * ต้นทุน (devops PR A): Turnstile โหลดเมื่อฟอร์มเปิดเท่านั้น (ไม่ใช่ตอนเปิดหน้า); หนึ่งการกดส่ง = POST เดียว ไม่ลอง
 * ซ้ำเองเลย; ส่งซ้อนไม่ได้ (ปุ่มปิด + ตัวกันใน ref); build ที่ไม่มี `VITE_TURNSTILE_SITE_KEY` ไม่ส่งอะไรเลย
 */
export function ReportCompose({
  lon,
  lat,
  safeArea,
  onClose,
  onCreated,
}: {
  lon: number;
  lat: number;
  safeArea: ShellSafeArea;
  /** X / Escape / ปัดขวา — ออกจากโหมดปักหมุด (หมุดชั่วคราวหายตาม) */
  onClose: () => void;
  /** 201 — ownerToken ถูกเก็บแล้ว ผู้เรียกใส่หมุด เปิดชั้น และเปิดแผงของรายงานนี้ */
  onCreated: (report: CommunityReport) => void;
}) {
  const { t } = useLang();
  return (
    <RightSheet kind="compose" selKey="compose" titleId={TITLE_ID} safeArea={safeArea} onClose={onClose}>
      <RightSheetHeader
        titleId={TITLE_ID}
        kicker={
          <>
            <MapPinPlus size={11} aria-hidden="true" className="text-[#f9a8d4]" />
            {t("community.kicker")}
          </>
        }
        title={t("community.compose.title")}
        onClose={onClose}
        closeLabel={t("common.close")}
      >
        <p
          className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${EPISTEMIC_BADGE.crowdsourced.className}`}
          data-report-unverified=""
        >
          {t("community.compose.unverified")}
        </p>
      </RightSheetHeader>
      <ComposeBody lon={lon} lat={lat} onCreated={onCreated} />
    </RightSheet>
  );
}

function ComposeBody({
  lon,
  lat,
  onCreated,
}: {
  lon: number;
  lat: number;
  onCreated: (report: CommunityReport) => void;
}) {
  const { lang, t } = useLang();
  const siteKey = turnstileSiteKey();
  // มือถือ: ฟอร์มเต็มจอทับแผนที่ — "แตะแผนที่อีกครั้งเพื่อย้ายหมุด" ทำไม่ได้จริง จึงไม่พูด
  const phone = useViewport().tier === "phone";
  const ids = useId();
  const [categories, setCategories] = useState<ReadonlySet<CommunityCategory>>(() => new Set());
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<Photo>({ state: "none" });
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<ReportFailure | null>(null);
  /** ตัวกันส่งซ้อน — state อัปเดตช้ากว่าการกดสองครั้งติดกันได้ ref ไม่ */
  const busyRef = useRef(false);
  const compressAbort = useRef<AbortController | null>(null);
  const turnstileBox = useRef<HTMLDivElement | null>(null);
  const failureRef = useRef<HTMLParagraphElement | null>(null);

  // Turnstile: โหลดสคริปต์เมื่อฟอร์มเปิด (ไม่ใช่ตอนเปิดหน้า) ให้พร้อมตอนกดส่ง — โหลดไม่ได้ตอนนี้ไม่ใช่ข้อผิดพลาด
  // ที่ต้องบอก: `getTurnstileToken` ลองโหลดใหม่ตอนส่งและบอก `turnstile-load` ถ้ายังไม่ได้
  useEffect(() => {
    if (siteKey) loadTurnstile().catch(() => {});
  }, [siteKey]);

  // คืน object URL ของ preview เมื่อรูปเปลี่ยน/ฟอร์มปิด และหยุดการบีบอัดที่ค้างอยู่ (worker ถูก terminate)
  useEffect(() => {
    if (photo.state !== "ready") return;
    const url = photo.url;
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  useEffect(() => () => compressAbort.current?.abort(), []);
  // ผลที่ไม่สำเร็จต้องเห็นได้โดยไม่ต้องเลื่อนหา (ฟอร์มยาวกว่าจอเตี้ย/มือถือ)
  useEffect(() => {
    if (failure) failureRef.current?.scrollIntoView({ block: "nearest" });
  }, [failure]);

  const toggleCategory = (c: CommunityCategory) =>
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0] ?? null;
    // ล้างค่าเพื่อให้เลือกไฟล์เดิมซ้ำได้ (เช่นหลังกด "เอารูปออก")
    e.currentTarget.value = "";
    if (!file) return;
    compressAbort.current?.abort();
    const ctl = new AbortController();
    compressAbort.current = ctl;
    setPhoto({ state: "compressing" });
    void compressImage(file, ctl.signal).then((out) => {
      if (!out || ctl.signal.aborted) return;
      if (!out.ok) {
        setPhoto({ state: "failed", failure: out.failure });
        return;
      }
      setPhoto({
        state: "ready",
        blob: out.blob,
        url: URL.createObjectURL(out.blob),
        width: out.width,
        height: out.height,
        mime: out.mime,
        inputBytes: out.inputBytes,
      });
    });
  };

  const removePhoto = () => {
    compressAbort.current?.abort();
    compressAbort.current = null;
    setPhoto({ state: "none" });
  };

  const tooLong = description.length > COMMUNITY_MAX_DESCRIPTION;
  const ready =
    siteKey !== null &&
    categories.size > 0 &&
    consent &&
    !tooLong &&
    photo.state !== "compressing" &&
    photo.state !== "failed" &&
    phase === "idle";

  const submit = async () => {
    if (busyRef.current || !ready || !siteKey) return;
    const box = turnstileBox.current;
    if (!box) return;
    busyRef.current = true;
    setFailure(null);
    setPhase("verifying");
    let token: string;
    try {
      token = await getTurnstileToken(box, siteKey, lang);
    } catch (err) {
      setFailure(err instanceof TurnstileError && err.kind === "script" ? "turnstile-load" : "turnstile");
      setPhase("idle");
      busyRef.current = false;
      return;
    }
    setPhase("submitting");
    const res = await submitReport(
      {
        lat,
        lon,
        categories: COMMUNITY_CATEGORIES.filter((c) => categories.has(c)),
        description: description.trim(),
        image: photo.state === "ready" ? photo.blob : null,
      },
      token,
    );
    if (!res.ok) {
      // ไม่ลองซ้ำเอง — ผู้ใช้กดส่งใหม่ (403 = widget ใหม่ token ใหม่ในการกดครั้งถัดไป)
      setFailure(res.failure);
      setPhase("idle");
      busyRef.current = false;
      return;
    }
    // รายงานถูกสร้างแล้วแม้ผู้ใช้จะปิดฟอร์มระหว่างรอ — เก็บ ownerToken (ลบเองได้) และให้ผู้เรียกแสดงหมุด/แผงเสมอ
    const { report, ownerToken } = res.value;
    writeCommunityStore(storage, withOwned(readCommunityStore(storage), report.id, ownerToken));
    onCreated(report);
  };

  const onSubmit = (e: FormEvent) => {
    // CSP `form-action 'none'` — ห้ามให้ฟอร์มนำทางจริง ส่งผ่าน fetch เท่านั้น
    e.preventDefault();
    void submit();
  };

  const busy = phase !== "idle";
  const descId = `${ids}-desc`;
  const counterId = `${ids}-count`;
  const consentId = `${ids}-consent`;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain px-3.5 py-3"
      data-report-compose=""
    >
      <section className="flex flex-col gap-0.5">
        <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("community.compose.location")}</p>
        <p className="text-sm text-white tabular-nums" data-report-coords="">
          {lat.toFixed(COORD_SHOWN_DIGITS)}, {lon.toFixed(COORD_SHOWN_DIGITS)}
        </p>
        <p className="text-[11px] text-[var(--color-fg-muted)]">
          {t(phone ? "community.compose.provinceHint" : "community.compose.moveHint")}
        </p>
      </section>

      <fieldset className="flex flex-col gap-1.5" disabled={busy}>
        <legend className="mb-1.5 text-xs font-medium text-[var(--color-fg)]">
          {t("community.compose.categories")}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {COMMUNITY_CATEGORIES.map((c) => {
            const on = categories.has(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => toggleCategory(c)}
                className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed md:min-h-8 ${
                  on
                    ? "bg-[var(--color-accent)]/25 text-white ring-1 ring-[var(--color-accent)]/70 ring-inset"
                    : "bg-white/6 text-[var(--color-fg)] ring-1 ring-white/12 ring-inset hover:bg-white/10"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: COMMUNITY_CATEGORY_COLOR[c] }} aria-hidden="true" />
                {t(`community.category.${c}` as MessageKey)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <section className="flex flex-col gap-1">
        <label htmlFor={descId} className="text-xs font-medium text-[var(--color-fg)]">
          {t("community.compose.description")}
        </label>
        <textarea
          id={descId}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          maxLength={COMMUNITY_MAX_DESCRIPTION}
          rows={4}
          disabled={busy}
          aria-describedby={counterId}
          placeholder={t("community.compose.descriptionPlaceholder")}
          className="min-h-24 resize-y rounded-lg bg-black/30 px-2.5 py-2 text-sm text-white ring-1 ring-white/12 ring-inset placeholder:text-white/35 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] disabled:opacity-60"
        />
        <p
          id={counterId}
          className={`self-end text-[11px] tabular-nums ${tooLong ? "text-[var(--color-risk-extreme)]" : "text-[var(--color-fg-subtle)]"}`}
          aria-live="polite"
        >
          {t("community.compose.counter", { n: description.length, max: COMMUNITY_MAX_DESCRIPTION })}
        </p>
      </section>

      <section className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-[var(--color-fg)]">{t("community.compose.photo")}</p>
        {photo.state === "ready" ? (
          <div className="flex flex-col gap-1.5">
            <img
              src={photo.url}
              alt={t("community.compose.photoAlt")}
              className="max-h-56 w-full rounded-lg bg-black/40 object-contain ring-1 ring-white/10"
              data-report-photo-preview=""
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-[var(--color-fg-muted)] tabular-nums" data-report-photo-size="">
                {t("community.compose.photoResult", {
                  size: formatBytes(photo.blob.size),
                  width: photo.width,
                  height: photo.height,
                  format: photo.mime === "image/webp" ? "WebP" : "JPEG",
                  input: formatBytes(photo.inputBytes),
                })}
              </p>
              <button
                type="button"
                onClick={removePhoto}
                disabled={busy}
                className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-xs text-[var(--color-fg)] ring-1 ring-white/12 ring-inset hover:bg-white/10 disabled:opacity-50 md:min-h-8"
              >
                <Trash2 size={13} aria-hidden="true" />
                {t("community.compose.photoRemove")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ไม่มี `capture` โดยตั้งใจ — มือถือยังเลือกได้ทั้งกล้องและคลังรูป */}
            <input
              type="file"
              accept="image/*"
              onChange={onFile}
              disabled={busy || photo.state === "compressing"}
              className="sr-only"
              id={`${ids}-file`}
              data-report-photo-input=""
            />
            <label
              htmlFor={`${ids}-file`}
              className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 self-start rounded-lg px-3 text-xs text-[var(--color-fg)] ring-1 ring-white/15 ring-inset hover:bg-white/10 md:min-h-9 ${
                busy || photo.state === "compressing" ? "pointer-events-none opacity-50" : ""
              }`}
            >
              <ImagePlus size={14} aria-hidden="true" />
              {t("community.compose.photoChoose")}
            </label>
          </>
        )}
        {photo.state === "compressing" ? (
          <p className="text-[11px] text-[var(--color-fg-muted)]" role="status">
            {t("community.compose.photoCompressing")}
          </p>
        ) : null}
        {photo.state === "failed" ? (
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] text-[var(--color-risk-extreme)]" role="alert">
              {t(`community.compose.photoFail.${photo.failure}` as MessageKey)}
            </p>
            <button
              type="button"
              onClick={removePhoto}
              className="min-h-11 shrink-0 cursor-pointer rounded-lg px-2.5 text-xs text-[var(--color-fg)] ring-1 ring-white/12 ring-inset hover:bg-white/10 md:min-h-8"
            >
              {t("community.compose.photoRemove")}
            </button>
          </div>
        ) : null}
        <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("community.compose.photoNote")}</p>
      </section>

      <label htmlFor={consentId} className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-white/4 px-2.5 py-2 ring-1 ring-white/10 ring-inset">
        <input
          id={consentId}
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.currentTarget.checked)}
          disabled={busy}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
          data-report-consent=""
        />
        <span className="text-xs leading-relaxed text-[var(--color-fg)]">{t("community.compose.consent")}</span>
      </label>

      <section className="flex flex-col gap-1.5 border-t border-white/8 pt-3">
        {!siteKey ? (
          <p className="text-xs text-[var(--color-risk-medium)]" role="status" data-report-off="">
            {t("community.compose.off")}
          </p>
        ) : null}
        {failure ? (
          <p ref={failureRef} className="text-xs text-[var(--color-risk-extreme)]" role="alert" data-report-failure={failure}>
            {t(`community.compose.fail.${failure}` as MessageKey)}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={!ready}
          className="min-h-11 cursor-pointer rounded-lg bg-[var(--color-accent)] px-3 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
          data-report-submit=""
        >
          {phase === "verifying"
            ? t("community.compose.verifying")
            : phase === "submitting"
              ? t("community.compose.submitting")
              : t("community.compose.submit")}
        </button>
        {siteKey && !busy && categories.size === 0 ? (
          <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("community.compose.needCategory")}</p>
        ) : siteKey && !busy && !consent ? (
          <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("community.compose.needConsent")}</p>
        ) : null}
        {/* Turnstile render ลงกล่องนี้ตอนกดส่ง (มองไม่เห็นเว้นแต่ต้องให้ผู้ใช้กดยืนยันเอง) */}
        <div ref={turnstileBox} data-turnstile-box="" />
      </section>
    </form>
  );
}
