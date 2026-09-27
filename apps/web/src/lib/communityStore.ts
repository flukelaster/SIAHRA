/**
 * ความจำในเครื่องของรายงานจากประชาชน —
 * `localStorage["siahra.community"] = {"v":1,"voterToken":string|null,"votes":{[id]:1|-1},"owned":{[id]:ownerToken}}`
 *
 * - `voterToken` — token นิรนามที่ server ลงนามให้หลังผ่าน Turnstile (`POST /community/session`) ใช้เป็น
 *   `X-Voter-Token`; server ไม่ผูกกับตัวตนใด ๆ
 * - `votes` — โหวตของผู้ใช้ในเครื่องนี้ (แสดง `aria-pressed` + กดซ้ำเพื่อถอน) ไม่ใช่แหล่งความจริงของตัวนับ
 * - `owned` — `ownerToken` ของรายงานที่ผู้ใช้ส่งเอง (PR C เขียน) ใช้ลบรายงานของตัวเอง
 *
 * ทุกการอ่าน/เขียนอยู่ใน try (getter ของ `window.localStorage` โยน `SecurityError` ได้ — แบบเดียวกับ
 * `lib/shellPrefs.ts`); ข้อความที่ไม่ใช่รูปร่าง v:1 = เริ่มใหม่ว่าง ๆ (ไม่เดาบางส่วน) โมดูลนี้อยู่ใน chunk ของ
 * แผงรายงานเท่านั้น ไม่อยู่ใน entry
 */
import type { StorageLike } from "./shellPrefs";

export const COMMUNITY_STORAGE_KEY = "siahra.community";
/** จำนวนรายการสูงสุดต่อแผนที่ (โหวต/รายงานของฉัน) — รายงานหมดอายุใน 30 วัน ตัวเก่าสุดถูกตัดทิ้งก่อน */
export const COMMUNITY_STORE_MAX_ENTRIES = 500;

export interface CommunityStore {
  voterToken: string | null;
  votes: Record<string, 1 | -1>;
  owned: Record<string, string>;
}

export const EMPTY_COMMUNITY_STORE: CommunityStore = { voterToken: null, votes: {}, owned: {} };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** ข้อความดิบ → store — รูปร่างผิด/JSON พัง/รุ่นอื่น = store ว่าง (null = ยังไม่เคยเขียน ก็ว่างเช่นกัน) */
export function parseCommunityStore(raw: string | null): CommunityStore {
  if (raw === null) return EMPTY_COMMUNITY_STORE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_COMMUNITY_STORE;
  }
  if (!isRecord(parsed) || parsed.v !== 1) return EMPTY_COMMUNITY_STORE;
  const { voterToken, votes, owned } = parsed;
  if (voterToken !== null && typeof voterToken !== "string") return EMPTY_COMMUNITY_STORE;
  if (!isRecord(votes) || !isRecord(owned)) return EMPTY_COMMUNITY_STORE;
  for (const v of Object.values(votes)) if (v !== 1 && v !== -1) return EMPTY_COMMUNITY_STORE;
  for (const v of Object.values(owned)) if (typeof v !== "string") return EMPTY_COMMUNITY_STORE;
  return {
    voterToken: voterToken === "" ? null : voterToken,
    votes: votes as Record<string, 1 | -1>,
    owned: owned as Record<string, string>,
  };
}

export function readCommunityStore(getStorage: () => StorageLike): CommunityStore {
  try {
    // getter อยู่ใน try โดยตั้งใจ — ดูหัวไฟล์
    return parseCommunityStore(getStorage().getItem(COMMUNITY_STORAGE_KEY));
  } catch {
    return EMPTY_COMMUNITY_STORE;
  }
}

/** คืน false เมื่อเขียนไม่ได้ (storage ถูกปิด/เต็ม) — ผู้เรียกยังทำงานต่อได้ในหน้านี้ */
export function writeCommunityStore(getStorage: () => StorageLike, store: CommunityStore): boolean {
  try {
    getStorage().setItem(COMMUNITY_STORAGE_KEY, JSON.stringify({ v: 1, ...store }));
    return true;
  } catch {
    return false;
  }
}

/** ตัดรายการเก่าสุด (ลำดับการใส่ของ object) ให้เหลือไม่เกินเพดาน */
function capped<V>(entries: Record<string, V>): Record<string, V> {
  const keys = Object.keys(entries);
  if (keys.length <= COMMUNITY_STORE_MAX_ENTRIES) return entries;
  return Object.fromEntries(keys.slice(keys.length - COMMUNITY_STORE_MAX_ENTRIES).map((k) => [k, entries[k]]));
}

/** บันทึก/ถอนโหวตของฉัน (`0` = ถอน) — ตัวที่เพิ่งโหวตย้ายไปท้ายสุด (ใหม่สุด) */
export function withVote(store: CommunityStore, id: string, value: 1 | -1 | 0): CommunityStore {
  const votes = { ...store.votes };
  delete votes[id];
  if (value !== 0) votes[id] = value;
  return { ...store, votes: capped(votes) };
}

export function withVoterToken(store: CommunityStore, voterToken: string | null): CommunityStore {
  return { ...store, voterToken };
}

/** เก็บ ownerToken ของรายงานที่ฉันส่ง (PR C) */
export function withOwned(store: CommunityStore, id: string, ownerToken: string): CommunityStore {
  const owned = { ...store.owned };
  delete owned[id];
  owned[id] = ownerToken;
  return { ...store, owned: capped(owned) };
}

/** รายงานถูกลบแล้ว — ทิ้งทั้ง ownerToken และโหวตของรายงานนั้น */
export function withoutReport(store: CommunityStore, id: string): CommunityStore {
  if (!(id in store.owned) && !(id in store.votes)) return store;
  const owned = { ...store.owned };
  const votes = { ...store.votes };
  delete owned[id];
  delete votes[id];
  return { ...store, owned, votes };
}
