import type { ZodiacSign } from "../../lib/horoscope/zodiac";

export interface HoroscopeLabels {
  readonly featureTitle: string;
  readonly mySign: string;
  readonly unset: string;
  readonly topToday: string;
  readonly myFortune: string;
  readonly allSigns: string;
  readonly overall: string;
  readonly career: string;
  readonly love: string;
  readonly wealth: string;
  readonly energy: string;
  readonly advice: string;
  readonly caution: string;
  readonly luckyColor: string;
  readonly luckyNumber: string;
  readonly yumeSays: string;
  readonly topBadge: string;
  readonly zodiac: Readonly<Record<ZodiacSign, string>>;
  readonly starRating: (label: string, stars: number) => string;
}

const zh: HoroscopeLabels = {
  featureTitle: "今日星运", mySign: "我的星座", unset: "未设置", topToday: "今日最旺",
  myFortune: "我的星运", allSigns: "全部星座", overall: "综合", career: "事业", love: "爱情",
  wealth: "财运", energy: "活力", advice: "宜", caution: "忌", luckyColor: "幸运色",
  luckyNumber: "幸运数字", yumeSays: "Yume", topBadge: "今日最旺",
  zodiac: { aries: "白羊座", taurus: "金牛座", gemini: "双子座", cancer: "巨蟹座", leo: "狮子座", virgo: "处女座", libra: "天秤座", scorpio: "天蝎座", sagittarius: "射手座", capricorn: "摩羯座", aquarius: "水瓶座", pisces: "双鱼座" },
  starRating: (label, stars) => `${label}，${stars} / 5`,
};

const en: HoroscopeLabels = {
  featureTitle: "Daily horoscope", mySign: "My sign", unset: "Not set", topToday: "Today's brightest",
  myFortune: "My horoscope", allSigns: "All signs", overall: "Overall", career: "Career", love: "Love",
  wealth: "Money", energy: "Energy", advice: "Good for", caution: "Take care with", luckyColor: "Lucky color",
  luckyNumber: "Lucky number", yumeSays: "Yume", topBadge: "Today's brightest",
  zodiac: { aries: "Aries", taurus: "Taurus", gemini: "Gemini", cancer: "Cancer", leo: "Leo", virgo: "Virgo", libra: "Libra", scorpio: "Scorpio", sagittarius: "Sagittarius", capricorn: "Capricorn", aquarius: "Aquarius", pisces: "Pisces" },
  starRating: (label, stars) => `${label}, ${stars} out of 5`,
};

const ja: HoroscopeLabels = {
  featureTitle: "今日の星運", mySign: "私の星座", unset: "未設定", topToday: "今日いちばんの星座",
  myFortune: "私の星運", allSigns: "すべての星座", overall: "総合", career: "仕事", love: "恋愛",
  wealth: "金運", energy: "活力", advice: "おすすめ", caution: "気をつけて", luckyColor: "ラッキーカラー",
  luckyNumber: "ラッキーナンバー", yumeSays: "Yume", topBadge: "今日いちばん",
  zodiac: { aries: "おひつじ座", taurus: "おうし座", gemini: "ふたご座", cancer: "かに座", leo: "しし座", virgo: "おとめ座", libra: "てんびん座", scorpio: "さそり座", sagittarius: "いて座", capricorn: "やぎ座", aquarius: "みずがめ座", pisces: "うお座" },
  starRating: (label, stars) => `${label}、5つ星中${stars}つ`,
};

const ko: HoroscopeLabels = {
  featureTitle: "오늘의 별자리 운세", mySign: "내 별자리", unset: "설정 안 함", topToday: "오늘의 최고 운세",
  myFortune: "내 운세", allSigns: "모든 별자리", overall: "종합", career: "일", love: "사랑",
  wealth: "재물", energy: "활력", advice: "하면 좋은 일", caution: "조심할 일", luckyColor: "행운의 색",
  luckyNumber: "행운의 숫자", yumeSays: "Yume", topBadge: "오늘의 최고",
  zodiac: { aries: "양자리", taurus: "황소자리", gemini: "쌍둥이자리", cancer: "게자리", leo: "사자자리", virgo: "처녀자리", libra: "천칭자리", scorpio: "전갈자리", sagittarius: "사수자리", capricorn: "염소자리", aquarius: "물병자리", pisces: "물고기자리" },
  starRating: (label, stars) => `${label}, 5점 중 ${stars}점`,
};

export function horoscopeLabels(language: string): HoroscopeLabels {
  switch (language) {
    case "en-US": return en;
    case "ja-JP": return ja;
    case "ko-KR": return ko;
    default: return zh;
  }
}
