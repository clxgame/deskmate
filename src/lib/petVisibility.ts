import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type PetVisibilityEvent = {
  readonly phase: "leaving" | "reset";
  readonly token: number;
};

export function onPetVisibility(callback: (event: PetVisibilityEvent) => void): Promise<UnlistenFn> {
  return listen<PetVisibilityEvent>("deskmate://pet-visibility", ({ payload }) => callback(payload));
}

export function acknowledgePetVisibility(token: number): Promise<void> {
  return invoke("acknowledge_pet_visibility", { token });
}

export function registerPetVisibility(personaId: string, animated: boolean): Promise<void> {
  return invoke("register_pet_visibility", { personaId, animated });
}

export function getPetVisibilityError(): Promise<string | null> {
  return invoke("get_pet_visibility_error");
}

export function onPetVisibilityError(callback: (message: string | null) => void): Promise<UnlistenFn> {
  return listen<{ readonly message: string | null }>("deskmate://pet-visibility-error", ({ payload }) => callback(payload.message));
}

export function getPetVisibility(): Promise<boolean> {
  return invoke("get_pet_visibility");
}
