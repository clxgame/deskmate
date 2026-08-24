import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Typed client for the Rust-owned memory store.
 *
 * Every type here mirrors `src-tauri/src/memory/domain.rs` and
 * `src-tauri/src/memory/error.rs`. Rust owns validation, sensitivity
 * classification, deduplication, and deletion; this module only carries typed
 * requests across the IPC boundary.
 */

export type MemoryScope = "global" | "persona";

export type MemoryType =
  | "identity"
  | "preference"
  | "boundary"
  | "routine"
  | "goal"
  | "event"
  | "shared_moment"
  | "mood";

export type MemoryStatus = "active" | "superseded" | "expired";

/** `secret` is never a stored value: Rust rejects it before persistence. */
export type Sensitivity = "normal" | "sensitive" | "secret";

export type SourceKind = "explicit" | "extracted" | "onboarding" | "follow_up";

export type MemoryAction =
  | "created"
  | "updated"
  | "superseded"
  | "forgotten"
  | "cleared"
  | "relationship_updated";

export interface Memory {
  id: string;
  scope: MemoryScope;
  personaId: string | null;
  type: MemoryType;
  memoryKey: string | null;
  content: string;
  status: MemoryStatus;
  confidence: number;
  importance: number;
  sensitivity: Sensitivity;
  sourceKind: SourceKind;
  validFrom: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
  supersedesId: string | null;
}

/** Provenance: identifiers only, never a copy of the original message. */
export interface MemorySource {
  conversationId: string | null;
  messageId: string | null;
  sourceKind: SourceKind;
  createdAt: string;
}

/** A memory with its provenance, as shown in the Memory Center. */
export interface MemoryRecord extends Memory {
  sources: MemorySource[];
  linkedTaskIds: string[];
}

export interface NewMemory {
  scope: MemoryScope;
  personaId?: string | null;
  type: MemoryType;
  memoryKey?: string | null;
  content: string;
  importance?: number | null;
  expiresAt?: string | null;
  sourceKind: SourceKind;
  conversationId?: string | null;
  messageId?: string | null;
  /** Set only after the user accepted the sensitive-storage disclosure. */
  sensitiveConfirmed?: boolean;
}

export interface MemoryUpdate {
  id: string;
  content: string;
  /** The revision the UI last saw; a mismatch returns `CONFLICT`. */
  expectedRevision: number;
  importance?: number | null;
  expiresAt?: string | null;
  sensitiveConfirmed?: boolean;
}

export interface MemoryQuery {
  personaId?: string | null;
  scope?: MemoryScope | null;
  types?: MemoryType[] | null;
  statuses?: MemoryStatus[] | null;
  search?: string | null;
  limit?: number | null;
}

export interface RetrievedMemory {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  content: string;
  importance: number;
}

/** The assembled memory block for one outgoing chat turn. */
export interface RetrievalContext {
  memories: RetrievedMemory[];
  promptBlock: string;
}

export interface RelationshipState {
  personaId: string;
  familiarity: number;
  summary: string;
  revision: number;
  updatedAt: string;
}

export interface MemoryExport {
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  memories: MemoryRecord[];
  relationships: RelationshipState[];
}

/** Cross-window notification payload. Carries ids, never memory content. */
export interface MemoryChange {
  version: number;
  action: MemoryAction;
  memoryId: string | null;
  scope: MemoryScope | null;
  personaId: string | null;
  revision: number | null;
}

export const MEMORY_CHANGED_EVENT = "deskmate://memory-changed";

/** Stable error codes from `src-tauri/src/memory/error.rs`. */
export const MEMORY_ERROR_CODES = [
  "MEMORY_DISABLED",
  "VALIDATION_FAILED",
  "SENSITIVE_CONFIRMATION_REQUIRED",
  "SECRET_REJECTED",
  "CONFLICT",
  "NOT_FOUND",
  "MIGRATION_FAILED",
  "STORAGE_UNAVAILABLE",
  "EXPORT_FAILED",
] as const;

export type MemoryErrorCode = (typeof MEMORY_ERROR_CODES)[number];

export interface MemoryErrorEnvelope {
  code: MemoryErrorCode;
  message: string;
}

const ERROR_CODE_SET: ReadonlySet<string> = new Set(MEMORY_ERROR_CODES);

/**
 * Narrow an unknown rejection into the memory error envelope.
 *
 * A rejection that is not a recognized envelope (an IPC failure, a panic) is
 * reported as `STORAGE_UNAVAILABLE` so callers always have a typed code to
 * branch on.
 */
export function asMemoryError(error: unknown): MemoryErrorEnvelope {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown };
    if (
      typeof candidate.code === "string" &&
      ERROR_CODE_SET.has(candidate.code)
    ) {
      return {
        code: candidate.code as MemoryErrorCode,
        message:
          typeof candidate.message === "string" ? candidate.message : "",
      };
    }
  }
  return {
    code: "STORAGE_UNAVAILABLE",
    message: error instanceof Error ? error.message : String(error),
  };
}

/** Whether the memory database opened successfully this run. */
export function memoryAvailable(): Promise<boolean> {
  return invoke<boolean>("memory_available");
}

export function memoryCreate(memory: NewMemory): Promise<Memory> {
  return invoke<Memory>("memory_create", { memory });
}

export function memoryUpdate(update: MemoryUpdate): Promise<Memory> {
  return invoke<Memory>("memory_update", { update });
}

export function memoryList(query: MemoryQuery = {}): Promise<MemoryRecord[]> {
  return invoke<MemoryRecord[]>("memory_list", { query });
}

/** Hard-deletes the memory: content, provenance, FTS rows, and task links. */
export function memoryForget(id: string): Promise<void> {
  return invoke<void>("memory_forget", { id });
}

/** Deletes a whole scope. Resolves to the number of memories removed. */
export function memoryClear(options: {
  scope?: MemoryScope | null;
  personaId?: string | null;
}): Promise<number> {
  return invoke<number>("memory_clear", {
    scope: options.scope ?? null,
    personaId: options.personaId ?? null,
  });
}

/**
 * Drops memories whose only source was this conversation. Memories with other
 * sources keep existing and lose only the deleted conversation's link.
 */
export function memoryForgetConversation(
  conversationId: string,
): Promise<number> {
  return invoke<number>("memory_forget_conversation", { conversationId });
}

/**
 * Build the memory block for one turn. Never rejects for storage reasons: a
 * disabled or broken store yields an empty context so chat still streams.
 */
export function memoryContext(options: {
  personaId: string;
  userText: string;
  enabled: boolean;
}): Promise<RetrievalContext> {
  return invoke<RetrievalContext>("memory_context", options);
}

export function memoryExport(): Promise<MemoryExport> {
  return invoke<MemoryExport>("memory_export");
}

export function memoryRelationship(
  personaId: string,
): Promise<RelationshipState> {
  return invoke<RelationshipState>("memory_relationship", { personaId });
}

export function memorySetRelationshipSummary(options: {
  personaId: string;
  summary: string;
  expectedRevision: number;
}): Promise<RelationshipState> {
  return invoke<RelationshipState>("memory_set_relationship_summary", options);
}

export function memoryLinkTask(
  memoryId: string,
  taskId: string,
): Promise<void> {
  return invoke<void>("memory_link_task", { memoryId, taskId });
}

export function memoryUnlinkTask(
  memoryId: string,
  taskId: string,
): Promise<void> {
  return invoke<void>("memory_unlink_task", { memoryId, taskId });
}

/** Called when a scheduled task is deleted: drops links, never a memory. */
export function memoryUnlinkDeletedTask(taskId: string): Promise<number> {
  return invoke<number>("memory_unlink_deleted_task", { taskId });
}

/**
 * Reject a payload we do not understand instead of feeding a half-typed object
 * to the UI. An unknown action or version means an older window received a
 * newer event.
 */
export function parseMemoryChange(payload: unknown): MemoryChange | null {
  if (typeof payload !== "object" || payload === null) return null;
  const candidate = payload as Record<string, unknown>;
  if (candidate.version !== 1) return null;
  const action = candidate.action;
  const known: readonly MemoryAction[] = [
    "created",
    "updated",
    "superseded",
    "forgotten",
    "cleared",
    "relationship_updated",
  ];
  if (typeof action !== "string" || !known.includes(action as MemoryAction)) {
    return null;
  }
  const optionalString = (value: unknown): string | null =>
    typeof value === "string" ? value : null;
  const scope = candidate.scope;
  return {
    version: 1,
    action: action as MemoryAction,
    memoryId: optionalString(candidate.memoryId),
    scope: scope === "global" || scope === "persona" ? scope : null,
    personaId: optionalString(candidate.personaId),
    revision: typeof candidate.revision === "number" ? candidate.revision : null,
  };
}

/** Fires in every window whenever memory changes. Re-fetch on receipt. */
export function onMemoryChanged(
  callback: (change: MemoryChange) => void,
): Promise<UnlistenFn> {
  return listen<unknown>(MEMORY_CHANGED_EVENT, (event) => {
    const change = parseMemoryChange(event.payload);
    if (change) callback(change);
  });
}
