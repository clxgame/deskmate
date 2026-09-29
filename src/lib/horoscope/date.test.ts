import { expect, test } from "bun:test";
import { calendarDayOrdinal, localDateKey, nextLocalMidnight } from "./date";

test("uses the local calendar and the following local midnight", () => {
  const now = new Date(2026, 8, 30, 23, 45);
  expect(localDateKey(now)).toBe("2026-09-30");
  const next = nextLocalMidnight(now);
  expect(next.getFullYear()).toBe(2026);
  expect(next.getMonth()).toBe(9);
  expect(next.getDate()).toBe(1);
  expect(next.getHours()).toBe(0);
  expect(next.getMinutes()).toBe(0);
  expect(now.getHours()).toBe(23);
  expect(() => localDateKey(new Date(Number.NaN))).toThrow(RangeError);
  expect(() => nextLocalMidnight(new Date(Number.NaN))).toThrow(RangeError);
});

test("validates Gregorian calendar dates and day ordinals", () => {
  expect(calendarDayOrdinal("2024-02-29") - calendarDayOrdinal("2024-02-28")).toBe(1);
  expect(calendarDayOrdinal("2024-03-01") - calendarDayOrdinal("2024-02-29")).toBe(1);
  expect(calendarDayOrdinal("1970-01-01")).toBe(0);
  expect(calendarDayOrdinal("1969-12-31")).toBe(-1);
  expect(calendarDayOrdinal("0001-01-01") + 1).toBe(calendarDayOrdinal("0001-01-02"));
  for (const invalid of ["2025-02-29", "2024-04-31", "2024-00-10", "2024-12-00", "2024/12/01"]) {
    expect(() => calendarDayOrdinal(invalid)).toThrow(RangeError);
  }
});

test("handles offset differences and 23/25-hour days in isolated time zones", () => {
  const script = `
    const {localDateKey, nextLocalMidnight} = await import("./src/lib/horoscope/date.ts");
    const late = new Date(2026, 0, 1, 23, 30);
    const early = new Date(2026, 0, 1, 0, 30);
    const spring = new Date(2026, 2, 8, 0, 0);
    const fall = new Date(2026, 10, 1, 0, 0);
    console.log(JSON.stringify({
      lateKey: localDateKey(late), lateUtc: late.toISOString().slice(0, 10),
      earlyKey: localDateKey(early), earlyUtc: early.toISOString().slice(0, 10),
      springHours: (nextLocalMidnight(spring).getTime() - spring.getTime()) / 3600000,
      fallHours: (nextLocalMidnight(fall).getTime() - fall.getTime()) / 3600000,
    }));
  `;
  function inZone(zone: string) {
    const child = Bun.spawnSync({
      cmd: [process.execPath, "-e", script],
      cwd: process.cwd(),
      env: { ...process.env, TZ: zone },
    });
    expect(child.exitCode).toBe(0);
    return JSON.parse(new TextDecoder().decode(child.stdout));
  }
  const losAngeles = inZone("America/Los_Angeles");
  expect(losAngeles.lateKey).toBe("2026-01-01");
  expect(losAngeles.lateUtc).toBe("2026-01-02");
  expect(losAngeles.springHours).toBe(23);
  expect(losAngeles.fallHours).toBe(25);

  const tokyo = inZone("Asia/Tokyo");
  expect(tokyo.earlyKey).toBe("2026-01-01");
  expect(tokyo.earlyUtc).toBe("2025-12-31");
});
