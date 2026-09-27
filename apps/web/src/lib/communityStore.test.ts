import { describe, expect, it } from "vitest";
import {
  COMMUNITY_STORAGE_KEY,
  COMMUNITY_STORE_MAX_ENTRIES,
  EMPTY_COMMUNITY_STORE,
  parseCommunityStore,
  readCommunityStore,
  withOwned,
  withVote,
  withVoterToken,
  withoutReport,
  writeCommunityStore,
} from "./communityStore";
import type { StorageLike } from "./shellPrefs";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
  };
}

const ID = "20260927-AAAAAAAAAAAAAAAAAAAAAA";

describe("communityStore — parseCommunityStore", () => {
  it("รับรูปร่าง v:1", () => {
    expect(parseCommunityStore(JSON.stringify({ v: 1, voterToken: "tok", votes: { [ID]: -1 }, owned: { [ID]: "own" } }))).toEqual({
      voterToken: "tok",
      votes: { [ID]: -1 },
      owned: { [ID]: "own" },
    });
    expect(parseCommunityStore(JSON.stringify({ v: 1, voterToken: null, votes: {}, owned: {} }))).toEqual(EMPTY_COMMUNITY_STORE);
  });

  it.each([
    ["ไม่เคยเขียน", null],
    ["JSON พัง", "{nope"],
    ["รุ่นอื่น", JSON.stringify({ v: 2, voterToken: null, votes: {}, owned: {} })],
    ["ไม่ใช่อ็อบเจ็กต์", "[]"],
    ["โหวตค่าผิด", JSON.stringify({ v: 1, voterToken: null, votes: { [ID]: 2 }, owned: {} })],
    ["token ชนิดผิด", JSON.stringify({ v: 1, voterToken: 5, votes: {}, owned: {} })],
    ["owned ชนิดผิด", JSON.stringify({ v: 1, voterToken: null, votes: {}, owned: { [ID]: 1 } })],
    ["ไม่มี votes", JSON.stringify({ v: 1, voterToken: null, owned: {} })],
  ])("%s → store ว่าง (เริ่มใหม่ ไม่เดาบางส่วน)", (_name, raw) => {
    expect(parseCommunityStore(raw)).toEqual(EMPTY_COMMUNITY_STORE);
  });
});

describe("communityStore — อ่าน/เขียนผ่าน storage", () => {
  it("เขียนแล้วอ่านกลับได้ค่าเดิม ใต้คีย์ siahra.community", () => {
    const mem = memoryStorage();
    const s = withOwned(withVote(withVoterToken(EMPTY_COMMUNITY_STORE, "tok"), ID, 1), ID, "own");
    expect(writeCommunityStore(() => mem, s)).toBe(true);
    expect(COMMUNITY_STORAGE_KEY).toBe("siahra.community");
    expect(JSON.parse(mem.store.get(COMMUNITY_STORAGE_KEY) ?? "null")).toMatchObject({ v: 1, voterToken: "tok" });
    expect(readCommunityStore(() => mem)).toEqual(s);
  });

  it("storage โยนตั้งแต่ getter หรือตอนเขียน = ไม่พัง (อ่านได้ store ว่าง, เขียนคืน false)", () => {
    const throwing = () => {
      throw new Error("SecurityError");
    };
    expect(readCommunityStore(throwing)).toEqual(EMPTY_COMMUNITY_STORE);
    expect(writeCommunityStore(throwing, EMPTY_COMMUNITY_STORE)).toBe(false);
    const full: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(writeCommunityStore(() => full, EMPTY_COMMUNITY_STORE)).toBe(false);
  });
});

describe("communityStore — การแก้", () => {
  it("โหวต 0 = ถอน; โหวตใหม่ทับของเดิม", () => {
    let s = withVote(EMPTY_COMMUNITY_STORE, ID, 1);
    expect(s.votes[ID]).toBe(1);
    s = withVote(s, ID, -1);
    expect(s.votes[ID]).toBe(-1);
    s = withVote(s, ID, 0);
    expect(ID in s.votes).toBe(false);
  });

  it("เพดานจำนวนรายการ — ตัดตัวเก่าสุดก่อน", () => {
    let s = EMPTY_COMMUNITY_STORE;
    for (let i = 0; i < COMMUNITY_STORE_MAX_ENTRIES + 3; i++) s = withVote(s, `id-${i}`, 1);
    const keys = Object.keys(s.votes);
    expect(keys).toHaveLength(COMMUNITY_STORE_MAX_ENTRIES);
    expect(keys[0]).toBe("id-3");
    expect(keys.at(-1)).toBe(`id-${COMMUNITY_STORE_MAX_ENTRIES + 2}`);
  });

  it("ลบรายงานแล้ว = ทิ้ง ownerToken และโหวตของรายงานนั้น", () => {
    const s = withOwned(withVote(EMPTY_COMMUNITY_STORE, ID, 1), ID, "own");
    const out = withoutReport(s, ID);
    expect(out.owned).toEqual({});
    expect(out.votes).toEqual({});
    expect(withoutReport(out, ID)).toBe(out);
  });
});
