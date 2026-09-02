import { useEffect, useMemo, useState } from "react";
import type { FloodSceneIndex, FloodSceneIndexEntry } from "@siahra/shared-types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";
import { floodFieldRequest, indexForProvince, pickFloodScene, type FloodSceneReason } from "../lib/floodScenes";
import { decodeFloodField, inflateFloodFieldBytes, type FloodField } from "../scene/floodField";
import { snapAtIso } from "./useFloodExtent";

export { FLOOD_SCENE_MAX_AGE_MS } from "../lib/floodScenes";

export interface FloodSceneState {
  /** ฉากที่กำลังแสดง — null เมื่อไม่มีฉากในหน้าต่าง (ดู `reason`) หรือยังไม่มีดัชนี */
  scene: FloodSceneIndexEntry | null;
  /** ฉากใหม่สุดก่อนเวลาที่เลือก ไม่สนหน้าต่าง — ให้ legend บอกว่าภาพล่าสุดก่อนหน้านั้นคือเมื่อไหร่ */
  latestBefore: FloodSceneIndexEntry | null;
  /** ฟิลด์ที่ถอดแล้วของ `scene` — null ระหว่างโหลด/ล้มเหลว/ไม่มีฉาก */
  field: FloodField | null;
  loading: boolean;
  error: ErrorMessage | null;
  reason: FloodSceneReason | null;
}

/**
 * แคชฟิลด์ที่ถอดแล้ว — คีย์ `{code}/{sceneId}` ไบต์ของฉากไม่มีวันเปลี่ยน
 * (`immutable`, docs/dataset.md §8) การเลื่อนเส้นเวลากลับไปกลับมาระหว่างสองฉาก
 * จึงไม่ต้องดึงหรือถอดซ้ำ: **หนึ่ง sceneId = หนึ่งคำขอ** ตลอดอายุของแท็บ
 * ขนาดจำกัดไว้ (ฟิลด์ละ ~2 MB ที่ 686×802) เก่าสุดถูกทิ้งก่อน
 */
const FIELD_CACHE_MAX = 4;
const fieldCache = new Map<string, FloodField>();

function cacheGet(key: string): FloodField | null {
  const v = fieldCache.get(key);
  if (!v) return null;
  // ย้ายไปท้ายสุด = เพิ่งใช้
  fieldCache.delete(key);
  fieldCache.set(key, v);
  return v;
}

function cachePut(key: string, field: FloodField) {
  fieldCache.set(key, field);
  while (fieldCache.size > FIELD_CACHE_MAX) {
    const oldest = fieldCache.keys().next().value;
    if (oldest === undefined) break;
    fieldCache.delete(oldest);
  }
}

/**
 * เลือกฉาก GFM สำหรับเวลาที่ดู แล้วดึง `field.bin` ของฉากนั้น (E14.F4)
 *
 * - ฉาก = ใหม่สุดที่ `observedAt ≤ (atIso ?? now)` และไม่เก่ากว่า
 *   `FLOOD_SCENE_MAX_AGE_MS` (14 วัน) — ไม่งั้น `scene: null, reason:
 *   "no-scene-in-window"` (`lib/floodScenes.ts`)
 * - `field.bin` ถูกดึง **ครั้งเดียวต่อ sceneId** (แคชด้านบน + เบราว์เซอร์แคช
 *   `immutable` หนึ่งปี) ไม่มี poll, ไม่มี retry: ไฟล์ที่ไม่เปลี่ยนไม่มีอะไรให้ถามซ้ำ
 *   และความล้มเหลวถูกส่งขึ้นไปให้ legend บอก ไม่ใช่ลองเงียบ ๆ
 * - `atIso` ถูกปัดเป็นช่วง 10 นาที (`snapAtIso`) ก่อนเลือกฉาก จึงไม่คำนวณใหม่ทุก
 *   เฟรมของการลาก และการเลือกฉากไม่ยิงคำขอใด ๆ เว้นแต่ sceneId เปลี่ยนจริง
 */
export function useFloodScene(
  provinceCode: string | null,
  index: FloodSceneIndex | null,
  atIso: string | null = null,
): FloodSceneState {
  const snappedAt = atIso ? snapAtIso(atIso) : null;
  // ดัชนีของจังหวัดอื่น (หนึ่งเฟรมหลังสลับจังหวัด ก่อน useFloodScenes จะรีเซ็ต) นับว่า
  // ไม่มีดัชนี — ไม่งั้นจะเลือกฉากของจังหวัดเก่าแล้วขอ field.bin ใต้ path ของจังหวัดใหม่
  const ownIndex = indexForProvince(index, provinceCode);
  // ดูสด: "ตอนนี้" อ่านตอนที่ดัชนีเปลี่ยน (ทุก 10 นาที) — พอสำหรับหน้าต่าง 14 วัน
  const pick = useMemo(
    () => pickFloodScene(ownIndex, snappedAt ? Date.parse(snappedAt) : Date.now()),
    [ownIndex, snappedAt],
  );
  const request = floodFieldRequest(provinceCode, pick.scene);
  const cacheKey = request?.cacheKey ?? null;
  const url = request?.url ?? null;

  const [loaded, setLoaded] = useState<{ key: string; field: FloodField | null; error: ErrorMessage | null } | null>(null);

  useEffect(() => {
    if (!cacheKey || !url) return;
    const cached = cacheGet(cacheKey);
    if (cached) {
      setLoaded({ key: cacheKey, field: cached, error: null });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // ปกติเบราว์เซอร์แกะ Content-Encoding: gzip ให้แล้ว แต่ cache HIT ของ
        // Cloudflare อาจตอบโดยไม่มี header นั้นทั้งที่ body ยังเป็น gzip — ตัดสิน
        // จากไบต์ (1f 8b) ไม่ใช่ header (ดู inflateFloodFieldBytes)
        const field = decodeFloodField(await inflateFloodFieldBytes(await res.arrayBuffer()));
        if (cancelled) return;
        cachePut(cacheKey, field);
        setLoaded({ key: cacheKey, field, error: null });
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setLoaded({ key: cacheKey, field: null, error: errorMessage(err, "error.loadFailed") });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cacheKey, url]);

  const current = loaded && loaded.key === cacheKey ? loaded : null;
  return {
    scene: pick.scene,
    latestBefore: pick.latestBefore,
    field: current?.field ?? null,
    loading: cacheKey !== null && current === null,
    error: current?.error ?? null,
    reason: pick.reason,
  };
}
