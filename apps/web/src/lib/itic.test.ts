import { describe, expect, it, vi } from "vitest";
import {
  classifyHlsFatal,
  classifyProbe,
  isPlayableHlsUrl,
  isSnapshotJpegUrl,
  ITIC_SNAPSHOT_MAX_MS,
  ITIC_SNAPSHOT_REFRESH_MS,
  ITIC_SNAPSHOT_TIMEOUT_MS,
  snapshotFrameUrl,
  startHlsPlayer,
  startItiCSnapshots,
  type HlsPlayerState,
  type ItiCSnapshotState,
  type SnapshotImage,
} from "./itic";

describe("isPlayableHlsUrl", () => {
  it("accepts only camerai1 playlists that are not the suspended placeholder", () => {
    expect(
      isPlayableHlsUrl("https://camerai1.iticfoundation.org/pass/180.180.242.207:1935/Phase8/PER_8_012.stream/playlist.m3u8"),
    ).toBe(true);
    expect(isPlayableHlsUrl("https://camerai1.iticfoundation.org/hls/kk08.m3u8")).toBe(true);
    expect(isPlayableHlsUrl("https://camerai1.iticfoundation.org/hls/tempsus.m3u8")).toBe(false);
    expect(isPlayableHlsUrl("https://camera1.iticfoundation.org/hls/kk08.m3u8")).toBe(false);
    expect(isPlayableHlsUrl("https://camerai1.iticfoundation.org.evil.test/x.m3u8")).toBe(false);
    expect(isPlayableHlsUrl("http://camerai1.iticfoundation.org/hls/kk08.m3u8")).toBe(false);
  });
});

describe("classifyHlsFatal", () => {
  it("a playlist the server refuses (4xx) or a malformed one is `suspended`", () => {
    expect(classifyHlsFatal({ type: "networkError", details: "manifestLoadError", responseCode: 404 })).toEqual({
      status: "suspended",
      detail: "HTTP 404",
    });
    expect(classifyHlsFatal({ type: "networkError", details: "levelLoadError", responseCode: 403 }).status).toBe("suspended");
    expect(classifyHlsFatal({ type: "networkError", details: "manifestParsingError" }).status).toBe("suspended");
    expect(classifyHlsFatal({ type: "networkError", details: "levelEmptyError" }).status).toBe("suspended");
  });

  it("no answer at all, a timeout or a 5xx is `unreachable` — never `suspended`", () => {
    expect(classifyHlsFatal({ type: "networkError", details: "manifestLoadError", responseCode: 0 })).toEqual({
      status: "unreachable",
      detail: "manifestLoadError",
    });
    expect(classifyHlsFatal({ type: "networkError", details: "manifestLoadTimeOut" }).status).toBe("unreachable");
    expect(classifyHlsFatal({ type: "networkError", details: "fragLoadError", responseCode: 502 })).toEqual({
      status: "unreachable",
      detail: "HTTP 502",
    });
  });

  it("a codec the browser cannot decode is `unsupported`", () => {
    expect(classifyHlsFatal({ type: "mediaError", details: "bufferAddCodecError" }).status).toBe("unsupported");
    expect(classifyHlsFatal({ type: "mediaError", details: "manifestIncompatibleCodecsError" }).status).toBe("unsupported");
    expect(classifyHlsFatal({ type: "otherError", details: "internalException" }).status).toBe("unsupported");
  });
});

describe("classifyProbe (native HLS fallback)", () => {
  it("separates 4xx, 5xx, network and a playlist that answered fine", () => {
    expect(classifyProbe({ status: 404 }).status).toBe("suspended");
    expect(classifyProbe({ status: 503 }).status).toBe("unreachable");
    expect(classifyProbe("network-error").status).toBe("unreachable");
    expect(classifyProbe({ status: 200 }).status).toBe("unsupported");
  });
});

/** `<video>` จำลองที่เล่น HLS เองได้ (เส้นทาง native) — พอให้ทดสอบวงจรชีวิตโดยไม่มี DOM */
function fakeVideo() {
  const listeners = new Map<string, Set<EventListener>>();
  const v = {
    src: "",
    currentTime: 0,
    readyState: 0,
    /** ช่วงที่ seek ได้ของสตรีมสด — ปลายสุด = ขอบสด */
    seekableEnd: null as number | null,
    get seekable() {
      const end = v.seekableEnd;
      return {
        length: end === null ? 0 : 1,
        start: () => 0,
        end: () => {
          if (end === null) throw new RangeError("empty");
          return end;
        },
      };
    },
    canPlayType: vi.fn(() => "maybe"),
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn((name: string) => {
      if (name === "src") v.src = "";
    }),
    addEventListener: vi.fn((type: string, fn: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: EventListener) => listeners.get(type)?.delete(fn)),
    fire: (type: string) => listeners.get(type)?.forEach((fn) => fn(new Event(type))),
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
  return v;
}

const URL_A = "https://camerai1.iticfoundation.org/hls/kk08.m3u8";

describe("startHlsPlayer lifecycle", () => {
  it("goes loading → live on `playing`, and says there is no stream time when the stream has none", () => {
    const video = fakeVideo();
    const states: HlsPlayerState[] = [];
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s));
    expect(video.src).toBe(URL_A);
    video.fire("playing");
    expect(states).toEqual([{ status: "loading" }, { status: "live", programDateTime: null }]);
    stop();
  });

  it("waiting after playback → buffering (not live, not a failure), back to live on `playing`", () => {
    const video = fakeVideo();
    const states: HlsPlayerState[] = [];
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s));
    video.fire("playing");
    video.fire("waiting");
    expect(states.at(-1)).toEqual({ status: "buffering", programDateTime: null });
    video.fire("playing");
    expect(states.at(-1)).toEqual({ status: "live", programDateTime: null });
    stop();
  });

  it("waiting before the first frame stays `loading`", () => {
    const video = fakeVideo();
    const states: HlsPlayerState[] = [];
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s));
    video.fire("waiting");
    video.fire("stalled");
    expect(states).toEqual([{ status: "loading" }]);
    stop();
  });

  it("stalled counts as buffering only when there is no data for the next frame", () => {
    const video = fakeVideo();
    const states: HlsPlayerState[] = [];
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s));
    video.fire("playing");
    video.readyState = 4; // HAVE_ENOUGH_DATA — ยังเล่นจากบัฟเฟอร์ได้
    video.fire("stalled");
    expect(states.at(-1)?.status).toBe("live");
    video.readyState = 2; // HAVE_CURRENT_DATA — ไม่มีเฟรมถัดไป
    video.fire("stalled");
    expect(states.at(-1)?.status).toBe("buffering");
    // timeupdate ระหว่างบัฟเฟอร์ไม่ดันกลับเป็น live
    video.currentTime = 5;
    video.fire("timeupdate");
    expect(states.at(-1)?.status).toBe("buffering");
    stop();
  });

  it("pause after playback → paused (never live), play jumps to the live edge, `playing` is the only way back to live", () => {
    const video = fakeVideo();
    const states: HlsPlayerState[] = [];
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s));
    video.fire("playing");
    video.currentTime = 10;
    video.fire("pause");
    expect(states.at(-1)).toEqual({ status: "paused", programDateTime: null });
    // บัฟเฟอร์/เวลาเดินระหว่างหยุดไม่เปลี่ยนสถานะ
    video.fire("waiting");
    video.readyState = 1;
    video.fire("stalled");
    video.currentTime = 11;
    video.fire("timeupdate");
    expect(states.at(-1)?.status).toBe("paused");
    // กดเล่น: กระโดดไปขอบสดก่อน แต่ยังไม่ติดป้าย live จนกว่า `playing`
    video.seekableEnd = 42;
    const before = states.length;
    video.fire("play");
    expect(video.currentTime).toBe(42);
    expect(states.length).toBe(before);
    video.fire("waiting");
    expect(states.at(-1)?.status).toBe("paused");
    video.fire("playing");
    expect(states.at(-1)).toEqual({ status: "live", programDateTime: null });
    stop();
  });

  it("pause before the first frame stays `loading`; play without a seekable range does not seek", () => {
    const video = fakeVideo();
    const states: HlsPlayerState[] = [];
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s));
    video.fire("pause");
    expect(states).toEqual([{ status: "loading" }]);
    video.fire("playing");
    video.currentTime = 7;
    video.fire("pause");
    video.fire("play");
    expect(video.currentTime).toBe(7);
    stop();
  });

  it("dispose's own pause is not reported", () => {
    const video = fakeVideo();
    const states: HlsPlayerState[] = [];
    video.pause.mockImplementation(() => video.fire("pause"));
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s));
    video.fire("playing");
    stop();
    expect(states.at(-1)?.status).toBe("live");
  });

  it("dispose drops the connection: pause, remove src, load(), no listeners left", () => {
    const video = fakeVideo();
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, () => {});
    stop();
    expect(video.pause).toHaveBeenCalled();
    expect(video.removeAttribute).toHaveBeenCalledWith("src");
    expect(video.load).toHaveBeenCalled();
    expect(video.src).toBe("");
    expect(video.listenerCount()).toBe(0);
    // เรียกซ้ำได้ ไม่พัง
    stop();
    expect(video.load).toHaveBeenCalledTimes(1);
  });

  it("allows exactly one player: starting a second one tears the first down", () => {
    const a = fakeVideo();
    const b = fakeVideo();
    const statesA: HlsPlayerState[] = [];
    const stopA = startHlsPlayer(a as unknown as HTMLVideoElement, URL_A, (s) => statesA.push(s));
    const stopB = startHlsPlayer(b as unknown as HTMLVideoElement, URL_A, () => {});
    expect(a.load).toHaveBeenCalledTimes(1);
    expect(a.src).toBe("");
    expect(b.src).toBe(URL_A);
    // ตัวที่ถูกทิ้งแล้วไม่ส่งสถานะอีก
    a.fire("playing");
    expect(statesA).toEqual([{ status: "loading" }]);
    stopA();
    expect(b.load).not.toHaveBeenCalled();
    stopB();
  });

  it("native playback error: one playlist probe separates suspended / unreachable / unsupported", async () => {
    const run = async (probe: () => Promise<Response>) => {
      vi.stubGlobal("fetch", vi.fn(probe));
      const video = fakeVideo();
      const states: HlsPlayerState[] = [];
      const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s));
      video.fire("error");
      await new Promise((r) => setTimeout(r, 0));
      stop();
      vi.unstubAllGlobals();
      return states.at(-1);
    };
    expect(await run(() => Promise.resolve(new Response("", { status: 404 })))).toEqual({
      status: "suspended",
      detail: "HTTP 404",
    });
    expect((await run(() => Promise.reject(new TypeError("Failed to fetch"))))?.status).toBe("unreachable");
    // node ไม่มี MediaSource → ไม่มี hls.js ให้ลองต่อ จึงบอกว่าเล่นไม่ได้
    expect((await run(() => Promise.resolve(new Response("#EXTM3U", { status: 200 }))))?.status).toBe("unsupported");
  });

  it("refuses a URL outside the allowlist without touching the network", () => {
    const video = fakeVideo();
    const states: HlsPlayerState[] = [];
    startHlsPlayer(video as unknown as HTMLVideoElement, "https://camerai1.iticfoundation.org/hls/tempsus.m3u8", (s) =>
      states.push(s),
    )();
    expect(states).toEqual([{ status: "unsupported", detail: "url rejected" }]);
    expect(video.play).not.toHaveBeenCalled();
  });
});

const JPEG = "https://camera1.iticfoundation.org/jpeg2.php?camid=10.8.0.19:8802";

describe("isSnapshotJpegUrl", () => {
  it("accepts only the probed jpeg2.php camid 10.8.0.x:port group", () => {
    expect(isSnapshotJpegUrl(JPEG)).toBe(true);
    expect(isSnapshotJpegUrl("https://camera1.iticfoundation.org/jpeg2.php?camid=X.X.X.X:YYYY")).toBe(false);
    expect(isSnapshotJpegUrl("https://camera1.iticfoundation.org/jpeg2.php?camid=CAMPK0001")).toBe(false);
    expect(isSnapshotJpegUrl("https://camera1.iticfoundation.org/jpeg2.php?camid=61.91.182.114:1111")).toBe(false);
    expect(isSnapshotJpegUrl("https://user:pw@camera1.iticfoundation.org/jpeg2.php?camid=10.8.0.1:80")).toBe(false);
    expect(isSnapshotJpegUrl("http://camera1.iticfoundation.org/jpeg2.php?camid=10.8.0.1:80")).toBe(false);
    expect(isSnapshotJpegUrl("https://camera1.iticfoundation.org.evil.test/jpeg2.php?camid=10.8.0.1:80")).toBe(false);
    expect(isSnapshotJpegUrl(`${JPEG}&x=1`)).toBe(false);
  });

  it("builds a fresh cache-busting URL per attempt", () => {
    const a = snapshotFrameUrl(JPEG, 1, 1_000);
    const b = snapshotFrameUrl(JPEG, 2, 1_000);
    expect(a.startsWith(`${JPEG}&_=`)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("startItiCSnapshots lifecycle", () => {
  class FakeImage implements SnapshotImage {
    src = "";
    private listeners = new Map<string, Set<() => void>>();
    addEventListener(type: "load" | "error", fn: () => void) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(fn);
    }
    removeEventListener(type: "load" | "error", fn: () => void) {
      this.listeners.get(type)?.delete(fn);
    }
    fire(type: "load" | "error") {
      for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
    }
    listenerCount() {
      return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
    }
  }

  function setup() {
    let clock = Date.parse("2026-09-26T05:00:00Z");
    const images: FakeImage[] = [];
    const shown: (FakeImage | null)[] = [];
    const states: ItiCSnapshotState[] = [];
    const stop = startItiCSnapshots(JPEG, (s) => states.push(s), {
      createImage: () => {
        const img = new FakeImage();
        images.push(img);
        return img;
      },
      show: (img) => shown.push(img),
      now: () => clock,
    });
    const advance = (ms: number) => {
      clock += ms;
      vi.advanceTimersByTime(ms);
    };
    return { images, shown, states, stop, advance };
  }

  it("loading → ok with the fetch time, then a new cache-busted request only after the refresh interval", () => {
    vi.useFakeTimers();
    try {
      const { images, shown, states, stop, advance } = setup();
      expect(states).toEqual([{ status: "loading" }]);
      expect(images).toHaveLength(1);
      expect(images[0].src.startsWith(`${JPEG}&_=`)).toBe(true);
      advance(1_200);
      images[0].fire("load");
      expect(shown).toEqual([images[0]]);
      expect(states.at(-1)).toEqual({ status: "ok", fetchedAt: "2026-09-26T05:00:01.200Z" });
      advance(ITIC_SNAPSHOT_REFRESH_MS - 1);
      expect(images).toHaveLength(1);
      advance(1);
      expect(images).toHaveLength(2);
      expect(images[1].src).not.toBe(images[0].src);
      images[1].fire("load");
      // เฟรมเดิมถูกแทน และปล่อยทิ้งด้วย src = ""
      expect(shown.at(-1)).toBe(images[1]);
      expect(images[0].src).toBe("");
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a hung request becomes `unreachable` (timeout) instead of loading forever, and keeps retrying", () => {
    vi.useFakeTimers();
    try {
      const { images, states, stop, advance } = setup();
      advance(ITIC_SNAPSHOT_TIMEOUT_MS);
      expect(states.at(-1)).toEqual({ status: "unreachable", detail: "timeout", lastFetchedAt: null });
      expect(images[0].src).toBe("");
      expect(images[0].listenerCount()).toBe(0);
      // error ที่ src = "" ยิงตามมาต้องไม่ถูกนับเป็นรอบใหม่
      images[0].fire("error");
      expect(states.filter((s) => s.status === "unreachable")).toHaveLength(1);
      advance(ITIC_SNAPSHOT_REFRESH_MS);
      expect(images).toHaveLength(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an image error (network, or a non-image body such as a 39-byte 'not found') is `unreachable` and keeps the last good fetch time", () => {
    vi.useFakeTimers();
    try {
      const { images, states, stop, advance } = setup();
      images[0].fire("load");
      const ok = states.at(-1) as Extract<ItiCSnapshotState, { status: "ok" }>;
      advance(ITIC_SNAPSHOT_REFRESH_MS);
      images[1].fire("error");
      expect(states.at(-1)).toEqual({ status: "unreachable", detail: "error", lastFetchedAt: ok.fetchedAt });
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("pauses by itself after the maximum viewing time", () => {
    vi.useFakeTimers();
    try {
      const { images, states, stop, advance } = setup();
      let i = 0;
      while (states.at(-1)?.status !== "paused" && i < 200) {
        images[i].fire("load");
        advance(ITIC_SNAPSHOT_REFRESH_MS);
        i++;
      }
      expect(states.at(-1)).toMatchObject({ status: "paused", lastFailed: false });
      const n = images.length;
      advance(ITIC_SNAPSHOT_MAX_MS);
      expect(images).toHaveLength(n);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop() drops the pending request and the shown frame (src = '') and emits nothing more", () => {
    vi.useFakeTimers();
    try {
      const { images, shown, states, stop, advance } = setup();
      images[0].fire("load");
      advance(ITIC_SNAPSHOT_REFRESH_MS);
      const count = states.length;
      stop();
      expect(images[0].src).toBe("");
      expect(images[1].src).toBe("");
      expect(shown.at(-1)).toBeNull();
      images[1].fire("load");
      advance(ITIC_SNAPSHOT_REFRESH_MS * 3);
      expect(states).toHaveLength(count);
      expect(images).toHaveLength(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a URL outside the probed group without requesting anything", () => {
    const created: FakeImage[] = [];
    const states: ItiCSnapshotState[] = [];
    const stop = startItiCSnapshots("https://camera1.iticfoundation.org/jpeg2.php?camid=CAMPK0001", (s) => states.push(s), {
      createImage: () => {
        const img = new FakeImage();
        created.push(img);
        return img;
      },
      show: () => {},
    });
    expect(created).toHaveLength(0);
    expect(states).toEqual([{ status: "unreachable", detail: "url rejected", lastFetchedAt: null }]);
    stop();
  });
});
