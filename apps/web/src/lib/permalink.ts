/**
 * Pure permalink codec: the URL query string is the only shareable projection
 * of the UI state, so parsing and serialising it live here — free of React and
 * of `window` — and `hooks/usePermalink.ts` is the thin binding to the browser.
 *
 * The two directions are deliberately *not* symmetric, and that asymmetry is
 * part of the contract:
 *   - `ex` is omitted at the default exaggeration of 1, so parsing a link
 *     without it yields `null` ("use the default"), not `1`
 *   - `cam` is rounded to whole metres — a link is a viewpoint, not a state dump
 *   - `layers` is written only when the layer state DIFFERS from the app's
 *     defaults, so an absent `layers` means "everything the app defaults to",
 *     not "no layers" and not "everything on". Comparing against the defaults
 *     (rather than against "all on") is what makes a default-off layer such as
 *     E10.4's flood exposure survive a copied link: with the old rule, turning
 *     it on made every layer on, `layers` was dropped, and reopening the link
 *     silently switched it back off — a state the URL claimed to carry
 *   - `lang` is omitted at the default (Thai), so an absent `lang` means
 *     "unspecified" and the reader's own preference decides — it never means
 *     "English". Thai is the default the project decided on, and it is never
 *     inferred from the browser (docs/roadmap.md §4)
 */
import type { CameraPose } from "../scene/setupScene";
import { DEFAULT_LANG, isLang, type Lang } from "../i18n";

export interface PermalinkState {
  provinceCode: string | null;
  pose: CameraPose | null;
  exaggeration: number | null;
  layers: string[] | null;
  atIso: string | null;
  /** null = the link does not pin a language; the reader's preference wins. */
  lang: Lang | null;
}

export interface PermalinkInput {
  provinceCode: string;
  pose: CameraPose | null;
  exaggeration: number;
  layers: Record<string, boolean>;
  /**
   * ค่าเริ่มต้นของทุกชั้นในแอป (`DEFAULT_LAYERS` ใน `App.tsx`) — ใช้ตัดสินว่าจะ
   * ต้องเขียน `layers` ลง URL ไหม ไม่ใช่ค่าที่ถูก serialise ลงไปเอง
   *
   * ต้องส่งเข้ามาเสมอ ไม่มีค่าปริยาย: ถ้าปล่อยให้เดาเป็น "เปิดทุกชั้น" ชั้นที่ปิดไว้
   * เป็นค่าเริ่มต้นจะหลุดออกจากลิงก์ทันทีที่ผู้ใช้เปิดมัน
   */
  defaultLayers: Record<string, boolean>;
  atIso: string | null;
  lang: Lang;
}

/** Reads a `?p=..&cam=..` query string (leading `?` optional) into state. */
export function parsePermalink(search: string): PermalinkState {
  const q = new URLSearchParams(search);
  const p = q.get("p");
  const cam = q.get("cam");
  let pose: CameraPose | null = null;
  if (cam) {
    const n = cam.split(",").map(Number);
    if (n.length === 6 && n.every((v) => Number.isFinite(v))) {
      pose = { position: [n[0], n[1], n[2]], target: [n[3], n[4], n[5]] };
    }
  }
  const ex = q.get("ex");
  const layers = q.get("layers");
  const t = q.get("t");
  const lang = q.get("lang");
  return {
    provinceCode: p && /^[0-9]{2}$/.test(p) ? p : null,
    pose,
    exaggeration: ex && Number.isFinite(Number(ex)) ? Number(ex) : null,
    layers: layers ? layers.split(",").filter(Boolean) : null,
    atIso: t && Number.isFinite(Date.parse(t)) ? t : null,
    lang: isLang(lang) ? lang : null,
  };
}

/** Renders the shareable UI state as a `?...` query string. */
export function serialisePermalink(state: PermalinkInput): string {
  const q = new URLSearchParams();
  q.set("p", state.provinceCode);
  if (state.pose) {
    q.set("cam", [...state.pose.position, ...state.pose.target].map((v) => Math.round(v)).join(","));
  }
  if (state.exaggeration !== 1) q.set("ex", String(state.exaggeration));
  const on = Object.entries(state.layers)
    .filter(([, v]) => v)
    .map(([k]) => k);
  // ชั้นที่ผู้อ่านลิงก์ไม่รู้จัก (บันเดิลคนละรุ่น) ถือว่าเปิดเป็นค่าเริ่มต้น ซึ่งเป็น
  // พฤติกรรมเดิมของแอปกับคีย์ที่ไม่มีใน DEFAULT_LAYERS
  const differsFromDefault = Object.entries(state.layers).some(
    ([k, v]) => v !== (state.defaultLayers[k] ?? true),
  );
  if (differsFromDefault) q.set("layers", on.join(","));
  if (state.atIso) q.set("t", state.atIso);
  if (state.lang !== DEFAULT_LANG) q.set("lang", state.lang);
  return `?${q.toString()}`;
}
