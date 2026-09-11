export type PackName = {
  readonly zh: string;
  readonly en: string;
  readonly ja: string;
  readonly ko: string;
};

type PackDefinition = {
  readonly name: PackName;
  readonly cover: string;
  readonly preferredPersona: string;
};

const definitions: Readonly<Record<string, PackDefinition>> = {
  baobao: {
    name: { zh: "包包", en: "Baobao", ja: "包包", ko: "바오바오" },
    cover: "baobao.png", preferredPersona: "baobao",
  },
  xiaoxiongchong: {
    name: { zh: "小熊虫", en: "Xiaoxiongchong", ja: "小熊虫", ko: "샤오슝충" },
    cover: "xiaoxiongchong.png", preferredPersona: "xiaoxiongchong",
  },
  aki: {
    name: { zh: "aki 团子", en: "aki Dango", ja: "aki 団子", ko: "aki 당고" },
    cover: "aki.png",
    preferredPersona: "aimisi",
  },
} as const;

export class PackAuthoringError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "PackAuthoringError";
  }
}

export function parsePersonaIds(ids: readonly string[]): readonly string[] {
  for (const id of ids) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw new PackAuthoringError(`Persona id must be a safe path segment: ${id}`);
    }
  }
  if (new Set(ids).size !== ids.length) {
    throw new PackAuthoringError("Duplicate persona ids are not allowed");
  }
  return ids;
}

export function packMetadata(packId: string, ids: readonly string[]) {
  const definition = definitions[packId];
  if (!Object.hasOwn(definitions, packId) || !definition) {
    throw new PackAuthoringError(`Add a build-only definition in scripts/pack-metadata.ts for pack ${packId}`);
  }
  const firstPersona = ids[0];
  if (!firstPersona) throw new PackAuthoringError("A pack must contain at least one persona");
  const coverPersona = ids.includes(definition.preferredPersona)
    ? definition.preferredPersona
    : firstPersona;
  return {
    name: definition.name,
    thumbnail: `personas/${coverPersona}/pack-thumbnail.png`,
    cover: definition.cover,
  };
}
