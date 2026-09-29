import type { AdviceId, CautionId, LuckyColorId, MessageId } from "./content";

export type ZodiacSign =
  | "aries"
  | "taurus"
  | "gemini"
  | "cancer"
  | "leo"
  | "virgo"
  | "libra"
  | "scorpio"
  | "sagittarius"
  | "capricorn"
  | "aquarius"
  | "pisces";

export type FortuneDimension = "career" | "wealth" | "love" | "energy";

export interface Fortune {
  readonly sign: ZodiacSign;
  readonly career: number;
  readonly wealth: number;
  readonly love: number;
  readonly energy: number;
  readonly overallUnits: number;
  readonly displayStars: number;
  readonly luckyColorId: LuckyColorId;
  readonly luckyNumber: number;
  readonly adviceIds: readonly [AdviceId, AdviceId];
  readonly cautionId: CautionId;
  readonly messageId: MessageId;
}

export interface DailyHoroscope {
  readonly date: string;
  readonly generatorVersion: number;
  readonly topSign: ZodiacSign;
  readonly fortunes: readonly Fortune[];
}
