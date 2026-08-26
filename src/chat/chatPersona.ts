import {
  DEFAULT_PERSONA_ID,
  personaById,
  personaLabel,
} from "../pet/personaCatalog";

export const XIAOZHU_NAME_ORIGIN_LINES = [
  "因为本人：系著名当代游戏电子游戏音乐先锋级选手",
  "霄·太郎是也~",
  "当然..",
  "您叫我小著就行..嘿嘿..",
] as const;

export const XIAOZHU_IDENTITY_REPLY =
  "你好！我是当代游戏电子游戏音乐先锋——小著。";

const XIAOZHU_NAME_ORIGIN_PATTERNS = [
  /(?:为什么|为何|怎么|怎样|为啥).{0,16}(?:是|叫|称作|称呼|取名|叫做).{0,16}小著/u,
  /(?:叫|称作|称呼|取名|叫做)小著.{0,16}(?:为什么|为何|怎么|怎样|为啥|来头|由来|原因|理由)/u,
  /小著.{0,16}(?:为什么|为何|怎么|怎样|为啥).{0,16}(?:叫|称作|称呼|取名|叫做|名字|是)/u,
  /(?:名字|称呼).{0,16}(?:为什么|为何|怎么|怎样|为啥).{0,16}(?:是|叫|称作|称呼|取名|叫做).{0,16}小著/u,
  /小著.{0,16}(?:是什么意思|什么意思|啥意思|怎么来的|由来|来历)/u,
  /小著.{0,16}(?:这个名字|名字).{0,16}(?:怎么|为什么|为啥|意思|含义|意义|由来|来历)/u,
  /小著.{0,16}(?:有什么|有何).{0,8}(?:含义|意义|意思)/u,
] as const;

const XIAOZHU_IDENTITY_PATTERNS = [
  /^(?:你|您)(?:是誰|是谁)$/u,
  /^(?:你|您).{0,8}(?:是誰|是谁|什么人|哪位)$/u,
  /^(?:你|您)(?:叫什麼|叫什么|叫啥|叫什么名字)$/u,
  /^(?:你|您).{0,8}(?:叫什麼|叫什么|叫啥|什么名字)$/u,
  /^(?:介绍|介紹)(?:一下)?(?:你自己|自己)$/u,
  /^(?:自我介绍|自我介紹|介绍自己|介紹自己)$/u,
  /^(?:我想知道|想知道|请问)(?:你|您)(?:是誰|是谁|叫什麼|叫什么|叫啥)$/u,
  /^(?:可以|能|能否|能不能|麻烦|请)?(?:简单)?(?:介绍|介紹)(?:一下)?(?:你自己|自己)$/u,
] as const;

function normalizePersonaQuestion(text: string): string {
  return text
    .replace(/\s+/gu, "")
    .replace(/[？?！!。.,，、：:；;“”"'「」]/gu, "")
    .replace(/(?:啊|呀|呢|嘛|吗|吧|呗|喂|诶|哎|来着)+$/u, "");
}

export function isXiaozhuNameOriginQuestion(text: string): boolean {
  const normalized = normalizePersonaQuestion(text);
  return XIAOZHU_NAME_ORIGIN_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

export function isXiaozhuIdentityQuestion(text: string): boolean {
  const normalized = normalizePersonaQuestion(text);
  return XIAOZHU_IDENTITY_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function resolvePersonaId(id: string | null | undefined): string {
  return personaById(id?.trim() || DEFAULT_PERSONA_ID).id;
}

export function personaDisplayName(
  id: string | null | undefined,
  language: string,
): string {
  return personaLabel(personaById(resolvePersonaId(id)), language);
}

export function shouldResetSessionForPersona(
  currentId: string | null | undefined,
  nextId: string | null | undefined,
): boolean {
  return resolvePersonaId(currentId) !== resolvePersonaId(nextId);
}

export function personalizePersonaCopy(
  copy: string,
  displayName: string,
): string {
  return copy
    .replaceAll("小著", displayName)
    .replaceAll("Dishy", displayName)
    .replaceAll("샤오디에", displayName);
}

export function userNameInstruction(userName: string): string | undefined {
  const preferredName = userName.trim();
  if (!preferredName) return undefined;
  return [
    "# 对用户的称呼（最高优先级）",
    `- 用户指定的称呼是 ${JSON.stringify(preferredName)}。`,
    "- 当需要称呼用户时，始终使用该称呼；它覆盖角色设定中的默认称呼。",
    "- 用户没有指定称呼时，才保留角色设定中的默认称呼。",
  ].join("\n");
}
