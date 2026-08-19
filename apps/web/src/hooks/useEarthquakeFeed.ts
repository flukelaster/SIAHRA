import { useEffect, useReducer, useRef } from "react";
import { WS_HEARTBEAT_LEGACY_WATCHDOG_MS, WS_HEARTBEAT_WATCHDOG_MS } from "@siahra/shared-types";
import type { EarthquakeRecentResponse, EqWsMessage } from "@siahra/shared-types";
import { errorMessage } from "../lib/errorMessage";
import { nextReconnectDelayMs } from "../lib/feed/backoff";
import { feedReducer, initialFeedState } from "../lib/feed/reducer";
import type { EarthquakeFeedState, FeedStatus } from "../lib/feed/reducer";

export type { EarthquakeFeedState, FeedStatus };

/**
 * E2.1 เดาคาบ heartbeat จากคาบ poll ของ DO (60 วิ) แล้วคูณ 2.5 เอง = 150 วิ
 * E6.1 ย้ายคาบไปประกาศไว้ที่เดียวในสัญญากลาง (`WS_HEARTBEAT_INTERVAL_MS` = 30 วิ
 * เมื่อมีไคลเอนต์ต่ออยู่) และคำนวณ watchdog จากค่านั้น → **75 วิ** ค่านี้จึงขยับ
 * ตามเซิร์ฟเวอร์เองโดยอัตโนมัติ ไม่ใช่ค่าคงที่สองตัวที่ต้องคอยจำให้แก้พร้อมกัน
 *
 * ที่ต้องรัดให้สั้นลง เพราะ 150 วิ แปลว่าสายที่ตายเงียบ (proxy ตัดกลางทางโดยไม่มี
 * close event) ค้างอยู่บนหน้าจอได้สองนาทีครึ่งก่อนจะยอมรับว่าหลุด
 */
export const HEARTBEAT_WATCHDOG_MS = WS_HEARTBEAT_WATCHDOG_MS; // 75 s

/**
 * ...แต่จะรัดเหลือ 75 วิ ได้ก็ต่อเมื่อ **เซิร์ฟเวอร์ที่ปลายสายนี้** เป็นรุ่น E6.1 จริง
 * สอง Worker ขึ้นแยกกัน เว็บจึงอาจไปเจอ api รุ่นก่อนหน้าที่ยิง heartbeat นาทีละครั้ง
 * ทุกสายจึงเริ่มที่ค่าเดิม (150 วิ) แล้วรัดลงเมื่อเห็น heartbeat ที่มี `serverTime`
 * ติดมาด้วย ซึ่งเป็นฟิลด์ที่มีเฉพาะรุ่นใหม่ — และรีเซ็ตกลับทุกครั้งที่ต่อสายใหม่
 * เผื่อกรณี rollback ฝั่ง api
 */
export const HEARTBEAT_WATCHDOG_LEGACY_MS = WS_HEARTBEAT_LEGACY_WATCHDOG_MS; // 150 s

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
  // watchdog ปัจจุบันของสายที่ต่ออยู่ (ดูหมายเหตุที่ HEARTBEAT_WATCHDOG_LEGACY_MS)
  const watchdogMsRef = useRef(HEARTBEAT_WATCHDOG_LEGACY_MS);

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
          message: errorMessage(err, "error.earthquakeFeed"),
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
      }, watchdogMsRef.current);
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
      // สายใหม่ = ยังไม่รู้ว่าปลายทางเป็นรุ่นไหน เริ่มที่ค่าหลวมเสมอ
      watchdogMsRef.current = HEARTBEAT_WATCHDOG_LEGACY_MS;
      armWatchdog(socket);

      socket.onmessage = (ev) => {
        if (cancelled) return;
        armWatchdog(socket);
        let msg: EqWsMessage;
        // `pong` เป็นคำตอบของ ping ที่เซิร์ฟเวอร์ตอบอัตโนมัติ (E6.1) ไม่ใช่ JSON —
        // ถ้าปล่อยให้ตกไป JSON.parse การตรวจสายด้วย ping จะโผล่บนการ์ดเป็น
        // "ข้อความจากฟีดอ่านไม่ได้" ทั้งที่ระบบทำงานถูกต้องทุกอย่าง
        if (ev.data === "pong") return;
        try {
          msg = JSON.parse(ev.data as string) as EqWsMessage;
        } catch {
          // เฟรมพังต้องนับไว้และโชว์บนการ์ด ไม่ใช่ทิ้งเงียบ ๆ
          dispatch({ type: "ws.parse-error" });
          return;
        }
        if (msg.type === "heartbeat" && msg.serverTime !== undefined && watchdogMsRef.current !== HEARTBEAT_WATCHDOG_MS) {
          // ปลายสายเป็นรุ่น E6.1 (เต้นทุก 30 วิ) — รัด watchdog แล้วตั้งใหม่ทันที
          watchdogMsRef.current = HEARTBEAT_WATCHDOG_MS;
          armWatchdog(socket);
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
