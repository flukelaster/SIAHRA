import { ExternalLink, MessageSquareWarning, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { CommunityReport, CommunityVoteValue } from "@siahra/shared-types";
import { PROVINCES } from "../../data/provinces";
import { useNow } from "../../hooks/useNow";
import { useLang } from "../../i18n/context";
import type { MessageKey } from "../../i18n";
import { castVote, deleteOwnReport, type CommunityFailure } from "../../lib/communityApi";
import { COMMUNITY_CATEGORY_COLOR } from "../../lib/communityReports";
import {
  readCommunityStore,
  withVote,
  withVoterToken,
  withoutReport,
  writeCommunityStore,
  type CommunityStore,
} from "../../lib/communityStore";
import { EPISTEMIC_BADGE } from "../../lib/layerFreshness";
import type { ShellSafeArea } from "../../lib/shellLayout";
import { formatAge, formatFullDateTime } from "../../lib/time";
import { getTurnstileToken, turnstileSiteKey } from "../../lib/turnstile";
import { RightSheet, RightSheetHeader } from "./RightSheet";

const TITLE_ID = "report-sheet-title";
/** รูปจาก API อยู่ใต้เส้นทางนี้เท่านั้น (same-origin) — URL อื่นไม่ถูกแสดง */
const IMAGE_PATH = /^\/api\/v1\/community\/image\/[0-9]{8}-[A-Za-z0-9_-]{22}$/;

const storage = () => window.localStorage;

/**
 * แผงรายงานจากประชาชนด้านขวา (chunk แยก ผ่าน `lazyMapViews.tsx`) — เปิดจากการคลิกหมุด ใช้กรอบ `RightSheet`
 * ร่วมกับแผงกล้อง (มีได้ทีละแผง)
 *
 * ความซื่อสัตย์ต่อข้อมูล:
 * - ป้าย "ยังไม่ได้ตรวจสอบ — ไม่ใช่ข้อมูลจากหน่วยงาน" อยู่ในหัวแผงเสมอ (ไม่เลื่อนหาย) ในสีของชิป crowdsourced
 * - เวลาเดียวที่แสดงคือ `createdAt` (เวลาของ server ตอนรับรายงาน) — ไม่มีเวลาที่ผู้รายงานอ้าง
 * - คำอธิบายเป็นข้อความธรรมดา (React escape ให้ ไม่มี innerHTML) รักษาการขึ้นบรรทัดของผู้เขียน
 * - รูปโหลดเมื่อแผงเปิดเท่านั้น (`loading="lazy"`) ไม่มี prefetch
 * - ตัวนับโหวตหลังโหวตมาจากคำตอบของ server เท่านั้น; ใต้ปุ่มบอกว่าคะแนนเป็นความเห็น ไม่ใช่การยืนยัน
 * - ล้มเหลวทุกแบบบอกเป็นข้อความตรงตัว (ปิดชั่วคราว / ครบเพดาน / ถี่เกิน / เครือข่าย / …) ว่า "ไม่ได้บันทึก"
 */
export function ReportSheet({
  report,
  gone,
  stale,
  safeArea,
  onClose,
  onVotes,
  onRemoved,
}: {
  /** รายงานที่แสดง — ตัวล่าสุดในรายการ หรือสำเนาตอนคลิกเมื่อไม่อยู่ในรายการแล้ว */
  report: CommunityReport;
  /** ไม่อยู่ในรายการล่าสุดแล้ว (ถูกซ่อน/ลบ/หมดอายุ) */
  gone: boolean;
  /** รอบล่าสุดของรายการล้มเหลว — ตัวเลขโหวตอาจไม่ใช่ของล่าสุด */
  stale: boolean;
  safeArea: ShellSafeArea;
  onClose: () => void;
  /** ตัวนับจาก server หลังโหวต — ใส่ทับรายการในเครื่องทันที (`useCommunityReports.patchVotes`) */
  onVotes: (id: string, counts: { up: number; down: number; hidden: boolean }) => void;
  /** ลบรายงานของฉันสำเร็จ (`useCommunityReports.removeLocal`) */
  onRemoved: (id: string) => void;
}) {
  const { t } = useLang();
  return (
    <RightSheet kind="report" selKey={report.id} titleId={TITLE_ID} safeArea={safeArea} onClose={onClose}>
      <ReportSheetContent
        key={report.id}
        report={report}
        gone={gone}
        stale={stale}
        onClose={onClose}
        onVotes={onVotes}
        onRemoved={onRemoved}
        closeLabel={t("common.close")}
      />
    </RightSheet>
  );
}

function ReportSheetContent({
  report,
  gone,
  stale,
  onClose,
  onVotes,
  onRemoved,
  closeLabel,
}: {
  report: CommunityReport;
  gone: boolean;
  stale: boolean;
  onClose: () => void;
  onVotes: (id: string, counts: { up: number; down: number; hidden: boolean }) => void;
  onRemoved: (id: string) => void;
  closeLabel: string;
}) {
  const { lang, t } = useLang();
  const nowMs = useNow();
  const siteKey = turnstileSiteKey();
  const [store, setStore] = useState<CommunityStore>(() => readCommunityStore(storage));
  const update = (f: (s: CommunityStore) => CommunityStore) => {
    // อ่านล่าสุดจาก storage ก่อนแก้ — อีกแท็บอาจเขียนไว้ระหว่างที่แผงนี้เปิดอยู่ (เขียนไม่ได้ = ยังใช้ในหน้านี้ได้)
    const next = f(readCommunityStore(storage));
    writeCommunityStore(storage, next);
    setStore(next);
  };
  const turnstileBox = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<CommunityFailure | null>(null);
  const [hiddenAfterVote, setHiddenAfterVote] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const myVote = store.votes[report.id] ?? 0;
  const ownerToken = store.owned[report.id] ?? null;
  const categoryLabels = report.categories.map((c) => t(`community.category.${c}` as MessageKey));
  const province = PROVINCES.find((p) => p.code === report.provinceCode);
  const provinceName = province ? (lang === "th" ? province.nameTh : province.nameEn) : report.provinceCode;
  const imageUrl = report.imageUrl && IMAGE_PATH.test(report.imageUrl) ? report.imageUrl : null;
  const crowd = EPISTEMIC_BADGE.crowdsourced;

  const vote = async (pressed: 1 | -1) => {
    if (busy || !siteKey || deleted) return;
    const value: CommunityVoteValue = myVote === pressed ? 0 : pressed;
    setBusy(true);
    setFailure(null);
    const res = await castVote(report.id, value, {
      getVoterToken: () => readCommunityStore(storage).voterToken,
      setVoterToken: (token) => update((s) => withVoterToken(s, token)),
      turnstileToken: () => {
        const box = turnstileBox.current;
        if (!box) return Promise.reject(new Error("no Turnstile container"));
        return getTurnstileToken(box, siteKey, lang);
      },
    });
    setBusy(false);
    if (!res.ok) {
      setFailure(res.failure);
      return;
    }
    update((s) => withVote(s, report.id, value));
    onVotes(report.id, res.value);
    if (res.value.hidden) setHiddenAfterVote(true);
  };

  const remove = async () => {
    if (!ownerToken || busy) return;
    setBusy(true);
    setFailure(null);
    const res = await deleteOwnReport(report.id, ownerToken);
    setBusy(false);
    setConfirmDelete(false);
    if (!res.ok) {
      setFailure(res.failure);
      return;
    }
    update((s) => withoutReport(s, report.id));
    setDeleted(true);
    onRemoved(report.id);
  };

  const inactive = gone || hiddenAfterVote || deleted;
  const voteBtn = (value: 1 | -1) => {
    const pressed = myVote === value;
    const Icon = value === 1 ? ThumbsUp : ThumbsDown;
    const n = value === 1 ? report.up : report.down;
    return (
      <button
        type="button"
        onClick={() => void vote(value)}
        disabled={!siteKey || busy || inactive}
        aria-pressed={pressed}
        title={pressed ? t("community.vote.mine") : undefined}
        className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50 md:min-h-9 ${
          pressed
            ? "bg-[var(--color-accent)]/25 text-white ring-1 ring-[var(--color-accent)]/70 ring-inset"
            : "bg-white/6 text-[var(--color-fg)] ring-1 ring-white/12 ring-inset hover:bg-white/10"
        }`}
      >
        <Icon size={14} aria-hidden="true" />
        {t(value === 1 ? "community.vote.up" : "community.vote.down")}
        <span className="tabular-nums text-[var(--color-fg-muted)]">{n}</span>
      </button>
    );
  };

  return (
    <>
      <RightSheetHeader
        titleId={TITLE_ID}
        kicker={
          <>
            <MessageSquareWarning size={11} aria-hidden="true" className="text-[#f9a8d4]" />
            {t("community.kicker")}
          </>
        }
        title={categoryLabels.join(" · ")}
        onClose={onClose}
        closeLabel={closeLabel}
      >
        <p
          className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${crowd.className}`}
          title={t(crowd.titleKey)}
          data-report-unverified=""
        >
          {t("community.unverified")}
        </p>
      </RightSheetHeader>
      <div
        className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3.5 py-3 ${inactive ? "opacity-70" : ""}`}
      >
        {deleted ? <p className="text-xs text-[var(--color-fg)]">{t("community.delete.done")}</p> : null}
        {hiddenAfterVote ? (
          <p className="text-xs text-[var(--color-risk-medium)]" role="status">
            {t("community.vote.hidden")}
          </p>
        ) : gone && !deleted ? (
          <p className="text-xs text-[var(--color-risk-medium)]" role="status">
            {t("community.gone")}
          </p>
        ) : null}
        {stale && !inactive ? <p className="text-[11px] text-[var(--color-risk-medium)]">{t("community.stale")}</p> : null}

        <ul className="flex flex-wrap gap-1" aria-label={t("community.kicker")}>
          {report.categories.map((c, i) => (
            <li
              key={c}
              className="inline-flex items-center gap-1 rounded-full bg-white/6 px-2 py-0.5 text-[11px] text-[var(--color-fg)] ring-1 ring-white/12 ring-inset"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: COMMUNITY_CATEGORY_COLOR[c] }} aria-hidden="true" />
              {categoryLabels[i]}
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          {t("community.reportedAt", {
            time: formatFullDateTime(lang, report.createdAt),
            age: formatAge(lang, report.createdAt, nowMs),
          })}
          {" · "}
          {t("viewport.province", { name: provinceName })}
        </p>

        {report.description.trim() !== "" ? (
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-[var(--color-fg)]">{report.description}</p>
        ) : (
          <p className="text-xs text-[var(--color-fg-subtle)]">{t("community.noDescription")}</p>
        )}

        {imageUrl ? (
          imageFailed ? (
            <p className="text-xs text-[var(--color-risk-extreme)]">{t("community.image.failed")}</p>
          ) : (
            <a
              href={imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={t("community.image.open")}
              className="group relative block overflow-hidden rounded-lg bg-black/40 ring-1 ring-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              <img
                src={imageUrl}
                alt={t("community.image.alt", { categories: categoryLabels.join(", ") })}
                loading="lazy"
                decoding="async"
                onError={() => setImageFailed(true)}
                className="max-h-72 w-full object-contain"
              />
              <span className="absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/90">
                <ExternalLink size={10} aria-hidden="true" />
                {t("community.image.open")}
              </span>
            </a>
          )
        ) : null}

        <section className="flex flex-col gap-1.5" aria-label={t("community.vote.note")}>
          <div className="flex gap-2">
            {voteBtn(1)}
            {voteBtn(-1)}
          </div>
          <p className="text-[11px] text-[var(--color-fg-subtle)]">{t("community.vote.note")}</p>
          {!siteKey ? <p className="text-[11px] text-[var(--color-fg-muted)]">{t("community.vote.off")}</p> : null}
          {busy ? (
            <p className="text-[11px] text-[var(--color-fg-muted)]" role="status">
              {t("community.vote.busy")}
            </p>
          ) : null}
          {failure ? (
            <p className="text-[11px] text-[var(--color-risk-extreme)]" role="alert">
              {t(`community.fail.${failure === "not-configured" ? "disabled" : failure}` as MessageKey)}
            </p>
          ) : null}
          {/* Turnstile render ลงกล่องนี้ (มองไม่เห็นเว้นแต่ต้องให้ผู้ใช้กดยืนยันเอง) — เฉพาะตอนโหวต */}
          <div ref={turnstileBox} data-turnstile-box="" />
        </section>

        {ownerToken && !deleted ? (
          <section className="flex flex-col gap-1.5 border-t border-white/8 pt-2.5">
            {confirmDelete ? (
              <>
                <p className="text-xs text-[var(--color-fg)]">{t("community.delete.confirm")}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void remove()}
                    disabled={busy}
                    className="min-h-11 flex-1 cursor-pointer rounded-lg bg-[var(--color-risk-extreme)]/80 px-2 text-xs font-medium text-white hover:bg-[var(--color-risk-extreme)] disabled:opacity-50 md:min-h-9"
                  >
                    {t("community.delete.yes")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={busy}
                    className="min-h-11 flex-1 cursor-pointer rounded-lg bg-white/6 px-2 text-xs text-[var(--color-fg)] ring-1 ring-white/12 ring-inset hover:bg-white/10 disabled:opacity-50 md:min-h-9"
                  >
                    {t("community.delete.no")}
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 self-start rounded-lg px-2.5 text-xs text-[var(--color-risk-extreme)] ring-1 ring-[var(--color-risk-extreme)]/40 ring-inset hover:bg-[var(--color-risk-extreme)]/10 md:min-h-8"
              >
                <Trash2 size={13} aria-hidden="true" />
                {t("community.delete")}
              </button>
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
