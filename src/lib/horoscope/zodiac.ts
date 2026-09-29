import type { ZodiacSign } from "./types";

export type { ZodiacSign } from "./types";

export const ZODIAC_SIGNS = [
  "aries", "taurus", "gemini", "cancer", "leo", "virgo",
  "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces",
] as const satisfies readonly ZodiacSign[];

export const ZODIAC_SYMBOLS: Readonly<Record<ZodiacSign, string>> = {
  aries: "♈", taurus: "♉", gemini: "♊", cancer: "♋",
  leo: "♌", virgo: "♍", libra: "♎", scorpio: "♏",
  sagittarius: "♐", capricorn: "♑", aquarius: "♒", pisces: "♓",
};

const ZODIAC_SET: ReadonlySet<string> = new Set(ZODIAC_SIGNS);

export function isZodiacSign(value: unknown): value is ZodiacSign {
  return typeof value === "string" && ZODIAC_SET.has(value);
}
