import type { PetMood } from "../lib/petState";

/**
 * Persona packs are the unit users install and uninstall. A pack is a category
 * (「AI 替身」, 「aki 团子」, ...) that owns one or more personas together with
 * their prompts and skills.
 *
 * Only built-in packs ship inside the app. Everything else arrives as an
 * offline `.dmpack` archive the user imports by hand, so the installer stays
 * small and large character sets are opt-in.
 */

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

/** A skill file under `skills/<personaId>/`, granted only to that persona. */
export interface PersonaSkillRef {
  readonly id: string;
  readonly file: string;
}

export interface PersonaEntry {
  readonly id: string;
  readonly name: PersonaName;
  readonly clips: PersonaClips;
  readonly scale: number;
  /** Pack this persona belongs to; drives install state and asset paths. */
  readonly packId: string;
  readonly skills?: readonly PersonaSkillRef[];
}

export interface PackName {
  readonly zh: string;
  readonly en: string;
  readonly ja: string;
  readonly ko: string;
}

export interface PackManifest {
  readonly packId: string;
  readonly name: PackName;
  readonly version: string;
  /** Built-in packs ship with the app and cannot be uninstalled. */
  readonly builtin: boolean;
  readonly personas: readonly Omit<PersonaEntry, "packId">[];
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

/**
 * 「AI 替身」— built into every build. 小著 is only ~375 KB and embeds its
 * textures in the GLB, so shipping it keeps a fresh install usable without
 * forcing a download before the pet can appear.
 */
export const AI_SUBSTITUTE_PACK: PackManifest = {
  packId: "ai-substitute",
  name: { zh: "AI 替身", en: "AI Substitute", ja: "AI 代理", ko: "AI 대리" },
  version: "1.0.0",
  builtin: true,
  personas: [
    {
      id: "xiaozhu",
      name: { zh: "小著", en: "Xiaozhu", ja: "小著", ko: "샤오주" },
      clips: PIXEL_CLIPS,
      scale: 1,
      skills: [{ id: "xiaozhu", file: "ncmdump.md" }],
    },
  ],
};

/**
 * 「aki 团子」— 25 personas, ~169 MB of models and textures. Distributed as an
 * offline `.dmpack`; this manifest only describes what the pack contains so the
 * UI can name and scale its personas once imported.
 */
export const AKI_PACK: PackManifest = {
  packId: "aki",
  name: { zh: "aki 团子", en: "aki Dango", ja: "aki 団子", ko: "aki 당고" },
  version: "1.0.0",
  builtin: false,
  personas: [
    { id: "aimisi", name: { zh: "爱弥斯", en: "Aemeath", ja: "エイメス", ko: "에이메스" }, clips: STANDARD_CLIPS, scale: 0.839 },
    { id: "aogusita", name: { zh: "奥古斯塔", en: "Augusta", ja: "オーガスタ", ko: "아우구스타" }, clips: STANDARD_CLIPS, scale: 1.05 },
    { id: "bulante", name: { zh: "布兰特", en: "Brant", ja: "ブラント", ko: "브렌트" }, clips: STANDARD_CLIPS, scale: 0.85 },
    { id: "carlotta", name: { zh: "珂莱塔", en: "Carlotta", ja: "カルロッタ", ko: "카를로타" }, clips: STANDARD_CLIPS, scale: 1 },
    { id: "changli", name: { zh: "长离", en: "Changli", ja: "長離", ko: "장리" }, clips: STANDARD_CLIPS, scale: 0.85 },
    { id: "chun", name: { zh: "椿", en: "Camellya", ja: "ツバキ", ko: "카멜리아" }, clips: STANDARD_CLIPS, scale: 0.92 },
    { id: "daniya", name: { zh: "达妮娅", en: "Denia", ja: "ダーニャ", ko: "데니아" }, clips: STANDARD_CLIPS, scale: 0.97 },
    { id: "feibi", name: { zh: "菲比", en: "Phoebe", ja: "フィービー", ko: "페비" }, clips: STANDARD_CLIPS, scale: 0.92 },
    { id: "feixue", name: { zh: "绯雪", en: "Hiyuki", ja: "緋雪", ko: "히유키" }, clips: STANDARD_CLIPS, scale: 0.85 },
    { id: "fuluoluo", name: { zh: "弗洛洛", en: "Phrolova", ja: "フローヴァ", ko: "플로로" }, clips: STANDARD_CLIPS, scale: 1.08 },
    { id: "jinxi", name: { zh: "今汐", en: "Jinhsi", ja: "今汐", ko: "금희" }, clips: STANDARD_CLIPS, scale: 1.01 },
    { id: "kakaluo", name: { zh: "卡卡罗", en: "Calcharo", ja: "カカロ", ko: "카카루" }, clips: STANDARD_CLIPS, scale: 1.02 },
    { id: "kanteleila", name: { zh: "坎特蕾拉", en: "Cantarella", ja: "カンタレラ", ko: "칸타렐라" }, clips: STANDARD_CLIPS, scale: 0.96 },
    { id: "katixiya", name: { zh: "卡提希娅", en: "Cartethyia", ja: "カルテジア", ko: "카르티시아" }, clips: STANDARD_CLIPS, scale: 0.88 },
    { id: "linnai", name: { zh: "琳奈", en: "Lynae", ja: "リンネー", ko: "린네" }, clips: STANDARD_CLIPS, scale: 1.06 },
    { id: "luhesi", name: { zh: "陆·赫斯", en: "Luuk Herssen", ja: "リューク・ヘルセン", ko: "루크・헤르센" }, clips: STANDARD_CLIPS, scale: 0.9 },
    { id: "luokeke", name: { zh: "洛可可", en: "Roccia", ja: "ロココ", ko: "로코코" }, clips: STANDARD_CLIPS, scale: 1 },
    { id: "moning", name: { zh: "莫宁", en: "Mornye", ja: "モーニエ", ko: "모니에" }, clips: STANDARD_CLIPS, scale: 0.89 },
    { id: "qianxiao", name: { zh: "千咲", en: "Chisa", ja: "千咲", ko: "치사" }, clips: STANDARD_CLIPS, scale: 1.08 },
    { id: "shouanren", name: { zh: "守岸人", en: "The Shorekeeper", ja: "ショアキーパー", ko: "파수인" }, clips: STANDARD_CLIPS, scale: 0.95 },
    { id: "xigelika", name: { zh: "西格莉卡", en: "Sigrika", ja: "シグリカ", ko: "시그리카" }, clips: STANDARD_CLIPS, scale: 1.03 },
    { id: "younuo", name: { zh: "尤诺", en: "Iuno", ja: "ユーノ", ko: "유노" }, clips: STANDARD_CLIPS, scale: 0.97 },
    { id: "zanni", name: { zh: "赞妮", en: "Zani", ja: "ザンニー", ko: "젠니" }, clips: STANDARD_CLIPS, scale: 0.95 },
    { id: "zhujue_FM", name: { zh: "漂泊者（女）", en: "Rover", ja: "漂泊者", ko: "방랑자" }, clips: STANDARD_CLIPS, scale: 0.94 },
    { id: "zhujue_M", name: { zh: "漂泊者（男）", en: "Rover", ja: "漂泊者", ko: "방랑자" }, clips: STANDARD_CLIPS, scale: 0.93 },
  ],
};

/** Packs bundled with the app; always installed, never removable. */
export const BUILTIN_PACKS: readonly PackManifest[] = [AI_SUBSTITUTE_PACK];

/**
 * Every pack the client knows how to describe, installed or not. Importing a
 * `.dmpack` makes its personas available; this list supplies their display
 * metadata so the UI never shows a raw id.
 */
export const KNOWN_PACKS: readonly PackManifest[] = [
  AI_SUBSTITUTE_PACK,
  AKI_PACK,
];

const PACK_BY_ID = new Map(KNOWN_PACKS.map((pack) => [pack.packId, pack]));

const PERSONA_ALIASES: Readonly<Record<string, string>> = {
  "pixel-glasses-chibi": "xiaozhu",
};

/** 小著 ships in every build, so it is always a safe fallback. */
export const DEFAULT_PERSONA_ID = "xiaozhu";

function personasOf(packs: readonly PackManifest[]): PersonaEntry[] {
  return packs.flatMap((pack) =>
    pack.personas.map((persona) => ({ ...persona, packId: pack.packId })),
  );
}

export function packById(packId: string): PackManifest | undefined {
  return PACK_BY_ID.get(packId);
}

/** What the backend reports about a pack that is present on disk. */
export interface InstalledPackState {
  readonly packId: string;
  readonly personaIds: readonly string[];
}

/**
 * Personas available for selection: built-in packs plus the personas an
 * installed pack actually shipped.
 *
 * The install state, not the manifest, decides which personas appear. A pack
 * may be built with a subset of the personas its manifest describes, and
 * offering one whose model is missing would leave the pet unable to render.
 * Unknown pack ids are ignored so a stale setting cannot break the catalog.
 */
export function personaCatalog(
  installed: readonly InstalledPackState[] = [],
): readonly PersonaEntry[] {
  const extra = installed.flatMap((state) => {
    const pack = PACK_BY_ID.get(state.packId);
    if (pack === undefined || pack.builtin) return [];
    const present = new Set(state.personaIds);
    return pack.personas
      .filter((persona) => present.has(persona.id))
      .map((persona) => ({ ...persona, packId: pack.packId }));
  });
  return [...personasOf(BUILTIN_PACKS), ...extra].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}


/** Built-in personas only; used where install state is not available. */
export const PERSONAS: readonly PersonaEntry[] = personaCatalog();

/** Every persona across every known pack, whether installed or not. */
export const ALL_PERSONAS: readonly PersonaEntry[] = personasOf(KNOWN_PACKS).sort(
  (left, right) => left.id.localeCompare(right.id),
);

const PERSONA_BY_ID = new Map(
  ALL_PERSONAS.map((persona) => [persona.id, persona]),
);

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

export function packLabel(pack: PackManifest, language: string): string {
  switch (language) {
    case "zh-CN":
    case "zh-TW":
      return pack.name.zh;
    case "ja-JP":
      return pack.name.ja;
    case "ko-KR":
      return pack.name.ko;
    default:
      return pack.name.en;
  }
}

/**
 * Resolves any persona id, including ones from packs that are not installed, so
 * history and settings written while a pack was present still render. Unknown
 * ids fall back to the default persona.
 */
export function personaById(id: string): PersonaEntry {
  const canonicalId = PERSONA_ALIASES[id] ?? id;
  return (
    PERSONA_BY_ID.get(canonicalId) ??
    PERSONA_BY_ID.get(DEFAULT_PERSONA_ID) ??
    ALL_PERSONAS[0]
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
