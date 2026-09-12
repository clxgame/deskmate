import { expect, test } from "bun:test";
import { weekForDate, weeksForYear, weekLabel } from "./worklogWeek";

test("formats the requested ISO week with Monday through Sunday", () => {
  const week = weekForDate("2026-09-12");
  expect(week).toEqual({ year: 2026, number: 37, start: "2026-09-07", end: "2026-09-13" });
  expect(weekLabel(week, "第{week}周（{range}）")).toBe("第37周（9.7-9.13）");
});

test("keeps cross-year days in the correct ISO week year", () => {
  expect(weekForDate("2027-01-01")).toEqual({ year: 2026, number: 53, start: "2026-12-28", end: "2027-01-03" });
  expect(weekForDate("2025-12-29").number).toBe(1);
  expect(weekForDate("2025-12-29").year).toBe(2026);
  expect(weeksForYear(2026)).toHaveLength(53);
  expect(weeksForYear(2027)).toHaveLength(52);
});
