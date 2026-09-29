import { ADVICE_ITEMS, CAUTION_ITEMS, LUCKY_COLORS, MESSAGE_ITEMS } from "./content";
import { calendarDayOrdinal } from "./date";
import type { DailyHoroscope, Fortune, FortuneDimension, ZodiacSign } from "./types";
import { ZODIAC_SIGNS } from "./zodiac";

/** Bump when score rules, content ID pools, selection, or PRNG change. */
export const HOROSCOPE_GENERATOR_VERSION = 1;

type ScoreTuple = readonly [career: number, wealth: number, love: number, energy: number];
type ScoreTier = "top" | "low" | "middle" | "high";

// Scores are deliberately authored. Every tuple varies across at least two dimensions.
// Weighted ranges: top 45–48, low 18–29, middle 30–38, high 39–44.
const SCORE_POOLS: Readonly<Record<ScoreTier, readonly ScoreTuple[]>> = {
  top: [
    [5, 4, 5, 5], [5, 5, 4, 5], [5, 5, 5, 4], [4, 5, 5, 5],
    [5, 4, 4, 5], [5, 5, 4, 4], [4, 5, 4, 5], [5, 4, 5, 4],
  ],
  low: [
    [2, 2, 2, 3], [3, 2, 2, 2], [1, 3, 3, 2], [2, 3, 2, 3],
    [3, 2, 3, 2], [2, 4, 2, 2], [3, 3, 2, 3], [2, 2, 3, 3],
  ],
  middle: [
    [3, 3, 3, 4], [4, 3, 3, 3], [3, 4, 3, 3], [3, 3, 4, 3],
    [4, 3, 4, 3], [3, 4, 3, 4], [4, 4, 3, 3], [3, 3, 4, 4],
  ],
  high: [
    [5, 4, 4, 3], [3, 4, 5, 5], [4, 5, 5, 3], [4, 4, 3, 5],
    [5, 3, 4, 4], [4, 5, 3, 5], [5, 4, 3, 4], [3, 5, 4, 5],
  ],
};

const DIMENSIONS = ["career", "wealth", "love", "energy"] as const satisfies readonly FortuneDimension[];

/** Fixed FNV-1a 32-bit hash. Seed strings consist of stable ASCII IDs. */
function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Mulberry32 with unsigned arithmetic at each step. */
function makeRandom(...parts: readonly (string | number)[]): () => number {
  let state = hash32(["yume-horoscope", `v${HOROSCOPE_GENERATOR_VERSION}`, ...parts].join("|"));
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1) >>> 0;
    value ^= (value + Math.imul(value ^ (value >>> 7), value | 61)) >>> 0;
    return (value ^ (value >>> 14)) >>> 0;
  };
}

function pick<T>(items: readonly T[], ...seed: readonly (string | number)[]): T {
  if (items.length === 0) throw new Error("Horoscope content pool is empty");
  return items[makeRandom(...seed)() % items.length];
}

function shuffled<T>(items: readonly T[], ...seed: readonly (string | number)[]): T[] {
  const result = [...items];
  const random = makeRandom(...seed);
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = random() % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function topCandidateForDate(dateKey: string): ZodiacSign {
  const ordinal = calendarDayOrdinal(dateKey);
  const block = Math.floor(ordinal / 3);
  const offset = ((ordinal % 3) + 3) % 3;
  return shuffled(ZODIAC_SIGNS, "top", block)[offset];
}

function weightedUnits([career, wealth, love, energy]: ScoreTuple): number {
  return career * 3 + wealth * 2 + love * 2 + energy * 3;
}

function selectedMessage(scores: ScoreTuple, dateKey: string, sign: ZodiacSign) {
  const max = Math.max(...scores);
  if (max >= 4) {
    const scopes = DIMENSIONS.filter((_, index) => scores[index] === max);
    const scope = pick(scopes, dateKey, sign, "message-scope-high");
    return pick(MESSAGE_ITEMS.filter((item) => item.scope === scope && item.band === "high"), dateKey, sign, "message-high");
  }
  const min = Math.min(...scores);
  if (min <= 2) {
    const scopes = DIMENSIONS.filter((_, index) => scores[index] === min);
    const scope = pick(scopes, dateKey, sign, "message-scope-low");
    return pick(MESSAGE_ITEMS.filter((item) => item.scope === scope && item.band === "low"), dateKey, sign, "message-low");
  }
  return pick(MESSAGE_ITEMS.filter((item) => item.band === "neutral"), dateKey, sign, "message-neutral");
}

function makeFortune(dateKey: string, sign: ZodiacSign, tier: ScoreTier): Fortune {
  const scores = pick(SCORE_POOLS[tier], dateKey, sign, "scores");
  const [career, wealth, love, energy] = scores;
  const units = weightedUnits(scores);
  const stars = Math.round(units / 10);
  const scoreByDimension: Readonly<Record<FortuneDimension, number>> = { career, wealth, love, energy };

  const matchingAdvice = ADVICE_ITEMS.filter((item) => item.scope !== "all" && scoreByDimension[item.scope] >= 4);
  const advicePool = matchingAdvice.length >= 2 ? matchingAdvice : ADVICE_ITEMS.filter((item) => item.scope === "all");
  const [firstAdvice, secondAdvice] = shuffled(advicePool, dateKey, sign, "advice");

  const matchingCautions = CAUTION_ITEMS.filter((item) => item.scope !== "all" && scoreByDimension[item.scope] <= 2);
  const cautionPool = matchingCautions.length > 0 ? matchingCautions : CAUTION_ITEMS.filter((item) => item.scope === "all");

  return {
    sign,
    career,
    wealth,
    love,
    energy,
    overallUnits: units,
    displayStars: stars,
    luckyColorId: pick(LUCKY_COLORS, dateKey, sign, "color").id,
    luckyNumber: (makeRandom(dateKey, sign, "number")() % 9) + 1,
    adviceIds: [firstAdvice.id, secondAdvice.id],
    cautionId: pick(cautionPool, dateKey, sign, "caution").id,
    messageId: selectedMessage(scores, dateKey, sign).id,
  };
}

/** Pure, versioned result: neither locale nor personal preference enters the seed. */
export function generateDailyHoroscope(dateKey: string): DailyHoroscope {
  const candidate = topCandidateForDate(dateKey);
  const others = shuffled(ZODIAC_SIGNS.filter((sign) => sign !== candidate), dateKey, "tiers");
  const tierBySign = new Map<ZodiacSign, ScoreTier>([[candidate, "top"]]);
  others.forEach((sign, index) => {
    tierBySign.set(sign, index < 2 ? "low" : index < 8 ? "middle" : "high");
  });
  const fortunes = ZODIAC_SIGNS.map((sign) => makeFortune(dateKey, sign, tierBySign.get(sign)!));
  const highest = fortunes.reduce((best, current) => current.overallUnits > best.overallUnits ? current : best);
  if (highest.sign !== candidate || fortunes.some((fortune) => fortune.sign !== candidate && fortune.overallUnits >= highest.overallUnits)) {
    throw new Error("Horoscope top score invariant failed");
  }
  return {
    date: dateKey,
    generatorVersion: HOROSCOPE_GENERATOR_VERSION,
    topSign: highest.sign,
    fortunes,
  };
}
