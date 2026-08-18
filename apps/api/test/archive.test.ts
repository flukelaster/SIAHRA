import { describe, expect, it } from "vitest";
import { addDays, bangkokDay, bangkokHour, dayStartMs, keys, BKK_OFFSET_MS } from "../src/archive";

/**
 * วันในคลังเก็บถาวรคือ "วันแบบกรุงเทพ" (+07:00) ไม่ใช่วัน UTC — เส้นแบ่งวัน
 * จึงอยู่ที่ 17:00Z ของวันก่อนหน้า ถ้าพลาดตรงนี้ ไฟล์ของเช้าวันใหม่จะไปตกอยู่
 * ในคีย์ของเมื่อวาน แล้วดัชนีรายวันก็ผิดตามไปทั้งชุด
 */
const at = (iso: string) => Date.parse(iso);

describe("bangkokDay / bangkokHour", () => {
  it("uses the +07:00 offset", () => {
    expect(BKK_OFFSET_MS).toBe(7 * 3600000);
  });

  it("rolls the day over at 17:00 UTC, not at midnight UTC", () => {
    expect(bangkokDay(at("2026-08-18T16:59:59.999Z"))).toBe("2026-08-18");
    expect(bangkokDay(at("2026-08-18T17:00:00.000Z"))).toBe("2026-08-19");
    expect(bangkokHour(at("2026-08-18T16:59:59.999Z"))).toBe("23");
    expect(bangkokHour(at("2026-08-18T17:00:00.000Z"))).toBe("00");
  });

  it("keeps midnight UTC inside the same Bangkok day", () => {
    expect(bangkokDay(at("2026-08-18T23:59:59Z"))).toBe("2026-08-19");
    expect(bangkokDay(at("2026-08-19T00:00:00Z"))).toBe("2026-08-19");
    expect(bangkokHour(at("2026-08-19T00:00:00Z"))).toBe("07");
  });

  it("pads the hour to two digits", () => {
    expect(bangkokHour(at("2026-08-18T18:30:00Z"))).toBe("01");
    expect(bangkokHour(at("2026-08-18T09:00:00Z"))).toBe("16");
  });

  it("crosses a month and a year boundary at the same 17:00Z line", () => {
    expect(bangkokDay(at("2026-08-31T16:59:59Z"))).toBe("2026-08-31");
    expect(bangkokDay(at("2026-08-31T17:00:00Z"))).toBe("2026-09-01");
    expect(bangkokDay(at("2026-12-31T17:00:00Z"))).toBe("2027-01-01");
  });
});

describe("dayStartMs", () => {
  it("is 17:00Z on the previous UTC day", () => {
    expect(dayStartMs("2026-08-19")).toBe(at("2026-08-18T17:00:00Z"));
  });

  it("round-trips with bangkokDay", () => {
    for (const day of ["2026-01-01", "2026-02-28", "2026-08-18", "2026-12-31"]) {
      expect(bangkokDay(dayStartMs(day))).toBe(day);
      expect(bangkokDay(dayStartMs(day) + 86399999)).toBe(day);
    }
  });
});

describe("addDays", () => {
  it("is the identity for 0", () => {
    expect(addDays("2026-08-18", 0)).toBe("2026-08-18");
  });

  it("steps forward and backward", () => {
    expect(addDays("2026-08-18", 1)).toBe("2026-08-19");
    expect(addDays("2026-08-18", -1)).toBe("2026-08-17");
    expect(addDays("2026-08-18", 7)).toBe("2026-08-25");
    expect(addDays("2026-08-18", -30)).toBe("2026-07-19");
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("walks a whole week one day at a time without drifting", () => {
    let day = "2026-08-18";
    const seen: string[] = [];
    for (let i = 0; i < 7; i++) {
      day = addDays(day, 1);
      seen.push(day);
    }
    expect(seen).toEqual([
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
      "2026-08-24",
      "2026-08-25",
    ]);
  });
});

describe("archive keys", () => {
  it("are stable, prefixed paths derived from the Bangkok day", () => {
    const day = bangkokDay(at("2026-08-18T17:30:00Z"));
    expect(day).toBe("2026-08-19");
    expect(keys.waterlevelDay(day, "10")).toBe("archive/waterlevel/2026-08-19/10.json.gz");
    expect(keys.snapshot(day, bangkokHour(at("2026-08-18T17:30:00Z")))).toBe(
      "archive/snapshots/2026-08-19/00.json.gz",
    );
    expect(keys.dams(day)).toBe("archive/dams/2026-08-19.json.gz");
    expect(keys.index(day)).toBe("archive/index/2026-08-19.json");
  });

  it("makes the flood scene ISO timestamp filesystem-safe", () => {
    expect(keys.flood("2026-08-18T09:15:30.500Z")).toBe(
      "archive/flood/2026-08-18T09-15-30-500Z.json.gz",
    );
  });
});
