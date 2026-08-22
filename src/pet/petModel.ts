import type { PetMood } from "../lib/petState";
import {
  DEFAULT_PERSONA_ID,
  personaClipName,
  personaModelUrl,
  personaTextureRoot,
} from "./personaCatalog";

export const DEFAULT_PET_PERSONA = DEFAULT_PERSONA_ID;
export const PET_MODEL_URL = personaModelUrl(DEFAULT_PERSONA_ID);
export const PET_TEXTURE_ROOT = personaTextureRoot(DEFAULT_PERSONA_ID);

export function clipNameForMood(mood: PetMood): string {
  return personaClipName(DEFAULT_PERSONA_ID, mood);
}
