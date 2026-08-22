import type { PetMood } from "../lib/petState";

export interface PersonaName {
  readonly zh: string;
  readonly en: string;
  readonly ja: string;
  readonly ko: string;
}

export interface PersonaClips {
  readonly idle: string;
  readonly thinking: string;
  readonly talking: string;
  readonly working: string;
  readonly error: string;
}

export interface PersonaEntry {
  readonly id: string;
  readonly name: PersonaName;
  readonly clips: PersonaClips;
  readonly scale: number;
}

const STANDARD_CLIPS: PersonaClips = {
  idle: "Idle",
  thinking: "Thinking",
  talking: "Talking",
  working: "Working",
  error: "Error",
};

const PIXEL_CLIPS: PersonaClips = {
  idle: "Idle",
  thinking: "Think",
  talking: "Wave",
  working: "Dance",
  error: "Sad",
};

const NAMES: Readonly<Record<string, PersonaName>> = {
  aimisi: { zh: "爱弥斯", en: "Aemeath", ja: "エイメス", ko: "에이메스" },
  aogusita: {
    zh: "奥古斯塔",
    en: "Augusta",
    ja: "オーガスタ",
    ko: "아우구스타",
  },
  bulante: { zh: "布兰特", en: "Brant", ja: "ブラント", ko: "브렌트" },
  carlotta: { zh: "珂莱塔", en: "Carlotta", ja: "カルロッタ", ko: "카를로타" },
  changli: { zh: "长离", en: "Changli", ja: "長離", ko: "장리" },
  chun: { zh: "椿", en: "Camellya", ja: "ツバキ", ko: "카멜리아" },
  daniya: { zh: "达妮娅", en: "Denia", ja: "ダーニャ", ko: "데니아" },
  feibi: { zh: "菲比", en: "Phoebe", ja: "フィービー", ko: "페비" },
  feixue: { zh: "绯雪", en: "Hiyuki", ja: "緋雪", ko: "히유키" },
  fuluoluo: { zh: "弗洛洛", en: "Phrolova", ja: "フローヴァ", ko: "플로로" },
  jinxi: { zh: "今汐", en: "Jinhsi", ja: "今汐", ko: "금희" },
  kakaluo: { zh: "卡卡罗", en: "Calcharo", ja: "カカロ", ko: "카카루" },
  kanteleila: {
    zh: "坎特蕾拉",
    en: "Cantarella",
    ja: "カンタレラ",
    ko: "칸타렐라",
  },
  katixiya: {
    zh: "卡提希娅",
    en: "Cartethyia",
    ja: "カルテジア",
    ko: "카르티시아",
  },
  linnai: { zh: "琳奈", en: "Lynae", ja: "リンネー", ko: "린네" },
  luhesi: {
    zh: "陆·赫斯",
    en: "Luuk Herssen",
    ja: "リューク・ヘルセン",
    ko: "루크・헤르센",
  },
  luokeke: { zh: "洛可可", en: "Roccia", ja: "ロココ", ko: "로코코" },
  moning: { zh: "莫宁", en: "Mornye", ja: "モーニエ", ko: "모니에" },
  qianxiao: { zh: "千咲", en: "Chisa", ja: "千咲", ko: "치사" },
  shouanren: {
    zh: "守岸人",
    en: "The Shorekeeper",
    ja: "ショアキーパー",
    ko: "파수인",
  },
  xigelika: { zh: "西格莉卡", en: "Sigrika", ja: "シグリカ", ko: "시그리카" },
  younuo: { zh: "尤诺", en: "Iuno", ja: "ユーノ", ko: "유노" },
  zanni: { zh: "赞妮", en: "Zani", ja: "ザンニー", ko: "젠니" },
  zhujue_FM: { zh: "漂泊者（女）", en: "Rover", ja: "漂泊者", ko: "방랑자" },
  zhujue_M: { zh: "漂泊者（男）", en: "Rover", ja: "漂泊者", ko: "방랑자" },
  xiaozhu: { zh: "小著", en: "Xiaozhu", ja: "小著", ko: "샤오주" },
};

const SCALES: Readonly<Record<string, number>> = {
  aimisi: 0.839,
  aogusita: 1.05,
  bulante: 0.85,
  carlotta: 1,
  changli: 0.85,
  chun: 0.92,
  daniya: 0.97,
  feibi: 0.92,
  feixue: 0.85,
  fuluoluo: 1.08,
  jinxi: 1.01,
  kakaluo: 1.02,
  kanteleila: 0.96,
  katixiya: 0.88,
  linnai: 1.06,
  luhesi: 0.9,
  luokeke: 1,
  moning: 0.89,
  qianxiao: 1.08,
  shouanren: 0.95,
  xigelika: 1.03,
  younuo: 0.97,
  zanni: 0.95,
  zhujue_FM: 0.94,
  zhujue_M: 0.93,
  xiaozhu: 1,
};

const PERSONA_ALIASES: Readonly<Record<string, string>> = {
  "pixel-glasses-chibi": "xiaozhu",
};

export const DEFAULT_PERSONA_ID = "aimisi";

export const PERSONAS: readonly PersonaEntry[] = Object.entries(NAMES)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([id, name]) => ({
    id,
    name,
    clips: id === "xiaozhu" ? PIXEL_CLIPS : STANDARD_CLIPS,
    scale: SCALES[id] ?? 1,
  }));

const PERSONA_BY_ID = new Map(PERSONAS.map((persona) => [persona.id, persona]));

export function personaLabel(persona: PersonaEntry, language: string): string {
  switch (language) {
    case "zh-CN":
    case "zh-TW":
      return persona.name.zh;
    case "ja-JP":
      return persona.name.ja;
    case "ko-KR":
      return persona.name.ko;
    default:
      return persona.name.en;
  }
}

export function personaById(id: string): PersonaEntry {
  const canonicalId = PERSONA_ALIASES[id] ?? id;
  return (
    PERSONA_BY_ID.get(canonicalId) ??
    PERSONA_BY_ID.get(DEFAULT_PERSONA_ID) ??
    PERSONAS[0]
  );
}

export function personaClipName(id: string, mood: PetMood): string {
  const clips = personaById(id).clips;
  return clips[mood];
}

export function personaModelUrl(id: string): string {
  return `/personas/${personaById(id).id}/figure.glb`;
}

export function personaTextureRoot(id: string): string {
  return `/personas/${personaById(id).id}/textures`;
}
