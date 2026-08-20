import { afterEach, describe, expect, it, vi } from "vitest";
import { readInitialLang, rememberLang } from "./initialLang";

/**
 * `window.sessionStorage`/`window.localStorage` เป็น getter ตาม spec — เบราว์เซอร์
 * บางนโยบาย (โหมดส่วนตัว/sandbox) โยน throw ตั้งแต่ตอน**อ่าน property** ไม่ใช่แค่
 * ตอนเรียก `.getItem()`/`.setItem()` เทสนี้จำลองด้วย getter ที่ throw ตรง ๆ เพื่อยืนยัน
 * ว่าทั้ง `readInitialLang()` และ `rememberLang()` ไม่พังทั้งฟังก์ชันเมื่อเจอกรณีนี้
 * (ไม่มี jsdom ในชุดเทสนี้ — จำลอง `window` เองด้วย `vi.stubGlobal`)
 */
function stubThrowingWindow(search = ""): void {
  vi.stubGlobal("window", {
    location: { search },
    get sessionStorage(): Storage {
      throw new DOMException("storage ถูกปิดโดยนโยบาย", "SecurityError");
    },
    get localStorage(): Storage {
      throw new DOMException("storage ถูกปิดโดยนโยบาย", "SecurityError");
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("initialLang — storage getter ที่ throw ต้องไม่ทำให้ทั้งฟังก์ชันพัง", () => {
  it("readInitialLang() ตกไปที่ภาษาไทยเริ่มต้นแม้ getter ของ storage เอง throw", () => {
    stubThrowingWindow();
    expect(readInitialLang()).toBe("th");
  });

  it("rememberLang('choice') ไม่ throw แม้ getter ของทั้ง sessionStorage และ localStorage throw", () => {
    stubThrowingWindow();
    expect(() => rememberLang("en", "choice")).not.toThrow();
  });

  it("rememberLang('link') ไม่ throw แม้ getter ของ sessionStorage throw", () => {
    stubThrowingWindow();
    expect(() => rememberLang("en", "link")).not.toThrow();
  });
});
