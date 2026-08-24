import {
  asMemoryError,
  memoryContext,
  memoryCreate,
  memoryForget,
  memoryUpdate,
  type Memory,
  type MemoryErrorCode,
  type MemoryScope,
  type MemoryType,
  type NewMemory,
} from "../lib/memory";

/**
 * Chat-side memory orchestration, kept out of the React component so it can be
 * tested without a DOM and so `ChatApp` stays a view coordinator.
 */

/** What the user is about to save, as shown in the confirmation UI. */
export interface MemoryDraft {
  content: string;
  type: MemoryType;
  scope: MemoryScope;
  personaId: string | null;
  conversationId: string | null;
  messageId: string | null;
}

/** An inline receipt rendered under the message that produced it. */
export interface MemoryReceipt {
  kind: "saved" | "updated" | "forgotten";
  memoryId: string;
  content: string;
  /** Present while an undo is still possible. */
  undoable: boolean;
}

export type MemoryFailure =
  | { kind: "sensitive-confirmation"; draft: MemoryDraft }
  | { kind: "secret-rejected" }
  | { kind: "conflict"; memoryId: string }
  | { kind: "disabled" }
  | { kind: "other"; code: MemoryErrorCode };

/**
 * Default classification for something the user asked to remember.
 *
 * Deliberately conservative: identity and boundary phrasings become global
 * anchors, a stated liking becomes a preference, and anything else is an event.
 * Rust still re-validates and may refuse.
 */
export function draftFromMessage(options: {
  text: string;
  personaId: string;
  conversationId: string | null;
  messageId: string | null;
}): MemoryDraft {
  const text = options.text.trim();
  const type = inferType(text);
  // Shared moments belong to the persona that lived them; facts about the user
  // are shared so every persona addresses them correctly.
  const scope: MemoryScope = type === "shared_moment" ? "persona" : "global";
  return {
    content: text,
    type,
    scope,
    personaId: scope === "persona" ? options.personaId : null,
    conversationId: options.conversationId,
    messageId: options.messageId,
  };
}

const IDENTITY_PATTERNS = [/叫我/, /我的名字/, /称呼我/, /call me/i];
const BOUNDARY_PATTERNS = [/不要/, /别再/, /请勿/, /don'?t /i, /stop /i];
const PREFERENCE_PATTERNS = [/喜欢/, /讨厌/, /偏好/, /习惯/, /prefer/i, /hate/i];
const ROUTINE_PATTERNS = [/每天/, /每周/, /通常/, /一般都/, /every day/i];
const GOAL_PATTERNS = [/我想/, /打算/, /目标/, /计划/, /want to/i, /plan to/i];
const MOMENT_PATTERNS = [/一起/, /我们/, /陪我/, /together/i];

function inferType(text: string): MemoryType {
  if (IDENTITY_PATTERNS.some((pattern) => pattern.test(text))) return "identity";
  if (BOUNDARY_PATTERNS.some((pattern) => pattern.test(text))) return "boundary";
  if (ROUTINE_PATTERNS.some((pattern) => pattern.test(text))) return "routine";
  if (PREFERENCE_PATTERNS.some((pattern) => pattern.test(text))) {
    return "preference";
  }
  if (GOAL_PATTERNS.some((pattern) => pattern.test(text))) return "goal";
  if (MOMENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return "shared_moment";
  }
  return "event";
}

/**
 * A stable key for the fact types where a new value should replace the old one.
 *
 * Episodic types get no key so they accumulate instead of overwriting.
 */
export function stableKeyFor(draft: MemoryDraft): string | null {
  switch (draft.type) {
    case "identity":
      return "identity.preferred_name";
    case "boundary":
      return `boundary.${fingerprint(draft.content)}`;
    case "preference":
      return `preference.${fingerprint(draft.content)}`;
    case "routine":
      return `routine.${fingerprint(draft.content)}`;
    default:
      return null;
  }
}

/**
 * A short, stable token derived from the content's meaningful characters.
 *
 * Two phrasings of the same preference land on the same key only if they share
 * their significant characters; that is intentional, since a genuinely new
 * preference should not silently overwrite an unrelated one.
 */
function fingerprint(content: string): string {
  const significant = content
    .replace(/[\s\p{P}]/gu, "")
    .slice(0, 12)
    .toLowerCase();
  let hash = 0;
  for (const character of significant) {
    hash = (hash * 31 + character.codePointAt(0)!) % 0xffffffff;
  }
  return hash.toString(36);
}

function toNewMemory(draft: MemoryDraft, sensitiveConfirmed: boolean): NewMemory {
  return {
    scope: draft.scope,
    personaId: draft.personaId,
    type: draft.type,
    memoryKey: stableKeyFor(draft),
    content: draft.content,
    sourceKind: "explicit",
    conversationId: draft.conversationId,
    messageId: draft.messageId,
    sensitiveConfirmed,
  };
}

export type MemoryOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; failure: MemoryFailure };

function toFailure(error: unknown, draft?: MemoryDraft, memoryId?: string): MemoryFailure {
  const { code } = asMemoryError(error);
  switch (code) {
    case "SENSITIVE_CONFIRMATION_REQUIRED":
      // The caller must show the local-storage disclosure and retry.
      return draft
        ? { kind: "sensitive-confirmation", draft }
        : { kind: "other", code };
    case "SECRET_REJECTED":
      return { kind: "secret-rejected" };
    case "CONFLICT":
      return memoryId ? { kind: "conflict", memoryId } : { kind: "other", code };
    case "MEMORY_DISABLED":
      return { kind: "disabled" };
    default:
      return { kind: "other", code };
  }
}

/** Save what the user explicitly asked to remember. */
export async function saveMemory(
  draft: MemoryDraft,
  options: { sensitiveConfirmed?: boolean } = {},
): Promise<MemoryOutcome<MemoryReceipt>> {
  try {
    const memory = await memoryCreate(
      toNewMemory(draft, options.sensitiveConfirmed ?? false),
    );
    return {
      ok: true,
      value: {
        kind: "saved",
        memoryId: memory.id,
        content: memory.content,
        undoable: true,
      },
    };
  } catch (error) {
    return { ok: false, failure: toFailure(error, draft) };
  }
}

/** Edit a memory, refusing to clobber a newer revision from another window. */
export async function editMemory(options: {
  id: string;
  content: string;
  expectedRevision: number;
  sensitiveConfirmed?: boolean;
}): Promise<MemoryOutcome<Memory>> {
  try {
    const memory = await memoryUpdate({
      id: options.id,
      content: options.content,
      expectedRevision: options.expectedRevision,
      sensitiveConfirmed: options.sensitiveConfirmed ?? false,
    });
    return { ok: true, value: memory };
  } catch (error) {
    return { ok: false, failure: toFailure(error, undefined, options.id) };
  }
}

/** Hard-delete a memory. Also the undo path for a just-saved memory. */
export async function forgetMemory(
  id: string,
): Promise<MemoryOutcome<{ id: string }>> {
  try {
    await memoryForget(id);
    return { ok: true, value: { id } };
  } catch (error) {
    return { ok: false, failure: toFailure(error, undefined, id) };
  }
}

/**
 * Compose the system prompt for one turn.
 *
 * The memory block always comes last, after the persona and any language
 * override, so stored facts can only add context to the instructions above
 * them.
 */
export function composeSystemPrompt(options: {
  personaPrompt: string | undefined;
  memoryBlock: string;
}): string | undefined {
  const persona = options.personaPrompt?.trim();
  const memory = options.memoryBlock.trim();
  if (!persona && !memory) return undefined;
  if (!memory) return persona;
  if (!persona) return memory;
  return `${persona}\n\n${memory}`;
}

/**
 * Fetch the memory block for a turn.
 *
 * Never throws: a memory failure must not stop the message from being sent.
 */
export async function memoryBlockForTurn(options: {
  personaId: string;
  userText: string;
  enabled: boolean;
}): Promise<string> {
  if (!options.enabled) return "";
  try {
    const context = await memoryContext(options);
    return context.promptBlock;
  } catch (error) {
    // Content-free: only the stable code reaches the console.
    console.warn("memory context skipped", asMemoryError(error).code);
    return "";
  }
}
