import type { EarthquakeEvent, EqWsMessage } from "@siahra/shared-types";

/**
 * สถานะและ reducer ของฟีดแผ่นดินไหว — โมดูลบริสุทธิ์ล้วน (ไม่มี WebSocket, ไม่มี timer,
 * ไม่มี Date.now()) เพื่อให้เทสสถานะ degrade ได้จริงโดยไม่ต้องมี DOM
 *
 * ความซื่อสัตย์ต่อข้อมูล: `asOf` มาจากสายเท่านั้น (snapshot.asOf / heartbeat.ts /
 * asOf ของ REST) ห้ามเติมด้วยนาฬิกาเครื่องผู้ใช้ — ไม่อย่างนั้นตอนสายหลุด การ์ดจะ
 * โฆษณาว่า "เพิ่งอัปเดต" ทั้งที่ไม่ได้รับอะไรจากต้นทางมาหลายนาทีแล้ว
 */

export type FeedStatus = "connecting" | "live" | "polling" | "reconnecting" | "error";

export interface EarthquakeFeedState {
  events: EarthquakeEvent[];
  status: FeedStatus;
  /** เวลาที่ต้นทางบอกว่าเป็นข้อมูล ณ ตอนไหน — null = ยังไม่เคยได้รับข้อมูลเลย */
  asOf: string | null;
  error: string | null;
  /** จำนวนเฟรมที่ parse ไม่ได้ นับไว้เพื่อแสดงบน UI แทนที่จะทิ้งเงียบ ๆ */
  parseErrors: number;
  /** จำนวนครั้งที่สายหลุดติดกัน ใช้คำนวณ backoff และรีเซ็ตเมื่อได้ snapshot */
  reconnectAttempt: number;
}

export type FeedAction =
  | { type: "ws.message"; msg: EqWsMessage }
  | { type: "ws.parse-error" }
  | { type: "ws.closed" }
  | { type: "ws.watchdog" }
  | { type: "poll.success"; asOf: string; events: EarthquakeEvent[] }
  | { type: "poll.error"; message: string };

export const initialFeedState: EarthquakeFeedState = {
  events: [],
  status: "connecting",
  asOf: null,
  error: null,
  parseErrors: 0,
  reconnectAttempt: 0,
};

export function sortByTimeDesc(events: EarthquakeEvent[]): EarthquakeEvent[] {
  return [...events].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

export function upsert(events: EarthquakeEvent[], incoming: EarthquakeEvent): EarthquakeEvent[] {
  const idx = events.findIndex((e) => e.id === incoming.id);
  if (idx === -1) return sortByTimeDesc([incoming, ...events]);
  // Last-write-wins on the upstream `updated` stamp, mirroring the
  // server-side dedupe rule so a stale re-delivery can't clobber a revision.
  if (Date.parse(incoming.updated) < Date.parse(events[idx].updated)) return events;
  const next = [...events];
  next[idx] = incoming;
  return sortByTimeDesc(next);
}

export function feedReducer(state: EarthquakeFeedState, action: FeedAction): EarthquakeFeedState {
  switch (action.type) {
    case "ws.message": {
      const msg = action.msg;
      switch (msg.type) {
        case "snapshot":
          // สายกลับมาใช้งานได้จริงแล้ว จึงเป็นจุดเดียวที่รีเซ็ต backoff
          return {
            ...state,
            events: sortByTimeDesc(msg.events),
            status: "live",
            // snapshot ของ DO ที่ยังไม่เคย poll สำเร็จส่ง `asOf: null` มา — คงค่าเดิม
            // ที่เคยรู้ไว้ เหมือนเส้นทาง heartbeat ดีกว่าล้างทิ้งแล้วแสดงว่าไม่มีข้อมูล
            asOf: msg.asOf ?? state.asOf,
            error: null,
            reconnectAttempt: 0,
          };
        case "event.created":
        case "event.updated":
          // asOf ไม่ขยับ: เฟรมนี้ไม่ได้บอกเวลาอ้างอิงของชุดข้อมูลมาด้วย
          return { ...state, status: "live", events: upsert(state.events, msg.event) };
        case "event.deleted":
          return { ...state, events: state.events.filter((e) => e.id !== msg.id) };
        case "heartbeat":
          /**
           * heartbeat พิสูจน์ว่า "สายยังมีชีวิต" ไม่ใช่ว่า "ข้อมูลใหม่" — ตั้งแต่ E6.1
           * มันเต้นทุก 30 วิ โดยไม่ผูกกับรอบ poll ดังนั้น `asOf` ต้องมาจาก
           * `msg.asOf` (เวลาของรอบ poll จริง) เท่านั้น ห้ามถอยไปใช้ `serverTime`/`ts`
           * ซึ่งเป็นนาฬิกาเซิร์ฟเวอร์ ไม่งั้นการ์ดจะโฆษณาความสดทั้งที่ poll ล้มยาว
           *
           * `msg.asOf` เป็น undefined ได้เมื่อ api ยังเป็นรุ่นก่อน E6.1 (สอง Worker
           * ขึ้นแยกกัน) และเป็น null เมื่อยังไม่เคย poll สำเร็จเลย — ทั้งสองกรณีให้คง
           * ค่าเดิมไว้ ไม่ใช่ล้าง `asOf` ที่เคยรู้ทิ้ง
           */
          return { ...state, status: "live", asOf: msg.asOf ?? state.asOf, error: null };
        default:
          return state;
      }
    }
    case "ws.parse-error":
      // เฟรมพังต้องนับและโชว์ ไม่ใช่ทิ้งเงียบ ๆ แล้วทำเหมือนฟีดยังสมบูรณ์
      return { ...state, parseErrors: state.parseErrors + 1 };
    case "ws.watchdog":
      // ไม่มีเฟรมใด ๆ นานเกิน watchdog → ถือว่าสายตายทั้งที่ readyState ยัง OPEN
      return { ...state, status: "reconnecting", error: null };
    case "ws.closed":
      return { ...state, status: "reconnecting", reconnectAttempt: state.reconnectAttempt + 1 };
    case "poll.success":
      // ยังไม่ live: ข้อมูลชุดนี้มาจาก REST fallback จึงเป็น "ดึงเป็นช่วง" ไม่ใช่ "เรียลไทม์"
      return {
        ...state,
        events: sortByTimeDesc(action.events),
        status: "polling",
        asOf: action.asOf,
        error: null,
      };
    case "poll.error":
      // เก็บ events/asOf เดิมไว้ให้เห็นว่าข้อมูลเก่าแค่ไหน แทนที่จะล้างจอ
      return { ...state, status: "error", error: action.message };
    default:
      return state;
  }
}
