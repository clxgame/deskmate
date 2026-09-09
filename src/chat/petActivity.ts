import type { PetActivityEvent, PetActivityScope, PetMood } from "../lib/petState";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createChatPetActivity(emit: (event: PetActivityEvent) => void) {
  let current: PetActivityScope | null = null;
  const messages = new Set<string>();
  const toolMessages = new Set<string>();
  let candidate: string | null = null;
  let idle = false;
  let latestMessage: string | null = null;
  const matches = (scope: PetActivityScope) => current?.sessionId === scope.sessionId && current.requestId === scope.requestId;
  const terminal = (type: "success" | "error" | "cancel", scope: PetActivityScope | null = current) => {
    if (!scope || !matches(scope)) return;
    emit({ ...scope, type, eventId: crypto.randomUUID() });
    current = null;
    messages.clear();
    toolMessages.clear();
    candidate = null;
    idle = false;
    latestMessage = null;
  };
  return {
    start(scope: PetActivityScope) {
      terminal("cancel");
      current = scope;
      emit({ ...scope, type: "start", eventId: crypto.randomUUID() });
    },
    isCurrent: matches,
    cancel: () => terminal("cancel"),
    success: (scope: PetActivityScope) => terminal("success", scope),
    error: (scope: PetActivityScope) => terminal("error", scope),
    sessionError(sessionId: unknown) {
      if (current && sessionId === current.sessionId) terminal("error");
    },
    idle(sessionId: unknown) {
      if (!current || sessionId !== current.sessionId) return;
      idle = true;
      if (candidate) terminal("success");
    },
    mood(mood: PetMood) {
      if (current) emit({ ...current, type: "mood", mood, eventId: crypto.randomUUID() });
    },
    message(value: unknown) {
      if (!record(value) || !current || value.sessionID !== current.sessionId || value.parentID !== current.requestId || value.role !== "assistant") return;
      if (typeof value.id === "string") {
        if (messages.has(value.id) && latestMessage !== value.id) return;
        if (!messages.has(value.id) && messages.size > 0) { candidate = null; idle = false; }
        messages.add(value.id);
        latestMessage = value.id;
      }
      if (value.error) { terminal("error"); return; }
      if (!record(value.time) || typeof value.time.completed !== "number") return;
      if (value.finish === "stop" && value.summary !== true && typeof value.id === "string" && !toolMessages.has(value.id)) {
        candidate = value.id;
        if (idle) terminal("success");
      }
      else if (value.finish === "length" || value.finish === "content-filter") terminal("cancel");
    },
    part(value: unknown) {
      if (!record(value) || !current || value.sessionID !== current.sessionId || value.messageID !== latestMessage || typeof value.messageID !== "string") return;
      candidate = null;
      idle = false;
      if (value.type === "text") this.mood("talking");
      else if (value.type === "tool") {
        if (!record(value.metadata) || value.metadata.providerExecuted !== true) toolMessages.add(value.messageID);
        this.mood("working");
      }
    },
  };
}
