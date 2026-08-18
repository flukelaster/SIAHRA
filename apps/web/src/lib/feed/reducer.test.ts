import { describe, expect, it } from "vitest";
import type { EarthquakeEvent } from "@siahra/shared-types";
import { feedReducer, initialFeedState, type EarthquakeFeedState } from "./reducer";

function ev(id: string, time: string, updated = time): EarthquakeEvent {
  return {
    id,
    clusterId: id,
    sources: ["usgs"],
    mag: 4.2,
    magType: "mb",
    place: "test",
    lat: 18,
    lon: 99,
    depthKm: 10,
    time,
    updated,
    status: "reviewed",
    tsunami: false,
    url: null,
  };
}

const live: EarthquakeFeedState = feedReducer(initialFeedState, {
  type: "ws.message",
  msg: { type: "snapshot", asOf: "2026-08-18T10:00:00.000Z", events: [ev("a", "2026-08-18T09:00:00.000Z")] },
});

describe("feedReducer — asOf only ever comes from the wire", () => {
  it("takes asOf from the snapshot and resets the reconnect counter", () => {
    expect(live.status).toBe("live");
    expect(live.asOf).toBe("2026-08-18T10:00:00.000Z");
    expect(live.reconnectAttempt).toBe(0);
  });

  it("does NOT touch asOf on event.created — that would pass the client clock off as data time", () => {
    const next = feedReducer(live, {
      type: "ws.message",
      msg: { type: "event.created", event: ev("b", "2026-08-18T09:30:00.000Z") },
    });
    expect(next.asOf).toBe(live.asOf);
    expect(next.events.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("keeps the stale asOf while reconnecting, never a fresher one", () => {
    const dropped = feedReducer(live, { type: "ws.closed" });
    expect(dropped.status).toBe("reconnecting");
    expect(dropped.asOf).toBe(live.asOf);
    expect(dropped.reconnectAttempt).toBe(1);
  });

  it("moves asOf forward only on a heartbeat", () => {
    const beat = feedReducer(live, {
      type: "ws.message",
      msg: { type: "heartbeat", ts: "2026-08-18T10:01:00.000Z" },
    });
    expect(beat.asOf).toBe("2026-08-18T10:01:00.000Z");
  });
});

describe("feedReducer — degraded paths", () => {
  it("counts malformed frames instead of dropping them silently", () => {
    const a = feedReducer(live, { type: "ws.parse-error" });
    const b = feedReducer(a, { type: "ws.parse-error" });
    expect(b.parseErrors).toBe(2);
    // ยังคงสถานะและข้อมูลเดิม — เฟรมพังไม่ได้แปลว่าสายตาย
    expect(b.status).toBe("live");
  });

  it("the watchdog marks the feed reconnecting without inventing an attempt", () => {
    const w = feedReducer(live, { type: "ws.watchdog" });
    expect(w.status).toBe("reconnecting");
    expect(w.reconnectAttempt).toBe(0);
    // การ close ที่ตามมาต่างหากที่นับ attempt (กันการนับซ้ำสองเด้ง)
    expect(feedReducer(w, { type: "ws.closed" }).reconnectAttempt).toBe(1);
  });

  it("a REST poll while the socket is down yields 'polling' with the REST asOf", () => {
    const dropped = feedReducer(live, { type: "ws.closed" });
    const polled = feedReducer(dropped, {
      type: "poll.success",
      asOf: "2026-08-18T10:05:00.000Z",
      events: [ev("c", "2026-08-18T10:00:00.000Z")],
    });
    expect(polled.status).toBe("polling");
    expect(polled.asOf).toBe("2026-08-18T10:05:00.000Z");
    // ยังไม่รีเซ็ต backoff: มีแต่ snapshot ของ WS เท่านั้นที่พิสูจน์ว่าสายกลับมาแล้ว
    expect(polled.reconnectAttempt).toBe(1);
  });

  it("a failed poll keeps the last known events and asOf visible", () => {
    const failed = feedReducer(live, { type: "poll.error", message: "HTTP 503" });
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("HTTP 503");
    expect(failed.events).toHaveLength(1);
    expect(failed.asOf).toBe(live.asOf);
  });

  it("upsert ignores a stale re-delivery of the same event", () => {
    const withNew = feedReducer(live, {
      type: "ws.message",
      msg: { type: "event.updated", event: ev("a", "2026-08-18T09:00:00.000Z", "2026-08-18T11:00:00.000Z") },
    });
    const stale = feedReducer(withNew, {
      type: "ws.message",
      msg: { type: "event.updated", event: ev("a", "2026-08-18T09:00:00.000Z", "2026-08-18T08:00:00.000Z") },
    });
    expect(stale.events[0].updated).toBe("2026-08-18T11:00:00.000Z");
  });

  it("event.deleted removes the event", () => {
    const gone = feedReducer(live, { type: "ws.message", msg: { type: "event.deleted", id: "a" } });
    expect(gone.events).toHaveLength(0);
  });
});
