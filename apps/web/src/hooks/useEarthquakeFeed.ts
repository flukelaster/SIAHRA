import { useEffect, useRef, useState } from "react";
import type { EarthquakeEvent, EarthquakeRecentResponse, EqWsMessage } from "@siahra/shared-types";

export type FeedStatus = "connecting" | "live" | "polling" | "error";

export interface EarthquakeFeedState {
  events: EarthquakeEvent[];
  status: FeedStatus;
  /** Timestamp of the last successful update from the backend. */
  asOf: string | null;
  error: string | null;
}

const RECONNECT_DELAY_MS = 5000;

function sortByTimeDesc(events: EarthquakeEvent[]): EarthquakeEvent[] {
  return [...events].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

function upsert(events: EarthquakeEvent[], incoming: EarthquakeEvent): EarthquakeEvent[] {
  const idx = events.findIndex((e) => e.id === incoming.id);
  if (idx === -1) return sortByTimeDesc([incoming, ...events]);
  // Last-write-wins on the upstream `updated` stamp, mirroring the
  // server-side dedupe rule so a stale re-delivery can't clobber a revision.
  if (Date.parse(incoming.updated) < Date.parse(events[idx].updated)) return events;
  const next = [...events];
  next[idx] = incoming;
  return sortByTimeDesc(next);
}

/**
 * Live earthquake events from the Worker's Durable Object feed.
 * The socket always delivers a `snapshot` before any `event.*`, so initial
 * state needs no separate REST race — the REST call is only a fallback for
 * when the WebSocket cannot connect.
 */
export function useEarthquakeFeed(): EarthquakeFeedState {
  const [state, setState] = useState<EarthquakeFeedState>({
    events: [],
    status: "connecting",
    asOf: null,
    error: null,
  });
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fallbackPoll = async () => {
      try {
        const res = await fetch("/api/v1/earthquakes/recent?limit=50");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as EarthquakeRecentResponse;
        if (cancelled) return;
        setState({
          events: sortByTimeDesc(data.events),
          status: "polling",
          asOf: data.asOf,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : "ไม่สามารถเชื่อมต่อข้อมูลแผ่นดินไหว",
        }));
      }
    };

    const connect = () => {
      if (cancelled) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      let socket: WebSocket;
      try {
        socket = new WebSocket(`${proto}//${location.host}/api/v1/earthquakes/live`);
      } catch {
        void fallbackPoll();
        return;
      }
      socketRef.current = socket;

      socket.onmessage = (ev) => {
        if (cancelled) return;
        let msg: EqWsMessage;
        try {
          msg = JSON.parse(ev.data as string) as EqWsMessage;
        } catch {
          return;
        }
        setState((s) => {
          switch (msg.type) {
            case "snapshot":
              return {
                events: sortByTimeDesc(msg.events),
                status: "live",
                asOf: msg.asOf,
                error: null,
              };
            case "event.created":
            case "event.updated":
              return {
                ...s,
                status: "live",
                events: upsert(s.events, msg.event),
                asOf: new Date().toISOString(),
              };
            case "event.deleted":
              return { ...s, events: s.events.filter((e) => e.id !== msg.id) };
            case "heartbeat":
              return { ...s, status: "live", asOf: msg.ts };
            default:
              return s;
          }
        });
      };

      socket.onerror = () => {
        if (!cancelled && socket.readyState !== WebSocket.OPEN) void fallbackPoll();
      };

      socket.onclose = () => {
        if (cancelled) return;
        retryRef.current = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryRef.current) window.clearTimeout(retryRef.current);
      const socket = socketRef.current;
      if (!socket) return;
      // Closing a socket that is still CONNECTING logs a console warning
      // (and happens every mount under React StrictMode), so defer the
      // close until the handshake finishes.
      socket.onclose = null;
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => socket.close(), { once: true });
      } else {
        socket.close();
      }
    };
  }, []);

  return state;
}
