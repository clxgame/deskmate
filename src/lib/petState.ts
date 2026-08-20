import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Pet mood states, mapped from opencode agent activity.
 * chat window emits → pet window listens and drives animation/expression.
 */
export type PetMood = "idle" | "thinking" | "talking" | "working" | "error";

const EVENT = "deskmate://pet-mood";

export function broadcastMood(mood: PetMood): void {
  void emit(EVENT, { mood });
}

export function onMood(cb: (mood: PetMood) => void): Promise<UnlistenFn> {
  return listen<{ mood: PetMood }>(EVENT, (e) => cb(e.payload.mood));
}
