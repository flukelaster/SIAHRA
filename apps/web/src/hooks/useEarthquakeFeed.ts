import { useEffect, useReducer, useRef } from "react";
import type { EarthquakeRecentResponse, EqWsMessage } from "@siahra/shared-types";
import { nextReconnectDelayMs } from "../lib/feed/backoff";
import { feedReducer, initialFeedState } from "../lib/feed/reducer";
import type { EarthquakeFeedState, FeedStatus } from "../lib/feed/reducer";

export type { EarthquakeFeedState, FeedStatus };

/** ฝั่ง DO ยิง heartbeat ทุกรอบ poll = 60 วินาที (`POLL_INTERVAL_MS` ใน earthquake-feed.ts) */
const SERVER_HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * ไม่ได้รับเฟรมใด ๆ นานเกินค่านี้ = ถือว่าสายตาย แม้ readyState จะยัง OPEN
 * (สาย WS ที่ถูก proxy ตัดกลางทางมักไม่ยิง close event เลย)
 * เผื่อ slack ไว้ 2.5 เท่าของ heartbeat กัน false positive จาก poll ที่ช้าไปหนึ่งรอบ
 * — ค่านี้ถูกจูนใหม่ใน E6.1 จึงตั้งชื่อไว้ให้หาเจอ
 */
export const HEARTBEAT_WATCHDOG_MS = 2.5 * SERVER_HEARTBEAT_INTERVAL_MS; // 150 s

/** ระหว่างที่ยังไม่ live ให้ REST คอยเติมข้อมูลทุก 30 วินาที */
export const REST_FALLBACK_INTERVAL_MS = 30_000;

/**
 * Live earthquake events from the Worker's Durable Object feed.
 * The socket always delivers a `snapshot` before any `event.*`, so initial
 * state needs no separate REST race — the REST call is the fallback for when
 * the WebSocket cannot connect, and it keeps polling for as long as the socket
 * is down instead of leaving the card frozen on stale numbers.
 */
export function useEarthquakeFeed(): EarthquakeFeedState {
  const [state, dispatch] = useReducer(feedReducer, initialFeedState);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);
  // นับ attempt ไว้ใน ref ด้วย เพราะ backoff ต้องอ่านค่าล่าสุดใน callback ของ socket
  // ที่ปิดทับ state เก่าไว้ (reducer ยังเป็นแหล่งความจริงของสิ่งที่ UI เห็น)
  const attemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const clearWatchdog = () => {
      if (watchdogRef.current !== null) {
        window.clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
    };

    const stopPolling = () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const fallbackPoll = async () => {
      try {
        const res = await fetch("/api/v1/earthquakes/recent?limit=50");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as EarthquakeRecentResponse;
        if (cancelled) return;
        dispatch({ type: "poll.success", asOf: data.asOf, events: data.events });
      } catch (err) {
        if (cancelled) return;
        dispatch({
          type: "poll.error",
          message: err instanceof Error ? err.message : "ไม่สามารถเชื่อมต่อข้อมูลแผ่นดินไหว",
        });
      }
    };

    /**
     * เริ่ม REST fallback (ยิงทันทีหนึ่งครั้ง แล้วทุก 30 วินาที) — idempotent:
     * onerror กับ onclose ของ handshake ที่ล้มจะเรียกซ้อนกัน ถ้ายิงทันทีทุกครั้ง
     * รอบ backoff ช่วงแรก (1 วิ) จะกลายเป็นการถล่ม /recent หลายนัดต่อวินาที
     */
    const startPolling = () => {
      if (cancelled || pollRef.current !== null) return;
      void fallbackPoll();
      pollRef.current = window.setInterval(() => void fallbackPoll(), REST_FALLBACK_INTERVAL_MS);
    };

    const scheduleReconnect = () => {
      if (cancelled || retryRef.current !== null) return;
      const delay = nextReconnectDelayMs(attemptRef.current);
      retryRef.current = window.setTimeout(() => {
        retryRef.current = null;
        connect();
      }, delay);
    };

    const armWatchdog = (socket: WebSocket) => {
      clearWatchdog();
      watchdogRef.current = window.setTimeout(() => {
        watchdogRef.current = null;
        if (cancelled) return;
        dispatch({ type: "ws.watchdog" });
        // ปิดเองเพื่อให้ onclose เดินเส้นทาง backoff + REST ปกติ
        socket.close();
      }, HEARTBEAT_WATCHDOG_MS);
    };

    const connect = () => {
      if (cancelled) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      let socket: WebSocket;
      try {
        socket = new WebSocket(`${proto}//${location.host}/api/v1/earthquakes/live`);
      } catch {
        startPolling();
        attemptRef.current += 1;
        dispatch({ type: "ws.closed" });
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;
      armWatchdog(socket);

      socket.onmessage = (ev) => {
        if (cancelled) return;
        armWatchdog(socket);
        let msg: EqWsMessage;
        try {
          msg = JSON.parse(ev.data as string) as EqWsMessage;
        } catch {
          // เฟรมพังต้องนับไว้และโชว์บนการ์ด ไม่ใช่ทิ้งเงียบ ๆ
          dispatch({ type: "ws.parse-error" });
          return;
        }
        if (msg.type === "snapshot") {
          // สายกลับมาแล้วจริง: หยุด REST fallback และรีเซ็ต backoff
          attemptRef.current = 0;
          stopPolling();
        }
        dispatch({ type: "ws.message", msg });
      };

      socket.onerror = () => {
        if (!cancelled && socket.readyState !== WebSocket.OPEN) startPolling();
      };

      socket.onclose = () => {
        if (cancelled) return;
        clearWatchdog();
        attemptRef.current += 1;
        dispatch({ type: "ws.closed" });
        // สายหลุด = ต้องมีข้อมูลจาก REST คั่นระหว่างรอ reconnect
        startPolling();
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryRef.current !== null) window.clearTimeout(retryRef.current);
      retryRef.current = null;
      clearWatchdog();
      stopPolling();
      const socket = socketRef.current;
      if (!socket) return;
      // Closing a socket that is still CONNECTING logs a console warning
      // (and happens every mount under React StrictMode), so defer the
      // close until the handshake finishes.
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => socket.close(), { once: true });
      } else {
        socket.close();
      }
    };
  }, []);

  return state;
}
