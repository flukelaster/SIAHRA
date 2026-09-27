import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommunityReport, CommunityReportsResponse } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";
import { nextCommunityPollDelayMs } from "../lib/pollSchedule";
import { EMPTY_OVERLAY, applyOverlay, pruneOverlay, type CommunityOverlay } from "../lib/communityReports";

/**
 * รายการรายงานจากประชาชนของจังหวัดที่เลือกอยู่ — **hook ตัวเดียว** ใน App.tsx (แผนที่ legend และแผงรายงาน
 * อ่านร่วมกัน)
 *
 * ข้อจำกัดต้นทุนจาก devops (PR A): `GET /api/v1/community/{code}/reports` **ไม่มี query string** (API ตอบ 400)
 * ถามทุก 2 นาที (`lib/pollSchedule.ts`) เฉพาะเมื่อชั้นเปิด (`enabled`) + มีจังหวัด + แท็บมองเห็นอยู่ — ชั้นปิดตอนเปิด
 * หน้า = ไม่มีคำขอใดใต้ `/api/v1/community` เลย; ล้มเหลวถามซ้ำไม่ถี่กว่า 60 วิ; ไม่ prefetch รูป (รูปโหลดเมื่อ
 * เปิดแผงรายงานเท่านั้น)
 *
 * ความซื่อสัตย์ต่อข้อมูล:
 * - 404/400/503/เครือข่าย = **error** ไม่ใช่ "ไม่มีรายงาน" — รายการล่าสุดที่ได้ไว้คงอยู่ (แผนที่หรี่ลง legend บอกเหตุ)
 * - `fetchedAt` = เวลาที่ DO อ่านรายการ (จากคำตอบ) — null จนกว่าจะสำเร็จครั้งแรก ไม่ใช่นาฬิกาเครื่อง
 * - สลับจังหวัด = ทิ้งรายการและความจำของรอบถามของจังหวัดเดิมทันที (หมุดของจังหวัดก่อนหน้าไม่ถูกวาดบนจังหวัดใหม่
 *   แม้เสี้ยววินาที และจังหวัดใหม่ไม่ต้องรอรอบ 2 นาทีของจังหวัดเดิม)
 *
 * `upsertLocal`/`removeLocal`/`patchVotes` ใส่การกระทำของผู้ใช้เองทับรายการทันที (รายการถูกแคชที่ขอบ 30 วิ) —
 * ดู overlay ใน `lib/communityReports.ts`
 */
export interface CommunityReportsState {
  /** รายการของจังหวัดที่เลือกอยู่ (รวม overlay) — null = ยังไม่เคยได้สำเร็จสำหรับจังหวัดนี้ */
  data: CommunityReportsResponse | null;
  /** รอบล่าสุดล้มเหลว — null = รอบล่าสุดสำเร็จ (หรือยังไม่เคยถาม) */
  error: ErrorMessage | null;
  /** กำลังรอคำตอบแรกของจังหวัดนี้ */
  loading: boolean;
  /** `data.fetchedAt` — null = ยังไม่เคยได้รายการ (ห้ามแสดงเป็นเวลาใด ๆ) */
  fetchedAt: string | null;
  /** จำนวนรายงานในช่วงเก็บที่ถูกซ่อน (โหวตลงถึงเกณฑ์/ผู้ดูแลซ่อน) — 0 เมื่อยังไม่มีรายการ */
  hiddenCount: number;
  upsertLocal: (report: CommunityReport) => void;
  removeLocal: (id: string) => void;
  patchVotes: (id: string, counts: { up: number; down: number; hidden: boolean }) => void;
}

interface PollMemo {
  code: string;
  lastSuccessAtMs: number | null;
  lastWasError: boolean;
}

interface Held {
  code: string;
  response: CommunityReportsResponse | null;
  error: ErrorMessage | null;
}

const RESPONSE_OK = (v: unknown): v is CommunityReportsResponse =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { fetchedAt?: unknown }).fetchedAt === "string" &&
  Array.isArray((v as { reports?: unknown }).reports) &&
  typeof (v as { hiddenCount?: unknown }).hiddenCount === "number";

export function useCommunityReports(provinceCode: string | null, enabled: boolean): CommunityReportsState {
  const [held, setHeld] = useState<Held>({ code: provinceCode ?? "", response: null, error: null });
  const [overlay, setOverlay] = useState<{ code: string; value: CommunityOverlay }>({
    code: provinceCode ?? "",
    value: EMPTY_OVERLAY,
  });
  const memo = useRef<PollMemo>({ code: provinceCode ?? "", lastSuccessAtMs: null, lastWasError: false });

  useEffect(() => {
    if (!enabled || !provinceCode) return;
    // ความจำของรอบถามผูกกับจังหวัด — จังหวัดใหม่เริ่มนับใหม่ (ยิงทันที)
    if (memo.current.code !== provinceCode) {
      memo.current = { code: provinceCode, lastSuccessAtMs: null, lastWasError: false };
    }
    const m = memo.current;
    const code = provinceCode;
    setHeld((h) => (h.code === code ? h : { code, response: null, error: null }));
    let stopped = false;
    let inFlight: AbortController | null = null;
    let timer: number | null = null;
    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      clearTimer();
      if (stopped || inFlight) return;
      const delay = nextCommunityPollDelayMs({
        lastSuccessAtMs: m.lastSuccessAtMs,
        nowMs: Date.now(),
        hidden: document.visibilityState === "hidden",
        panelOpen: false,
        lastWasError: m.lastWasError,
      });
      if (delay === null) return;
      timer = window.setTimeout(() => void load(), delay);
    };
    const load = async () => {
      timer = null;
      const controller = new AbortController();
      inFlight = controller;
      try {
        const res = await fetch(`/api/v1/community/${code}/reports`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: unknown = await res.json();
        if (!RESPONSE_OK(body)) throw new Error("Malformed community report list");
        if (stopped) return;
        m.lastSuccessAtMs = Date.now();
        m.lastWasError = false;
        setHeld({ code, response: body, error: null });
        setOverlay((o) => (o.code === code ? { code, value: pruneOverlay(o.value, body.fetchedAt) } : o));
      } catch (err) {
        if (stopped || controller.signal.aborted) return;
        m.lastWasError = true;
        // รายการที่ได้ไว้แล้วคงอยู่ — แค่บอกว่ารอบล่าสุดล้มเหลว
        setHeld((h) =>
          h.code === code
            ? { ...h, error: errorMessage(err, "error.loadFailed") }
            : { code, response: null, error: errorMessage(err, "error.loadFailed") },
        );
      } finally {
        if (inFlight === controller) inFlight = null;
      }
      schedule();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") clearTimer();
      else schedule();
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      stopped = true;
      clearTimer();
      inFlight?.abort();
      inFlight = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [provinceCode, enabled]);

  const code = provinceCode ?? "";
  const mine = held.code === code;
  const response = mine ? held.response : null;
  const ov = overlay.code === code ? overlay.value : EMPTY_OVERLAY;
  const data = useMemo(() => (response ? applyOverlay(response, ov) : null), [response, ov]);

  const edit = useCallback(
    (f: (o: CommunityOverlay, atMs: number) => CommunityOverlay) =>
      setOverlay((o) => {
        const base = o.code === code ? o.value : EMPTY_OVERLAY;
        return { code, value: f(base, Date.now()) };
      }),
    [code],
  );
  const upsertLocal = useCallback(
    (report: CommunityReport) =>
      edit((o, atMs) => ({ ...o, upserts: new Map(o.upserts).set(report.id, { report, atMs }) })),
    [edit],
  );
  const removeLocal = useCallback(
    (id: string) => edit((o, atMs) => ({ ...o, removals: new Map(o.removals).set(id, atMs) })),
    [edit],
  );
  const patchVotes = useCallback(
    (id: string, counts: { up: number; down: number; hidden: boolean }) =>
      edit((o, atMs) => ({ ...o, votes: new Map(o.votes).set(id, { ...counts, atMs }) })),
    [edit],
  );

  return {
    data,
    error: mine ? held.error : null,
    // ยังไม่มีรายการของจังหวัดนี้และยังไม่ล้มเหลว = กำลังรอคำตอบแรก
    loading: enabled && provinceCode !== null && response === null && (!mine || held.error === null),
    fetchedAt: data?.fetchedAt ?? null,
    hiddenCount: data?.hiddenCount ?? 0,
    upsertLocal,
    removeLocal,
    patchVotes,
  };
}
