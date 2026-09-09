import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Pet mood states, mapped from opencode agent activity.
 * chat window emits → pet window listens and drives animation/expression.
 */
export type PetMood = "idle" | "thinking" | "talking" | "working" | "error";

export type PetActivityScope = {
  readonly sessionId: string;
  readonly requestId: string;
};
export type PetActivityEvent = PetActivityScope & { readonly eventId: string } & (
  | { readonly type: "start" }
  | { readonly type: "success" }
  | { readonly type: "error" }
  | { readonly type: "cancel" }
  | { readonly type: "mood"; readonly mood: PetMood }
);
const ACTIVITY_EVENT = "deskmate://pet-activity";

export function broadcastPetActivity(event: PetActivityEvent): void {
  void emit(ACTIVITY_EVENT, event);
}

export function onPetActivity(cb: (event: PetActivityEvent) => void): Promise<UnlistenFn> {
  return listen<PetActivityEvent>(ACTIVITY_EVENT, (event) => cb(event.payload));
}

const EVENT = "deskmate://pet-mood";

export function broadcastMood(mood: PetMood): void {
  void emit(EVENT, { mood });
}

export function onMood(cb: (mood: PetMood) => void): Promise<UnlistenFn> {
  return listen<{ mood: PetMood }>(EVENT, (e) => cb(e.payload.mood));
}
