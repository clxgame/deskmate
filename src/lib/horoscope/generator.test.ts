import { describe, expect, test } from "bun:test";
import { ADVICE_ITEMS, CAUTION_ITEMS, LUCKY_COLORS, MESSAGE_ITEMS, horoscopeContent } from "./content";
import { calendarDayOrdinal } from "./date";
import { generateDailyHoroscope, HOROSCOPE_GENERATOR_VERSION, topCandidateForDate } from "./generator";
import type { Fortune, FortuneDimension } from "./types";
import { ZODIAC_SIGNS, isZodiacSign } from "./zodiac";

const LANGUAGES = ["zh-CN", "en-US", "ja-JP", "ko-KR"] as const;
const DIMENSIONS = ["career", "wealth", "love", "energy"] as const satisfies readonly FortuneDimension[];

function datesBetween(start: string, count: number): string[] {
  const startDate = new Date(`${start}T12:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(startDate.getTime());
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function assertContentMatchesScores(fortune: Fortune): void {
  const advice = fortune.adviceIds.map((id) => ADVICE_ITEMS.find((item) => item.id === id));
  expect(advice.every(Boolean)).toBe(true);
  expect(new Set(fortune.adviceIds).size).toBe(2);
  for (const item of advice) {
    if (item!.scope !== "all") expect(fortune[item!.scope]).toBeGreaterThanOrEqual(4);
  }
  const caution = CAUTION_ITEMS.find((item) => item.id === fortune.cautionId);
  expect(caution).toBeDefined();
  if (caution!.scope !== "all") expect(fortune[caution!.scope]).toBeLessThanOrEqual(2);

  const message = MESSAGE_ITEMS.find((item) => item.id === fortune.messageId);
  expect(message).toBeDefined();
  if (message!.band === "high") {
    expect(message!.scope).not.toBe("all");
    expect(fortune[message!.scope as FortuneDimension]).toBe(Math.max(...DIMENSIONS.map((dimension) => fortune[dimension])));
    expect(fortune[message!.scope as FortuneDimension]).toBeGreaterThanOrEqual(4);
  } else if (message!.band === "low") {
    expect(message!.scope).not.toBe("all");
    expect(fortune[message!.scope as FortuneDimension]).toBe(Math.min(...DIMENSIONS.map((dimension) => fortune[dimension])));
    expect(fortune[message!.scope as FortuneDimension]).toBeLessThanOrEqual(2);
  } else {
    expect(DIMENSIONS.every((dimension) => fortune[dimension] === 3)).toBe(true);
  }
}

describe("daily horoscope generator", () => {
  test("is stable across calls, unrelated days, and rebuilt instances", () => {
    const first = generateDailyHoroscope("2026-09-30");
    generateDailyHoroscope("2027-01-03");
    expect(generateDailyHoroscope("2026-09-30")).toEqual(first);
    expect(first).not.toBe(generateDailyHoroscope("2026-09-30"));
    expect(first.generatorVersion).toBe(HOROSCOPE_GENERATOR_VERSION);
    expect(first.date).toBe("2026-09-30");
  });

  test("keeps known version 1 samples stable", () => {
    const examples = [
      { date: "2024-02-29", sign: "virgo", units: 48, color: "teal", number: 4, message: "career_high_flow" },
      { date: "2026-09-30", sign: "scorpio", units: 47, color: "rose", number: 6, message: "energy_high_move" },
      { date: "2026-12-31", sign: "aquarius", units: 45, color: "teal", number: 2, message: "wealth_high_care" },
    ] as const;
    for (const example of examples) {
      const result = generateDailyHoroscope(example.date);
      const top = result.fortunes.find((fortune) => fortune.sign === result.topSign)!;
      expect(result.topSign).toBe(example.sign);
      expect(top.overallUnits).toBe(example.units);
      expect(top.luckyColorId).toBe(example.color);
      expect(top.luckyNumber).toBe(example.number);
      expect(top.messageId).toBe(example.message);
    }
  });

  test("produces twelve valid scorecards and tier counts over a leap-year sample", () => {
    for (const date of datesBetween("2024-01-01", 366)) {
      const result = generateDailyHoroscope(date);
      expect(result.fortunes.map((fortune) => fortune.sign)).toEqual([...ZODIAC_SIGNS]);
      const units: number[] = [];
      for (const fortune of result.fortunes) {
        for (const dimension of DIMENSIONS) {
          expect(Number.isInteger(fortune[dimension])).toBe(true);
          expect(fortune[dimension]).toBeGreaterThanOrEqual(1);
          expect(fortune[dimension]).toBeLessThanOrEqual(5);
        }
        const actual = fortune.career * 3 + fortune.wealth * 2 + fortune.love * 2 + fortune.energy * 3;
        expect(fortune.overallUnits).toBe(actual);
        expect(fortune.displayStars).toBe(Math.round(actual / 10));
        expect(fortune.luckyNumber).toBeGreaterThanOrEqual(1);
        expect(fortune.luckyNumber).toBeLessThanOrEqual(9);
        expect(LUCKY_COLORS.some((color) => color.id === fortune.luckyColorId)).toBe(true);
        assertContentMatchesScores(fortune);
        units.push(actual);
      }
      const top = result.fortunes.find((fortune) => fortune.sign === result.topSign)!;
      expect(result.topSign).toBe(topCandidateForDate(date));
      expect(top.overallUnits).toBe(Math.max(...units));
      expect(units.filter((value) => value === top.overallUnits)).toHaveLength(1);
      expect(units.filter((value) => value >= 45 && value <= 48)).toHaveLength(1);
      expect(units.filter((value) => value >= 18 && value <= 29)).toHaveLength(2);
      expect(units.filter((value) => value >= 30 && value <= 38)).toHaveLength(6);
      expect(units.filter((value) => value >= 39 && value <= 44)).toHaveLength(3);
    }
  });

  test("never gives one sign more than two consecutive top days", () => {
    let previous = "";
    let run = 0;
    for (const date of datesBetween("2023-12-25", 390)) {
      const sign = generateDailyHoroscope(date).topSign;
      run = sign === previous ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(2);
      previous = sign;
    }
    expect(calendarDayOrdinal("2024-03-01") - calendarDayOrdinal("2024-02-29")).toBe(1);
    expect(calendarDayOrdinal("2025-01-01") - calendarDayOrdinal("2024-12-31")).toBe(1);
  });

  test("varies actual data across representative dates", () => {
    const first = generateDailyHoroscope("2026-09-30");
    const second = generateDailyHoroscope("2026-10-01");
    expect(first.fortunes.map((fortune) => fortune.overallUnits)).not.toEqual(second.fortunes.map((fortune) => fortune.overallUnits));
    expect(first.fortunes.map((fortune) => fortune.messageId)).not.toEqual(second.fortunes.map((fortune) => fortune.messageId));
  });

  test("rejects invalid date keys and zodiac IDs", () => {
    for (const date of ["2026-02-29", "2026-13-01", "2026-9-1", "today", "2026-00-10"]) {
      expect(() => generateDailyHoroscope(date)).toThrow(RangeError);
    }
    expect(isZodiacSign("aries")).toBe(true);
    expect(isZodiacSign("Aries")).toBe(false);
    expect(isZodiacSign(42)).toBe(false);
  });
});

describe("horoscope translations", () => {
  test("keeps enough applicable material for every dimension and fallback", () => {
    for (const dimension of DIMENSIONS) {
      expect(ADVICE_ITEMS.filter((item) => item.scope === dimension).length).toBeGreaterThanOrEqual(3);
      expect(CAUTION_ITEMS.filter((item) => item.scope === dimension).length).toBeGreaterThanOrEqual(3);
      expect(MESSAGE_ITEMS.filter((item) => item.scope === dimension && item.band === "high").length).toBeGreaterThanOrEqual(3);
      expect(MESSAGE_ITEMS.filter((item) => item.scope === dimension && item.band === "low").length).toBeGreaterThanOrEqual(3);
    }
    expect(ADVICE_ITEMS.filter((item) => item.scope === "all").length).toBeGreaterThanOrEqual(2);
    expect(CAUTION_ITEMS.filter((item) => item.scope === "all").length).toBeGreaterThanOrEqual(2);
    expect(MESSAGE_ITEMS.filter((item) => item.band === "neutral").length).toBeGreaterThanOrEqual(2);
    for (const pool of [LUCKY_COLORS, ADVICE_ITEMS, CAUTION_ITEMS, MESSAGE_ITEMS]) {
      expect(new Set(pool.map((item) => item.id)).size).toBe(pool.length);
    }
  });

  test("covers each selected ID in every supported language", () => {
    for (const language of LANGUAGES) {
      const content = horoscopeContent(language);
      for (const item of LUCKY_COLORS) expect(content.colors[item.id].trim()).not.toBe("");
      for (const item of ADVICE_ITEMS) expect(content.advice[item.id].trim()).not.toBe("");
      for (const item of CAUTION_ITEMS) expect(content.cautions[item.id].trim()).not.toBe("");
      for (const item of MESSAGE_ITEMS) expect(content.messages[item.id].trim()).not.toBe("");
    }
    expect(horoscopeContent("unexpected")).toBe(horoscopeContent("zh-CN"));
  });

  test("translations do not change generated scores or content IDs", () => {
    const original = generateDailyHoroscope("2026-09-30");
    for (const language of LANGUAGES) {
      const content = horoscopeContent(language);
      for (const fortune of original.fortunes) {
        expect(content.colors[fortune.luckyColorId]).toBeTruthy();
        expect(content.advice[fortune.adviceIds[0]]).toBeTruthy();
        expect(content.advice[fortune.adviceIds[1]]).toBeTruthy();
        expect(content.cautions[fortune.cautionId]).toBeTruthy();
        expect(content.messages[fortune.messageId]).toBeTruthy();
      }
      expect(generateDailyHoroscope("2026-09-30")).toEqual(original);
    }
  });
});
