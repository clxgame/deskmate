import {
  DEFAULT_PERSONA_ID,
  personaById,
  personaLabel,
} from "../pet/personaCatalog";

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
    .replaceAll("小碟", displayName)
    .replaceAll("Dishy", displayName)
    .replaceAll("샤오디에", displayName);
}
