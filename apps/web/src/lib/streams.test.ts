import { describe, expect, it, vi } from "vitest";
import {
  classifyHlsFatal,
  classifyProbe,
  fetchJpegOnce,
  JPEG_POLL_MAX_MS,
  JPEG_POLL_REFRESH_MS,
  JPEG_POLL_TIMEOUT_MS,
  parseLastModified,
  snapshotFrameUrl,
  startHlsPlayer,
  startJpegPoll,
  type HlsPlayerState,
  type JpegFetchDeps,
  type JpegPollState,
  type SnapshotImage,
} from "./streams";
import { isAllowedUrl } from "./cameraSources";

/** guard ที่ inject เข้าตัวเล่นในเทส — อันเดียวกับที่ CameraBody ใช้ (ทะเบียนของ iTIC) */
const allowHls = (url: string) => isAllowedUrl("itic-cctv", "hls", url);
const allowJpeg = (url: string) => isAllowedUrl("itic-cctv", "jpeg", url);

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
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s), allowHls);
    expect(video.src).toBe(URL_A);
    video.fire("playing");
    expect(states).toEqual([{ status: "loading" }, { status: "live", programDateTime: null }]);
    stop();
  });

  it("waiting after playback → buffering (not live, not a failure), back to live on `playing`", () => {
    const video = fakeVideo();
    const states: HlsPlayerState[] = [];
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s), allowHls);
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
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s), allowHls);
    video.fire("waiting");
    video.fire("stalled");
    expect(states).toEqual([{ status: "loading" }]);
    stop();
  });

  it("stalled counts as buffering only when there is no data for the next frame", () => {
    const video = fakeVideo();
    const states: HlsPlayerState[] = [];
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s), allowHls);
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
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s), allowHls);
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
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s), allowHls);
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
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s), allowHls);
    video.fire("playing");
    stop();
    expect(states.at(-1)?.status).toBe("live");
  });

  it("dispose drops the connection: pause, remove src, load(), no listeners left", () => {
    const video = fakeVideo();
    const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, () => {}, allowHls);
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
    const stopA = startHlsPlayer(a as unknown as HTMLVideoElement, URL_A, (s) => statesA.push(s), allowHls);
    const stopB = startHlsPlayer(b as unknown as HTMLVideoElement, URL_A, () => {}, allowHls);
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
      const stop = startHlsPlayer(video as unknown as HTMLVideoElement, URL_A, (s) => states.push(s), allowHls);
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

  it("refuses a URL the injected guard rejects without touching the network", () => {
    const video = fakeVideo();
    const states: HlsPlayerState[] = [];
    startHlsPlayer(
      video as unknown as HTMLVideoElement,
      "https://camerai1.iticfoundation.org/hls/tempsus.m3u8",
      (s) => states.push(s),
      allowHls,
    )();
    expect(states).toEqual([{ status: "unsupported", detail: "url rejected" }]);
    expect(video.play).not.toHaveBeenCalled();
    // guard ที่ปฏิเสธทุกอย่าง = ไม่มีทางตั้ง src แม้ URL จะดูถูกต้อง
    const v2 = fakeVideo();
    startHlsPlayer(v2 as unknown as HTMLVideoElement, URL_A, () => {}, () => false)();
    expect(v2.src).toBe("");
  });
});

const JPEG = "https://camera1.iticfoundation.org/jpeg2.php?camid=10.8.0.19:8802";

describe("snapshotFrameUrl", () => {
  it("builds a fresh cache-busting URL per attempt, with ? or & as the URL needs", () => {
    const a = snapshotFrameUrl(JPEG, 1, 1_000);
    const b = snapshotFrameUrl(JPEG, 2, 1_000);
    expect(a.startsWith(`${JPEG}&_=`)).toBe(true);
    expect(a).not.toBe(b);
    expect(snapshotFrameUrl("https://example.test/cam.jpg", 1, 1_000).startsWith("https://example.test/cam.jpg?_=")).toBe(true);
  });
});

describe("startJpegPoll lifecycle", () => {
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
    const states: JpegPollState[] = [];
    const stop = startJpegPoll(
      JPEG,
      (s) => states.push(s),
      {
        createImage: () => {
          const img = new FakeImage();
          images.push(img);
          return img;
        },
        show: (img) => shown.push(img),
        now: () => clock,
      },
      allowJpeg,
    );
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
      advance(JPEG_POLL_REFRESH_MS - 1);
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
      advance(JPEG_POLL_TIMEOUT_MS);
      expect(states.at(-1)).toEqual({ status: "unreachable", detail: "timeout", lastFetchedAt: null });
      expect(images[0].src).toBe("");
      expect(images[0].listenerCount()).toBe(0);
      // error ที่ src = "" ยิงตามมาต้องไม่ถูกนับเป็นรอบใหม่
      images[0].fire("error");
      expect(states.filter((s) => s.status === "unreachable")).toHaveLength(1);
      advance(JPEG_POLL_REFRESH_MS);
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
      const ok = states.at(-1) as Extract<JpegPollState, { status: "ok" }>;
      advance(JPEG_POLL_REFRESH_MS);
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
        advance(JPEG_POLL_REFRESH_MS);
        i++;
      }
      expect(states.at(-1)).toMatchObject({ status: "paused", lastFailed: false });
      const n = images.length;
      advance(JPEG_POLL_MAX_MS);
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
      advance(JPEG_POLL_REFRESH_MS);
      const count = states.length;
      stop();
      expect(images[0].src).toBe("");
      expect(images[1].src).toBe("");
      expect(shown.at(-1)).toBeNull();
      images[1].fire("load");
      advance(JPEG_POLL_REFRESH_MS * 3);
      expect(states).toHaveLength(count);
      expect(images).toHaveLength(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a URL outside the probed group (guard) without requesting anything", () => {
    const created: FakeImage[] = [];
    const states: JpegPollState[] = [];
    const stop = startJpegPoll(
      "https://camera1.iticfoundation.org/jpeg2.php?camid=CAMPK0001",
      (s) => states.push(s),
      {
        createImage: () => {
          const img = new FakeImage();
          created.push(img);
          return img;
        },
        show: () => {},
      },
      allowJpeg,
    );
    expect(created).toHaveLength(0);
    expect(states).toEqual([{ status: "unreachable", detail: "url rejected", lastFetchedAt: null }]);
    stop();
  });
});

describe("parseLastModified", () => {
  it("HTTP-date → ISO, anything else → null (never filled from the clock)", () => {
    expect(parseLastModified("Fri, 26 Sep 2026 07:17:00 GMT")).toBe("2026-09-26T07:17:00.000Z");
    expect(parseLastModified(null)).toBeNull();
    expect(parseLastModified("")).toBeNull();
    expect(parseLastModified("not a date")).toBeNull();
  });
});

describe("fetchJpegOnce (jpeg-fetch)", () => {
  const FETCH_URL = "https://camera1.iticfoundation.org/jpeg2.php?camid=10.8.0.19:8802";
  const NOW = Date.parse("2026-09-26T00:30:00Z");
  function deps(responses: (Response | Error)[]): JpegFetchDeps & { calls: string[] } {
    const calls: string[] = [];
    let i = 0;
    return {
      calls,
      fetch: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        const r = responses[i++];
        if (r instanceof Error) throw r;
        return r;
      }) as typeof fetch,
      createObjectURL: () => "blob:fake-1",
      now: () => NOW,
    };
  }
  const jpeg = (headers: Record<string, string> = {}) =>
    new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), { status: 200, headers });
  const signal = () => new AbortController().signal;
  const allowAll = () => true;

  it("ok: blob URL + observedAt from Last-Modified only, fetchedAt from the injected clock", async () => {
    const d = deps([jpeg({ "last-modified": "Fri, 26 Sep 2026 00:17:00 GMT" })]);
    expect(await fetchJpegOnce(FETCH_URL, signal(), allowAll, d)).toEqual({
      kind: "ok",
      blobUrl: "blob:fake-1",
      observedAt: "2026-09-26T00:17:00.000Z",
      fetchedAt: "2026-09-26T00:30:00.000Z",
    });
    expect(d.calls[0].startsWith(`${FETCH_URL}&_=`)).toBe(true);
  });

  it("no Last-Modified → observedAt null (not fetchedAt)", async () => {
    const r = await fetchJpegOnce(FETCH_URL, signal(), allowAll, deps([jpeg()]));
    expect(r.kind === "ok" ? r.observedAt : "x").toBeNull();
  });

  it("404 / empty / non-image → no-image; network / 5xx → unreachable; guard reject → unreachable without a request", async () => {
    expect(await fetchJpegOnce(FETCH_URL, signal(), allowAll, deps([new Response(null, { status: 404 })]))).toEqual({ kind: "no-image" });
    expect(await fetchJpegOnce(FETCH_URL, signal(), allowAll, deps([new Response(new Blob([]), { status: 200 })]))).toEqual({ kind: "no-image" });
    expect(
      await fetchJpegOnce(FETCH_URL, signal(), allowAll, deps([new Response("nope", { status: 200, headers: { "content-type": "text/plain" } })])),
    ).toEqual({ kind: "no-image" });
    expect((await fetchJpegOnce(FETCH_URL, signal(), allowAll, deps([new TypeError("Failed to fetch")]))).kind).toBe("unreachable");
    expect((await fetchJpegOnce(FETCH_URL, signal(), allowAll, deps([new Response("", { status: 503 })]))).kind).toBe("unreachable");
    const d = deps([jpeg()]);
    expect(await fetchJpegOnce(FETCH_URL, signal(), () => false, d)).toEqual({ kind: "unreachable", detail: "url rejected" });
    expect(d.calls).toEqual([]);
  });

  it("an aborted request rethrows instead of reporting the source as unreachable", async () => {
    const c = new AbortController();
    c.abort();
    await expect(fetchJpegOnce(FETCH_URL, c.signal, allowAll, deps([new DOMException("Aborted", "AbortError")]))).rejects.toThrow();
  });
});
